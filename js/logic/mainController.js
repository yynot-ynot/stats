import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("main");

import {
  fetchAvailableJsonFiles,
  fetchAndDecompressJsonGz,
} from "../core/dataLoader.js";
import {
  buildManifestRaidIndex,
  buildRaidEntityKey,
  resolveEffectiveEntitySlug,
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
  populateDropdown,
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
import {
  setupParseScaleControl,
  setParseScaleControlValue,
} from "../ui/parseScaleControl.js";
import { setupViewSwitcher } from "../ui/viewSwitcher.js";

import { setupDataDisplayManager } from "./dataDisplayManager.js";
import { createRaidDataStore } from "./raidDataStore.js";

let isLoading = false;
let manifestIndex = null;
let raidDataStore = null;
let raidLoadScheduler = null;
let activeRaid = "";
let activeEntitySlug = "";
let chromeInitialized = false;
let filterUrlSyncStarted = false;
let raidChangeListenerInitialized = false;
let activationInFlightPromise = null;
let requestedRaid = "";
let requestedRaidOptions = null;
let raidRequestVersion = 0;
let processingRaid = "";
const activationWaiters = new Set();
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
  // Initialize the standalone parse-scale toggle before URL hydration so it can
  // accept startup state like the other filter controls.
  setupParseScaleControl();
  const initialFiltersFromUrl = parseFilterStateFromUrl();
  logger.info(
    `Initial URL filter intent: raid="${initialFiltersFromUrl.selectedRaid || ""}", boss="${initialFiltersFromUrl.selectedBoss || ""}", metric="${initialFiltersFromUrl.selectedDpsType || ""}", pct="${initialFiltersFromUrl.selectedPercentile ?? ""}"`
  );
  isLoading = true;
  syncActiveRaidLoadingIndicator(true);
  const start = performance.now();

  try {
    // Step 1: Discover available JSON files
    const t1 = performance.now();
    const files = await fetchAvailableJsonFiles("json/");
    manifestIndex = buildManifestRaidIndex(files);
    raidDataStore = createRaidDataStore(manifestIndex.filesByGroup);
    raidLoadScheduler = createRaidLoadScheduler({
      allFiles: manifestIndex.allFiles,
      filesByGroup: manifestIndex.filesByGroup,
      filesByRaid: manifestIndex.filesByRaid,
      loadFile: async (record) => fetchAndDecompressJsonGz(record.path),
      onFileLoaded: (record, rows) => {
        const normalizedRows = rows.map((row) => ({
          ...row,
          entitySlug: record.entitySlug || row.entitySlug || row.boss,
          entityLabel: record.entityLabel || row.entityLabel || row.boss,
        }));
        raidDataStore.appendFileRows(record.groupKey, record.path, normalizedRows);
        finalFailedFiles.delete(record.path);
        syncLoadFailureMessage();
      },
      onFileFailed: (record, error) => {
        raidDataStore.markFileFailed(record.groupKey, record.path, error);
        finalFailedFiles.set(record.path, error);
        logger.warn(`Error loading ${record.path}:`, error);
        syncLoadFailureMessage();
      },
    });
    const t2 = performance.now();
    logger.info(
      `Discovered ${files.length} files to load. (in ${(t2 - t1).toFixed(1)}ms)`
    );

    const effectiveRaid = resolveEffectiveRaid(
      manifestIndex,
      initialFiltersFromUrl.selectedRaid
    );
    logger.info(
      `[ui-active] resolved startup raid "${effectiveRaid}" from URL raid "${initialFiltersFromUrl.selectedRaid || ""}"`
    );
    primeManifestRaidSelection(effectiveRaid);
    ensureSelectionChangeListeners();
    const effectiveEntitySlug = resolveEffectiveEntitySlug(
      manifestIndex,
      effectiveRaid,
      initialFiltersFromUrl.selectedBoss
    );
    logger.info(
      `[ui-active] resolved startup entity "${effectiveEntitySlug}" for raid "${effectiveRaid}"`
    );
    primeManifestEntitySelection(effectiveRaid, effectiveEntitySlug);
    await requestSelectionActivation(effectiveRaid, effectiveEntitySlug, {
      source: "startup",
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
  logger.info(`Total init() duration: ${(end - start).toFixed(1)}ms`);
}

/**
 * Load the currently requested raid/entity selection and activate that slice
 * as the current app context without restoring prior user-made selections.
 *
 * If a newer selection request arrives while the current load is in flight,
 * this activation exits early and lets the newer request win. The scheduler
 * still allows any already-started file work to finish, but stale row-driven
 * UI should not be applied after supersession.
 *
 * @param {string} raid
 * @param {string} entitySlug
 * @param {Object} options
 * @param {string} [options.source="unknown"]
 * @param {boolean} [options.applyUrlFilters=false]
 * @param {Object} [options.urlFilters]
 */
async function activateSelection(raid, entitySlug, options = {}) {
  if (!raid || !manifestIndex || !raidLoadScheduler || !raidDataStore) return;

  const { source = "unknown", applyUrlFilters = false, urlFilters = null } = options;
  const groupKey = buildRaidEntityKey(raid, entitySlug);
  processingRaid = groupKey;
  try {
    logger.info(
      `[ui-active] begin activation for selection "${groupKey}" (source=${source})`
    );
    isLoading = true;
    syncActiveRaidLoadingIndicator(true, raid);
    raidLoadScheduler.setActiveSelection(groupKey);
    raidDataStore.markGroupLoading(groupKey);

    const tRaidLoadStart = performance.now();
    const requestVersion = raidRequestVersion;
    const supersedeWaiter = createSupersedingRaidWaiter(groupKey, requestVersion);
    const activationOutcome = await Promise.race([
      raidLoadScheduler.prioritizeSelection(groupKey).then(() => "loaded"),
      supersedeWaiter.promise,
    ]);
    supersedeWaiter.cancel();
    if (activationOutcome === "superseded") {
      logger.info(
        `[ui-active] activation for selection "${groupKey}" superseded by a newer request`
      );
      return;
    }
    if (requestedRaid && requestedRaid !== groupKey) {
      logger.info(
        `[ui-active] activation for selection "${groupKey}" skipped because "${requestedRaid}" is now pending`
      );
      return;
    }

    activeRaid = raid;
    activeEntitySlug = entitySlug;
    const activeRaidRows = raidDataStore.getGroupRows(groupKey);
    const tRaidLoadEnd = performance.now();
    logger.info(
      `[ui-active] activated selection "${groupKey}" with ${activeRaidRows.length} rows after ${(tRaidLoadEnd - tRaidLoadStart).toFixed(1)}ms`
    );

    setupDataDisplayManager(activeRaidRows);
    populateAllFilters(activeRaidRows, {
      raidValues: manifestIndex.sortedRaids,
      raidLatestDates: manifestIndex.latestDateByRaid,
      preferredRaid: raid,
      bossValues: new Set(
        (manifestIndex.entitiesByRaid.get(raid) || []).map((entry) => entry.slug)
      ),
      bossLabelMap: Object.fromEntries(
        (manifestIndex.entitiesByRaid.get(raid) || []).map((entry) => [
          entry.slug,
          entry.label,
        ])
      ),
      preferredBoss: entitySlug,
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
    isLoading = false;
    syncActiveRaidLoadingIndicator(false, raid);
    logger.info(
      `[ui-active] UI activation complete for selection "${groupKey}" (source=${source}, rows=${activeRaidRows.length}, bosses=${new Set(activeRaidRows.map((row) => row.boss).filter(Boolean)).size})`
    );
    logDisplayedRaidBossState();
  } finally {
    if (processingRaid === groupKey) {
      processingRaid = "";
    }
  }
}

/**
 * Record the latest requested raid and ensure the controller eventually
 * activates it. While another activation is already running, this acts as a
 * last-selection-wins queue and immediately updates scheduler priority.
 *
 * @param {string} raid
 * @param {Object} options
 * @returns {Promise<void>}
 */
function requestSelectionActivation(raid, entitySlug, options = {}) {
  if (!raid || !manifestIndex || !raidLoadScheduler || !raidDataStore) {
    return Promise.resolve();
  }
  const groupKey = buildRaidEntityKey(raid, entitySlug);
  if (activationInFlightPromise && groupKey === processingRaid) {
    logger.debug(
      `Ignoring duplicate activation request for in-flight selection "${groupKey}"`
    );
    return activationInFlightPromise;
  }

  requestedRaid = groupKey;
  requestedRaidOptions = { ...options, raid, entitySlug };
  raidRequestVersion += 1;
  logger.info(
    `[ui-active] queued activation request for selection "${groupKey}" (requestVersion=${raidRequestVersion}, source=${options.source || "unknown"})`
  );
  isLoading = true;
  syncActiveRaidLoadingIndicator(true, raid);
  raidLoadScheduler.setActiveSelection(groupKey);
  raidDataStore.markGroupLoading(groupKey);
  notifyActivationWaiters();

  if (activationInFlightPromise) {
    return activationInFlightPromise;
  }

  activationInFlightPromise = processRequestedRaidActivations().finally(() => {
    activationInFlightPromise = null;
  });
  return activationInFlightPromise;
}

async function processRequestedRaidActivations() {
  while (requestedRaid) {
    const options = requestedRaidOptions || {};
    const { raid = "", entitySlug = "" } = options;
    requestedRaid = "";
    requestedRaidOptions = null;
    await activateSelection(raid, entitySlug, options);
  }
}

/**
 * Allow an in-flight activation to stop waiting once a different raid has been
 * requested. The scheduler still finishes any already-started file work, but
 * the controller no longer applies stale row-driven UI to the superseded
 * selection.
 *
 * @param {string} raid
 * @param {number} requestVersion
 * @returns {{promise: Promise<string>, cancel: () => void}}
 */
function createSupersedingRaidWaiter(raid, requestVersion) {
  let waiter = null;
  const promise = new Promise((resolve) => {
    waiter = () => {
      if (
        raidRequestVersion !== requestVersion &&
        requestedRaid &&
        requestedRaid !== raid
      ) {
        activationWaiters.delete(waiter);
        resolve("superseded");
      }
    };
    activationWaiters.add(waiter);
  });

  return {
    promise,
    cancel() {
      if (waiter) {
        activationWaiters.delete(waiter);
      }
    },
  };
}

function notifyActivationWaiters() {
  Array.from(activationWaiters).forEach((waiter) => waiter());
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
  // Hydrate the parse-delta scale alongside the standard trend filters.
  if (filters.parseDeltaScale) {
    setParseScaleControlValue(filters.parseDeltaScale);
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
  logger.info(
    `[ui-active] displayed raid: "${displayedRaid}" (filter: "${
      selectedRaid || ""
    }") | Displayed boss: "${displayedBoss}" (filter: "${selectedBoss || ""}")`
  );
}

function ensureSelectionChangeListeners() {
  if (raidChangeListenerInitialized) return;
  raidChangeListenerInitialized = true;
  subscribeToFilterChanges((state, change) => {
    if (!change) return;
    if (change.key === "selectedRaid") {
      const nextRaid = state.selectedRaid || "";
      if (!nextRaid || change.previousValue === nextRaid) {
        return;
      }
      const nextEntitySlug = resolveEffectiveEntitySlug(
        manifestIndex,
        nextRaid,
        ""
      );
      primeManifestEntitySelection(nextRaid, nextEntitySlug);
      if (filterUrlSyncStarted) {
        broadcastCurrentFilters();
      }
      return;
    }
    if (change.key !== "selectedBoss") return;
    const nextRaid = state.selectedRaid || "";
    const nextEntitySlug = state.selectedBoss || "";
    if (!nextRaid) return;
    if (
      nextRaid === activeRaid &&
      nextEntitySlug === activeEntitySlug &&
      !activationInFlightPromise
    ) {
      return;
    }
    logger.info(
      `[ui-active] observed entity selection change: raid="${nextRaid}" entity="${nextEntitySlug}"`
    );
    updateFilterValue("selectedJobs", new Set());
    requestSelectionActivation(nextRaid, nextEntitySlug, {
      source: `filter-state:${change.key}`,
    })
      .then(() => {
        if (filterUrlSyncStarted) {
          broadcastCurrentFilters();
        }
      })
      .catch((error) => {
        logger.error(
          `Failed to activate selection "${nextRaid}::${nextEntitySlug}"`,
          error
        );
      });
  });
}

function primeManifestRaidSelection(effectiveRaid) {
  const raidSelect = document.getElementById("raid-select");
  const bossSelect = document.getElementById("boss-select");
  if (!raidSelect || !bossSelect || !manifestIndex) {
    return;
  }

  populateDropdown(raidSelect, new Set(manifestIndex.sortedRaids), "Raid", {
    latestDateMap: manifestIndex.latestDateByRaid,
    preferredValue: effectiveRaid,
  });
  populateDropdown(bossSelect, new Set(), "Boss");
  logger.info(
    `[ui-active] primed manifest-driven raid selector with ${manifestIndex.sortedRaids.length} raid option(s); preferred raid="${effectiveRaid}"`
  );

  if (!chromeInitialized) {
    setupHeaderBindings();
    setupViewSwitcher();
    chromeInitialized = true;
  }
}

function primeManifestEntitySelection(raid, preferredEntitySlug) {
  const bossSelect = document.getElementById("boss-select");
  if (!bossSelect || !manifestIndex) {
    return;
  }
  const entities = manifestIndex.entitiesByRaid.get(raid) || [];
  const entityValues = new Set(entities.map((entry) => entry.slug));
  const entityLabels = Object.fromEntries(
    entities.map((entry) => [entry.slug, entry.label])
  );
  populateDropdown(bossSelect, entityValues, "Boss", {
    optionLabels: entityLabels,
    preferredValue: preferredEntitySlug,
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
  const parseScaleContainer = document.getElementById(
    "parse-delta-scale-container"
  );
  const bodyEl = document.body;

  if (!isVisible) {
    if (bodyEl) {
      delete bodyEl.dataset.appLoading;
    }
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

  if (bodyEl) {
    bodyEl.dataset.appLoading = "true";
  }

  if (parseScaleContainer) {
    // Hide the scale toggle while a raid is loading so stale controls do not
    // float above an empty or superseded chart area.
    parseScaleContainer.classList.add("view-hidden");
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
