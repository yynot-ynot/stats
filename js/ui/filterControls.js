import {
  ORDER_OVERRIDES,
  MULTI_SELECTS,
  DEFAULTS,
} from "../config/appConfig.js";
import { updateFilterValue } from "../shared/filterState.js";
import {
  setupPercentileSlider,
  setupReferencePercentileSlider,
  setupComparisonPercentileSlider,
} from "./percentileSliderControls.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("filterControls");

/**
 * Populate a <select> dropdown element with sorted values and initialize its state.
 * @param {HTMLSelectElement} selectElement - The <select> element to populate.
 * @param {Set<string>} valueSet - A Set of unique values.
 * @param {string} label - Label used if "All" option is added.
 */
export function populateDropdown(selectElement, valueSet, label) {
  if (!selectElement) return;

  const values = Array.from(valueSet);
  const id = selectElement.id;

  const customOrder = ORDER_OVERRIDES[id];
  if (customOrder) {
    values.sort((a, b) => {
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
  } else {
    values.sort();
  }

  selectElement.innerHTML = "";

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
  }

  // Immediately push initial value to centralized state
  const mappedKey = mapSelectIdToFilterKey(id);
  if (MULTI_SELECTS.includes(id)) {
    const selectedSet = new Set(
      [...selectElement.selectedOptions].map((o) => o.value)
    );
    updateFilterValue(mappedKey, selectedSet);
  } else {
    updateFilterValue(mappedKey, selectElement.value);
  }

  // Attach centralized update handler on change
  selectElement.addEventListener("change", (e) => {
    if (MULTI_SELECTS.includes(id)) {
      const selected = new Set(
        [...selectElement.selectedOptions].map((o) => o.value)
      );
      updateFilterValue(mappedKey, selected);
    } else {
      updateFilterValue(mappedKey, selectElement.value);
    }
  });
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
 * Setup header dropdown behavior using centralized state (no direct DOM triggers).
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
 * Populate all dropdown filters using the provided dataset.
 * Sets the default for Reference Percentile to 50 and for Comparison Percentiles to [25, 75] if they exist.
 * @param {Array<Object>} data - Array of all loaded entries.
 */
export function populateAllFilters(data) {
  const raids = new Set(data.map((d) => d.raid));
  const bosses = new Set(data.map((d) => d.boss));
  const percentiles = new Set(data.map((d) => d.percentile));
  const classes = new Set(data.map((d) => d.class));
  const dpsTypes = new Set(
    data.filter((d) => d.dps_type).map((d) => d.dps_type)
  );

  populateDropdown(document.getElementById("raid-select"), raids, "Raid");
  populateDropdown(document.getElementById("boss-select"), bosses, "Boss");

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
 * Setup single header dropdown behavior (for raid and boss headers).
 * @param {HTMLSelectElement} selectEl - The <select> element.
 * @param {HTMLElement} titleEl - The clickable title/header.
 * @param {HTMLElement} dropdownEl - The dropdown container.
 */
function setupSingleHeaderBehavior(selectEl, titleEl, dropdownEl) {
  const options = [...selectEl.options];
  if (options.length <= 1) {
    titleEl.classList.add("non-interactive");
    return;
  } else {
    titleEl.classList.remove("non-interactive");
  }

  titleEl.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".custom-dropdown").forEach((d) => {
      if (d !== dropdownEl) {
        d.classList.add("hidden-dropdown");
      }
    });
    populateCustomDropdown(selectEl, dropdownEl, titleEl);
    dropdownEl.classList.toggle("hidden-dropdown");
  });
}
