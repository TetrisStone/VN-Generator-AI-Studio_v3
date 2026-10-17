
const DB_NAME = 'VNCreatorDB';
const STORE_NAME = 'keyval'; // legacy store
const IMAGES_STORE = 'images';
const PROJECT_STORE = 'project';

let dbPromise: Promise<IDBDatabase> | null = null;

export const getDB = (): Promise<IDBDatabase> => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onerror = () => {
        dbPromise = null; // Reset on error
        reject(request.error);
      };
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE);
        }
        if (!db.objectStoreNames.contains(PROJECT_STORE)) {
          db.createObjectStore(PROJECT_STORE);
        }
      };
    });
  }
  return dbPromise;
};

export const setItem = async (key: string, value: any): Promise<void> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB Save Error:", err);
    throw err;
  }
};

export const getItem = async <T>(key: string): Promise<T | null> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB Load Error:", err);
    return null;
  }
};

export const deleteItem = async (key: string): Promise<void> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB Delete Error:", err);
    throw err;
  }
};

export const setProjectItem = async (key: string, value: any): Promise<void> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, 'readwrite');
      const store = tx.objectStore(PROJECT_STORE);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB Project Save Error:", err);
    throw err;
  }
};

export const getProjectItem = async <T>(key: string): Promise<T | null> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, 'readonly');
      const store = tx.objectStore(PROJECT_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB Project Load Error:", err);
    return null;
  }
};

export const getAllProjectKeys = async (): Promise<string[]> => {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, 'readonly');
      const store = tx.objectStore(PROJECT_STORE);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB keys error:", err);
    return [];
  }
};

