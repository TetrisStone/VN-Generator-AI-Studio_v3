import { deleteItem, getAllKeyvalKeys, getItem } from './db';
import {
  AssetKind,
  AssetSummary,
  deleteAsset,
  getAssetBlob,
  listAssets,
  saveAsset,
} from './assetStore';
import { compressImage, ImagePreset } from './compressImage';
import { GlbRole, optimizeGlbBlob } from './optimizeGlb';
import {
  collectMediaRefs,
  LEGACY_PROJECT_ID,
  loadProjectFields,
  loadRegistry,
  ProjectData,
} from './projects';

const DUNGEON_SANDBOX_KEYS = [
  'dungeon_chunk_library',
  'dungeon_npc_library',
  'dungeon_custom_floor_glb',
  'dungeon_custom_wall_glb',
  'dungeon_custom_door_glb',
  'dungeon_custom_glb_config',
] as const;

export interface CategoryStats {
  count: number;
  bytes: number;
}

export interface StorageReport {
  totalCount: number;
  totalBytes: number;
  byKind: Record<AssetKind, CategoryStats>;
  orphaned: AssetSummary[];
  orphanedBytes: number;
  legacyBackupKeys: string[];
  quota?: {
    usage: number;
    quota: number;
    freeRatio: number;
  };
}

export interface BatchOptimizeProgress {
  done: number;
  total: number;
  currentId: string;
  currentKind: AssetKind;
  savedBytes: number;
}

export interface BatchOptimizeResult {
  processedCount: number;
  optimizedCount: number;
  skippedCount: number;
  failedCount: number;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  warnings: string[];
}

export interface ProjectReferenceScan {
  referencedIds: Set<string>;
  imagePresets: Map<string, ImagePreset>;
  glbTargets: Map<string, { role: GlbRole; maxTextureSize: 1024 | 2048 }>;
}

