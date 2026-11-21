import { ASSETS_STORE, IMAGES_STORE, getDB } from './db';

export type AssetKind = 'image' | 'audio' | 'video' | 'model';

export interface AssetMeta {
  mime?: string;
  kind?: AssetKind;
  width?: number;
  height?: number;
  createdAt?: number;
}

export interface AssetRecord {
  id: string;
  blob: Blob;
  mime: string;
  kind: AssetKind;
  bytes: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface AssetSummary {
  id: string;
  mime: string;
  kind: AssetKind;
  bytes: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface StorageStatus {
  persisted: boolean;
  usage: number;
  quota: number;
  freeRatio: number;
  lowSpace: boolean;
}

const urlCache = new Map<string, { url: string; refs: number }>();
// Old URLs replaced via saveAsset while still referenced by active UI remain valid until released.
const staleUrlRefs = new Map<string, number>();
const inFlightBlobs = new Map<string, Promise<Blob | null>>();
const writeEpoch = new Map<string, number>();

export const isDirectUrl = (id: string): boolean =>
  id.startsWith('http://') ||
  id.startsWith('https://') ||
  id.startsWith('data:') ||
  id.startsWith('blob:') ||
  id.startsWith('/');

export const detectAssetKind = (mime: string): AssetKind => {
  const lower = (mime || '').toLowerCase();
  if (lower.startsWith('audio/')) return 'audio';
  if (lower.startsWith('video/')) return 'video';
  if (lower.startsWith('model/') || lower === 'application/octet-stream') return 'model';
  return 'image';
};

export const isGlbBytes = (buf: ArrayBuffer): boolean => {
  if (buf.byteLength < 4) return false;
  const view = new Uint8Array(buf, 0, 4);
  return view[0] === 0x67 && view[1] === 0x6c && view[2] === 0x54 && view[3] === 0x46; // "glTF"
};

export const dataUrlToBlob = (dataUrl: string): Blob => {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('Invalid data URL');
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Malformed data URL (missing comma)');
  }
  const header = dataUrl.slice(0, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;,]+)/i);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);

  if (!isBase64) {
    const decoded = decodeURIComponent(payload);
    return new Blob([decoded], { type: mime });
  }

  const bin = atob(payload.replace(/\s+/g, ''));
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
};

const MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const EXT_TO_MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export const mimeToExtension = (mime: string, kind?: AssetKind): string => {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  if (MIME_TO_EXT[clean]) return MIME_TO_EXT[clean];
  if (kind === 'model') return 'glb';
  if (kind === 'audio') return 'mp3';
  if (kind === 'video') return 'mp4';
  if (kind === 'image') return 'png';
  return 'bin';
};

export const extensionToMime = (ext: string): string => {
  const clean = (ext || '').replace(/^\./, '').toLowerCase();
  return EXT_TO_MIME[clean] || 'application/octet-stream';
};

const bumpEpoch = (id: string): number => {
  const next = (writeEpoch.get(id) ?? 0) + 1;
  writeEpoch.set(id, next);
  return next;
};

