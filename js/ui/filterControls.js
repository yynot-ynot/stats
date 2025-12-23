import {
  ORDER_OVERRIDES,
  MULTI_SELECTS,
  DEFAULTS,
} from "../config/appConfig.js";
import {
  updateFilterValue,
  subscribeToFilterChanges,
} from "../shared/filterState.js";
import {
  setupPercentileSlider,
  setupReferencePercentileSlider,
  setupComparisonPercentileSlider,
} from "./percentileSliderControls.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("filterControls");

// Module-level cache storing every boss option and the raid -> bosses lookup to support dependent dropdowns.
let bossIndexCache = {
  bossesByRaid: {},
  allBosses: new Set(),
};

export function __setBossIndexCacheForTests(cache) {
  bossIndexCache = cache;
}

export function __getBossIndexCacheForTests() {
  return bossIndexCache;
}

/**
 * Sort a raw array of dropdown values using the appropriate override for the given DOM id.
 * When a custom order override exists it wins outright, otherwise the helper optionally
 * applies date-aware ordering before falling back to simple alphabetical sorting.
 *
 * The helper is intentionally exported so the ordering rules can be unit tested without a DOM.
 *
 * @param {Array<string>} values - Raw option labels collected from the dataset.
 * @param {string} selectId - DOM id of the <select>, used to look up overrides.
 * @param {Object<string, string>} [latestDateMap] - Map of label -> most recent YYYYMMDD string.
 * @returns {Array<string>} Newly sorted copy of the supplied values.
 */
export function sortDropdownValues(values, selectId, latestDateMap) {
  const sortedValues = [...values];

  const customOrder = ORDER_OVERRIDES[selectId];
  if (customOrder) {
    sortedValues.sort((a, b) => {
      const aIndex = customOrder.findIndex(
        (v) => v.toLowerCase() === a.toLowerCase()
      );
      const bIndex = customOrder.findIndex(
        (v) => v.toLowerCase() === b.toLowerCase()
      );
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  } else if (latestDateMap) {
    sortedValues.sort((a, b) => {
      const dateA = latestDateMap?.[a] ?? "";
      const dateB = latestDateMap?.[b] ?? "";
      if (dateA === dateB) {
        return a.localeCompare(b);
      }
      return dateB.localeCompare(dateA);
    });
  } else {
    sortedValues.sort();
  }

  return sortedValues;
}

/**
 * Build a lookup table mapping each raid to the bosses observed in the data and track the full boss set.
 * This powers the dependent boss dropdown so we can instantly repopulate the boss list when the raid changes
 * without issuing new fetches.
 *
 * @param {Array<Object>} data - Full dataset rows containing { raid, boss } pairs.
 * @returns {{bossesByRaid: Object<string, Set<string>>, allBosses: Set<string>}} Aggregated lookup.
 */
export function buildBossIndex(data) {
  const bossesByRaid = {};
  const allBosses = new Set();

  data.forEach((entry) => {
    if (!entry?.boss) return;
    allBosses.add(entry.boss);
    if (!entry.raid) return;

    if (!bossesByRaid[entry.raid]) {
      bossesByRaid[entry.raid] = new Set();
    }
    bossesByRaid[entry.raid].add(entry.boss);
  });

  return { bossesByRaid, allBosses };
}

/**
 * Populate a <select> dropdown element with sorted values and initialize its state.
 * The helper first delegates ordering to `sortDropdownValues`, then renders <option> nodes
 * and pushes the initial selection into the shared filter state.
 *
 * @param {HTMLSelectElement} selectElement - The <select> element to populate.
 * @param {Set<string>} valueSet - A Set of unique values.
 * @param {string} label - Label used if "All" option is added.
 * @param {Object} [options] - Optional configuration overrides.
 * @param {Object<string, string>} [options.latestDateMap] - Map of item -> latest YYYYMMDD date for sorting.
 */
export function populateDropdown(selectElement, valueSet, label, options = {}) {
  if (!selectElement) return;

  const id = selectElement.id;
  const { latestDateMap } = options;
  const values = sortDropdownValues(Array.from(valueSet), id, latestDateMap);

  selectElement.innerHTML = "";
  selectElement.value = "";
  selectElement.selectedIndex = -1;

  if (selectElement.multiple) {
    const allOption = document.createElement("option");
    allOption.value = "All";
    allOption.textContent = `All ${label}s`;
    selectElement.appendChild(allOption);
  }

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  });

  // --- Updated for default multi-select for percentile-compare-select
  const defaultValue = DEFAULTS[id];
  if (defaultValue && selectElement.multiple && Array.isArray(defaultValue)) {
    // Multi-select with array of defaults
    for (const opt of selectElement.options) {
      if (defaultValue.includes(opt.value)) {
        opt.selected = true;
      }
    }
    // --- Fire a change event so listeners update centralized state
    selectElement.dispatchEvent(new Event("change"));
  } else if (
    defaultValue &&
    [...selectElement.options].some((opt) => opt.value === defaultValue)
  ) {
    selectElement.value = defaultValue;
  } else if (!selectElement.multiple && selectElement.options.length > 0) {
    selectElement.selectedIndex = 0;
    selectElement.value = selectElement.options[0].value;
  }

  const mappedKey = mapSelectIdToFilterKey(id);
  const isMultiSelect = MULTI_SELECTS.includes(id);

  const pushCurrentSelection = () => {
    if (!mappedKey) return;
    if (isMultiSelect) {
      const selectedSet = new Set(
        [...selectElement.selectedOptions].map((o) => o.value)
      );
      updateFilterValue(mappedKey, selectedSet);
    } else {
      updateFilterValue(mappedKey, selectElement.value);
    }
  };

  // Immediately push initial value to centralized state
  pushCurrentSelection();

  // Attach centralized update handler on change (guard to avoid stacking duplicates on re-population)
  if (!selectElement.__filterControlsChangeHandler) {
    const handler = () => pushCurrentSelection();
    selectElement.addEventListener("change", handler);
    selectElement.__filterControlsChangeHandler = handler;
  }
}