const IMAGE_PRESET_PRIORITY: Record<ImagePreset, number> = {
  icon: 1,
  sprite: 2,
  background: 3,
};

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const scanAllProjectReferences = async (
  knownIds: Set<string>
): Promise<ProjectReferenceScan> => {
  const referencedIds = new Set<string>();
  const imagePresets = new Map<string, ImagePreset>();
  const glbTargets = new Map<string, { role: GlbRole; maxTextureSize: 1024 | 2048 }>();

  const markPreset = (id: string | null | undefined, preset: ImagePreset) => {
    if (!id || !knownIds.has(id)) return;
    const prev = imagePresets.get(id);
    if (!prev || IMAGE_PRESET_PRIORITY[preset] > IMAGE_PRESET_PRIORITY[prev]) {
      imagePresets.set(id, preset);
    }
  };

  const markGlb = (
    id: string | null | undefined,
    role: GlbRole,
    maxTextureSize: 1024 | 2048
  ) => {
    if (!id || !knownIds.has(id)) return;
    const rank = role === 'character' && maxTextureSize === 2048 ? 3 : role === 'character' ? 2 : 1;
    const prev = glbTargets.get(id);
    const prevRank = !prev
      ? 0
      : prev.role === 'character' && prev.maxTextureSize === 2048
      ? 3
      : prev.role === 'character'
      ? 2
      : 1;
    if (rank > prevRank) {
      glbTargets.set(id, { role, maxTextureSize });
    }
  };

  const inspectDungeon = (dp: any) => {
    if (!dp || typeof dp !== 'object') return;
    if (dp.baseCharacter?.assetId) markGlb(dp.baseCharacter.assetId, 'character', 2048);
    for (const key of ['baseFloor', 'baseWall', 'baseDoor'] as const) {
      if (dp[key]?.assetId) markGlb(dp[key].assetId, 'chunk', 1024);
    }
    if (Array.isArray(dp.chunkLibrary)) {
      for (const c of dp.chunkLibrary) {
        if (c?.assetId) markGlb(c.assetId, 'chunk', 1024);
      }
    }
    if (Array.isArray(dp.npcLibrary)) {
      for (const n of dp.npcLibrary) {
        if (n?.assetId) markGlb(n.assetId, 'character', 1024);
      }
    }
  };

  const inspectProject = (data: ProjectData) => {
    collectMediaRefs(data, knownIds, referencedIds);

    markPreset(data.worldInfo?.projectMeta?.coverImageId, 'background');
    const skins = (data.worldInfo as any)?.diceConfig?.skins;
    if (skins && typeof skins === 'object') {
      for (const arr of Object.values(skins)) {
        if (Array.isArray(arr)) {
          for (const id of arr) markPreset(id as string, 'icon');
        }
      }
    }

    for (const s of data.scenes ?? []) {
      markPreset(s?.backgroundSrc, 'background');
      markPreset(s?.mapIconSrc, 'icon');
    }
    for (const m of data.maps ?? []) {
      markPreset(m?.backgroundSrc, 'background');
    }
    for (const b of data.battles ?? []) {
      markPreset(b?.backgroundSrc, 'background');
    }
    for (const c of data.characters ?? []) {
      markPreset(c?.imageSrc, 'sprite');
      markPreset(c?.mapSpriteSrc, 'icon');
      if (c?.emotions && typeof c.emotions === 'object') {
        for (const emId of Object.values(c.emotions)) {
          markPreset(emId as string, 'sprite');
        }
      }
      markPreset(c?.battleIdleSrc, 'sprite');
      markPreset(c?.battlePrepSrc, 'sprite');
      markPreset(c?.battleHitSrc, 'sprite');
      if (Array.isArray(c?.woozySprites)) {
        for (const w of c.woozySprites) markPreset(w, 'sprite');
      }
      markPreset(c?.finishSprite, 'sprite');
      if (Array.isArray(c?.finishAnimation)) {
        for (const f of c.finishAnimation) markPreset(f, 'sprite');
      }
      if (c?.model3dSrc) {
        markGlb(c.model3dSrc, 'character', c.importance !== 'side' ? 2048 : 1024);
      }
    }
    for (const a of data.assets ?? []) {
      if (a?.fileUrl) {
        markPreset(a.fileUrl, a.category === 'characters' ? 'sprite' : 'background');
      }
    }
    for (const dp of data.dungeonProjects ?? []) {
      inspectDungeon(dp);
    }
  };

  const reg = await loadRegistry();
  const projectIds = reg ? reg.projects.map((p) => p.id) : [LEGACY_PROJECT_ID];

  for (const p of reg?.projects ?? []) {
    if (p.coverImageId && knownIds.has(p.coverImageId)) {
      referencedIds.add(p.coverImageId);
      markPreset(p.coverImageId, 'background');
    }
  }

  for (const pid of projectIds) {
    const data = await loadProjectFields(pid);
    inspectProject(data);
  }

  // Standalone 3D dungeon sandbox keys in keyval
  for (const sbKey of DUNGEON_SANDBOX_KEYS) {
    const val = await getItem<any>(sbKey);
    if (!val) continue;
    collectMediaRefs(val, knownIds, referencedIds);
    if (sbKey === 'dungeon_custom_glb_config' && val?.assetId) {
      markGlb(val.assetId, 'character', 2048);
    } else if (
      (sbKey === 'dungeon_custom_floor_glb' ||
        sbKey === 'dungeon_custom_wall_glb' ||
        sbKey === 'dungeon_custom_door_glb') &&
      val?.assetId
    ) {
      markGlb(val.assetId, 'chunk', 1024);
    } else if (sbKey === 'dungeon_chunk_library' && Array.isArray(val)) {
      for (const c of val) {
        if (c?.assetId) markGlb(c.assetId, 'chunk', 1024);
      }
    } else if (sbKey === 'dungeon_npc_library' && Array.isArray(val)) {
      for (const n of val) {
        if (n?.assetId) markGlb(n.assetId, 'character', 1024);
      }
    }
  }

  return { referencedIds, imagePresets, glbTargets };
};

export const analyzeStorage = async (): Promise<StorageReport> => {
  const assets = await listAssets();
  const knownIds = new Set(assets.map((a) => a.id));
  const [{ referencedIds }, keyvalKeys] = await Promise.all([
    scanAllProjectReferences(knownIds),
    getAllKeyvalKeys(),
  ]);

  const byKind: Record<AssetKind, CategoryStats> = {
    image: { count: 0, bytes: 0 },
    audio: { count: 0, bytes: 0 },
    video: { count: 0, bytes: 0 },
    model: { count: 0, bytes: 0 },
  };

  let totalBytes = 0;
  let orphanedBytes = 0;
  const orphaned: AssetSummary[] = [];

  for (const asset of assets) {
    const kindBucket = byKind[asset.kind] ?? byKind.image;
    kindBucket.count++;
    kindBucket.bytes += asset.bytes;
    totalBytes += asset.bytes;

    if (!referencedIds.has(asset.id)) {
      orphaned.push(asset);
      orphanedBytes += asset.bytes;
    }
  }

  orphaned.sort((a, b) => b.bytes - a.bytes);
  const legacyBackupKeys = keyvalKeys.filter((k) => k.startsWith('project_backup_'));

  let quota: StorageReport['quota'];
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const q = est.quota ?? 0;
      const u = est.usage ?? 0;
      if (q > 0) {
        quota = {
          usage: u,
          quota: q,
          freeRatio: Math.max(0, (q - u) / q),
        };
      }
    }
  } catch {
    // ignore quota check failures
  }

  return {
    totalCount: assets.length,
    totalBytes,
    byKind,
    orphaned,
    orphanedBytes,
    legacyBackupKeys,
    quota,
  };
};