/** Stores a binary Blob in the `assets` store and invalidates any stale cached ObjectURL. */
export const saveAsset = async (id: string, blob: Blob, meta?: AssetMeta): Promise<AssetRecord> => {
  let mime = meta?.mime || blob.type || 'application/octet-stream';
  if (mime === 'application/octet-stream' && !meta?.kind && blob.size >= 4) {
    try {
      const head = await blob.slice(0, 4).arrayBuffer();
      if (isGlbBytes(head)) mime = 'model/gltf-binary';
    } catch {
      // keep fallback mime
    }
  }
  const kind = meta?.kind || detectAssetKind(mime);
  const normalizedBlob = blob.type === mime ? blob : new Blob([blob], { type: mime });
  const record: AssetRecord = {
    id,
    blob: normalizedBlob,
    mime,
    kind,
    bytes: normalizedBlob.size,
    width: meta?.width,
    height: meta?.height,
    createdAt: meta?.createdAt ?? Date.now(),
  };

  bumpEpoch(id);
  inFlightBlobs.delete(id);

  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    const store = tx.objectStore(ASSETS_STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  const cached = urlCache.get(id);
  if (cached) {
    urlCache.delete(id);
    if (cached.refs <= 0) {
      URL.revokeObjectURL(cached.url);
    } else {
      staleUrlRefs.set(cached.url, (staleUrlRefs.get(cached.url) ?? 0) + cached.refs);
    }
  }

  return record;
};

/** Reads the full AssetRecord (including Blob and metadata) from the `assets` store. */
export const getAssetRecord = async (id: string): Promise<AssetRecord | null> => {
  if (!id || isDirectUrl(id)) return null;
  try {
    const db = await getDB();
    return await new Promise<AssetRecord | null>((resolve, reject) => {
      const tx = db.transaction(ASSETS_STORE, 'readonly');
      const req = tx.objectStore(ASSETS_STORE).get(id);
      req.onsuccess = () => resolve((req.result as AssetRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB getAssetRecord error:', err);
    return null;
  }
};

const readLegacyImageBlob = async (id: string): Promise<Blob | null> => {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains(IMAGES_STORE)) return null;
    const raw = await new Promise<string | Blob | null>((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const req = tx.objectStore(IMAGES_STORE).get(id);
      req.onsuccess = () => resolve((req.result as string | Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!raw) return null;
    if (raw instanceof Blob) return raw;
    if (typeof raw === 'string' && raw.startsWith('data:')) {
      return dataUrlToBlob(raw);
    }
    return null;
  } catch (err) {
    console.error('IndexedDB legacy image fallback error:', err);
    return null;
  }
};

/** Returns the raw Blob for an asset ID (or decodes a `data:` URL). Falls back to legacy `images` store. */
export const getAssetBlob = async (id: string): Promise<Blob | null> => {
  if (!id) return null;
  if (id.startsWith('data:')) {
    try {
      return dataUrlToBlob(id);
    } catch (err) {
      console.error('Failed to decode data URL to Blob:', err);
      return null;
    }
  }
  if (isDirectUrl(id)) return null;

  const rec = await getAssetRecord(id);
  if (rec?.blob) return rec.blob;

  return readLegacyImageBlob(id);
};

/**
 * Returns a cached `blob:` URL for an asset ID and increments its refcount.
 * Direct URLs (`http:`, `https:`, `data:`, `blob:`, `/...`) pass through unchanged.
 */
export const getAssetUrl = async (id: string): Promise<string | null> => {
  if (!id) return null;
  if (isDirectUrl(id)) return id;

  const existing = urlCache.get(id);
  if (existing) {
    existing.refs += 1;
    return existing.url;
  }

  const epochAtStart = writeEpoch.get(id) ?? 0;
  let pending = inFlightBlobs.get(id);
  if (!pending) {
    pending = getAssetBlob(id).finally(() => {
      if (inFlightBlobs.get(id) === pending) {
        inFlightBlobs.delete(id);
      }
    });
    inFlightBlobs.set(id, pending);
  }

  let blob = await pending;
  // If saveAsset/deleteAsset happened while the read was in flight, re-read the latest blob.
  if ((writeEpoch.get(id) ?? 0) !== epochAtStart) {
    blob = await getAssetBlob(id);
  }
  if (!blob) return null;

  const raceWinner = urlCache.get(id);
  if (raceWinner) {
    raceWinner.refs += 1;
    return raceWinner.url;
  }

  const url = URL.createObjectURL(blob);
  urlCache.set(id, { url, refs: 1 });
  return url;
};

/** Decrements the refcount for an asset URL and revokes it once no consumer holds it. */
export const releaseAssetUrl = (id: string | null | undefined, url?: string | null): void => {
  if (!id || isDirectUrl(id)) return;

  if (url && staleUrlRefs.has(url)) {
    const next = (staleUrlRefs.get(url) ?? 0) - 1;
    if (next <= 0) {
      staleUrlRefs.delete(url);
      URL.revokeObjectURL(url);
    } else {
      staleUrlRefs.set(url, next);
    }
    return;
  }

  const entry = urlCache.get(id);
  if (!entry) return;
  if (url && entry.url !== url) return;

  entry.refs -= 1;
  if (entry.refs <= 0) {
    urlCache.delete(id);
    URL.revokeObjectURL(entry.url);
  }
};

/** Deletes an asset from `assets` (and legacy `images` if present) and revokes any cached URL. */
export const deleteAsset = async (id: string): Promise<void> => {
  if (!id || isDirectUrl(id)) return;

  bumpEpoch(id);
  inFlightBlobs.delete(id);

  const cached = urlCache.get(id);
  if (cached) {
    urlCache.delete(id);
    URL.revokeObjectURL(cached.url);
  }

  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const stores = db.objectStoreNames.contains(IMAGES_STORE)
      ? [ASSETS_STORE, IMAGES_STORE]
      : [ASSETS_STORE];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(ASSETS_STORE).delete(id);
    if (stores.length > 1) {
      tx.objectStore(IMAGES_STORE).delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/** Lists lightweight asset summaries via cursor without keeping Blobs in memory. */
export const listAssets = async (): Promise<AssetSummary[]> => {
  try {
    const db = await getDB();
    return await new Promise<AssetSummary[]>((resolve, reject) => {
      const result: AssetSummary[] = [];
      const tx = db.transaction(ASSETS_STORE, 'readonly');
      const req = tx.objectStore(ASSETS_STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as AssetRecord;
          result.push({
            id: rec.id,
            mime: rec.mime,
            kind: rec.kind,
            bytes: rec.bytes ?? rec.blob?.size ?? 0,
            width: rec.width,
            height: rec.height,
            createdAt: rec.createdAt,
          });
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB listAssets error:', err);
    return [];
  }
};

export const listAssetIds = async (): Promise<string[]> => {
  try {
    const db = await getDB();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(ASSETS_STORE, 'readonly');
      const req = tx.objectStore(ASSETS_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB listAssetIds error:', err);
    return [];
  }
};

export const hasAsset = async (id: string): Promise<boolean> => {
  if (!id || isDirectUrl(id)) return false;
  try {
    const db = await getDB();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(ASSETS_STORE, 'readonly');
      const req = tx.objectStore(ASSETS_STORE).count(id);
      req.onsuccess = () => resolve((req.result ?? 0) > 0);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return false;
  }
};

/** Requests persistent browser storage and reports quota / free-space status. */
export const initStoragePersistence = async (): Promise<StorageStatus> => {
  let persisted = false;
  let usage = 0;
  let quota = 0;

  try {
    if (navigator.storage?.persist) {
      persisted = await navigator.storage.persist();
    }
  } catch (err) {
    console.warn('navigator.storage.persist failed:', err);
  }

  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage ?? 0;
      quota = est.quota ?? 0;
    }
  } catch (err) {
    console.warn('navigator.storage.estimate failed:', err);
  }

  const freeRatio = quota > 0 ? Math.max(0, (quota - usage) / quota) : 1;
  const lowSpace = quota > 0 && freeRatio < 0.1;

  return { persisted, usage, quota, freeRatio, lowSpace };
};
