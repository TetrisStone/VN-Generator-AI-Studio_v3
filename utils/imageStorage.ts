import { IMAGES_STORE, getDB } from './db';
import {
  dataUrlToBlob,
  deleteAsset,
  getAssetUrl,
  isDirectUrl,
  listAssetIds,
  saveAsset,
} from './assetStore';

export const saveImage = async (id: string, base64OrDataUrl: string): Promise<void> => {
  const blob = dataUrlToBlob(base64OrDataUrl);
  await saveAsset(id, blob);
};

export const loadImage = async (id: string): Promise<string | null> => {
  if (!id) return null;
  if (isDirectUrl(id)) return id;
  return getAssetUrl(id);
};

export const deleteImage = async (id: string): Promise<void> => {
  await deleteAsset(id);
};

export const getLegacyImageKeys = async (): Promise<string[]> => {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains(IMAGES_STORE)) return [];
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const req = tx.objectStore(IMAGES_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB getLegacyImageKeys Error:', err);
    return [];
  }
};

export const getLegacyImageRaw = async (id: string): Promise<string | Blob | null> => {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains(IMAGES_STORE)) return null;
    return await new Promise<string | Blob | null>((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const req = tx.objectStore(IMAGES_STORE).get(id);
      req.onsuccess = () => resolve((req.result as string | Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB getLegacyImageRaw Error:', err);
    return null;
  }
};

export const clearLegacyImagesStore = async (): Promise<void> => {
  const db = await getDB();
  if (!db.objectStoreNames.contains(IMAGES_STORE)) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    const req = tx.objectStore(IMAGES_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const listImageIds = async (): Promise<string[]> => {
  const [assetIds, legacyIds] = await Promise.all([listAssetIds(), getLegacyImageKeys()]);
  if (legacyIds.length === 0) return assetIds;
  return Array.from(new Set([...assetIds, ...legacyIds]));
};
