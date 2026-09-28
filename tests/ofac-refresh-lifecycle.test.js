import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { performSDNUpdate } from "../src/worker/ofac-check.js";

test("a slow shared OFAC refresh stays alive after MDOS finishes and releases its timer", async (t) => {
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, previous));
  t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let pulses = 0;
  globalThis.chrome = { runtime: { getPlatformInfo(callback) { pulses++; callback({}); } } };
  const database = {
    close() {},
    transaction() {
      const tx = {
        objectStore() {
          return { put() {
            const request = {};
            queueMicrotask(() => {
              request.onsuccess?.();
              tx.oncomplete?.();
            });
            return request;
          } };
        },
        abort() { tx.onabort?.(); },
      };
      return tx;
    },
  };
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => request.onsuccess({ target: { result: database } }));
    return request;
  } };
  let started;
  const fetching = new Promise((resolve) => { started = resolve; });
  let rejectDownload;
  let fetches = 0;
  globalThis.fetch = () => {
    fetches++;
    started();
    return new Promise((_resolve, reject) => { rejectDownload = reject; });
  };
  const first = performSDNUpdate();
  const second = performSDNUpdate();
  await fetching;
  t.mock.timers.tick(40000);
  await setImmediate();
  const whilePending = pulses;
  rejectDownload(new Error("Synthetic network failure"));
  const results = await Promise.all([first, second]);
  assert.equal(fetches, 1);
  assert.equal(results.every((result) => result.success === false), true);
  assert.ok(whilePending >= 3, "OFAC must maintain its own lifetime during a slow download");
  t.mock.timers.tick(40000);
  assert.equal(pulses, whilePending, "finished refresh must stop keeping the worker alive");
});
