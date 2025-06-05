import { getLogger } from "../shared/logging/logger.js";
import { REQUIRED_FILTERS, CLASS_GROUPS } from "../config/appConfig.js";
import {
  subscribeToFilterChanges,
  getCurrentFilterState,
} from "../shared/filterState.js";
import { parsePairedHealerClasses } from "../ui/classSidebarManager.js";

const logger = getLogger("dataDisplay");
let globalData = [];

/**
 * Initialize the data display manager:
 * - Subscribes to centralized filter changes.
 * - Updates chart only when all required filters are satisfied.
 * @param {Array<Object>} allData - Full dataset (DPS + healing data).
 */
export function setupDataDisplayManager(allData) {
  globalData = allData;

  // Subscribe to all filter state changes
  subscribeToFilterChanges(() => {
    const state = getCurrentFilterState();
    if (areRequiredFiltersSelected(state)) {
      logger.debug("Required filters selected. Rendering full chart.");
      updateChart(state);
    } else {
      logger.debug(
        "Filter change detected but required filters not fully selected."
      );
    }
    // Always try to update comparison plots too
    updateComparisonCharts(state);
  });

  logger.debug(
    "Data display manager initialized and centralized listener attached."
  );
}

/**
 * Check if all required filters are satisfied in the provided state.
 * @param {Object} state - Current filter state snapshot.
 * @returns {boolean} True if all required filters have valid values.
 */
function areRequiredFiltersSelected(state) {
  return REQUIRED_FILTERS.every((key) => {
    const value = state[key];
    logger.debug(`Filter [${key}] value: ${value}`);
    if (value instanceof Set) {
      return value.size > 0;
    }
    return value !== "" && value !== "All";
  });
}

/**
 * Update the main DPS and Healing charts using current data and filter state.
 * - For DPS: plots selected classes as is.
 * - For HPS: flattens paired healer selection into individual healers for plotting.
 * @param {Object} state - Current filter state snapshot.
 */
function updateChart(state) {
  const {
    selectedRaid,
    selectedBoss,
    selectedPercentile,
    selectedDpsType,
    selectedClasses,
  } = state;

  const baseFilters = {
    raid: selectedRaid,
    boss: selectedBoss,
    percentile: selectedPercentile,
  };

  const dpsFilters = {
    ...baseFilters,
    classNames: Array.from(selectedClasses),
    dps_type: selectedDpsType,
  };
  // For HPS: plot exactly the same selected classes, not just healers.
  const healingFilters = {
    ...baseFilters,
    classNames: Array.from(selectedClasses),
  };

  const dpsData = globalData.filter((d) => "dps" in d);
  const healingData = globalData.filter((d) => "hps" in d);

  const dpsContainer = document.getElementById("dps-plot-container");
  const healingContainer = document.getElementById("healing-plot-container");

  logger.debug("Updating chart with filters:");
  logger.debug(`DPS Filters: ${JSON.stringify(dpsFilters)}`);
  logger.debug(`Healing Filters: ${JSON.stringify(healingFilters)}`);
  logger.debug(`DPS Data Size: ${dpsData.length}`);
  logger.debug(`Healing Data Size: ${healingData.length}`);

  import(`../ui/chartRenderer.js`).then(({ renderFilteredLineChart }) => {
    renderFilteredLineChart(dpsData, dpsFilters, dpsContainer, "DPS");
    renderFilteredLineChart(
      healingData,
      healingFilters,
      healingContainer,
      "Healing"
    );
  });
}

/**
 * Update the comparison charts (DPS & Healing percentile comparisons).
 * - For DPS: uses selected classes as is.
 * - For Healing: flattens paired healer selection into individual healers for plotting.
 * Show/hide charts based on filter completeness.
 * @param {Object} state - Current filter state snapshot.
 */
function updateComparisonCharts(state) {
  const {
    selectedRaid,
    selectedBoss,
    selectedReferencePercentile,
    selectedComparisonPercentiles,
    selectedDpsType,
    selectedClasses,
  } = state;

  const dpsCompContainer = document.getElementById(
    "dps-comparison-plot-container"
  );
  const healCompContainer = document.getElementById(
    "healing-comparison-plot-container"
  );
  const message = document.getElementById("comparison-message");

  // Must have: reference percentile AND at least one comparison percentile
  const referenceOk =
    selectedReferencePercentile && selectedReferencePercentile !== "All";
  const compPercentiles =
    selectedComparisonPercentiles instanceof Set
      ? Array.from(selectedComparisonPercentiles).filter((v) => v !== "All")
      : [];

  if (!referenceOk || compPercentiles.length === 0) {
    dpsCompContainer.innerHTML = "";
    healCompContainer.innerHTML = "";
    if (message) {
      message.style.display = "";
      message.textContent =
        "Select a reference and comparison percentile to display the chart.";
    }
    return;
  }

  // All filters are present, render charts
  if (message) message.style.display = "none";

  // For DPS, use selected classes as-is.
  const dpsFilters = {
    raid: selectedRaid,
    boss: selectedBoss,
    classNames: Array.from(selectedClasses),
    dps_type: selectedDpsType,
  };

  // For Healing, use the exact set of selected classes.
  const hpsFilters = {
    raid: selectedRaid,
    boss: selectedBoss,
    classNames: Array.from(selectedClasses),
  };

  const dpsData = globalData.filter((d) => "dps" in d);
  const healingData = globalData.filter((d) => "hps" in d);

  import("../ui/chartRenderer.js").then(({ renderComparisonLineChart }) => {
    renderComparisonLineChart(
      dpsData,
      dpsFilters,
      dpsCompContainer,
      "DPS Comparison",
      Number(selectedReferencePercentile),
      compPercentiles.map(Number)
    );
    renderComparisonLineChart(
      healingData,
      hpsFilters,
      healCompContainer,
      "Healing Comparison",
      Number(selectedReferencePercentile),
      compPercentiles.map(Number)
    );
  });
}

/**
 * Given the current Set of selected classes (including healer pairs),
 * returns a new Set of all individual healer classes that are represented,
 * flattening all paired healer selections to their components.
 * e.g., if ["Sage", "White Mage+Sage"] is selected, returns ["Sage", "White Mage"]
 * @param {Set<string>} selectedClasses
 * @returns {Set<string>}
 */
function getHealerClassesForHpsPlot(selectedClasses) {
  const result = new Set();
  selectedClasses.forEach((className) => {
    const pair = parsePairedHealerClasses(className);
    if (pair) {
      pair.forEach((h) => result.add(h));
    } else if (CLASS_GROUPS.Healer.includes(className)) {
      result.add(className);
    }
  });
  return result;
}
