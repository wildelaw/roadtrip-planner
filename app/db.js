// IndexedDB layer: open + versioned migrations + tiny promise helpers.
// Stores: trips (keyPath id, index updatedAt), ai_conversations (keyPath id, index tripId).

const DB_NAME = 'trip-planner';
const DB_VERSION = 1;

let dbp = null;

export function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('trips')) {
        const s = idb.createObjectStore('trips', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!idb.objectStoreNames.contains('ai_conversations')) {
        const s = idb.createObjectStore('ai_conversations', { keyPath: 'id' });
        s.createIndex('tripId', 'tripId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

// Run a request on a store; resolves with request.result when the txn completes.
async function run(store, mode, makeReq) {
  const idb = await db();
  return new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const req = makeReq(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function getAll(store) {
  return run(store, 'readonly', (s) => s.getAll()).then((r) => r || []);
}

export function getOne(store, id) {
  return run(store, 'readonly', (s) => s.get(id)).then((r) => r || null);
}

export function put(store, value) {
  return run(store, 'readwrite', (s) => s.put(value)).then(() => value);
}

export function del(store, id) {
  return run(store, 'readwrite', (s) => s.delete(id));
}

export function clearStore(store) {
  return run(store, 'readwrite', (s) => s.clear());
}

// IndexedDB availability check (used for the sidebar status line).
export function idbAvailable() {
  try { return typeof indexedDB !== 'undefined'; } catch { return false; }
}