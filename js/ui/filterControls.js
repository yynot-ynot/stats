// ui/filterControls.js

import {
  ORDER_OVERRIDES,
  MULTI_SELECTS,
  DEFAULTS,
} from "../config/appConfig.js";

/**
 * Populate a <select> dropdown element with sorted values.
 * Adds an "All" option only if the select is multi-select.
 * Sets default values based on appConfig or falls back to first option (for single-selects).
 *
 * @param {HTMLSelectElement} selectElement - The <select> element to populate.
 * @param {Set<string>} valueSet - A Set of unique values to populate the dropdown with.
 * @param {string} label - Label used if "All" option is added.
 */
export function populateDropdown(selectElement, valueSet, label) {
  const values = Array.from(valueSet);

  // Apply custom ordering if defined
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
    values.sort(); // default alphanumeric
  }

  // Clear existing options
  selectElement.innerHTML = "";

  // If multi-select, add "All" option first
  if (selectElement.multiple) {
    const allOption = document.createElement("option");
    allOption.value = "All";
    allOption.textContent = `All ${label}s`;
    selectElement.appendChild(allOption);
  }

  // Add data-driven options
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  });

  // Set default: from appConfig if available, else first option (for single-selects)
  const defaultValue = DEFAULTS[id];
  if (
    defaultValue &&
    [...selectElement.options].some((opt) => opt.value === defaultValue)
  ) {
    selectElement.value = defaultValue;
  } else if (!selectElement.multiple && selectElement.options.length > 0) {
    // For single-selects, select first option if no default
    selectElement.selectedIndex = 0;
  }
}

/**
 * Extract unique values from dataset and populate all filtering dropdowns.
 *
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

  // Set default selections
  populateDropdown(document.getElementById("raid-select"), raids, "Raid");
  populateDropdown(document.getElementById("boss-select"), bosses, "Boss");
  populateDropdown(
    document.getElementById("percentile-select"),
    percentiles,
    "Percentile"
  );
  populateDropdown(document.getElementById("class-select"), classes, "Class");
  populateDropdown(
    document.getElementById("dps-type-select"),
    dpsTypes,
    "DPS Type"
  );
}
