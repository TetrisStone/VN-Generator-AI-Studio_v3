import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { closeDB, getDB, getItem, IMAGES_STORE } from '../utils/db';
import {
  getAssetBlob,
  getAssetRecord,
  getAssetUrl,
  listAssets,
  releaseAssetUrl,
  saveAsset,
} from '../utils/assetStore';
import { getLegacyImageKeys } from '../utils/imageStorage';
import { ASSET_MIGRATION_FLAG, runAssetMigrationV1 } from '../utils/migrateAssets';
import { LEGACY_PROJECT_ID, saveProjectFields, loadProjectFields, saveRegistry } from '../utils/projects';
import { analyzeStorage, deleteOrphanedAssets } from '../utils/storageMaintenance';

const putLegacyImage = async (id: string, value: string): Promise<void> => {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    const req = tx.objectStore(IMAGES_STORE).put(value, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const makeSampleGlbDataUrl = async (): Promise<{ dataUrl: string; byteLength: number }> => {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos);
  const mesh = doc.createMesh('SampleTri').addPrimitive(prim);
  const node = doc.createNode('Root').setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  const bytes = await new WebIO().writeBinary(doc);
  return {
    dataUrl: `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`,
    byteLength: bytes.byteLength,
  };
};

describe('Asset Store, Migration V1 & Multi-Project Orphan Cleanup', () => {
  let nextMockUrlId = 1;
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    nextMockUrlId = 1;
    vi.restoreAllMocks();
    createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:test-${nextMockUrlId++}`);
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await closeDB();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('VNCreatorDB');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it('migrates legacy images, extracts inline media & GLBs with deduplication, verifies bytes, and manages refcounted ObjectURLs', async () => {
    const pngId = 'legacy-png-1';
    const mp3Id = 'legacy-mp3-1';
    const mp4Id = 'legacy-mp4-1';
    const pngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const mp3DataUrl = 'data:audio/mpeg;base64,SUQzAwAAAAAA';
    const mp4DataUrl = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';
    const inlineImgUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    await putLegacyImage(pngId, pngDataUrl);
    await putLegacyImage(mp3Id, mp3DataUrl);
    await putLegacyImage(mp4Id, mp4DataUrl);

    const sampleGlb = await makeSampleGlbDataUrl();

    await saveProjectFields(LEGACY_PROJECT_ID, {
      worldInfo: { projectMeta: { title: 'Test VN', coverImageId: pngId } },
      chapters: [{ id: 'ch1', name: 'Ch 1', description: '' }],
      characters: [{ id: 'c1', name: 'Hero', imageSrc: inlineImgUrl, mapSpriteSrc: null }],
      scenes: [
        {
          id: 's1',
          name: 'Intro',
          backgroundSrc: pngId,
          introVideoSrc: mp4Id,
          bgmUrl: mp3Id,
          description: '',
          goal: '',
          characters: [],
        },
      ],
      battles: [],
      maps: [],
      assets: [],
      dungeonProjects: [
        {
          id: 'd1',
          name: 'Dungeon 1',
          sections: [{ id: 'root', name: 'Abschnitt 1' }],
          baseFloor: { fileName: 'floor.glb', fileSize: sampleGlb.byteLength, dataBase64: sampleGlb.dataUrl },
          chunkLibrary: [
            {
              id: 'chunk-floor-1',
              type: 'floor',
              fileName: 'floor.glb',
              fileSize: sampleGlb.byteLength,
              dataBase64: sampleGlb.dataUrl,
            },
          ],
          placedChunks: [],
          npcLibrary: [],
          placedNpcs: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const result = await runAssetMigrationV1();
    expect(result.alreadyMigrated).toBe(false);
    expect(result.migratedImages).toBe(3);
    // 1 inline image + 1 deduplicated GLB (shared across baseFloor and chunkLibrary)
    expect(result.extractedEmbedded).toBe(2);

    // Flag set and legacy store cleared
    expect(await getItem<boolean>(ASSET_MIGRATION_FLAG)).toBe(true);
    expect(await getLegacyImageKeys()).toHaveLength(0);

    // Migrated assets exist as typed Blobs
    const pngRec = await getAssetRecord(pngId);
    const mp3Rec = await getAssetRecord(mp3Id);
    const mp4Rec = await getAssetRecord(mp4Id);
    expect(pngRec?.kind).toBe('image');
    expect(mp3Rec?.kind).toBe('audio');
    expect(mp4Rec?.kind).toBe('video');
    expect(pngRec?.blob).toBeInstanceOf(Blob);

    // Project JSON updated cleanly: inline image replaced, GLBs deduplicated to same assetId
    const migratedProj = await loadProjectFields(LEGACY_PROJECT_ID);
    const extractedCharImgId = migratedProj.characters?.[0]?.imageSrc;
    expect(typeof extractedCharImgId).toBe('string');
    expect(extractedCharImgId.startsWith('data:')).toBe(false);
    expect((await getAssetRecord(extractedCharImgId))?.kind).toBe('image');

    const dp = migratedProj.dungeonProjects?.[0];
    expect(dp.baseFloor.dataBase64).toBeUndefined();
    expect(dp.chunkLibrary[0].dataBase64).toBeUndefined();
    expect(dp.baseFloor.assetId).toBeTruthy();
    expect(dp.baseFloor.assetId).toBe(dp.chunkLibrary[0].assetId);

    const glbBlob = await getAssetBlob(dp.baseFloor.assetId);
    expect(glbBlob).not.toBeNull();
    expect(glbBlob!.size).toBe(sampleGlb.byteLength);

    // Refcounted URL caching & revocation
    const urlA = await getAssetUrl(pngId);
    const urlB = await getAssetUrl(pngId);
    expect(urlA).toBe(urlB);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

    releaseAssetUrl(pngId, urlA);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    releaseAssetUrl(pngId, urlB);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith(urlA);
  });

  it('resumes safely after an aborted partial migration without data loss or duplicates', async () => {
    const id1 = 'partial-1';
    const id2 = 'partial-2';
    const id3 = 'partial-3';
    const id4 = 'partial-4';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await putLegacyImage(id1, dataUrl);
    await putLegacyImage(id2, dataUrl);
    await putLegacyImage(id3, dataUrl);
    await putLegacyImage(id4, dataUrl);

    // Simulate an interrupted run where 2 items were already written to `assets` before crash
    const preBlob = await getAssetBlob(dataUrl);
    await saveAsset(id1, preBlob!);
    await saveAsset(id2, preBlob!);

    const firstResume = await runAssetMigrationV1();
    expect(firstResume.alreadyMigrated).toBe(false);
    expect(firstResume.migratedImages).toBe(2); // Only the 2 remaining entries were written

    const allAssets = await listAssets();
    const ids = allAssets.map((a) => a.id).sort();
    expect(ids).toEqual([id1, id2, id3, id4]);
    expect(await getLegacyImageKeys()).toHaveLength(0);

    // Subsequent start is an instant no-op
    const secondRun = await runAssetMigrationV1();
    expect(secondRun.alreadyMigrated).toBe(true);
  });

  it('identifies orphaned assets across multiple projects and protects referenced assets during deletion', async () => {
    const coverP1 = 'asset-cover-p1';
    const bgP1 = 'asset-bg-p1';
    const charP2 = 'asset-char-p2';
    const orphanId = 'asset-orphan-1';
    const dummyBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });

    await saveAsset(coverP1, dummyBlob, { kind: 'image', mime: 'image/webp' });
    await saveAsset(bgP1, dummyBlob, { kind: 'image', mime: 'image/webp' });
    await saveAsset(charP2, dummyBlob, { kind: 'image', mime: 'image/webp' });
    await saveAsset(orphanId, dummyBlob, { kind: 'image', mime: 'image/webp' });

    await saveRegistry({
      activeId: 'p1',
      projects: [
        { id: 'p1', title: 'Projekt 1', coverImageId: coverP1, createdAt: 1, updatedAt: 1 },
        { id: 'p2', title: 'Projekt 2', coverImageId: null, createdAt: 2, updatedAt: 2 },
      ],
    });

    await saveProjectFields('p1', {
      worldInfo: { projectMeta: { title: 'Projekt 1', coverImageId: coverP1 } },
      scenes: [{ id: 's1', name: 'S1', backgroundSrc: bgP1, description: '', goal: '', characters: [] }],
    });
    await saveProjectFields('p2', {
      worldInfo: { projectMeta: { title: 'Projekt 2' } },
      characters: [{ id: 'c2', name: 'NPC', imageSrc: charP2, mapSpriteSrc: null }],
    });

    const report = await analyzeStorage();
    expect(report.totalCount).toBe(4);
    expect(report.byKind.image.count).toBe(4);
    expect(report.orphaned.map((a) => a.id)).toEqual([orphanId]);

    // Attempting to delete both orphanId and coverP1 must spare coverP1
    const deletedCount = await deleteOrphanedAssets([orphanId, coverP1]);
    expect(deletedCount).toBe(1);
    expect(await getAssetRecord(orphanId)).toBeNull();
    expect(await getAssetRecord(coverP1)).not.toBeNull();
    expect(await getAssetRecord(charP2)).not.toBeNull();
  });
});
