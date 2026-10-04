import { DK_ARCHIVE_KEY, emptyDKArchive, readDKArchive, validateDKArchive, type DKArchive } from './draftkings-archive';

export const DK_DATABASE_NAME = 'gridiron-draftkings-storage-v1';
const STORE = 'archives';
let opening: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Browser database storage is unavailable. Existing saves have not been changed.')); return; }
    const request = indexedDB.open(DK_DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Another tab is blocking saved-data storage. Close other app tabs and retry.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}

/** Merge a legacy tab's saves without redefining any frozen forecast. */
function mergeLegacy(current: DKArchive, legacy: DKArchive): DKArchive {
  const existing = new Map(current.slates.map(slate => [slate.id, slate]));
  for (const slate of legacy.slates) {
    const duplicate = existing.get(slate.id);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(slate)) {
      throw new Error('Conflicting versions of a saved slate were found. Both storage copies have been preserved.');
    }
  }
  const key = (score: DKArchive['official'][number]) => JSON.stringify([score.season, score.team, score.playerId, score.week]);
  const official = new Map(legacy.official.map(score => [key(score), score]));
  for (const score of current.official) {
    const prior = official.get(key(score));
    if (!prior || !(Date.parse(prior.enteredAt) > Date.parse(score.enteredAt))) official.set(key(score), score);
  }
  return { ...current,
    slates: [...current.slates, ...legacy.slates.filter(slate => !existing.has(slate.id))],
    official: [...official.values()],
    marketDrafts: { ...legacy.marketDrafts, ...current.marketDrafts },
  };
}

/** Read/merge/write in one transaction: concurrent tabs cannot overwrite each other. */
export async function updateBrowserDKArchive(change?: (archive: DKArchive) => DKArchive): Promise<DKArchive> {
  const db = await openDatabase();
  const legacyRaw = localStorage.getItem(DK_ARCHIVE_KEY);
  const legacy = legacyRaw ? readDKArchive({ getItem: () => legacyRaw, setItem: () => {} }) : null;
  const next = await new Promise<DKArchive>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let result: DKArchive;
    let failure: unknown;
    const abort = (error: unknown) => { failure = error; transaction.abort(); };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Saved-data transaction was interrupted.'));
    transaction.onerror = () => { failure ??= transaction.error; };
    transaction.oncomplete = () => resolve(result);
    const request = store.get(DK_ARCHIVE_KEY);
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? emptyDKArchive() : validateDKArchive(request.result);
        const migrated = legacy ? mergeLegacy(current, legacy) : current;
        result = validateDKArchive(change ? change(migrated) : migrated);
        if (request.result === undefined || change || legacy) {
          store.put(result, DK_ARCHIVE_KEY);
          // Verify the structured-clone copy before allowing migration cleanup.
          const verification = store.get(DK_ARCHIVE_KEY);
          verification.onsuccess = () => {
            try {
              if (JSON.stringify(validateDKArchive(verification.result)) !== JSON.stringify(result)) {
                throw new Error('Saved-data verification failed. Existing saves have not been removed.');
              }
            } catch (error) { abort(error); }
          };
        }
      } catch (error) { abort(error); }
    };
  });
  // Never clear unrelated storage, or a legacy entry changed by another tab.
  try {
    if (legacyRaw && localStorage.getItem(DK_ARCHIVE_KEY) === legacyRaw) localStorage.removeItem(DK_ARCHIVE_KEY);
  } catch (error) { console.warn('DraftKings database save succeeded; legacy backup could not be removed.', error); }
  return next;
}

export const readBrowserDKArchive = () => updateBrowserDKArchive();