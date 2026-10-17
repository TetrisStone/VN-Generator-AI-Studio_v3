import { getDB } from './db';

const IMAGES_STORE = 'images';

export const saveImage = async (id: string, base64: string): Promise<void> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readwrite');
      const store = tx.objectStore(IMAGES_STORE);
      const request = store.put(base64, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB saveImage Error:", err);
    throw err;
  }
};

export const loadImage = async (id: string): Promise<string | null> => {
  if (!id) return null;
  // If it's still an old base64 string because it hasn't migrated but somehow passed here,
  // or a direct link
  if (id.startsWith('data:') || id.startsWith('http')) return id;
  
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const store = tx.objectStore(IMAGES_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB loadImage Error:", err);
    return null;
  }
};

export const deleteImage = async (id: string): Promise<void> => {
  if (!id || id.startsWith('data:') || id.startsWith('http')) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readwrite');
      const store = tx.objectStore(IMAGES_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB deleteImage Error:", err);
    throw err;
  }
};

export const listImageIds = async (): Promise<string[]> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const store = tx.objectStore(IMAGES_STORE);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB listImageIds Error:", err);
    return [];
  }
};
