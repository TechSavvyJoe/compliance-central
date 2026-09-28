import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

let instance = 0;
async function setup(t) {
  const opens = [];
  const transactions = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else delete globalThis.indexedDB;
  });
  globalThis.indexedDB = {
    open() {
      const request = {};
      opens.push(request);
      return request;
    },
  };
  const storage = await import(`../ofac/storage.js?storage-test=${++instance}`);
  const database = {
    closed: false,
    close() { this.closed = true; },
    transaction() {
      const request = {};
      const transaction = {
        request,
        aborted: false,
        objectStore() {
          return {
            getAll: () => request,
            get: () => request,
            count: () => request,
            put: () => request,
            clear: () => request,
          };
        },
        abort() {
          this.aborted = true;
          queueMicrotask(() => this.onabort?.());
        },
      };
      transactions.push(transaction);
      return transaction;
    },
  };
  return { storage, opens, transactions, database };
}

function observe(promise) {
  const state = { settled: false };
  state.done = promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error })
  );
  return state;
}

test("concurrent OFAC callers share one IndexedDB open", async (t) => {
  const { storage, opens, database } = await setup(t);
  const first = storage.initDB();
  const second = storage.initDB();
  for (const request of opens) request.onsuccess({ target: { result: database } });
  await Promise.all([first, second]);
  assert.equal(opens.length, 1);
});

test("a blocked OFAC database fails promptly instead of leaving screening running", async (t) => {
  const { storage, opens } = await setup(t);
  const result = observe(storage.initDB());
  opens[0].onblocked?.();
  await setImmediate();
  assert.equal(result.settled, true);
  assert.match(result.error?.message || "", /OFAC.*busy/i);
});

test("a stalled OFAC database open times out and closes a late connection", async (t) => {
  const { storage, opens, database } = await setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = observe(storage.initDB());
  t.mock.timers.tick(10000);
  await setImmediate();
  assert.equal(result.settled, true);
  assert.match(result.error?.message || "", /OFAC.*timed out/i);
  opens[0].onsuccess({ target: { result: database } });
  assert.equal(database.closed, true, "an abandoned open cannot become the shared database");
  const retry = observe(storage.initDB());
  assert.equal(opens.length, 2);
  opens[1].onerror();
  await retry.done;
});

test("OFAC releases its old connection when a database upgrade is requested", async (t) => {
  const { storage, opens, database } = await setup(t);
  const first = storage.initDB();
  opens[0].onsuccess({ target: { result: database } });
  await first;
  database.onversionchange?.();
  assert.equal(database.closed, true);
  const retry = observe(storage.initDB());
  assert.equal(opens.length, 2);
  opens[1].onerror();
  await retry.done;
});

test("an OFAC storage read that never completes aborts with an actionable error", async (t) => {
  const { storage, opens, database, transactions } = await setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const read = observe(storage.getAllSDNEntries());
  opens[0].onsuccess({ target: { result: database } });
  await setImmediate();
  t.mock.timers.tick(20000);
  await setImmediate();
  assert.equal(read.settled, true);
  assert.equal(transactions[0].aborted, true);
  assert.match(read.error?.message || "", /OFAC.*timed out/i);
});

test("OFAC settings are only reported saved after the transaction commits", async (t) => {
  const { storage, opens, database, transactions } = await setup(t);
  const saved = observe(storage.saveSetting("lastUpdate", "synthetic-time"));
  opens[0].onsuccess({ target: { result: database } });
  await setImmediate();
  transactions[0].request.onsuccess?.();
  await setImmediate();
  assert.equal(saved.settled, false);
  transactions[0].oncomplete?.();
  await saved.done;
  assert.equal(saved.error, undefined);
});

test("a timed-out list replacement aborts and cannot report success on a late completion", async (t) => {
  const { storage, opens, database, transactions } = await setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let wroteFreshMetadata = false;
  const update = observe(storage.replaceSDNEntries([{ uid: "synthetic-entry" }]).then(() => {
    wroteFreshMetadata = true;
  }));
  opens[0].onsuccess({ target: { result: database } });
  await setImmediate();
  t.mock.timers.tick(20000);
  await update.done;
  transactions[0].oncomplete();
  await setImmediate();
  assert.equal(transactions[0].aborted, true);
  assert.match(update.error?.message || "", /OFAC.*timed out/i);
  assert.equal(wroteFreshMetadata, false);
});
