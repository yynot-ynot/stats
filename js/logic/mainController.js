import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("main");

import {
  fetchAvailableJsonFiles,
  fetchAndDecompressJsonGz,
} from "../core/dataLoader.js";
import {
  buildManifestRaidIndex,
  resolveEffectiveRaid,
} from "../core/manifestRaidIndex.js";
import { createRaidLoadScheduler } from "../core/raidLoadScheduler.js";
import {
  filterState,
  updateFilterValue,
  getCurrentFilterState,
  subscribeToFilterChanges,
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
import { createRaidDataStore } from "./raidDataStore.js";

let isLoading = false;
let manifestIndex = null;
let raidDataStore = null;
let raidLoadScheduler = null;
let activeRaid = "";
let chromeInitialized = false;
let filterUrlSyncStarted = false;
let raidChangeListenerInitialized = false;
let suppressRaidChangeHandling = false;
const finalFailedFiles = new Map();

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
  syncActiveRaidLoadingIndicator(true);
  const start = performance.now();

  try {
    // Step 1: Discover available JSON files
    const t1 = performance.now();
    const files = await fetchAvailableJsonFiles("json/");
    manifestIndex = buildManifestRaidIndex(files);
    raidDataStore = createRaidDataStore(manifestIndex.filesByRaid);
    raidLoadScheduler = createRaidLoadScheduler({
      allFiles: manifestIndex.allFiles,
      filesByRaid: manifestIndex.filesByRaid,
      loadFile: async (record) => fetchAndDecompressJsonGz(record.path),
      onFileLoaded: (record, rows) => {
        raidDataStore.appendFileRows(record.raid, record.path, rows);
        finalFailedFiles.delete(record.path);
        syncLoadFailureMessage();
      },
      onFileFailed: (record, error) => {
        raidDataStore.markFileFailed(record.raid, record.path, error);
        finalFailedFiles.set(record.path, error);
        logger.warn(`Error loading ${record.path}:`, error);
        syncLoadFailureMessage();
      },
    });
    const t2 = performance.now();
    logger.debug(
      `Discovered ${files.length} files to load. (in ${(t2 - t1).toFixed(1)}ms)`
    );

    ensureRaidChangeListener();
    const effectiveRaid = resolveEffectiveRaid(
      manifestIndex,
      initialFiltersFromUrl.selectedRaid
    );
    await activateRaid(effectiveRaid, {
      applyUrlFilters: true,
      urlFilters: initialFiltersFromUrl,
    });

    if (!filterUrlSyncStarted) {
      startFilterUrlSync();
      filterUrlSyncStarted = true;
    }
    broadcastCurrentFilters();
    logDisplayedRaidBossState();
    raidLoadScheduler.startBackgroundLoading();
  } catch (e) {
    logger.error("Discovery failed:", e);
  } finally {
    isLoading = false;
    syncActiveRaidLoadingIndicator(false);
  }

  const end = performance.now();
  logger.debug(`Total init() duration: ${(end - start).toFixed(1)}ms`);
}

/**
 * Load the active raid, derive its row-driven UI state, and activate that raid
 * as the current app context without restoring prior user-made selections.
 *
 * @param {string} raid
 * @param {Object} options
 * @param {boolean} [options.applyUrlFilters=false]
 * @param {Object} [options.urlFilters]
 */
