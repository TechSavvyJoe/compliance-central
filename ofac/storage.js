/**
 * IndexedDB Storage Manager for OFAC SDN Data
 * Handles database initialization, SDN entry storage, and search history
 *
 * MATCHES: TechSavvyJoe/OFAC-Search/utils/storage.js
 */

const DB_NAME = "ComplianceCentralDB";
const DB_VERSION = 2;
const SDN_STORE = "sdnEntries";
const HISTORY_STORE = "searchHistory";
const SETTINGS_STORE = "settings";
const OPEN_TIMEOUT_MS = 10000;
const TRANSACTION_TIMEOUT_MS = 20000;

let db = null;
let opening = null;

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  if (db) return db;
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(
      "Opening the OFAC database timed out. Reload the extension and try again."
    )), OPEN_TIMEOUT_MS);

    request.onerror = () => fail(new Error("Could not open the OFAC database. Reload the extension and try again."));
    request.onblocked = () => fail(new Error(
      "The OFAC database is busy. Close other Compliance Central panels, reload the extension, and try again."
    ));

    request.onsuccess = (event) => {
      const database = event.target.result;
      // A timed-out open can still succeed later. Never publish or retain it.
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      db = database;
      const forget = () => { if (db === database) db = null; };
      database.onversionchange = () => {
        database.close();
        forget();
      };
      database.onclose = forget;
      resolve(database);
    };

    request.onupgradeneeded = (event) => {
      if (settled) {
        request.transaction?.abort();
        return;
      }
      const database = event.target.result;

      // SDN Entries Store
      if (!database.objectStoreNames.contains(SDN_STORE)) {
        const sdnStore = database.createObjectStore(SDN_STORE, {
          keyPath: "uid",
        });
        sdnStore.createIndex("lastName", "lastName", { unique: false });
        sdnStore.createIndex("firstName", "firstName", { unique: false });
        sdnStore.createIndex("type", "type", { unique: false });
        sdnStore.createIndex("program", "program", { unique: false });
      }

      // The search-history store was created but never written to or read
      // from: `saveSearchHistory`, `getSearchHistory` and `clearSearchHistory`
      // had no callers anywhere. An empty object store literally named
      // "searchHistory" sitting in every user's browser is the kind of thing a
      // reviewer reasonably asks about in an extension that handles ID
      // numbers, so version 2 removes it.
      if (database.objectStoreNames.contains(HISTORY_STORE)) {
        database.deleteObjectStore(HISTORY_STORE);
      }

      // Settings Store
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
  }).finally(() => { opening = null; });
  return opening;
}

// Resolve writes only after commit. A deadline aborts the transaction, so late
// request events cannot publish data or mark an unfinished refresh as current.
async function transact(storeName, mode, work) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], mode);
    let settled = false;
    let result;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      const error = new Error("The OFAC database timed out. Reload the extension and try again.");
      finish(error);
      try { transaction.abort(); } catch { /* It may already have completed. */ }
      database.close();
      if (db === database) db = null;
    }, TRANSACTION_TIMEOUT_MS);
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(transaction.error || new Error("OFAC database operation failed."));
    transaction.onabort = () => finish(transaction.error || new Error("OFAC database operation was interrupted."));
    try {
      const request = work(transaction.objectStore(storeName));
      if (request) request.onsuccess = () => { result = request.result; };
    } catch (error) {
      finish(error);
      try { transaction.abort(); } catch { /* No unfinished transaction remains. */ }
    }
  });
}
/**
 * Atomically replace all SDN entries: clears the store and writes the new set
 * within a SINGLE transaction. If the worker dies mid-write or any put fails,
 * the transaction aborts and rolls back, leaving the previous list intact —
 * the DB is never left empty by a partial/failed update.
 * @param {Array} entries - Array of SDN entry objects
 * @returns {Promise<void>}
 */
export async function replaceSDNEntries(entries) {
  // Defense in depth: never let an empty/garbage set wipe the stored list. The
  // caller (performSDNUpdate) already enforces a count floor; this guards any
  // future caller from atomically clearing the DB to nothing.
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("replaceSDNEntries refused an empty entry set");
  }
  return transact(SDN_STORE, "readwrite", (store) => {
    store.clear();
    for (const entry of entries) {
      store.put(entry);
    }
  });
}

/**
 * Get all SDN entries from the database
 * @returns {Promise<Array>}
 */
export async function getAllSDNEntries() {
  return transact(SDN_STORE, "readonly", (store) => store.getAll());
}

/**
 * Get the count of SDN entries
 * @returns {Promise<number>}
 */
export async function getSDNCount() {
  return transact(SDN_STORE, "readonly", (store) => store.count());
}




/**
 * Save a setting
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 * @returns {Promise<void>}
 */
export async function saveSetting(key, value) {
  await transact(SETTINGS_STORE, "readwrite", (store) => store.put({ key, value }));
}

/**
 * Get a setting
 * @param {string} key - Setting key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  const result = await transact(SETTINGS_STORE, "readonly", (store) => store.get(key));
  return result ? result.value : null;
}
