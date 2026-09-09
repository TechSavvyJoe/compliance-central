import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { CONFIG } from "../lib/config.js";
import { FORM_CACHE_MESSAGES as MESSAGES, FORM_CACHE_STATE_KEY, handleFormCacheMessage } from "../src/worker/form-cache.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function elements(firstName = "Alex") {
  const field = (value = "") => ({ value, dataset: {} });
  return {
    firstName: field(firstName), middleName: field(), lastName: field("Example"), suffix: field(),
    dob: field("01/02/1980"), dlnPid: field("S123456789012"), tradeVin: field(),
    hasCoBuyer: { checked: false, dispatchEvent() {} }, runTitleBtn: { disabled: true },
  };
}

const panel = () => import(`../src/sidepanel/form.js?panel=${crypto.randomUUID()}`);

function install(t, initial = {}) {
  const oldChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = oldChrome; });
  const store = structuredClone(initial);
  const state = { store, beforeSet: null, intercept: null, active: 0, maxActive: 0, writes: 0, messages: [] };
  async function operation(work) {
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    try { return await work(); } finally { state.active--; }
  }
  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        const snapshot = structuredClone(message);
        state.messages.push(snapshot);
        return state.intercept?.(snapshot) ?? handleFormCacheMessage(snapshot.type, snapshot.data);
      },
    },
    storage: { session: {
      get: async () => operation(async () => structuredClone(store)),
      set: async update => operation(async () => {
        const copy = structuredClone(update);
        await state.beforeSet?.(copy);
        Object.assign(store, copy);
        state.writes++;
      }),
    } },
  };
  return state;
}

test("a reopened panel adopts the loaded identity and Clear removes that customer", async (t) => {
  const state = install(t);
  const source = await panel();
  await source.cacheFormData(elements());
  const cacheId = state.store[FORM_CACHE_STATE_KEY].cacheId;
  const reopened = await panel();
  const form = elements("");
  assert.equal((await reopened.loadCachedFormData(form)).firstName, "Alex");
  assert.equal(form.firstName.value, "Alex");
  assert.equal(await reopened.clearCachedFormData(), true);
  const clear = state.messages.find(message => message.type === MESSAGES.clear);
  assert.equal(clear.data.cacheId, cacheId);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
  assert.equal(state.store[STORAGE_KEYS.cachedAt], null);
  assert.equal(await (await panel()).loadCachedFormData(elements("")), null);
});

test("Clear from an older restored panel preserves another panel's newer save", async (t) => {
  const state = install(t);
  await (await panel()).cacheFormData(elements("First"));
  const older = await panel();
  const newer = await panel();
  await older.loadCachedFormData(elements(""));
  await newer.loadCachedFormData(elements(""));
  const oldId = state.store[FORM_CACHE_STATE_KEY].cacheId;
  await newer.cacheFormData(elements("Newer"));
  assert.notEqual(state.store[FORM_CACHE_STATE_KEY].cacheId, oldId);
  await older.clearCachedFormData();
  assert.equal(state.store[STORAGE_KEYS.cachedFormData].firstName, "Newer");
});

test("late pre-Clear cache writes cannot restore PII or overwrite a post-Clear customer", async (t) => {
  const state = install(t);
  const form = await panel();
  const waiting = [];
  state.intercept = message => {
    if (message.type !== MESSAGES.save) return;
    const gate = deferred();
    waiting.push({ message, gate });
    return gate.promise;
  };
  const first = form.cacheFormData(elements("Cleared first"));
  const second = form.cacheFormData(elements("Cleared second"));
  await form.clearCachedFormData();
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], undefined);
  state.intercept = null;
  await form.cacheFormData(elements("New customer"));
  for (const pending of waiting.reverse()) {
    pending.gate.resolve(await handleFormCacheMessage(pending.message.type, pending.message.data));
  }
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData].firstName, "New customer");
  assert.equal(JSON.stringify(state.store).includes("Cleared"), false);
});

test("save and Clear hold the worker lock across their storage operations", async (t) => {
  const state = install(t);
  const form = await panel();
  const entered = deferred();
  const release = deferred();
  state.beforeSet = async () => { entered.resolve(); await release.promise; };
  const saving = form.cacheFormData(elements());
  await entered.promise;
  const clearing = form.clearCachedFormData();
  release.resolve();
  await Promise.all([saving, clearing]);
  assert.equal(state.maxActive, 1);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
});

test("a delayed older save cannot replace a newer revision", async (t) => {
  const state = install(t);
  const form = await panel();
  const waiting = [];
  state.intercept = message => {
    const gate = deferred();
    waiting.push({ message, gate });
    return gate.promise;
  };
  const first = form.cacheFormData(elements("Old"));
  const second = form.cacheFormData(elements("New"));
  for (const pending of waiting.reverse()) {
    pending.gate.resolve(await handleFormCacheMessage(pending.message.type, pending.message.data));
  }
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData].firstName, "New");
});

