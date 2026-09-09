/** All cached-form reads and mutations share the worker's session-state queue. */
import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { withSessionStateLock } from "./state.js";

export const FORM_CACHE_MESSAGES = Object.freeze({
  save: "SAVE_FORM_CACHE",
  load: "LOAD_FORM_CACHE",
  clear: "CLEAR_FORM_CACHE",
});
export const FORM_CACHE_STATE_KEY = "formCacheState";

const CACHE_KEYS = [STORAGE_KEYS.cachedFormData, STORAGE_KEYS.cachedAt, FORM_CACHE_STATE_KEY];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PERSON_LIMITS = { firstName: 100, middleName: 100, lastName: 100, suffix: 16, dob: 32, dlnPid: 32 };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && UUID.test(value);

function validPerson(person, buyer = false) {
  if (!isRecord(person)) return false;
  return Object.entries(person).every(([key, value]) => {
    if (Object.hasOwn(PERSON_LIMITS, key)) {
      return typeof value === "string" && value.length <= PERSON_LIMITS[key];
    }
    if (!buyer) return false;
    if (key === "tradeVin") return typeof value === "string" && value.length <= 17;
    if (key === "hasCoBuyer") return typeof value === "boolean";
    if (key === "coBuyer") return validPerson(value);
    if (["buyerIsMichigan", "coBuyerIsMichigan"].includes(key)) {
      return value === null || typeof value === "boolean";
    }
    return false;
  });
}

export function validateFormCacheMessage(type, data) {
  if (!isRecord(data) || !isId(data.epochId)) return false;
  if (type === FORM_CACHE_MESSAGES.load) {
    return Number.isSafeInteger(data.revision) && data.revision >= 0;
  }
  if (type === FORM_CACHE_MESSAGES.clear) {
    return data.cacheId === null || isId(data.cacheId);
  }
  return type === FORM_CACHE_MESSAGES.save && isId(data.cacheId) &&
    Number.isSafeInteger(data.revision) && data.revision > 0 && validPerson(data.data, true);
}

function cacheState(stored) {
  const state = stored[FORM_CACHE_STATE_KEY];
  return {
    cacheId: isId(state?.cacheId) ? state.cacheId : null,
    epochId: isId(state?.epochId) ? state.epochId : null,
    // Anonymous generation fences persist across worker restarts. Never prune a
    // cleared generation while a delayed message from that session can arrive.
    epochs: isRecord(state?.epochs) ? { ...state.epochs } : {},
    loadedCacheIds: isRecord(state?.loadedCacheIds) ? { ...state.loadedCacheIds } : {},
  };
}

function emptyCache(state) {
  return {
    [STORAGE_KEYS.cachedFormData]: null,
    [STORAGE_KEYS.cachedAt]: null,
    [FORM_CACHE_STATE_KEY]: { ...state, cacheId: null, epochId: null },
  };
}

export async function handleFormCacheMessage(type, data) {
  if (!validateFormCacheMessage(type, data)) {
    return { success: false, error: `Invalid ${type} payload` };
  }
  try {
    return await withSessionStateLock(async () => {
      const stored = await chrome.storage.session.get(CACHE_KEYS);
      const state = cacheState(stored);
      if (type === FORM_CACHE_MESSAGES.save) {
        const revision = state.epochs[data.epochId];
        if (revision === null || (Number.isSafeInteger(revision) && revision >= data.revision)) {
          return { success: true, saved: false };
        }
        state.epochs[data.epochId] = data.revision;
        await chrome.storage.session.set({
          [STORAGE_KEYS.cachedFormData]: data.data,
          [STORAGE_KEYS.cachedAt]: Date.now(),
          [FORM_CACHE_STATE_KEY]: { ...state, cacheId: data.cacheId, epochId: data.epochId },
        });
        return { success: true, saved: true, cacheId: data.cacheId };
      }
      if (type === FORM_CACHE_MESSAGES.clear) {
        state.epochs[data.epochId] = null;
        const loadedId = data.cacheId || state.loadedCacheIds[data.epochId] || null;
        const ownsCache = state.epochId === data.epochId ||
          (loadedId !== null && state.cacheId === loadedId);
        delete state.loadedCacheIds[data.epochId];
        // Clearing the data and fencing queued writes is one storage update.
        await chrome.storage.session.set(ownsCache
          ? emptyCache(state)
          : { [FORM_CACHE_STATE_KEY]: state });
        return { success: true, cleared: ownsCache };
      }

      // Register the observed cache inside the lock, before replying to a
      // restoring panel. Clear can then cancel a delayed response, while a
      // load delivered after Clear cannot adopt a different panel's new data.
      const revision = state.epochs[data.epochId];
      if (revision === null || (revision ?? 0) !== data.revision) {
        return { success: true, data: null, cacheId: null };
      }
      const cached = stored[STORAGE_KEYS.cachedFormData];
      const cachedAt = stored[STORAGE_KEYS.cachedAt];
      const age = Date.now() - cachedAt;
      if (!validPerson(cached, true) || !Number.isFinite(cachedAt) || age < 0 || age >= CONFIG.timeouts.formCacheExpiry) {
        if (cached != null || cachedAt != null || state.cacheId) {
          await chrome.storage.session.set(emptyCache(state));
        }
        return { success: true, data: null, cacheId: null };
      }
      // Give pre-identity caches a stable identity before any panel can adopt
      // them. A restored panel clears this exact record, never a newer save.
      if (!state.cacheId) {
        state.cacheId = crypto.randomUUID();
      }
      state.loadedCacheIds[data.epochId] = state.cacheId;
      await chrome.storage.session.set({ [FORM_CACHE_STATE_KEY]: state });
      return { success: true, data: cached, cacheId: state.cacheId };
    });
  } catch {
    return { success: false, error: "Could not update the cached form. Please try again." };
  }
}
