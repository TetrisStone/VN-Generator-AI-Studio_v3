import { getItem, setItem } from './db';
import { clearLegacyImagesStore, getLegacyImageKeys, getLegacyImageRaw } from './imageStorage';
import { dataUrlToBlob, getAssetRecord, hasAsset, saveAsset } from './assetStore';
import { LEGACY_PROJECT_ID, loadProjectFields, loadRegistry, saveProjectFields } from './projects';

export const ASSET_MIGRATION_FLAG = 'assetMigrationV1';

const BATCH_SIZE = 15;
const VERIFY_YIELD_INTERVAL = 50;

const DUNGEON_SANDBOX_KEYS = [
  'dungeon_chunk_library',
  'dungeon_npc_library',
  'dungeon_custom_floor_glb',
  'dungeon_custom_wall_glb',
  'dungeon_custom_door_glb',
  'dungeon_custom_glb_config',
] as const;

export interface MigrationProgress {
  phase: 'images' | 'projects' | 'sandbox' | 'verify' | 'cleanup';
  done: number;
  total: number;
  message: string;
}

export interface MigrationResult {
  alreadyMigrated: boolean;
  migratedImages: number;
  extractedEmbedded: number;
  totalBytes: number;
}

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const isEmbeddedAssetDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && /^data:(image|audio|video|model|application\/octet-stream)[;/,]/i.test(v);

