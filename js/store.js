// IndexedDB store for uploaded massing OBJ files (kept in the browser, not on a server).
// DB name predates the BuildSkin rename; kept so existing uploads aren't lost.
const DB_NAME = 'facade-calculator';
const STORE = 'massings';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}

export const listLocal = () => tx('readonly', s => s.getAll());
export const getLocal = id => tx('readonly', s => s.get(id));
export const putLocal = rec => tx('readwrite', s => s.put(rec));
export const deleteLocal = id => tx('readwrite', s => s.delete(id));
