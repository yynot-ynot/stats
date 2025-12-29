import { getLogger } from "../shared/logging/logger.js";
import { REQUIRED_FILTERS, JOB_GROUPS } from "../config/appConfig.js";
import {
  subscribeToFilterChanges,
  getCurrentFilterState,
} from "../shared/filterState.js";
import {
  subscribeToViewChanges,
  getCurrentView,
} from "../shared/viewState.js";
import { parsePairedHealerJobs } from "../ui/jobSidebarManager.js";
import { setupPercentileDateSlider } from "../ui/percentileDateSlider.js";
import { collectAvailableDates } from "./percentileDataUtils.js";

const logger = getLogger("dataDisplay");
let globalData = [];
let activeView = "trend";
let latestState = null;
const JOB_SELECTION_PROMPT = "Start by choosing one or more jobs.";
const TREND_VIEW_SECTION_IDS = Object.freeze([
  "percentile-slider-container",
  "dps-plot-container",
  "healing-plot-container",
  "reference-percentile-container",
  "comparison-slider-container",
  "dps-comparison-plot-container",
  "healing-comparison-plot-container",
  "comparison-message",
  "parse-total-plot-container",
  "parse-delta-plot-container",
]);

/**
 * Initialize the data display manager:
 * - Subscribes to centralized filter changes.
 * - Updates chart only when all required filters are satisfied.
 * @param {Array<Object>} allData - Full dataset (DPS + healing data).
 */
export function setupDataDisplayManager(allData) {
  globalData = allData;
  activeView = getCurrentView?.() || activeView;
  latestState = getCurrentFilterState();
  setupPercentileDateSlider(getAvailablePercentileDates(globalData, latestState));

  // Subscribe to all filter state changes
  subscribeToFilterChanges(() => {
    const state = getCurrentFilterState();
    latestState = state;
    setupPercentileDateSlider(getAvailablePercentileDates(globalData, state));
    handleStateChangeForActiveView(state);
  });

  subscribeToViewChanges((view) => {
    if (view === activeView) return;
    activeView = view;
    handleStateChangeForActiveView(latestState);
  });

  logger.debug(
    "Data display manager initialized and centralized listener attached."
  );
}

/**
 * Central dispatcher that routes filter updates to the appropriate view renderer.
 * Trend view continues to render the legacy charts/comparisons; Percentile view currently
 * shows the filter-state placeholder until the new charts are built.
 * @param {Object} state
 */
