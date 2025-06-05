import {
  ORDER_OVERRIDES,
  MULTI_SELECTS,
  DEFAULTS,
  ALL_FILTER_KEYS,
} from "../config/appConfig.js";
import { updateFilterValue } from "../shared/filterState.js";
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
 * Setup a native range slider for reference percentile with proportional tick marks and custom thumb.
 * UI and functionality matches setupPercentileSlider but writes to selectedReferencePercentile.
 *
 * @param {Set<string>} percentiles - Set of available percentile values (as strings)
 */
export function setupReferencePercentileSlider(percentiles) {
  const container = document.getElementById("reference-percentile-container");
  if (!container) {
    logger.warn("Reference percentile slider container not found.");
    return;
  }

  container.innerHTML = `
  <label id="reference-percentile-label" style="display: block; margin-bottom: 0.5rem;">
    Reference Percentile:
  </label>
  <div class="percentile-slider-row" style="position:relative; height: 44px;">
    <input id="reference-percentile-slider" type="range" />
    <div class="slider-tick-overlay"></div>
    <div class="slider-thumb-custom"></div>
  </div>
`;

  const sortedPercentiles = Array.from(percentiles)
    .map(Number)
    .sort((a, b) => a - b);

  if (sortedPercentiles.length === 0) {
    logger.warn("No percentiles provided to setupReferencePercentileSlider.");
    return;
  }

  // Slider uses values 0..n-1 (steps), but ticks are placed by value on a 0-100% range
  const slider = container.querySelector("#reference-percentile-slider");
  const overlay = container.querySelector(".slider-tick-overlay");
  const thumb = container.querySelector(".slider-thumb-custom");

  slider.min = 0;
  slider.max = sortedPercentiles.length - 1;
  slider.step = 1;

  // Default: config or first value
  let defaultValue = Number(DEFAULTS["percentile-reference-select"]);
  let defaultIdx = sortedPercentiles.indexOf(defaultValue);
  if (defaultIdx === -1) {
    logger.warn(
      `Default reference percentile value (${defaultValue}) not found in available slider values: [${sortedPercentiles.join(
        ", "
      )}]. Falling back to first item.`
    );
    defaultIdx = 0;
    defaultValue = sortedPercentiles[0];
  }

  slider.value = String(defaultIdx);
  let currentIdx = defaultIdx;

  // Compute proportional positions for tick/label placement
  const positions = getProportionalPositions(sortedPercentiles);

  // Clear and render ticks and labels
  overlay.innerHTML = "";
  sortedPercentiles.forEach((percentile, idx) => {
    // Use value-based proportional left position
    const percent = positions[percentile];

    // Tick mark
    const tick = document.createElement("div");
    tick.className = "slider-tick";
    if (idx === currentIdx) tick.classList.add("selected");
    tick.style.left = `calc(${percent}% )`;

    // Label (only shown under selected thumb)
    const label = document.createElement("span");
    label.className = "slider-tick-label";
    label.textContent = percentile;
    label.style.left = `calc(${percent}% )`;
    if (idx === currentIdx) label.classList.add("visible");
    overlay.appendChild(tick);
    overlay.appendChild(label);
  });

  /**
   * Move custom thumb overlay to selected value position.
   * @param {number} idx - Selected percentile index in sortedPercentiles.
   */
  function updateCustomThumb(idx) {
    const percentile = sortedPercentiles[idx];
    const percent = positions[percentile]; // Use the proportional value
    thumb.style.left = `calc(${percent}% )`;
  }

  // Initial thumb position and filter state
  updateCustomThumb(currentIdx);
  updateFilterValue(
    "selectedReferencePercentile",
    sortedPercentiles[currentIdx]
  );

  // Listen for slider movement
  slider.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10);
    currentIdx = idx;
    updateCustomThumb(currentIdx);
    updateFilterValue(
      "selectedReferencePercentile",
      sortedPercentiles[currentIdx]
    );

    // Highlight correct tick/label (hide others)
    const allTicks = overlay.querySelectorAll(".slider-tick");
    const allLabels = overlay.querySelectorAll(".slider-tick-label");
    allTicks.forEach((tick, i) => {
      tick.classList.toggle("selected", i === currentIdx);
    });
    allLabels.forEach((lbl, i) => {
      lbl.classList.toggle("visible", i === currentIdx);
    });
  });

  logger.info(
    "Reference percentile slider with proportional tick marks and custom thumb initialized."
  );
}

