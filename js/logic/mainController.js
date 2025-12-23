import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("main");

import {
  fetchAvailableJsonFiles,
  fetchAndDecompressJsonGz,
} from "../core/dataLoader.js";
import {
  filterState,
  updateFilterValue,
  getCurrentFilterState,
} from "../shared/filterState.js";
import {
  parseFilterStateFromUrl,
  startFilterUrlSync,
} from "../shared/urlState.js";
import { initViewState } from "../shared/viewState.js";
import {
  populateAllFilters,
  setupHeaderBindings,
} from "../ui/filterControls.js";
import {
  setupJobSidebar,
  applyJobSelections,
} from "../ui/jobSidebarManager.js";
import { setupDpsTypeSidebarManager } from "../ui/dpsTypeSidebarManager.js";
import {
  setPercentileSliderValue,
  setReferencePercentileSliderValue,
  setComparisonSliderValues,
} from "../ui/percentileSliderControls.js";
import { setupViewSwitcher } from "../ui/viewSwitcher.js";

import { setupDataDisplayManager } from "./dataDisplayManager.js";

let allData = [];
let isLoading = false;

/**
 * Get the current loading state.
 * @returns {boolean} True if loading is in progress, false otherwise.
 */
export function getLoadingState() {
  return isLoading;
}

/**
 * Main entry point to initialize data loading, filtering, and rendering.
 * 1. Discover available JSON files.
 * 2. Load and decompress data.
 * 3. Populate dropdowns and sidebar.
 * 4. Set up the centralized display manager.
 */
export async function init() {
  initViewState();
  const initialFiltersFromUrl = parseFilterStateFromUrl();
  isLoading = true;
  const start = performance.now();

  try {
    // Step 1: Discover available JSON files
    const t1 = performance.now();
    const files = await fetchAvailableJsonFiles("json/");
    const t2 = performance.now();
    logger.debug(
      `Discovered ${files.length} files to load. (in ${(t2 - t1).toFixed(1)}ms)`
    );

    // Step 2: Fetch and decompress all files in parallel
    const tDecompressStart = performance.now();
    const allFilePromises = files.map(async (file) => {
      try {
        const data = await fetchAndDecompressJsonGz(file);
        return data;
      } catch (err) {
        logger.warn(`Error loading ${file}:`, err);
        return [];
      }
    });

    const loadedArrays = await Promise.all(allFilePromises);
    allData = loadedArrays.flat(); // Flatten into a single array
    const tDecompressEnd = performance.now();
    logger.debug(
      `Total decompression time (parallel): ${(
        tDecompressEnd - tDecompressStart
      ).toFixed(1)}ms`
    );

    // Step 3: Populate filter dropdowns and sidebar
    const tFiltersStart = performance.now();
    populateAllFilters(allData);
    setupHeaderBindings();
    setupViewSwitcher();

    const dpsTypes = Array.from(
      new Set(allData.filter((d) => d.dps_type).map((d) => d.dps_type))
    );
    setupDpsTypeSidebarManager(dpsTypes);

    const uniqueJobs = Array.from(new Set(allData.map((d) => d.class)));
    setupJobSidebar(uniqueJobs); // uses idle batching to avoid blocking
    applyInitialFiltersFromUrl(initialFiltersFromUrl);
    // Force initial notification so filter listeners fire on startup
    updateFilterValue("selectedJobs", filterState.selectedJobs); // This will notify listeners

    const tFiltersEnd = performance.now();
    logger.debug(
      `Populated filters in ${(tFiltersEnd - tFiltersStart).toFixed(1)}ms`
    );

    // Step 4: Setup centralized filter event listeners and display manager
    setupDataDisplayManager(allData);
    startFilterUrlSync();
    broadcastCurrentFilters();
    const tListeners = performance.now();
    logger.debug(
      `Setup filter listeners in ${(tListeners - tFiltersEnd).toFixed(1)}ms`
    );
  } catch (e) {
    logger.error("Discovery failed:", e);
  } finally {
    isLoading = false;
  }

  const end = performance.now();
  logger.debug(`Total init() duration: ${(end - start).toFixed(1)}ms`);
}

/**
 * Hydrate UI controls from the filter values found in the URL.
 * Each control is updated via its native DOM APIs so existing change listeners fire naturally.
 * @param {Object} filters - Partial filter state parsed from the URL.
 */
function applyInitialFiltersFromUrl(filters) {
  if (!filters || Object.keys(filters).length === 0) return;

  if (filters.selectedRaid) {
    setSelectValueById("raid-select", filters.selectedRaid);
  }
  if (filters.selectedBoss) {
    setSelectValueById("boss-select", filters.selectedBoss);
  }
  if (filters.selectedDpsType) {
    setSelectValueById("dps-type-select", filters.selectedDpsType);
  }
  if (isNumberValue(filters.selectedPercentile)) {
    setPercentileSliderValue(filters.selectedPercentile);
  }
  if (isNumberValue(filters.selectedReferencePercentile)) {
    setReferencePercentileSliderValue(filters.selectedReferencePercentile);
  }
  if (
    filters.selectedComparisonPercentiles instanceof Set &&
    filters.selectedComparisonPercentiles.size > 0
  ) {
    setComparisonSliderValues(
      Array.from(filters.selectedComparisonPercentiles)
    );
  }
  if (filters.selectedJobs instanceof Set && filters.selectedJobs.size > 0) {
    applyJobSelections(filters.selectedJobs);
  }
}

/**
 * Helper to set a select element's value (when the option exists) and emit a change event.
 * Prevents double-dispatching by no-oping when the select already holds the target value.
 * @param {string} selectId
 * @param {string} value
 */
function setSelectValueById(selectId, value) {
  if (value === undefined || value === null || value === "") return;
  const selectEl = document.getElementById(selectId);
  if (!selectEl) return;
  const hasOption = Array.from(selectEl.options).some(
    (opt) => opt.value === value
  );
  if (!hasOption) return;
  if (selectEl.value === value) return;
  selectEl.value = value;
  selectEl.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Type guard to ensure slider setters only receive numeric input.
 * @param {*} value
 * @returns {boolean}
 */
function isNumberValue(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Re-emit the current filter snapshot so late subscribers (like the display manager)
 * receive a fresh update after all URL-driven mutations finish applying.
 */
function broadcastCurrentFilters() {
  const state = getCurrentFilterState();
  Object.entries(state).forEach(([key, value]) => {
    updateFilterValue(key, value);
  });
}
