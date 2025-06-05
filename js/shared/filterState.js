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
  selectedClasses: new Set(),
  listeners: new Set(),
};

/**
 * Subscribe a listener to be notified on any filter change.
 * @param {Function} listener - Callback receiving the full filter state.
 */
export function subscribeToFilterChanges(listener) {
  filterState.listeners.add(listener);
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
  console.debug(`[filterState] Updating key: ${key}`, value);
  filterState[key] = value;
  console.debug("[filterState] New state:", getCurrentFilterState());
  filterState.listeners.forEach((listener) =>
    listener(getCurrentFilterState())
  );
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
  const sidebar = document.getElementById("class-sidebar");
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
