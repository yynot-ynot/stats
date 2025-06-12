import { DEFAULTS } from "../config/appConfig.js";
import { updateFilterValue } from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("percentileSliderControls");

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

/**
 * Setup a native range slider with percentile ticks and a custom thumb overlay.
 *
 * - Uses a shared helper to render and control slider UI and state.
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
      <label id="percentile-label">Percentile:</label>
      <div class="percentile-slider-row">
        <input id="percentile-slider" type="range" />
        <div class="slider-tick-overlay"></div>
        <div class="slider-thumb-custom"></div>
      </div>
    `;

  const sortedPercentiles = Array.from(percentiles)
    .map(Number)
    .sort((a, b) => a - b);

  initPercentileSliderUI({
    container,
    sliderSelector: "#percentile-slider",
    stateKey: "selectedPercentile",
    percentiles: sortedPercentiles,
    defaultValue: Number(DEFAULTS["percentile-select"]),
    logger,
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
      <label id="reference-percentile-label">
        Reference Percentile:
      </label>
      <div class="percentile-slider-row">
        <input id="reference-percentile-slider" type="range" />
        <div class="slider-tick-overlay"></div>
        <div class="slider-thumb-custom"></div>
      </div>
    `;

  const sortedPercentiles = Array.from(percentiles)
    .map(Number)
    .sort((a, b) => a - b);

  initPercentileSliderUI({
    container,
    sliderSelector: "#reference-percentile-slider",
    stateKey: "selectedReferencePercentile",
    percentiles: sortedPercentiles,
    defaultValue: Number(DEFAULTS["percentile-reference-select"]),
    logger,
  });
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

  // -- CSS REMOVED, CLASS/ID ONLY!
  container.innerHTML = `
      <div class="comparison-label-row"></div>
      <label id="comparison-label">
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
 * Helper to initialize and manage a proportional percentile slider UI.
 * Handles tick and label rendering, custom thumb movement, and filter state update.
 *
 * @param {Object} options - Slider configuration.
 * @param {HTMLElement} container - The container element to render in.
 * @param {string} sliderSelector - ID selector for the slider input.
 * @param {string} stateKey - Centralized filter state key.
 * @param {number[]} percentiles - Sorted array of percentiles (numbers).
 * @param {number} defaultValue - Default percentile value.
 * @param {function} logger - Logger for warning/info.
 */
function initPercentileSliderUI({
  container,
  sliderSelector,
  stateKey,
  percentiles,
  defaultValue,
  logger,
}) {
  if (percentiles.length === 0) {
    logger.warn(`No percentiles provided to slider UI (${sliderSelector}).`);
    return;
  }

  const slider = container.querySelector(sliderSelector);
  const overlay = container.querySelector(".slider-tick-overlay");
  const thumb = container.querySelector(".slider-thumb-custom");

  // Slider now goes from 0 to 100 (continuous)
  slider.min = 0;
  slider.max = 100;
  slider.step = 1; // or finer if desired

  // Find proportional value for defaultValue
  let defaultPercent = getProportionalPositions(percentiles)[defaultValue];
  if (defaultPercent === undefined) {
    logger.warn(
      `Default value (${defaultValue}) not found in percentiles: [${percentiles.join(
        ", "
      )}]. Falling back to first item.`
    );
    defaultPercent = 0;
  }
  slider.value = String(defaultPercent);
  // Find closest index for rendering tick highlights
  let currentIdx = percentiles.indexOf(defaultValue);
  if (currentIdx === -1) currentIdx = 0;

  const positions = getProportionalPositions(percentiles);

  // Render ticks and labels
  overlay.innerHTML = "";
  percentiles.forEach((percentile, idx) => {
    const percent = positions[percentile];
    const tick = document.createElement("div");
    tick.className = "slider-tick";
    if (idx === currentIdx) tick.classList.add("selected");
    tick.style.left = `calc(${percent}% )`;

    const label = document.createElement("span");
    label.className = "slider-tick-label";
    label.textContent = percentile;
    label.style.left = `calc(${percent}% )`;
    if (idx === currentIdx) label.classList.add("visible");
    overlay.appendChild(tick);
    overlay.appendChild(label);
  });

  function updateCustomThumb(idx) {
    const percentile = percentiles[idx];
    const percent = positions[percentile];
    thumb.style.left = `calc(${percent}% )`;
  }

  // Initial thumb position and filter state
  updateCustomThumb(currentIdx);
  updateFilterValue(stateKey, percentiles[currentIdx]);

  // On input: move thumb visually only (find the "would-be" closest percentile for thumb, but do NOT update state yet)
  slider.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    // Find closest percentile to the slider value
    const closest = findClosestPercentile(value, percentiles);
    const idx = percentiles.indexOf(closest);
    updateCustomThumbByValue(value, percentiles, positions, thumb); // Move thumb visually to current value
    highlightTickAndLabel(idx, overlay); // Optionally show a preview
  });

  // On change: snap to nearest allowed percentile, update state
  slider.addEventListener("change", (e) => {
    const value = parseFloat(e.target.value);
    const closest = findClosestPercentile(value, percentiles);
    const idx = percentiles.indexOf(closest);
    // Snap slider to the allowed value
    slider.value = String(positions[closest]);
    updateCustomThumb(idx); // Move thumb to snapped position
    highlightTickAndLabel(idx, overlay);
    updateFilterValue(stateKey, closest);
  });
}

/**
 * Find the closest percentile value in the array to a given slider position.
 * @param {number} sliderValue - Value from the slider (0–100)
 * @param {number[]} percentiles - Sorted array of allowed percentiles
 * @returns {number} Closest percentile
 */
function findClosestPercentile(sliderValue, percentiles) {
  return percentiles.reduce((prev, curr) =>
    Math.abs(getProportionalPositions(percentiles)[curr] - sliderValue) <
    Math.abs(getProportionalPositions(percentiles)[prev] - sliderValue)
      ? curr
      : prev
  );
}

/**
 * Move the custom thumb overlay to the current slider value (not snapped).
 * @param {number} value - Slider value (0–100)
 * @param {number[]} percentiles
 * @param {Object} positions - Map of percentile→position
 * @param {HTMLElement} thumb - The thumb element
 */
function updateCustomThumbByValue(value, percentiles, positions, thumb) {
  // Just use the slider value directly
  thumb.style.left = `calc(${value}% )`;
}

/**
 * Highlight tick and label overlays for the closest percentile.
 */
function highlightTickAndLabel(idx, overlay) {
  const allTicks = overlay.querySelectorAll(".slider-tick");
  const allLabels = overlay.querySelectorAll(".slider-tick-label");
  allTicks.forEach((tick, i) => {
    tick.classList.toggle("selected", i === idx);
  });
  allLabels.forEach((lbl, i) => {
    lbl.classList.toggle("visible", i === idx);
  });
}
