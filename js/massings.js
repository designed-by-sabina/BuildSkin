// Massing sources: bundled library (Sample Massing/manifest.json) + browser uploads (IndexedDB).
import { listLocal, getLocal, putLocal, deleteLocal } from './store.js';
import { storageGet, storageSet } from './common.js';

const LIBRARY_DIR = 'Sample Massing/';
// Storage keys keep the old 'facade:' prefix so massings saved before the rename still load
const SETTINGS_KEY = 'facade:massingSettings';
const CURRENT_KEY = 'facade:currentMassing';

export const UNITS = ['ft', 'in', 'm', 'cm', 'mm'];

async function libraryItems() {
  try {
    const res = await fetch(encodeURI(LIBRARY_DIR + 'manifest.json'));
    if (!res.ok) return [];
    const overrides = storageGet(SETTINGS_KEY, {});
    return (await res.json()).map(m => {
      const id = 'lib:' + m.file;
      return { id, name: m.name ?? m.file, file: m.file, units: m.units ?? 'ft', up: m.up ?? 'y', source: 'library', ...overrides[id] };
    });
  } catch {
    return [];
  }
}

export async function listMassings() {
  const local = (await listLocal()).sort((a, b) => a.created - b.created).map(m => ({ ...m, source: 'upload' }));
  return [...(await libraryItems()), ...local];
}

export async function loadMassingText(m) {
  if (m.source === 'upload') return m.text;
  const res = await fetch(encodeURI(LIBRARY_DIR + m.file));
  if (!res.ok) throw new Error(`Could not load ${m.file}`);
  return res.text();
}

export async function getMassing(id) {
  if (!id) return null;
  if (id.startsWith('lib:')) return (await libraryItems()).find(m => m.id === id) ?? null;
  const rec = await getLocal(id);
  return rec ? { ...rec, source: 'upload' } : null;
}

export async function saveUpload(file) {
  const rec = {
    id: 'local:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: file.name.replace(/\.obj$/i, ''),
    text: await file.text(),
    units: 'ft',
    up: 'y',
    created: Date.now(),
  };
  await putLocal(rec);
  return { ...rec, source: 'upload' };
}

export async function updateMassingSettings(m, patch) {
  Object.assign(m, patch);
  if (m.source === 'upload') {
    const { source, ...rec } = m;
    await putLocal(rec);
  } else {
    const all = storageGet(SETTINGS_KEY, {});
    all[m.id] = { ...all[m.id], ...patch };
    storageSet(SETTINGS_KEY, all);
  }
}

export const removeMassing = m => deleteLocal(m.id);
export const getCurrentMassingId = () => storageGet(CURRENT_KEY);
export const setCurrentMassingId = id => storageSet(CURRENT_KEY, id);