/**
 * Map DOM select IDs to centralized filter state keys.
 * @param {string} id - DOM select ID.
 * @returns {string} Corresponding filterState key.
 */
function mapSelectIdToFilterKey(id) {
  const mapping = {
    "raid-select": "selectedRaid",
    "boss-select": "selectedBoss",
    "percentile-select": "selectedPercentile",
    "dps-type-select": "selectedDpsType",
    "class-select": "selectedClasses",
  };
  return mapping[id];
}

/**
 * Wire the raid and boss headers up to their underlying <select> elements so clicking the
 * headers toggles the dropdown content while the true <select> stays hidden for accessibility.
 * This keeps a single source of truth (the <select>) and mirrors its value back into the titles.
 */
export function setupHeaderBindings() {
  const raidSelect = document.getElementById("raid-select");
  const bossSelect = document.getElementById("boss-select");
  const raidTitle = document.getElementById("raid-title");
  const bossSubheader = document.getElementById("boss-subheader");
  const raidDropdown = document.getElementById("raid-dropdown");
  const bossDropdown = document.getElementById("boss-dropdown");

  raidTitle.textContent = raidSelect.value || "[Select Raid]";
  bossSubheader.textContent = bossSelect.value || "[Select Boss]";

  setupSingleHeaderBehavior(raidSelect, raidTitle, raidDropdown);
  setupSingleHeaderBehavior(bossSelect, bossSubheader, bossDropdown);

  document.addEventListener("click", (e) => {
    if (!raidTitle.contains(e.target) && !raidDropdown.contains(e.target)) {
      raidDropdown.classList.add("hidden-dropdown");
    }
    if (!bossSubheader.contains(e.target) && !bossDropdown.contains(e.target)) {
      bossDropdown.classList.add("hidden-dropdown");
    }
  });
}

/**
 * Populate every dropdown filter from the decompressed dataset snapshot.
 * The raid dropdown receives an additional recency-aware ordering map so the newest raids float
 * to the top, while other dropdowns rely on alphabetical or explicit overrides as appropriate.
 *
 * @param {Array<Object>} data - Array of all loaded entries.
 */
export function populateAllFilters(data) {
  // Track each raid's most recent date so the dropdown can surface the newest content first.
  const raidLatestDates = {};
  data.forEach((entry) => {
    if (!entry.raid || !entry.date) return;
    const currentLatest = raidLatestDates[entry.raid];
    if (!currentLatest || entry.date > currentLatest) {
      raidLatestDates[entry.raid] = entry.date;
    }
  });

  bossIndexCache = buildBossIndex(data);

  const raids = new Set(data.map((d) => d.raid));
  const bosses = bossIndexCache.allBosses;
  const percentiles = new Set(data.map((d) => d.percentile));
  const classes = new Set(data.map((d) => d.class));
  const dpsTypes = new Set(
    data.filter((d) => d.dps_type).map((d) => d.dps_type)
  );

  populateDropdown(document.getElementById("raid-select"), raids, "Raid", {
    latestDateMap: raidLatestDates,
  });
  populateDropdown(document.getElementById("boss-select"), bosses, "Boss");
  setupRaidBossFiltering();

  setupPercentileSlider(percentiles);
  setupReferencePercentileSlider(percentiles);
  setupComparisonPercentileSlider(percentiles);

  populateDropdown(
    document.getElementById("dps-type-select"),
    dpsTypes,
    "DPS Type"
  );

  populateDropdown(document.getElementById("class-select"), classes, "Class");
}

