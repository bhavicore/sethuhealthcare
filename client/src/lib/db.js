import { openDB } from 'idb';

const DB_NAME = 'sethu-db';
const DB_VERSION = 1;
export const STORE_VISITS = 'visits';

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_VISITS)) {
          const store = db.createObjectStore(STORE_VISITS, { keyPath: 'localId' });
          store.createIndex('syncStatus', 'syncStatus');
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('abhaId', 'abhaId');
        }
      },
    });
  }
  return dbPromise;
}

function makeLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Save a newly logged PHC visit. Always local-first: written before any network attempt. */
export async function saveVisit(visit) {
  const db = await getDb();
  const record = {
    ...visit,
    localId: makeLocalId(),
    createdAt: new Date().toISOString(),
    syncStatus: 'pending',
    origin: 'phc',
  };
  await db.put(STORE_VISITS, record);
  return record;
}

/** Save a visit record learned from a scanned QR at the CHC end, for local history/audit. */
export async function saveScannedVisit(visit) {
  const db = await getDb();
  const record = {
    ...visit,
    localId: visit.localId || makeLocalId(),
    scannedAt: new Date().toISOString(),
    syncStatus: visit.syncStatus || 'scanned-only',
    origin: 'chc-scan',
  };
  await db.put(STORE_VISITS, record);
  return record;
}

export async function listVisits() {
  const db = await getDb();
  const all = await db.getAll(STORE_VISITS);
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function listPendingVisits() {
  const db = await getDb();
  return db.getAllFromIndex(STORE_VISITS, 'syncStatus', 'pending');
}

export async function markSynced(localId, serverId) {
  const db = await getDb();
  const record = await db.get(STORE_VISITS, localId);
  if (!record) return;
  record.syncStatus = 'synced';
  record.serverId = serverId;
  record.syncedAt = new Date().toISOString();
  await db.put(STORE_VISITS, record);
}

export async function findByAbhaId(abhaId) {
  const db = await getDb();
  return db.getAllFromIndex(STORE_VISITS, 'abhaId', abhaId);
}
