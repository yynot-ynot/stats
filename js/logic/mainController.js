import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("main");

import {
  fetchAvailableJsonFiles,
  fetchAndDecompressJsonGz,
} from "../core/dataLoader.js";
import {
  buildManifestRaidIndex,
  resolveEffectiveRaid,
  resolveEffectiveBoss,
  resolveActivationTarget,
  getManifestBossesForRaid,
  isBossScopedRaid,
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
  setManifestBossOptionsByRaid,
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
let activeLoadTarget = "";
let chromeInitialized = false;
let filterUrlSyncStarted = false;
let raidChangeListenerInitialized = false;
let bossChangeListenerInitialized = false;
let activationInFlightPromise = null;
let requestedRaid = "";
let requestedRaidOptions = null;
let raidRequestVersion = 0;
let processingRaid = "";
let processingLoadTarget = "";
let visibleLoadingTarget = "";
let visibleLoadingLabel = "";
let visibleLoadingKind = "raid";
const activationWaiters = new Set();
const finalFailedFiles = new Map();

/**
 * Build the normalized activation descriptor for the supplied raid/boss
 * request. This keeps target resolution, loading labels, and scope kind in one
 * place so runtime code and unit tests evaluate the same contract.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndexArg
 * @param {string} raid
 * @param {string} [selectedBoss=""]
 * @returns {{
 *   raid: string,
 *   resolvedBoss: string,
 *   activationTarget: string,
 *   activationMetadata: Object|undefined,
 *   loadingKind: "raid"|"boss",
 *   loadingLabel: string,
 * }}
 */
function buildActivationRequest(manifestIndexArg, raid, selectedBoss = "") {
  const resolvedBoss = resolveEffectiveBoss(manifestIndexArg, raid, selectedBoss);
  const activationTarget = resolveActivationTarget(
    manifestIndexArg,
    raid,
    resolvedBoss
  );
  const activationMetadata =
    manifestIndexArg?.targetMetadataByKey?.get(activationTarget);
  const loadingKind = activationMetadata?.scopeType === "boss" ? "boss" : "raid";
  const loadingLabel =
    activationMetadata?.boss || activationMetadata?.raid || raid;

  return {
    raid,
    resolvedBoss,
    activationTarget,
    activationMetadata,
    loadingKind,
    loadingLabel,
  };
}

/**
 * Decide whether an in-flight activation request is an exact duplicate of the
 * currently processing target.
 *
 * @param {Object} params
 * @param {boolean} params.hasActivationInFlight
 * @param {string} params.raid
 * @param {string} params.processingRaid
 * @param {string} params.activationTarget
 * @param {string} params.processingLoadTarget
 * @returns {boolean}
 */
function shouldIgnoreDuplicateActivation(params) {
  const {
    hasActivationInFlight,
    raid,
    processingRaid,
    activationTarget,
    processingLoadTarget,
  } = params;
  return Boolean(
    hasActivationInFlight &&
      raid === processingRaid &&
      activationTarget === processingLoadTarget
  );
}

/**
 * Decide whether a Trial/Ultimate boss change should schedule a new activation.
 * The helper preserves the current parity rules: boss-scoped families only,
 * ignore no-op changes, and treat the active load target as the source of
 * truth when deciding whether we already show the requested boss.
 *
 * @param {Object} params
 * @param {ReturnType<typeof buildManifestRaidIndex>} params.manifestIndexArg
 * @param {string} params.nextRaid
 * @param {string} params.nextBoss
 * @param {string} params.previousBoss
 * @param {string} params.activeLoadTargetValue
 * @returns {{shouldActivate: boolean, activationTarget: string}}
 */
function evaluateBossChangeActivation(params) {
  const {
    manifestIndexArg,
    nextRaid,
    nextBoss,
    previousBoss,
    activeLoadTargetValue,
  } = params;
  if (!nextRaid || !nextBoss || !manifestIndexArg) {
    return { shouldActivate: false, activationTarget: "" };
  }
  if (!isBossScopedRaid(manifestIndexArg, nextRaid)) {
    return { shouldActivate: false, activationTarget: "" };
  }

  const { activationTarget } = buildActivationRequest(
    manifestIndexArg,
    nextRaid,
    nextBoss
  );
  if (previousBoss === nextBoss || activationTarget === activeLoadTargetValue) {
    return { shouldActivate: false, activationTarget };
  }

  return { shouldActivate: true, activationTarget };
}

export function __buildActivationRequestForTests(
  manifestIndexArg,
  raid,
  selectedBoss = ""
) {
  return buildActivationRequest(manifestIndexArg, raid, selectedBoss);
}

export function __shouldIgnoreDuplicateActivationForTests(params) {
  return shouldIgnoreDuplicateActivation(params);
}

export function __evaluateBossChangeActivationForTests(params) {
  return evaluateBossChangeActivation(params);
}

/**
 * Toggle controls that should be owned exclusively by the loading banner while
 * a new raid/boss target is activating. The previous inline display values are
 * restored afterward so existing collapsed/expanded behavior remains intact.
 *
 * @param {boolean} isVisible
 */
function syncLoadingOwnedControlVisibility(isVisible) {
  if (typeof document === "undefined") return;

  const controlledElements = [
    document.getElementById("job-sidebar"),
    document.getElementById("sidebar-label-container"),
    document.getElementById("dps-type-label-container"),
  ].filter(Boolean);

  controlledElements.forEach((element) => {
    if (!element) return;
    if (!isVisible) {
      if (typeof element.dataset?.preLoadDisplay === "string") {
        element.style.display = element.dataset.preLoadDisplay;
        delete element.dataset.preLoadDisplay;
      }
      return;
    }

    if (!("preLoadDisplay" in element.dataset)) {
      element.dataset.preLoadDisplay = element.style.display;
    }
    element.style.display = "none";
  });
}

export function __syncLoadingOwnedControlVisibilityForTests(isVisible) {
  syncLoadingOwnedControlVisibility(isVisible);
}

export function __buildActiveRaidLoadingMarkupForTests(
  label,
  subtitle,
  progressPercent
) {
  return buildActiveRaidLoadingMarkup(label, subtitle, progressPercent);
}

export function __shouldRebuildActiveRaidLoadingMarkupForTests(params) {
  return shouldRebuildActiveRaidLoadingMarkup(params);
}

/**
 * Convert the current target record into the whole-number percentage shown in
 * the shared loading banner. The percentage is target-scoped, so boss-scoped
 * activation only reflects the active subset rather than every file in the
 * broader raid family.
 *
 * @param {string} target
 * @returns {number|null}
 */
function getLoadingProgressPercent(target) {
  if (!raidDataStore || !target) {
    return null;
  }

  const progress = raidDataStore.getTargetProgress?.(target);
  if (!progress) {
    return null;
  }

  return progress.percentLoaded;
}

/**
 * Refresh the visible loading banner's target-scoped percentage without
 * disturbing the existing title/subtitle or bouncing-dot treatment.
 *
 * @param {string} target
 */
function syncVisibleTargetLoadingProgress(target) {
  if (!target || target !== visibleLoadingTarget) {
    return;
  }

  syncActiveRaidLoadingIndicator(
    true,
    visibleLoadingLabel,
    visibleLoadingKind,
    getLoadingProgressPercent(target),
    target
  );
}

/**
 * Decide whether the loading banner must be rebuilt from scratch or can reuse
 * the existing DOM and only patch the progress readout in place.
 *
 * @param {Object} params
 * @param {string} params.nextTarget
 * @param {string} params.nextLabel
 * @param {"raid"|"boss"} params.nextKind
 * @param {string} [params.currentTarget]
 * @param {string} [params.currentLabel]
 * @param {"raid"|"boss"} [params.currentKind]
 * @param {boolean} [params.isVisible]
 * @returns {boolean}
 */
function shouldRebuildActiveRaidLoadingMarkup(params) {
  const {
    nextTarget,
    nextLabel,
    nextKind,
    currentTarget = "",
    currentLabel = "",
    currentKind = "raid",
    isVisible = false,
  } = params;
  if (!isVisible) {
    return true;
  }
  return (
    nextTarget !== currentTarget ||
    nextLabel !== currentLabel ||
    nextKind !== currentKind
  );
}

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
    setManifestBossOptionsByRaid(
      manifestIndex.bossOptionsByRaid,
      manifestIndex.bossLatestDatesByRaid
    );
    raidDataStore = createRaidDataStore({
      filesByRaid: manifestIndex.filesByRaid,
      filesByLoadTarget: manifestIndex.filesByLoadTarget,
      loadTargetsByRaid: manifestIndex.loadTargetsByRaid,
    });
    raidLoadScheduler = createRaidLoadScheduler({
      allFiles: manifestIndex.allFiles,
      filesByLoadTarget: manifestIndex.filesByLoadTarget,
      loadTargetsByRaid: manifestIndex.loadTargetsByRaid,
      targetMetadataByKey: manifestIndex.targetMetadataByKey,
      loadFile: async (record) => fetchAndDecompressJsonGz(record.path),
      onFileLoaded: (record, rows) => {
        raidDataStore.appendFileRows(record, rows);
        finalFailedFiles.delete(record.path);
        syncLoadFailureMessage();
        syncVisibleTargetLoadingProgress(record.loadTarget || record.raid);
      },
      onFileFailed: (record, error) => {
        raidDataStore.markFileFailed(record, error);
        finalFailedFiles.set(record.path, error);
        logger.warn(`Error loading ${record.path}:`, error);
        syncLoadFailureMessage();
        syncVisibleTargetLoadingProgress(record.loadTarget || record.raid);
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
    const effectiveBoss = resolveEffectiveBoss(
      manifestIndex,
      effectiveRaid,
      initialFiltersFromUrl.selectedBoss
    );
    primeManifestRaidSelection(effectiveRaid, effectiveBoss);
    ensureRaidChangeListener();
    ensureBossChangeListener();
    await requestRaidActivation(effectiveRaid, {
      source: "startup",
      applyUrlFilters: true,
      urlFilters: initialFiltersFromUrl,
      selectedBoss: effectiveBoss,
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
 * Load the currently requested raid (or narrower boss-scoped target), derive
 * its row-driven UI state, and activate it as the current app context without
 * restoring prior user-made selections. If a newer request arrives while the
 * current load is in flight, this activation exits early and lets the newer
 * request win.
 *
 * @param {string} raid
 * @param {Object} options
 * @param {string} [options.source="unknown"]
 * @param {boolean} [options.applyUrlFilters=false]
 * @param {Object} [options.urlFilters]
 */
async function activateRaid(raid, options = {}) {
  if (!raid || !manifestIndex || !raidLoadScheduler || !raidDataStore) return;

  const {
    source = "unknown",
    applyUrlFilters = false,
    urlFilters = null,
    selectedBoss = "",
  } = options;
  const {
    resolvedBoss,
    activationTarget,
    loadingKind,
    loadingLabel,
  } = buildActivationRequest(manifestIndex, raid, selectedBoss);
  processingRaid = raid;
  processingLoadTarget = activationTarget;
  try {
    logger.info(
      `[ui-active] begin activation for raid "${raid}" via target "${activationTarget}" (source=${source})`
    );
    isLoading = true;
    raidDataStore.markTargetLoading(activationTarget);
    syncActiveRaidLoadingIndicator(
      true,
      loadingLabel,
      loadingKind,
      getLoadingProgressPercent(activationTarget) ?? 0,
      activationTarget
    );
    raidLoadScheduler.setActiveTarget(activationTarget);

    const tRaidLoadStart = performance.now();
    const requestVersion = raidRequestVersion;
    const supersedeWaiter = createSupersedingRaidWaiter(
      raid,
      activationTarget,
      requestVersion
    );
    const activationOutcome = await Promise.race([
      raidLoadScheduler.prioritizeTarget(activationTarget).then(() => "loaded"),
      supersedeWaiter.promise,
    ]);
    supersedeWaiter.cancel();
    if (activationOutcome === "superseded") {
      logger.info(`[ui-active] activation for raid "${raid}" superseded by a newer request`);
      return;
    }
    const latestRequestedTarget = getRequestedActivationTarget();
    if (latestRequestedTarget && latestRequestedTarget !== activationTarget) {
      logger.info(
        `[ui-active] activation for raid "${raid}" skipped because newer target "${latestRequestedTarget}" is now pending`
      );
      return;
    }

    activeRaid = raid;
    activeLoadTarget = activationTarget;
    const activeRaidRows = raidDataStore.getRowsForTarget(activationTarget);
    const tRaidLoadEnd = performance.now();
    logger.info(
      `[ui-active] activated raid "${raid}" via target "${activationTarget}" with ${activeRaidRows.length} rows after ${(tRaidLoadEnd - tRaidLoadStart).toFixed(1)}ms`
    );

    setupDataDisplayManager(activeRaidRows);
    populateAllFilters(activeRaidRows, {
      raidValues: manifestIndex.sortedRaids,
      raidLatestDates: manifestIndex.latestDateByRaid,
      preferredRaid: raid,
      bossValuesByRaid: manifestIndex.bossOptionsByRaid,
      bossLatestDatesByRaid: manifestIndex.bossLatestDatesByRaid,
      preferredBoss: resolvedBoss,
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
    syncActiveRaidLoadingIndicator(false, loadingLabel, loadingKind);
    logger.info(
      `[ui-active] UI activation complete for raid "${raid}" via target "${activationTarget}" (source=${source}, rows=${activeRaidRows.length}, bosses=${new Set(activeRaidRows.map((row) => row.boss).filter(Boolean)).size})`
    );
    logDisplayedRaidBossState();
  } finally {
    if (processingRaid === raid) {
      processingRaid = "";
    }
    if (processingLoadTarget === activationTarget) {
      processingLoadTarget = "";
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
function requestRaidActivation(raid, options = {}) {
  if (!raid || !manifestIndex || !raidLoadScheduler || !raidDataStore) {
    return Promise.resolve();
  }
  const { activationTarget, loadingKind, loadingLabel } =
    buildActivationRequest(
      manifestIndex,
      raid,
      options.selectedBoss || getCurrentFilterState().selectedBoss
    );
  if (
    shouldIgnoreDuplicateActivation({
      hasActivationInFlight: Boolean(activationInFlightPromise),
      raid,
      processingRaid,
      activationTarget,
      processingLoadTarget,
    })
  ) {
    logger.debug(
      `Ignoring duplicate activation request for in-flight target "${activationTarget}"`
    );
    return activationInFlightPromise;
  }

  requestedRaid = raid;
  requestedRaidOptions = options;
  raidRequestVersion += 1;
  logger.info(
    `[ui-active] queued activation request for raid "${raid}" via target "${activationTarget}" (requestVersion=${raidRequestVersion}, source=${options.source || "unknown"})`
  );
  isLoading = true;
  raidDataStore.markTargetLoading(activationTarget);
  syncActiveRaidLoadingIndicator(
    true,
    loadingLabel,
    loadingKind,
    getLoadingProgressPercent(activationTarget) ?? 0,
    activationTarget
  );
  raidLoadScheduler.setActiveTarget(activationTarget);
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
    const raid = requestedRaid;
    const options = requestedRaidOptions || {};
    requestedRaid = "";
    requestedRaidOptions = null;
    await activateRaid(raid, options);
  }
}

/**
 * Allow an in-flight activation to stop waiting once a different raid has been
 * requested. The scheduler still finishes any already-started file work, but
 * the controller no longer applies stale row-driven UI to the superseded raid.
 *
 * @param {string} raid
 * @param {string} activationTarget
 * @param {number} requestVersion
 * @returns {{promise: Promise<string>, cancel: () => void}}
 */
function createSupersedingRaidWaiter(raid, activationTarget, requestVersion) {
  let waiter = null;
  const promise = new Promise((resolve) => {
    waiter = () => {
      const latestRequestedTarget = getRequestedActivationTarget();
      if (
        raidRequestVersion !== requestVersion &&
        latestRequestedTarget &&
        latestRequestedTarget !== activationTarget
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

function getRequestedActivationTarget() {
  if (!requestedRaid || !manifestIndex) {
    return "";
  }
  const requestedBoss = requestedRaidOptions?.selectedBoss || "";
  return resolveActivationTarget(manifestIndex, requestedRaid, requestedBoss);
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

function ensureRaidChangeListener() {
  if (raidChangeListenerInitialized) return;
  raidChangeListenerInitialized = true;
  subscribeToFilterChanges((state, change) => {
    if (!change || change.key !== "selectedRaid") return;
    const nextRaid = state.selectedRaid || "";
    if (!nextRaid) {
      return;
    }
    if (change.previousValue === nextRaid) {
      return;
    }
    if (nextRaid === activeRaid && !activationInFlightPromise) {
      return;
    }

    logger.info(
      `[ui-active] observed selectedRaid change in filter state: previous="${change.previousValue || ""}" next="${nextRaid}"`
    );
    updateFilterValue("selectedJobs", new Set());
    requestRaidActivation(nextRaid, { source: "filter-state:selectedRaid" })
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

function ensureBossChangeListener() {
  if (bossChangeListenerInitialized) return;
  bossChangeListenerInitialized = true;
  subscribeToFilterChanges((state, change) => {
    if (!change || change.key !== "selectedBoss") return;
    const nextBoss = state.selectedBoss || "";
    const nextRaid = state.selectedRaid || activeRaid || "";
    const { shouldActivate } = evaluateBossChangeActivation({
      manifestIndexArg: manifestIndex,
      nextRaid,
      nextBoss,
      previousBoss: change.previousValue || "",
      activeLoadTargetValue: activeLoadTarget,
    });
    if (!shouldActivate) {
      return;
    }

    logger.info(
      `[ui-active] observed selectedBoss change in filter state: previous="${change.previousValue || ""}" next="${nextBoss}" (raid="${nextRaid}")`
    );
    requestRaidActivation(nextRaid, {
      source: "filter-state:selectedBoss",
      selectedBoss: nextBoss,
    }).catch((error) => {
      logger.error(
        `Failed to activate boss "${nextBoss}" for raid "${nextRaid}"`,
        error
      );
    });
  });
}

function primeManifestRaidSelection(effectiveRaid, preferredBoss = "") {
  const raidSelect = document.getElementById("raid-select");
  const bossSelect = document.getElementById("boss-select");
  if (!raidSelect || !bossSelect || !manifestIndex) {
    return;
  }

  populateDropdown(raidSelect, new Set(manifestIndex.sortedRaids), "Raid", {
    latestDateMap: manifestIndex.latestDateByRaid,
    preferredValue: effectiveRaid,
  });
  populateDropdown(
    bossSelect,
    new Set(getManifestBossesForRaid(manifestIndex, effectiveRaid)),
    "Boss",
    {
      latestDateMap: manifestIndex.bossLatestDatesByRaid[effectiveRaid],
      preferredValue: preferredBoss,
    }
  );
  logger.info(
    `[ui-active] primed manifest-driven raid selector with ${manifestIndex.sortedRaids.length} raid option(s); preferred raid="${effectiveRaid}"`
  );

  if (!chromeInitialized) {
    setupHeaderBindings();
    setupViewSwitcher();
    chromeInitialized = true;
  }
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

/**
 * Show or hide the shared loading banner used during both raid-scoped and
 * boss-scoped activation. The optional label/kind pair lets the same banner
 * stay truthful when the active load target is narrower than an entire raid.
 *
 * @param {boolean} isVisible
 * @param {string} [label=""]
 * @param {"raid"|"boss"} [kind="raid"]
 * @param {number|null} [progressPercent=null]
 * @param {string} [target=""]
 */
function syncActiveRaidLoadingIndicator(
  isVisible,
  label = "",
  kind = "raid",
  progressPercent = null,
  target = ""
) {
  const indicatorEl = getOrCreateActiveRaidLoadingElement();
  if (!indicatorEl) return;
  const trendPlaceholder = document.getElementById("trend-view-placeholder");
  const parseScaleContainer = document.getElementById(
    "parse-delta-scale-container"
  );
  const bodyEl = document.body;

  if (!isVisible) {
    visibleLoadingTarget = "";
    visibleLoadingLabel = "";
    visibleLoadingKind = "raid";
    if (bodyEl) {
      delete bodyEl.dataset.appLoading;
    }
    syncLoadingOwnedControlVisibility(false);
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
  syncLoadingOwnedControlVisibility(true);

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

  const activeLabel = label || activeRaid || "selected target";
  const subtitle = kind === "boss" ? "Loading boss data" : "Loading raid data";
  const shouldRebuild = shouldRebuildActiveRaidLoadingMarkup({
    nextTarget: target || visibleLoadingTarget,
    nextLabel: activeLabel,
    nextKind: kind,
    currentTarget: visibleLoadingTarget,
    currentLabel: visibleLoadingLabel,
    currentKind: visibleLoadingKind,
    isVisible: !indicatorEl.classList.contains("view-hidden"),
  });
  visibleLoadingTarget = target || visibleLoadingTarget;
  visibleLoadingLabel = activeLabel;
  visibleLoadingKind = kind;
  indicatorEl.classList.remove("view-hidden");
  indicatorEl.setAttribute("aria-hidden", "false");
  if (shouldRebuild) {
    indicatorEl.innerHTML = buildActiveRaidLoadingMarkup(
      activeLabel,
      subtitle,
      progressPercent
    );
    return;
  }

  syncActiveRaidLoadingProgressText(indicatorEl, progressPercent);
}

/**
 * Build the loading banner markup. The percentage lives on its own line above
 * the bouncing dots so the motion treatment remains unchanged while still
 * surfacing exact target progress.
 *
 * @param {string} activeLabel
 * @param {string} subtitle
 * @param {number|null} progressPercent
 * @returns {string}
 */
function buildActiveRaidLoadingMarkup(activeLabel, subtitle, progressPercent) {
  const normalizedPercent =
    typeof progressPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : null;
  const progressMarkup =
    normalizedPercent === null
      ? ""
      : `<div class="active-raid-loading-progress" data-loading-progress="true">${normalizedPercent}%</div>`;

  return `
    <div class="active-raid-loading-title">Loading ${escapeHtml(
      activeLabel
    )}</div>
    <div class="active-raid-loading-subtitle">${escapeHtml(subtitle)}</div>
    ${progressMarkup}
    <div class="active-raid-loading-pulse" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  `;
}

/**
 * Update the numeric percentage in-place so progress changes do not recreate
 * the bouncing-dot nodes and inadvertently restart their animation.
 *
 * @param {HTMLElement} indicatorEl
 * @param {number|null} progressPercent
 */
function syncActiveRaidLoadingProgressText(indicatorEl, progressPercent) {
  if (!indicatorEl?.querySelector) {
    return;
  }

  const progressEl = indicatorEl.querySelector("[data-loading-progress='true']");
  if (!progressEl) {
    return;
  }

  if (typeof progressPercent !== "number") {
    progressEl.textContent = "";
    return;
  }

  const normalizedPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));
  progressEl.textContent = `${normalizedPercent}%`;
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