export const runAssetMigrationV1 = async (
  onProgress?: (progress: MigrationProgress) => void
): Promise<MigrationResult> => {
  const alreadyDone = await getItem<boolean>(ASSET_MIGRATION_FLAG);
  if (alreadyDone) {
    return { alreadyMigrated: true, migratedImages: 0, extractedEmbedded: 0, totalBytes: 0 };
  }

  // Maps assetId -> expected byte length for pre-cleanup verification
  const expected = new Map<string, number>();
  let migratedImages = 0;
  let extractedEmbedded = 0;

  // -------------------------------------------------------------------------
  // Phase 1: Migrate `images` store entries into `assets` store in batches
  // -------------------------------------------------------------------------
  const legacyKeys = await getLegacyImageKeys();
  const totalImages = legacyKeys.length;

  for (let i = 0; i < totalImages; i += BATCH_SIZE) {
    const batch = legacyKeys.slice(i, i + BATCH_SIZE);
    for (const id of batch) {
      if (await hasAsset(id)) {
        const existing = await getAssetRecord(id);
        if (existing && existing.blob && existing.blob.size === existing.bytes) {
          expected.set(id, existing.bytes);
          continue;
        }
      }

      const raw = await getLegacyImageRaw(id);
      if (!raw) continue;

      const blob = raw instanceof Blob ? raw : dataUrlToBlob(raw);
      const rec = await saveAsset(id, blob);
      expected.set(id, rec.bytes);
      migratedImages++;
    }

    onProgress?.({
      phase: 'images',
      done: Math.min(i + batch.length, totalImages),
      total: totalImages,
      message: `Migriere Medien in Blob-Speicher (${Math.min(i + batch.length, totalImages)} / ${totalImages})...`,
    });
    await yieldToMain();
  }

  // -------------------------------------------------------------------------
  // Phase 2: Extract embedded `data:` URLs across ALL projects & sandbox keys
  // -------------------------------------------------------------------------
  const dedupeMap = new Map<string, Array<{ raw: string; id: string }>>();

  const extractDataUrl = async (raw: string): Promise<string> => {
    const fp = `${raw.length}:${raw.slice(0, 64)}:${raw.slice(-64)}`;
    const bucket = dedupeMap.get(fp);
    if (bucket) {
      const hit = bucket.find((item) => item.raw === raw);
      if (hit) return hit.id;
    }

    const blob = dataUrlToBlob(raw);
    const id = crypto.randomUUID();
    const rec = await saveAsset(id, blob);
    expected.set(id, rec.bytes);
    extractedEmbedded++;

    if (extractedEmbedded % BATCH_SIZE === 0) {
      await yieldToMain();
    }

    if (bucket) bucket.push({ raw, id });
    else dedupeMap.set(fp, [{ raw, id }]);
    return id;
  };

  const extractEmbeddedInValue = async (root: any): Promise<boolean> => {
    let modified = false;

    const walk = async (node: any): Promise<void> => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let idx = 0; idx < node.length; idx++) {
          const item = node[idx];
          if (isEmbeddedAssetDataUrl(item)) {
            node[idx] = await extractDataUrl(item);
            modified = true;
          } else {
            await walk(item);
          }
        }
      } else {
        for (const key of Object.keys(node)) {
          const val = node[key];
          if (isEmbeddedAssetDataUrl(val)) {
            const id = await extractDataUrl(val);
            if (key === 'dataBase64') {
              node.assetId = id;
              delete node.dataBase64;
            } else {
              node[key] = id;
            }
            modified = true;
          } else {
            await walk(val);
          }
        }
      }
    };

    await walk(root);
    return modified;
  };

  const reg = await loadRegistry();
  const projectIds = reg ? reg.projects.map((p) => p.id) : [LEGACY_PROJECT_ID];

  for (let pIdx = 0; pIdx < projectIds.length; pIdx++) {
    const pid = projectIds[pIdx];
    onProgress?.({
      phase: 'projects',
      done: pIdx,
      total: projectIds.length,
      message: `Prüfe Projekt ${pIdx + 1} / ${projectIds.length} auf eingebettete Dateien...`,
    });

    const data = await loadProjectFields(pid);
    const modified = await extractEmbeddedInValue(data);
    if (modified) {
      await saveProjectFields(pid, data);
    }
    await yieldToMain();
  }

  // Legacy single-project keyval fallback if no registry existed yet
  if (!reg) {
    const legacyKeyvalProject = await getItem<any>('vn_creator_project');
    if (legacyKeyvalProject && typeof legacyKeyvalProject === 'object') {
      const modified = await extractEmbeddedInValue(legacyKeyvalProject);
      if (modified) {
        await setItem('vn_creator_project', legacyKeyvalProject);
      }
    }
  }

  onProgress?.({
    phase: 'projects',
    done: projectIds.length,
    total: projectIds.length,
    message: `Projekte geprüft (${projectIds.length} / ${projectIds.length}).`,
  });

  // Scan standalone Dungeon Sandbox keys in keyval
  for (let sIdx = 0; sIdx < DUNGEON_SANDBOX_KEYS.length; sIdx++) {
    const sbKey = DUNGEON_SANDBOX_KEYS[sIdx];
    onProgress?.({
      phase: 'sandbox',
      done: sIdx,
      total: DUNGEON_SANDBOX_KEYS.length,
      message: `Prüfe 3D-Dungeon-Sandbox (${sIdx + 1} / ${DUNGEON_SANDBOX_KEYS.length})...`,
    });

    const val = await getItem<any>(sbKey);
    if (val && typeof val === 'object') {
      const modified = await extractEmbeddedInValue(val);
      if (modified) {
        await setItem(sbKey, val);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Verify count & exact bytes BEFORE deleting any legacy data
  // -------------------------------------------------------------------------
  let verifiedCount = 0;
  let verifiedBytes = 0;
  let expectedTotalBytes = 0;
  const totalVerify = expected.size;

  for (const [id, expectedBytes] of expected.entries()) {
    expectedTotalBytes += expectedBytes;
    const rec = await getAssetRecord(id);
    if (!rec || !rec.blob || rec.bytes !== expectedBytes || rec.blob.size !== expectedBytes) {
      throw new Error(`Migration verification failed for asset "${id}" (expected ${expectedBytes} bytes).`);
    }
    verifiedCount++;
    verifiedBytes += rec.bytes;

    if (verifiedCount % VERIFY_YIELD_INTERVAL === 0 || verifiedCount === totalVerify) {
      onProgress?.({
        phase: 'verify',
        done: verifiedCount,
        total: totalVerify,
        message: `Verifiziere migrierte Assets (${verifiedCount} / ${totalVerify})...`,
      });
      await yieldToMain();
    }
  }

  if (verifiedCount !== expected.size || verifiedBytes !== expectedTotalBytes) {
    throw new Error(
      `Migration verification mismatch: count ${verifiedCount}/${expected.size}, bytes ${verifiedBytes}/${expectedTotalBytes}.`
    );
  }

  // -------------------------------------------------------------------------
  // Phase 4: Clear legacy `images` store and mark migration complete
  // -------------------------------------------------------------------------
  onProgress?.({
    phase: 'cleanup',
    done: 1,
    total: 1,
    message: 'Schließe Migration ab...',
  });
  await clearLegacyImagesStore();
  await setItem(ASSET_MIGRATION_FLAG, true);

  return {
    alreadyMigrated: false,
    migratedImages,
    extractedEmbedded,
    totalBytes: verifiedBytes,
  };
};
