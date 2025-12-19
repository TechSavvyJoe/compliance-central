/**
 * IndexedDB Storage Manager for OFAC SDN Data
 * Handles database initialization, SDN entry storage, and search history
 *
 * MATCHES: TechSavvyJoe/OFAC-Search/utils/storage.js
 */

const DB_NAME = "ComplianceCentralDB";
const DB_VERSION = 1;
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

      // Search History Store
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        const historyStore = database.createObjectStore(HISTORY_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        historyStore.createIndex("timestamp", "timestamp", { unique: false });
        historyStore.createIndex("result", "result", { unique: false });
      }

      // Settings Store
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
  });
}

/**
 * Clear all SDN entries from the database
 * @returns {Promise<void>}
 */
export async function clearSDNEntries() {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SDN_STORE], "readwrite");
    const store = transaction.objectStore(SDN_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("Failed to clear SDN entries"));
  });
}

/**
 * Store SDN entries in bulk
 * @param {Array} entries - Array of SDN entry objects
 * @returns {Promise<void>}
 */
export async function storeSDNEntries(entries) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SDN_STORE], "readwrite");
    const store = transaction.objectStore(SDN_STORE);

    let completed = 0;
    const total = entries.length;

    entries.forEach((entry) => {
      const request = store.put(entry);
      request.onsuccess = () => {
        completed++;
        if (completed === total) {
          resolve();
        }
      };
      request.onerror = () => {
        // Continue with other entries even if one fails
        completed++;
        if (completed === total) {
          resolve();
        }
      };
    });

    if (total === 0) {
      resolve();
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
 * Save a search to history
 * @param {Object} searchData - Search parameters and result
 * @returns {Promise<number>} - The ID of the saved search
 */
export async function saveSearchHistory(searchData) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE], "readwrite");
    const store = transaction.objectStore(HISTORY_STORE);

    const entry = {
      ...searchData,
      timestamp: new Date().toISOString(),
    };

    const request = store.add(entry);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to save search history"));
  });
}

/**
 * Get search history
 * @param {number} limit - Maximum entries to return
 * @returns {Promise<Array>}
 */
export async function getSearchHistory(limit = 50) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE], "readonly");
    const store = transaction.objectStore(HISTORY_STORE);
    const index = store.index("timestamp");

    const entries = [];
    const request = index.openCursor(null, "prev");

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && entries.length < limit) {
        entries.push(cursor.value);
        cursor.continue();
      } else {
        resolve(entries);
      }
    };

    request.onerror = () => reject(new Error("Failed to get search history"));
  });
}

/**
 * Clear search history
 * @returns {Promise<void>}
 */
export async function clearSearchHistory() {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE], "readwrite");
    const store = transaction.objectStore(HISTORY_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("Failed to clear search history"));
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
