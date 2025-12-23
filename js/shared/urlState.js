import { subscribeToFilterChanges } from "./filterState.js";
import { getLogger } from "./logging/logger.js";

const logger = getLogger("urlState");

const PARAM_CONFIG = {
  selectedRaid: { param: "raid", type: "string" },
  selectedBoss: { param: "boss", type: "string" },
  selectedPercentile: { param: "pct", type: "number" },
  selectedDpsType: { param: "metric", type: "string" },
  selectedReferencePercentile: { param: "refpct", type: "number" },
  selectedComparisonPercentiles: { param: "comp", type: "setNumber" },
  selectedJobs: { param: "jobs", type: "setString" },
  selectedPercentileDate: { param: "pdate", type: "string" },
};

let syncInitialized = false;
let filterChangeSubscriber = subscribeToFilterChanges;

/**
 * Parse the current browser URL and build a partial filter state snapshot.
 * Only keys present in PARAM_CONFIG are considered; everything else stays untouched.
 * @returns {Object} Partial filter state.
 */
export function parseFilterStateFromUrl() {
  if (typeof window === "undefined") return {};
  const snapshot = {};
  try {
    const url = new URL(window.location.href);
    Object.entries(PARAM_CONFIG).forEach(([key, config]) => {
      const raw = url.searchParams.get(config.param);
      if (raw === null) return;
      const parsed = decodeValue(config.type, raw);
      if (parsed !== null) {
        snapshot[key] = parsed;
      }
    });
  } catch (err) {
    logger.warn("Unable to parse filters from URL", err);
  }
  return snapshot;
}

/**
 * Listen for centralized filter updates and mirror them into the URL.
 * Safe to call only once; subsequent calls are ignored.
 */
export function startFilterUrlSync() {
  if (syncInitialized || typeof window === "undefined") return;
  syncInitialized = true;
  filterChangeSubscriber((state) => {
    updateUrlWithFilters(state);
  });
}

/**
 * Reconcile the provided filter state with the current URL query string.
 * Adds, updates, or removes parameters as needed and rewrites the history entry.
 * @param {Object} state - Current filter snapshot.
 */
function updateUrlWithFilters(state) {
  if (!state || typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    Object.entries(PARAM_CONFIG).forEach(([key, config]) => {
      const encoded = encodeValue(config.type, state[key]);
      if (encoded === null) {
        if (url.searchParams.has(config.param)) {
          url.searchParams.delete(config.param);
          changed = true;
        }
      } else if (url.searchParams.get(config.param) !== encoded) {
        url.searchParams.set(config.param, encoded);
        changed = true;
      }
    });
    if (!changed) return;
    const newUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", newUrl);
  } catch (err) {
    logger.warn("Failed to sync filters to URL", err);
  }
}

/**
 * Convert a serialized query string value back into its strongly typed counterpart.
 * Supports primitives, numeric sets, and string sets according to PARAM_CONFIG.
 * @param {string} type
 * @param {string} raw
 * @returns {*|null}
 */
function decodeValue(type, raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (type) {
    case "string":
      return raw;
    case "number": {
      const num = Number(raw);
      return Number.isNaN(num) ? null : num;
    }
    case "setNumber": {
      const values = raw
        .split(",")
        .map((part) => Number(part))
        .filter((num) => !Number.isNaN(num));
      return values.length ? new Set(values) : null;
    }
    case "setString": {
      const items = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return items.length ? new Set(items) : null;
    }
    default:
      return null;
  }
}

/**
 * Encode a filter state value into a query string friendly representation.
 * Mirrors decodeValue so round-tripping preserves the original intent.
 * @param {string} type
 * @param {*} value
 * @returns {string|null}
 */
function encodeValue(type, value) {
  if (value === undefined || value === null) return null;
  switch (type) {
    case "string": {
      const str = String(value);
      return str === "" ? null : str;
    }
    case "number": {
      const num = Number(value);
      return Number.isNaN(num) ? null : String(num);
    }
    case "setNumber":
    case "setString": {
      let values;
      if (value instanceof Set) values = Array.from(value);
      else if (Array.isArray(value)) values = value;
      else values = [value];
      const normalized = values
        .map((entry) => {
          if (type === "setNumber") {
            const num = Number(entry);
            return Number.isNaN(num) ? null : num;
          }
          const str = String(entry).trim();
          return str === "" ? null : str;
        })
        .filter((entry) => entry !== null);
      if (normalized.length === 0) return null;
      return normalized.map((entry) => String(entry)).join(",");
    }
    default:
      return null;
  }
}

/**
 * Test-only helper that resets module-level state so each test starts fresh.
 * Resets the custom subscriber and the syncInitialized sentinel.
 */
export function __resetUrlStateForTests() {
  syncInitialized = false;
  filterChangeSubscriber = subscribeToFilterChanges;
}

/**
 * Test-only helper to override the subscription mechanism so unit tests can
 * intercept the listener without needing the full filterState module.
 * @param {Function} subscriber
 */
export function __setFilterChangeSubscriberForTests(subscriber) {
  filterChangeSubscriber = subscriber || subscribeToFilterChanges;
}
