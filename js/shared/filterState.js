import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("filterState");

/**
 * Centralized filter state object.
 * Tracks all active filter values and notifies listeners on change.
 */
export const filterState = {
  selectedRaid: "",
  selectedBoss: "",
  selectedPercentile: "",
  selectedDpsType: "",
  selectedReferencePercentile: "",
  selectedComparisonPercentiles: new Set(),
  selectedJobs: new Set(),
  selectedPercentileDate: "",
  showMaxPercentile: false,
  listeners: new Set(),
};

/**
 * Subscribe a listener to be notified on any filter change.
 * The listener receives the latest state snapshot and a change descriptor
 * containing the key that changed plus its previous/next values.
 * @param {Function} listener - Callback receiving (state, changeMeta).
 * @returns {Function} unsubscribe handler
 */
export function subscribeToFilterChanges(listener) {
  filterState.listeners.add(listener);
  return () => filterState.listeners.delete(listener);
}

/**
 * Update a filter value and notify all listeners.
 * Debug logs the changed filter key/value and the new filter state.
 * @param {string} key - Filter key (must match one in filterState).
 * @param {*} value - New value (Set or primitive).
 */
export function updateFilterValue(key, value) {
  if (!(key in filterState)) {
    logger.warn(`Attempted to update unknown filter key: ${key}`);
    return;
  }
  logger.debug(`[filterState] Updating key: ${key}`, value);
  const previousValue = filterState[key];
  filterState[key] = value;
  const snapshot = getCurrentFilterState();
  const changeMeta = {
    key,
    previousValue,
    nextValue: value,
  };
  logger.debug("[filterState] New state:", snapshot);
  filterState.listeners.forEach((listener) => {
    try {
      listener(snapshot, changeMeta);
    } catch (err) {
      logger.warn("Filter listener error", err);
    }
  });
}

/**
 * Get a shallow snapshot of the current filter state.
 * @returns {Object} Snapshot object with all filter keys.
 */
export function getCurrentFilterState() {
  return { ...filterState };
}

/**
 * Show the class mini-icons and DPS metric elements only when sidebar is collapsed.
 * Hide both when sidebar is expanded.
 */
export function updateSidebarLabelVisibility() {
  const sidebar =
    document.getElementById("job-sidebar") ||
    document.getElementById("class-sidebar");
  const labelContainer = document.getElementById("sidebar-label-container");
  const dpsTypeLabelContainer = document.getElementById(
    "dps-type-label-container"
  );
  if (!sidebar) return;
  const shouldShow = sidebar.classList.contains("collapsed");
  if (labelContainer)
    labelContainer.style.display = shouldShow ? "flex" : "none";
  if (dpsTypeLabelContainer)
    dpsTypeLabelContainer.style.display = shouldShow ? "flex" : "none";
}