async function activateRaid(raid, options = {}) {
  if (!raid || !manifestIndex || !raidLoadScheduler || !raidDataStore) return;

  const { applyUrlFilters = false, urlFilters = null } = options;
  activeRaid = raid;
  isLoading = true;
  syncActiveRaidLoadingIndicator(true, raid);
  suppressRaidChangeHandling = true;
  raidLoadScheduler.setActiveRaid(raid);
  raidDataStore.markRaidLoading(raid);

  const tRaidLoadStart = performance.now();
  await raidLoadScheduler.prioritizeRaid(raid);
  const activeRaidRows = raidDataStore.getRaidRows(raid);
  const tRaidLoadEnd = performance.now();
  logger.debug(
    `Activated raid "${raid}" with ${activeRaidRows.length} rows after ${(tRaidLoadEnd - tRaidLoadStart).toFixed(1)}ms`
  );

  setupDataDisplayManager(activeRaidRows);
  populateAllFilters(activeRaidRows, {
    raidValues: manifestIndex.sortedRaids,
    raidLatestDates: manifestIndex.latestDateByRaid,
    preferredRaid: raid,
  });

  if (!chromeInitialized) {
    setupHeaderBindings();
    setupViewSwitcher();
    chromeInitialized = true;
  }

  const dpsTypes = Array.from(
    new Set(activeRaidRows.filter((d) => d.dps_type).map((d) => d.dps_type))
  );
  setupDpsTypeSidebarManager(dpsTypes);

  const uniqueJobs = Array.from(new Set(activeRaidRows.map((d) => d.class)));
  setupJobSidebar(uniqueJobs);

  if (applyUrlFilters) {
    applyInitialFiltersFromUrl(urlFilters);
  } else {
    resetSelectionsForRaidActivation();
  }

  syncLoadFailureMessage();
  suppressRaidChangeHandling = false;
  isLoading = false;
  syncActiveRaidLoadingIndicator(false, raid);
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
 * Reset the cross-filter selections that should not persist across raid
 * switches. Dropdown-based defaults are handled by the active-raid setup code.
 */
function resetSelectionsForRaidActivation() {
  updateFilterValue("selectedJobs", new Set());
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

/**
 * Report the currently displayed raid/boss titles alongside the
 * centralized filter selections so URL hydration issues are visible.
 */
function logDisplayedRaidBossState() {
  const raidTitleEl = document.getElementById("raid-title");
  const bossTitleEl = document.getElementById("boss-subheader");
  const displayedRaid = raidTitleEl?.textContent?.trim() || "[None]";
  const displayedBoss = bossTitleEl?.textContent?.trim() || "[None]";
  const { selectedRaid = "", selectedBoss = "" } = getCurrentFilterState();
  logger.debug(
    `Displayed raid: "${displayedRaid}" (filter: "${
      selectedRaid || ""
    }") | Displayed boss: "${displayedBoss}" (filter: "${selectedBoss || ""}")`
  );
}

function ensureRaidChangeListener() {
  if (raidChangeListenerInitialized) return;
  raidChangeListenerInitialized = true;
  subscribeToFilterChanges((state, change) => {
    if (!change || change.key !== "selectedRaid") return;
    const nextRaid = state.selectedRaid || "";
    if (!nextRaid || nextRaid === activeRaid || suppressRaidChangeHandling) {
      return;
    }

    updateFilterValue("selectedJobs", new Set());
    activateRaid(nextRaid)
      .then(() => {
        if (filterUrlSyncStarted) {
          broadcastCurrentFilters();
        }
      })
      .catch((error) => {
        logger.error(`Failed to activate raid "${nextRaid}"`, error);
      });
  });
}

function syncLoadFailureMessage() {
  const messageEl = getOrCreateLoadMessageElement();
  if (!messageEl) return;

  if (finalFailedFiles.size === 0) {
    messageEl.style.display = "none";
    messageEl.textContent = "";
    return;
  }

  const failedNames = Array.from(finalFailedFiles.keys())
    .map((filePath) => filePath.split("/").pop())
    .sort();
  messageEl.style.display = "";
  messageEl.textContent = `Some data files failed to load and are being treated as missing data: ${failedNames.join(", ")}`;
}

function syncActiveRaidLoadingIndicator(isVisible, raid = "") {
  const indicatorEl = getOrCreateActiveRaidLoadingElement();
  if (!indicatorEl) return;
  const trendPlaceholder = document.getElementById("trend-view-placeholder");

  if (!isVisible) {
    indicatorEl.classList.add("view-hidden");
    indicatorEl.setAttribute("aria-hidden", "true");
    if (trendPlaceholder) {
      // Restore whatever visibility state the placeholder had before the active
      // raid banner temporarily suppressed it.
      const previousDisplay = trendPlaceholder.dataset.preLoadDisplay;
      if (typeof previousDisplay === "string") {
        trendPlaceholder.style.display = previousDisplay;
        delete trendPlaceholder.dataset.preLoadDisplay;
      }
    }
    return;
  }

  if (trendPlaceholder && !("preLoadDisplay" in trendPlaceholder.dataset)) {
    // While the active raid banner is visible, hide the generic dashed trend
    // placeholder so the loader becomes the only empty-state affordance.
    trendPlaceholder.dataset.preLoadDisplay = trendPlaceholder.style.display;
    trendPlaceholder.style.display = "none";
  }

  const activeRaidLabel = raid || activeRaid || "selected raid";
  indicatorEl.classList.remove("view-hidden");
  indicatorEl.setAttribute("aria-hidden", "false");
  indicatorEl.innerHTML = `
    <div class="active-raid-loading-title">Loading ${escapeHtml(
      activeRaidLabel
    )}</div>
    <div class="active-raid-loading-subtitle">Loading raid data</div>
    <div class="active-raid-loading-pulse" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  `;
}

function getOrCreateLoadMessageElement() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("load-status-message");
  if (el) return el;

  const filters = document.getElementById("filters");
  if (!filters) return null;

  el = document.createElement("div");
  el.id = "load-status-message";
  el.className = "chart-empty-message";
  el.style.display = "none";
  filters.insertAdjacentElement("afterend", el);
  return el;
}

function getOrCreateActiveRaidLoadingElement() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("active-raid-loading");
  if (el) return el;

  const filters = document.getElementById("filters");
  if (!filters) return null;

  el = document.createElement("div");
  el.id = "active-raid-loading";
  el.className = "active-raid-loading view-hidden";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-hidden", "true");
  filters.insertAdjacentElement("afterend", el);
  return el;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
