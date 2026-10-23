// Offline solo persistence: versioned IndexedDB snapshots + bounded event trace.
// Every read/write is guarded: private windows or blocked storage degrade to no-save.
const DB = 'homeless-dark';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { r.result.createObjectStore('snapshots'); r.result.createObjectStore('trace', { autoIncrement: true }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export interface SaveGame {
  schema: 'homeless.save/1';
  savedAt: number;
  gameUtc: number;
  location: { name: string; lat: number; lon: number };
  player: { x: number; y: number; z: number; yaw: number };
  world: unknown; // WorldSnapshot
  npcs: { id: string; memory: unknown[]; relationship: Record<string, number> }[];
  travel: unknown | null;
  settings: Record<string, unknown>;
}

export async function save(slot: string, s: SaveGame): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => { const t = db.transaction('snapshots', 'readwrite'); t.objectStore('snapshots').put(s, slot); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    db.close();
    return true;
  } catch { return false; }
}

export async function load(slot: string): Promise<SaveGame | null> {
  try {
    const db = await open();
    const v = await new Promise<SaveGame | undefined>((res, rej) => { const r = db.transaction('snapshots').objectStore('snapshots').get(slot); r.onsuccess = () => res(r.result as SaveGame | undefined); r.onerror = () => rej(r.error); });
    db.close();
    return v && v.schema === 'homeless.save/1' ? v : null;
  } catch { return null; }
}

export async function appendTrace(events: unknown[]): Promise<void> {
  try {
    const db = await open();
    const t = db.transaction('trace', 'readwrite');
    const st = t.objectStore('trace');
    for (const e of events) st.add(e);
    await new Promise<void>((res) => { t.oncomplete = () => res(); t.onerror = () => res(); });
    db.close();
  } catch { /* storage unavailable: trace stays in memory */ }
}