test("a worker restart retains the fence against a cleared generation", async (t) => {
  const state = install(t);
  const form = await panel();
  await form.cacheFormData(elements());
  const saved = state.messages[0];
  await form.clearCachedFormData();
  const restarted = await import(`../src/worker/form-cache.js?restart=${crypto.randomUUID()}`);
  assert.equal((await restarted.handleFormCacheMessage(saved.type, { ...saved.data, revision: 99 })).saved, false);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
});

test("Clear during a delayed restore fences the UI and clears its adopted legacy cache", async (t) => {
  const state = install(t, { [STORAGE_KEYS.cachedFormData]: { firstName: "Legacy" }, [STORAGE_KEYS.cachedAt]: Date.now() });
  const loaded = deferred();
  const release = deferred();
  state.intercept = message => {
    if (message.type !== MESSAGES.load) return;
    return handleFormCacheMessage(message.type, message.data).then(async result => {
      loaded.resolve();
      await release.promise;
      return result;
    });
  };
  const form = await panel();
  const inputs = elements("");
  const restoring = form.loadCachedFormData(inputs);
  await loaded.promise;
  const clearing = form.clearCachedFormData();
  release.resolve();
  assert.equal(await restoring, null);
  assert.equal(await clearing, true);
  assert.equal(inputs.firstName.value, "");
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
});

test("a load request delivered after Clear cannot adopt or clear a newly saved customer", async (t) => {
  const state = install(t);
  const form = await panel();
  const waiting = deferred();
  let delayedLoad;
  state.intercept = message => {
    if (message.type !== MESSAGES.load) return;
    delayedLoad = message;
    return waiting.promise;
  };
  const inputs = elements("");
  const restoring = form.loadCachedFormData(inputs);
  const clearing = form.clearCachedFormData();
  await form.cacheFormData(elements("After clear"));
  waiting.resolve(await handleFormCacheMessage(delayedLoad.type, delayedLoad.data));
  await clearing;
  assert.equal(await restoring, null);
  assert.equal(inputs.firstName.value, "");
  assert.equal(state.store[STORAGE_KEYS.cachedFormData].firstName, "After clear");
});

test("a failed Clear reports failure and retains the target for a retry", async (t) => {
  const state = install(t);
  const form = await panel();
  await form.cacheFormData(elements());
  state.beforeSet = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(form.clearCachedFormData(), /cached form/i);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData].firstName, "Alex");
  state.beforeSet = null;
  await form.clearCachedFormData();
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
});

test("expired or invalid cache data is removed under the worker lock", async (t) => {
  const state = install(t, {
    [STORAGE_KEYS.cachedFormData]: { firstName: "Expired" },
    [STORAGE_KEYS.cachedAt]: Date.now() - CONFIG.timeouts.formCacheExpiry - 1,
  });
  assert.equal((await handleFormCacheMessage(MESSAGES.load, { epochId: crypto.randomUUID(), revision: 0 })).data, null);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
  assert.equal(state.store[STORAGE_KEYS.cachedAt], null);
});

test("worker cache messages reject invalid identities and credential-like fields without writing", async (t) => {
  const state = install(t);
  const data = { cacheId: crypto.randomUUID(), epochId: crypto.randomUUID(), revision: 1, data: { firstName: "Alex" } };
  for (const payload of [
    { ...data, epochId: "" },
    { ...data, revision: 0 },
    { ...data, data: { password: "must not persist" } },
    { ...data, data: { coBuyer: { accessToken: "must not persist" } } },
  ]) assert.equal((await handleFormCacheMessage(MESSAGES.save, payload)).success, false);
  assert.equal(state.writes, 0);
});

test("the router authorizes, validates, and dispatches the cache save/load/clear contract", async (t) => {
  const state = install(t);
  chrome.runtime.id = "test-extension";
  chrome.runtime.getURL = path => `chrome-extension://test-extension/${path}`;
  const { handleMessage } = await import("../src/worker/message-router.js");
  const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel.html") };
  const epochId = crypto.randomUUID();
  const cacheId = crypto.randomUUID();
  const save = { type: MESSAGES.save, data: { epochId, cacheId, revision: 1, data: { firstName: "Alex" } } };
  assert.equal((await handleMessage(save, { ...sender, url: "https://example.com/" })).success, false);
  assert.equal((await handleMessage({ type: MESSAGES.load, data: {} }, sender)).success, false);
  assert.equal(state.writes, 0);
  assert.equal((await handleMessage(save, sender)).saved, true);
  const reopenedEpochId = crypto.randomUUID();
  const loaded = await handleMessage({ type: MESSAGES.load, data: { epochId: reopenedEpochId, revision: 0 } }, sender);
  assert.equal(loaded.data.firstName, "Alex");
  assert.equal(loaded.cacheId, cacheId);
  const cleared = await handleMessage({ type: MESSAGES.clear, data: { epochId: reopenedEpochId, cacheId } }, sender);
  assert.equal(cleared.cleared, true);
  assert.equal(state.store[STORAGE_KEYS.cachedFormData], null);
});
