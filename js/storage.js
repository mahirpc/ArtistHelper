// storage.js — persistence layer.
// IndexedDB ("ArtRefDB") holds full-resolution image blobs and project
// snapshots so large references don't hit the ~5MB LocalStorage string quota.
// LocalStorage holds small UI preferences (last-used grid theme, etc).

const DB_NAME = "ArtRefDB";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const PREFS_KEY = "artref_settings";
const MAX_RECENT = 24;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode) {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

export const Storage = {
  /** Save (or update) a project record: { id, name, imageBlob, thumbBlob, projectState, updatedAt } */
  async saveProject(record) {
    const store = await tx(STORE_PROJECTS, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  },

  async getProject(id) {
    const store = await tx(STORE_PROJECTS, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async listRecent(limit = MAX_RECENT) {
    const store = await tx(STORE_PROJECTS, "readonly");
    return new Promise((resolve, reject) => {
      const items = [];
      const idx = store.index("updatedAt");
      const req = idx.openCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && items.length < limit) {
          items.push(cursor.value);
          cursor.continue();
        } else {
          resolve(items);
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteProject(id) {
    const store = await tx(STORE_PROJECTS, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  getPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  setPrefs(patch) {
    try {
      const merged = { ...Storage.getPrefs(), ...patch };
      localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    } catch {
      /* storage disabled or full — ignore, UI prefs are non-critical */
    }
  },
};

export function makeId() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}