/**
 * Setup the comparison percentile multi-select slider or tick UI.
 * This now controls only comparison percentiles.
 * @param {Set<string>} percentiles - Available percentiles (numbers as strings)
 */
export function setupComparisonPercentileSlider(percentiles) {
  const container = document.getElementById("comparison-slider-container");
  if (!container) {
    logger.warn("Comparison percentile slider container not found.");
    return;
  }

  // Only a single row of clickable labels, no bubbles/dots
  container.innerHTML = `
    <div class="comparison-label-row" style="width:100%; position:relative; height:44px; display:flex; align-items:center; justify-content:space-between;"></div>
    <label id="comparison-label" style="display:block; margin-top:0.5rem;">
      Comparison Percentiles
    </label>
  `;

  const labelRow = container.querySelector(".comparison-label-row");

  const sortedPercentiles = Array.from(percentiles)
    .map(Number)
    .sort((a, b) => a - b);

  let compare = new Set(DEFAULTS["percentile-compare-select"].map(Number));

  /**
   * Render percentile value labels on a single line,
   * with each label centered at its proportional position.
   * Selected values are highlighted.
   */
  function renderLabels() {
    labelRow.innerHTML = "";
    const positions = getProportionalPositions(sortedPercentiles);
    sortedPercentiles.forEach((val, idx) => {
      const label = document.createElement("span");
      label.className = "comparison-value-label";
      label.textContent = val;
      label.style.position = "absolute";
      label.style.left = `${positions[val]}%`; // Place at proportional position
      label.style.transform = "translateX(-50%)"; // Center label horizontally
      label.style.top = "10px";
      if (compare.has(val)) label.classList.add("selected");
      label.addEventListener("click", () => {
        const newCompare = new Set(compare);
        if (newCompare.has(val)) newCompare.delete(val);
        else newCompare.add(val);
        updateCompare(Array.from(newCompare));
      });
      labelRow.appendChild(label);
    });
  }
  function updateCompare(newCompare) {
    compare = new Set(newCompare);
    updateFilterValue("selectedComparisonPercentiles", compare);
    renderLabels();
  }
  renderLabels();

  // Set initial value
  updateCompare(compare);
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

/**
 * Setup a native range slider with percentile ticks and a custom thumb overlay.
 *
 * - Ticks and labels are positioned proportionally by percentile value (range 0–100).
 * - Custom thumb follows selected value (not index!).
 * - Label is shown only under the currently selected tick.
 * - Tick labels now have more space below the slider row for clarity.
 *
 * @param {Set<string>} percentiles - Set of available percentile values.
 */
export function setupPercentileSlider(percentiles) {
  const container = document.getElementById("percentile-slider-container");
  if (!container) {
    logger.warn("Percentile slider container not found.");
    return;
  }

  container.innerHTML = `
    <label id="percentile-label" style="display: block; margin-bottom: 0.5rem;">Percentile:</label>
    <div class="percentile-slider-row" style="position:relative; height: 44px;">
      <input id="percentile-slider" type="range" />
      <div class="slider-tick-overlay"></div>
      <div class="slider-thumb-custom"></div>
    </div>
  `;

  const sortedPercentiles = Array.from(percentiles)
    .map(Number)
    .sort((a, b) => a - b);

  if (sortedPercentiles.length === 0) {
    logger.warn("No percentiles provided to setupPercentileSlider.");
    return;
  }

  // Slider always uses values 0..n-1 (steps), but ticks are placed by value on a 0-100% range
  const slider = container.querySelector("#percentile-slider");
  const overlay = container.querySelector(".slider-tick-overlay");
  const thumb = container.querySelector(".slider-thumb-custom");

  slider.min = 0;
  slider.max = sortedPercentiles.length - 1;
  slider.step = 1;

  // Default: config or first value
  let defaultValue = Number(DEFAULTS["percentile-select"]);
  let defaultIdx = sortedPercentiles.indexOf(defaultValue);
  if (defaultIdx === -1) {
    logger.warn(
      `Default percentile value (${defaultValue}) not found in available slider values: [${sortedPercentiles.join(
        ", "
      )}]. Falling back to first item.`
    );
    defaultIdx = 0;
    defaultValue = sortedPercentiles[0];
  }

  slider.value = defaultIdx;
  let currentIdx = defaultIdx;

  // Compute proportional positions for tick/label placement
  const positions = getProportionalPositions(sortedPercentiles);

  // Clear and render ticks and labels
  overlay.innerHTML = "";
  sortedPercentiles.forEach((percentile, idx) => {
    // Use value-based proportional left position
    const percent = positions[percentile];

    // Tick mark
    const tick = document.createElement("div");
    tick.className = "slider-tick";
    if (idx === currentIdx) tick.classList.add("selected");
    tick.style.left = `calc(${percent}% )`;

    // Label (only shown under selected thumb)
    const label = document.createElement("span");
    label.className = "slider-tick-label";
    label.textContent = percentile;
    label.style.left = `calc(${percent}% )`;
    if (idx === currentIdx) label.classList.add("visible");
    overlay.appendChild(tick);
    overlay.appendChild(label);
  });

  /**
   * Move custom thumb overlay to selected value position.
   * @param {number} idx - Selected percentile index in sortedPercentiles.
   */
  function updateCustomThumb(idx) {
    const percentile = sortedPercentiles[idx];
    const percent = positions[percentile]; // Use the proportional value
    thumb.style.left = `calc(${percent}% )`;
  }

  // Initial thumb position and filter state
  updateCustomThumb(currentIdx);
  updateFilterValue("selectedPercentile", sortedPercentiles[currentIdx]);

  // Listen for slider movement
  slider.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10);
    currentIdx = idx;
    updateCustomThumb(currentIdx);
    updateFilterValue("selectedPercentile", sortedPercentiles[currentIdx]);

    // Highlight correct tick/label (hide others)
    const allTicks = overlay.querySelectorAll(".slider-tick");
    const allLabels = overlay.querySelectorAll(".slider-tick-label");
    allTicks.forEach((tick, i) => {
      tick.classList.toggle("selected", i === currentIdx);
    });
    allLabels.forEach((lbl, i) => {
      lbl.classList.toggle("visible", i === currentIdx);
    });
  });

  logger.info(
    "Native slider with value-proportional tick marks, custom thumb overlay, and improved label spacing initialized."
  );
}

/**
 * Given a sorted array of values, compute the proportional position (0–100) for each value,
 * using a fixed [0,100] range. Values outside [0,100] are logged and excluded.
 * @param {number[]} values - Sorted array of values (e.g. percentiles)
 * @returns {Object} Map of value → percent position (0–100)
 */
function getProportionalPositions(values) {
  const minVal = 0;
  const maxVal = 100;
  if (values.length === 0) return {};

  // Edge case: all values are the same and within [0,100]
  if (values.every((v) => v === values[0] && v >= 0 && v <= 100)) {
    return Object.fromEntries(values.map((v) => [v, 50]));
  }

  const positions = {};
  values.forEach((val) => {
    if (val < 0 || val > 100) {
      // You can swap to logger.warn/info if you prefer
      console.warn(
        `[getProportionalPositions] Ignoring out-of-range value: ${val} (must be between 0 and 100)`
      );
      return; // skip this value
    }
    positions[val] = ((val - minVal) / (maxVal - minVal)) * 100;
  });
  return positions;
}