export const optimizeAllExistingAssets = async (
  onProgress?: (progress: BatchOptimizeProgress) => void
): Promise<BatchOptimizeResult> => {
  const assets = await listAssets();
  const knownIds = new Set(assets.map((a) => a.id));
  const { imagePresets, glbTargets } = await scanAllProjectReferences(knownIds);

  const targets = assets.filter((a) => a.kind === 'image' || a.kind === 'model');
  let optimizedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let beforeBytes = 0;
  let afterBytes = 0;
  const warnings: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const asset = targets[i];
    beforeBytes += asset.bytes;

    try {
      const blob = await getAssetBlob(asset.id);
      if (!blob) {
        afterBytes += asset.bytes;
        skippedCount++;
      } else if (asset.kind === 'image') {
        const preset = imagePresets.get(asset.id) ?? 'background';
        const res = await compressImage(blob, preset);
        if (res.wasCompressed && res.compressedBytes < res.originalBytes) {
          await saveAsset(asset.id, res.blob, {
            kind: 'image',
            mime: res.mime,
            width: res.width,
            height: res.height,
            createdAt: asset.createdAt,
          });
          afterBytes += res.compressedBytes;
          optimizedCount++;
        } else {
          afterBytes += asset.bytes;
          skippedCount++;
        }
      } else {
        const targetOpts = glbTargets.get(asset.id) ?? { role: 'chunk' as GlbRole, maxTextureSize: 1024 as const };
        const res = await optimizeGlbBlob(blob, {
          role: targetOpts.role,
          maxTextureSize: targetOpts.maxTextureSize,
          fileName: asset.id,
        });
        for (const w of res.report.warnings) {
          warnings.push(`${asset.id.slice(0, 12)}: ${w}`);
        }
        if (res.report.errorMessage) {
          failedCount++;
          afterBytes += asset.bytes;
        } else if (!res.report.fallbackUsed && res.report.optimizedBytes < res.report.originalBytes) {
          await saveAsset(asset.id, res.blob, {
            kind: 'model',
            mime: 'model/gltf-binary',
            createdAt: asset.createdAt,
          });
          afterBytes += res.report.optimizedBytes;
          optimizedCount++;
        } else {
          afterBytes += asset.bytes;
          skippedCount++;
        }
      }
    } catch (err: any) {
      console.warn(`Batch optimization failed for ${asset.id}:`, err);
      warnings.push(`${asset.id.slice(0, 12)}: ${err?.message || String(err)}`);
      failedCount++;
      afterBytes += asset.bytes;
    }

    onProgress?.({
      done: i + 1,
      total: targets.length,
      currentId: asset.id,
      currentKind: asset.kind,
      savedBytes: Math.max(0, beforeBytes - afterBytes),
    });
    await yieldToMain();
  }

  return {
    processedCount: targets.length,
    optimizedCount,
    skippedCount,
    failedCount,
    beforeBytes,
    afterBytes,
    savedBytes: Math.max(0, beforeBytes - afterBytes),
    warnings,
  };
};

export const deleteOrphanedAssets = async (ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const candidateSet = new Set(ids);
  const { referencedIds } = await scanAllProjectReferences(candidateSet);
  let deleted = 0;
  for (const id of candidateSet) {
    if (referencedIds.has(id)) continue;
    await deleteAsset(id);
    deleted++;
  }
  return deleted;
};

export const deleteLegacyProjectBackups = async (keys: string[]): Promise<number> => {
  let deleted = 0;
  for (const key of keys) {
    if (!key.startsWith('project_backup_')) continue;
    await deleteItem(key);
    deleted++;
  }
  return deleted;
};