/**
 * Populate a custom dropdown visual container.
 * Used by the faux headers so the actual select element can remain hidden while still receiving events.
 *
 * @param {HTMLSelectElement} selectEl - The <select> element.
 * @param {HTMLElement} dropdownEl - The dropdown container.
 * @param {HTMLElement} titleEl - The header element.
 */
function populateCustomDropdown(selectEl, dropdownEl, titleEl) {
  dropdownEl.innerHTML = "";
  [...selectEl.options].forEach((opt) => {
    const item = document.createElement("div");
    item.textContent = opt.value;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      titleEl.textContent = opt.value;
      selectEl.value = opt.value;
      dropdownEl.classList.add("hidden-dropdown");
      selectEl.dispatchEvent(new Event("change"));
    });
    dropdownEl.appendChild(item);
  });
}

/**
 * Retrieve the boss Set for the provided raid, falling back to the full catalog if no raid is selected.
 * @param {string} raid - Current raid selection.
 * @returns {Set<string>} Boss option set for dropdown population.
 */
function getBossSetForRaid(raid) {
  if (raid && bossIndexCache.bossesByRaid[raid]) {
    return bossIndexCache.bossesByRaid[raid];
  }
  return bossIndexCache.allBosses;
}

/**
 * Keep the boss dropdown synchronized with the currently selected raid.
 * When the player changes raids we rebuild the boss options so only relevant bosses are surfaced.
 */
export function setupRaidBossFiltering() {
  const raidSelect = document.getElementById("raid-select");
  const bossSelect = document.getElementById("boss-select");
  if (!raidSelect || !bossSelect) return;

  const applyBossFilter = () => {
    const bossesForRaid = getBossSetForRaid(raidSelect.value);
    populateDropdown(bossSelect, bossesForRaid, "Boss");

    const bossTitle = document.getElementById("boss-subheader");
    if (bossTitle) {
      bossTitle.textContent = bossSelect.value || "[Select Boss]";
      bossTitle.__updateDropdownInteractivity?.();
    }
    const bossDropdown = document.getElementById("boss-dropdown");
    bossDropdown?.classList.add("hidden-dropdown");
  };

  if (raidSelect.__bossFilterHandler) {
    raidSelect.removeEventListener("change", raidSelect.__bossFilterHandler);
  }

  raidSelect.__bossFilterHandler = applyBossFilter;
  raidSelect.addEventListener("change", applyBossFilter);

  applyBossFilter();

  if (!raidSelect.__raidFilterSubscription) {
    raidSelect.__raidFilterSubscription = subscribeToFilterChanges(
      (_, change) => {
        if (change && change.key !== "selectedRaid") return;
        const nextRaid = change?.nextValue || "";
        if (nextRaid && raidSelect.value !== nextRaid) {
          raidSelect.value = nextRaid;
        }
        applyBossFilter();
      }
    );
  }
}

/**
 * Setup single header dropdown behavior (for raid and boss headers).
 * Connects the faux title to the hidden select and keeps the dropdown in sync with selections.
 *
 * @param {HTMLSelectElement} selectEl - The <select> element.
 * @param {HTMLElement} titleEl - The clickable title/header.
 * @param {HTMLElement} dropdownEl - The dropdown container.
 */
function setupSingleHeaderBehavior(selectEl, titleEl, dropdownEl) {
  const updateInteractivity = () => {
    if (selectEl.options.length <= 1) {
      titleEl.classList.add("non-interactive");
      dropdownEl?.classList.add("hidden-dropdown");
    } else {
      titleEl.classList.remove("non-interactive");
    }
  };

  // expose so other helpers (e.g., raid->boss filtering) can refresh when options change
  titleEl.__updateDropdownInteractivity = updateInteractivity;
  updateInteractivity();

  if (titleEl.__dropdownClickHandler) return;

  const clickHandler = (e) => {
    if (selectEl.options.length <= 1) return; // nothing to show
    e.stopPropagation();
    document.querySelectorAll(".custom-dropdown").forEach((d) => {
      if (d !== dropdownEl) {
        d.classList.add("hidden-dropdown");
      }
    });
    populateCustomDropdown(selectEl, dropdownEl, titleEl);
    dropdownEl.classList.toggle("hidden-dropdown");
  };

  titleEl.addEventListener("click", clickHandler);
  titleEl.__dropdownClickHandler = clickHandler;
}