function handleStateChangeForActiveView(state) {
  if (!state) return;
  if (activeView === "trend") {
    toggleTrendViewVisibility(hasAnyJobSelection(state.selectedJobs));
    if (areRequiredFiltersSelected(state)) {
      logger.debug("Required filters selected. Rendering full chart.");
      updateChart(state);
    } else {
      logger.debug(
        "Filter change detected but required filters not fully selected."
      );
    }
    updateComparisonCharts(state);
  } else if (activeView === "percentile") {
    updatePercentileCharts(state);
  }
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
 * Determine whether the user currently has at least one job selected.
 * Accepts Sets or arrays so legacy filter snapshots remain compatible.
 * @param {Set<string>|Array<string>|null|undefined} selectedJobs
 * @returns {boolean}
 */
function hasAnyJobSelection(selectedJobs) {
  if (!selectedJobs) return false;
  if (selectedJobs instanceof Set) return selectedJobs.size > 0;
  if (Array.isArray(selectedJobs)) return selectedJobs.length > 0;
  return Boolean(selectedJobs);
}

/**
 * Update the main DPS and Healing charts using current data and filter state.
 * - For DPS: plots selected jobs as is.
 * - For HPS: flattens paired healer selection into individual healers for plotting.
 * @param {Object} state - Current filter state snapshot.
 */
function updateChart(state) {
  const {
    selectedRaid,
    selectedBoss,
    selectedPercentile,
    selectedDpsType,
    selectedJobs,
  } = state;

  const baseFilters = {
    raid: selectedRaid,
    boss: selectedBoss,
    percentile: selectedPercentile,
  };

  const dpsFilters = {
    ...baseFilters,
    jobNames: Array.from(selectedJobs),
    dps_type: selectedDpsType,
  };
  // For HPS: plot exactly the same selected jobs, not just healers.
  const healingFilters = {
    ...baseFilters,
    jobNames: Array.from(selectedJobs),
  };

  const dpsData = globalData.filter((d) => "dps" in d);
  const healingData = globalData.filter((d) => "hps" in d);

  const dpsContainer = document.getElementById("dps-plot-container");
  const healingContainer = document.getElementById("healing-plot-container");
  const parseTotalContainer = document.getElementById(
    "parse-total-plot-container"
  );
  const parseDeltaContainer = document.getElementById(
    "parse-delta-plot-container"
  );

  logger.debug("Updating chart with filters:");
  logger.debug(`DPS Filters: ${JSON.stringify(dpsFilters)}`);
  logger.debug(`Healing Filters: ${JSON.stringify(healingFilters)}`);
  logger.debug(`DPS Data Size: ${dpsData.length}`);
  logger.debug(`Healing Data Size: ${healingData.length}`);

  const dpsMetricTitle =
    selectedDpsType && selectedDpsType !== "All"
      ? formatDpsMetricTitle(selectedDpsType)
      : "DPS";

  import(`../ui/chartRenderer.js`).then(
    ({ renderFilteredLineChart, renderParseTrendCharts }) => {
      renderFilteredLineChart(
        dpsData,
        dpsFilters,
        dpsContainer,
        dpsMetricTitle
      );
      renderFilteredLineChart(
        healingData,
        healingFilters,
        healingContainer,
        "Healing"
      );
      // Surface aggregate parse counts so analysts can immediately gauge data volume trends.
      renderParseTrendCharts({
        data: dpsData,
        filters: dpsFilters,
        totalContainer: parseTotalContainer,
        deltaContainer: parseDeltaContainer,
      });
    }
  );
}

/**
 * Convert a raw DPS metric id (e.g., "rdps") into the mixed-case label required by the UI.
 * Keeps the first character lowercase and uppercases the remainder (-> "rDPS").
 * @param {string} metric
 * @returns {string}
 */
function formatDpsMetricTitle(metric) {
  if (!metric) return "DPS";
  if (metric.length === 1) return metric.toLowerCase();
  return `${metric[0].toLowerCase()}${metric.slice(1).toUpperCase()}`;
}

/**
 * Update the comparison charts (DPS & Healing percentile comparisons).
 * - For DPS: uses selected jobs as is.
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
    selectedJobs,
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
    hasValidReferencePercentile(selectedReferencePercentile);
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

  // For DPS, use selected jobs as-is.
  const dpsFilters = {
    raid: selectedRaid,
    boss: selectedBoss,
    jobNames: Array.from(selectedJobs),
    dps_type: selectedDpsType,
  };

  // For Healing, use the exact set of selected jobs.
  const hpsFilters = {
    raid: selectedRaid,
    boss: selectedBoss,
    jobNames: Array.from(selectedJobs),
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
 * Determine whether the reference percentile selection is valid. Accepts numbers or strings and
 * treats 0 (Min) as a valid input per the reference-slider plan.
 * @param {number|string|null|undefined} value
 * @returns {boolean}
 */
function hasValidReferencePercentile(value) {
  if (value === null || value === undefined) return false;
  if (value === "All") return false;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  return Boolean(value);
}

/**
 * Render the new percentile view charts whenever filters or view state change.
 * Ensures prerequisites (raid/boss/jobs) exist, configures data filters for DPS/HPS,
 * and passes the includeMaxPercentile flag through so the toggle can hide the 100th bucket
 * before delegating to the shared chart renderer.
 * @param {Object} state
 */
function updatePercentileCharts(state) {
  const placeholder = document.getElementById("percentile-view-placeholder");
  const viewContent = document.getElementById("percentile-view-content");
  const dpsContainer = document.getElementById("percentile-dps-chart");
  const hpsContainer = document.getElementById("percentile-hps-chart");
  if (!dpsContainer || !hpsContainer) return;

  const showContent = () => {
    if (viewContent) viewContent.classList.remove("view-hidden");
    if (placeholder) placeholder.style.display = "none";
  };

  const showMessage = (text) => {
    if (placeholder) {
      placeholder.innerHTML = buildPercentilePlaceholderMarkup(text, state);
      placeholder.style.display = "";
    }
    if (viewContent) viewContent.classList.add("view-hidden");
    dpsContainer.innerHTML = "";
    hpsContainer.innerHTML = "";
  };

  if (!areRequiredFiltersSelected(state)) {
    showMessage(JOB_SELECTION_PROMPT);
    return;
  }
  showContent();

  const jobNames = Array.from(state.selectedJobs);
  const dpsFilters = {
    raid: state.selectedRaid,
    boss: state.selectedBoss,
    jobNames,
    dps_type: state.selectedDpsType,
  };
  const hpsFilters = {
    raid: state.selectedRaid,
    boss: state.selectedBoss,
    jobNames,
  };
  const includeMaxPercentile = state.showMaxPercentile !== false;
  const dpsData = globalData.filter((row) => "dps" in row);
  const hpsData = globalData.filter((row) => "hps" in row);
  const dpsMetricLabel = formatDpsMetricTitle(state.selectedDpsType);

  import("../ui/chartRenderer.js").then(({ renderPercentileCharts }) => {
    const result = renderPercentileCharts({
      dpsData,
      hpsData,
      dpsFilters,
      hpsFilters,
      dpsContainer,
      hpsContainer,
      dpsLabel: dpsMetricLabel,
      targetDate: state.selectedPercentileDate,
      includeMaxPercentile,
    });
    if (!result.renderedAny) {
      showMessage("No percentile data available for the current selection.");
    }
  });
}

/**
 * Given the current Set of selected jobs (including healer pairs),
 * returns a new Set of all individual healer jobs that are represented,
 * flattening all paired healer selections to their components.
 * e.g., if ["Sage", "White Mage+Sage"] is selected, returns ["Sage", "White Mage"]
 * @param {Set<string>} selectedJobs
 * @returns {Set<string>}
 */
function getHealerJobsForHpsPlot(selectedJobs) {
  const result = new Set();
  selectedJobs.forEach((jobName) => {
    const pair = parsePairedHealerJobs(jobName);
    if (pair) {
      pair.forEach((h) => result.add(h));
    } else if (JOB_GROUPS.Healer.includes(jobName)) {
      result.add(jobName);
    }
  });
  return result;
}

function getAvailablePercentileDates(data, state = {}) {
  return collectAvailableDates(data, {
    raid: state?.selectedRaid,
    boss: state?.selectedBoss,
  });
}

function buildPercentilePlaceholderMarkup(message, state) {
  const summaryItems = [
    { label: "Raid", value: state.selectedRaid || "Not selected" },
    { label: "Boss", value: state.selectedBoss || "Not selected" },
    { label: "Jobs", value: formatSet(state.selectedJobs) },
    {
      label: "DPS Metric",
      value: formatDpsMetricTitle(state.selectedDpsType) || "Default",
    },
    {
      label: "Date",
      value: state.selectedPercentileDate || "Latest available",
    },
  ];
  const summaryHtml = summaryItems
    .map(
      (item) =>
        `<li><span class="placeholder-selection-label">${item.label}:</span>${item.value}</li>`
    )
    .join("");
  return `
    <div>${message}</div>
    <div class="placeholder-selection-heading">Current Selection</div>
    <ul class="placeholder-selection-list">${summaryHtml}</ul>
  `;
}

function formatSet(value) {
  if (!value) return "Not selected";
  if (value instanceof Set) {
    return value.size ? Array.from(value).join(", ") : "Not selected";
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not selected";
  return String(value);
}

/**
 * Toggle the main trend view slider/chart sections based on whether a job selection exists.
 * Hides all trend-only DOM nodes and surfaces a placeholder prompt when no jobs are selected,
 * ensuring the initial load guides the user to pick jobs before interacting with sliders.
 * @param {boolean} hasJobSelection
 */
export function toggleTrendViewVisibility(hasJobSelection) {
  const placeholder = document.getElementById("trend-view-placeholder");
  const targets = TREND_VIEW_SECTION_IDS.map((id) =>
    document.getElementById(id)
  ).filter(Boolean);

  if (hasJobSelection) {
    targets.forEach((node) => node.classList.remove("view-hidden"));
    if (placeholder) placeholder.style.display = "none";
  } else {
    targets.forEach((node) => node.classList.add("view-hidden"));
    if (placeholder) {
      placeholder.textContent = JOB_SELECTION_PROMPT;
      placeholder.style.display = "";
    }
  }
}

export const __comparisonTestUtils = {
  hasValidReferencePercentile,
};
