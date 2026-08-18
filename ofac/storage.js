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

let db = null;

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open database"));
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
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
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SDN_STORE], "readwrite");
    const store = transaction.objectStore(SDN_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Failed to replace SDN entries"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("SDN replace transaction aborted"));

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
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SDN_STORE], "readonly");
    const store = transaction.objectStore(SDN_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to get SDN entries"));
  });
}

/**
 * Get the count of SDN entries
 * @returns {Promise<number>}
 */
export async function getSDNCount() {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SDN_STORE], "readonly");
    const store = transaction.objectStore(SDN_STORE);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to count SDN entries"));
  });
}




/**
 * Save a setting
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 * @returns {Promise<void>}
 */
export async function saveSetting(key, value) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SETTINGS_STORE], "readwrite");
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("Failed to save setting"));
  });
}

/**
 * Get a setting
 * @param {string} key - Setting key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SETTINGS_STORE], "readonly");
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : null);
    };
    request.onerror = () => reject(new Error("Failed to get setting"));
  });
}
