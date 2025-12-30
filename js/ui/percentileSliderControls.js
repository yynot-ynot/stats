import { DEFAULTS } from "../config/appConfig.js";
import { updateFilterValue } from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("percentileSliderControls");

// These helpers keep the proportional slider implementation generic while allowing specialized
// sliders (like the reference slider) to opt into presentation tweaks outlined in the plan.
const REFERENCE_SLIDER_VISUAL_MAX = 110;

/**
 * Default label formatter so callers that do not need custom copy can avoid touching the helper.
 * The reference slider overrides this to surface "Min"/"Max" without branching inside the UI code.
 * @param {number} value
 * @returns {string}
 */
function defaultLabelFormatter(value) {
  return String(value);
}

/**
 * Identity transformer applied when no slider needs to alter the proportional map. The reference
 * slider passes its own transformer so it can space 0/100 as if they were 0/110 without affecting
 * other sliders.
 * @param {Object} positions
 * @returns {Object}
 */
function identityPositionTransformer(positions) {
  return positions;
}

/**
 * Given a sorted array of values, compute the proportional position (0–100) for each value,
 * using a fixed [0,100] range. Values outside [0,100] are logged and excluded. Callers may feed
 * the result into a transformer hook when they need presentation-specific tweaks (e.g., the plan's
 * reference slider spacing adjustment).
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
 * Setup the reference percentile slider. Mirrors the main slider behavior but opts into the plan's
 * "Min/Max with extended spacing" requirement via the new formatter/transformer hooks so other
 * sliders remain untouched.
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
    valueLabelFormatter: formatReferenceSliderLabel,
    positionTransformer: transformReferenceSliderPositions,
  });
}

/**
 * Format reference slider endpoints as "Min"/"Max" per the planning note so the UI communicates
 * intent without changing the numeric values pushed into filter state.
 * @param {number} value
 * @returns {string}
 */
function formatReferenceSliderLabel(value) {
  if (value === 0) return "Min";
  if (value === 100) return "Max";
  return String(value);
}

/**
 * Stretch the visual spacing for the reference slider so 100 behaves as if the dataset extended to
 * 110. Other sliders continue to share the default proportional spacing, keeping the plan scoped.
 * @param {Object} basePositions - Map of percentile → base proportional percent (0-100)
 * @param {number[]} percentiles - Sorted percentile list to ensure every key updates
 * @returns {Object} New positions map with 100 shifted as if it were 110
 */
function transformReferenceSliderPositions(basePositions, percentiles) {
  const positions = { ...basePositions };
  percentiles.forEach((value) => {
    const stretchedValue =
      value === 100 ? REFERENCE_SLIDER_VISUAL_MAX : value;
    const boundedValue = Math.max(
      0,
      Math.min(stretchedValue, REFERENCE_SLIDER_VISUAL_MAX)
    );
    positions[value] =
      (boundedValue / REFERENCE_SLIDER_VISUAL_MAX) * 100;
  });
  return positions;
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
    // Keep the clickable comparison labels visually locked to the reference slider ticks so the
    // "Min/Max with stretched spacing" requirement stays consistent across both UI elements.
    const basePositions = getProportionalPositions(sortedPercentiles);
    const positions = transformReferenceSliderPositions(
      basePositions,
      sortedPercentiles
    );
    sortedPercentiles.forEach((val, idx) => {
      const label = document.createElement("span");
      label.className = "comparison-value-label";
      label.textContent = formatReferenceSliderLabel(val);
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
  function updateCompare(newCompare, options = {}) {
    const normalized = normalizeComparisonValues(newCompare);
    compare = new Set(normalized);
    renderLabels();
    if (!options.silent) {
      updateFilterValue("selectedComparisonPercentiles", new Set(compare));
    }
  }
  function normalizeComparisonValues(values) {
    if (!values) return [];
    if (values instanceof Set) values = Array.from(values);
    if (!Array.isArray(values)) values = [values];
    return values
      .map((val) => Number(val))
      .filter((val) => !Number.isNaN(val));
  }

  updateCompare(compare);
  container.__setComparisonValues = (values, options = {}) =>
    updateCompare(values, options);
}

/**
 * Helper to initialize and manage a proportional percentile slider UI.
 * Handles tick and label rendering, custom thumb movement, and filter state update.
 * Accepts optional label formatter/position transformer hooks so specialized sliders (like the
 * reference slider) can tweak presentation without introducing ad-hoc logic elsewhere.
 *
 * @param {Object} options - Slider configuration.
 * @param {HTMLElement} container - The container element to render in.
 * @param {string} sliderSelector - ID selector for the slider input.
 * @param {string} stateKey - Centralized filter state key.
 * @param {number[]} percentiles - Sorted array of percentiles (numbers).
 * @param {number} defaultValue - Default percentile value.
 * @param {function} logger - Logger for warning/info.
 * @param {function} [valueLabelFormatter] - Optional formatter for tick labels.
 * @param {function} [positionTransformer] - Optional proportional map transformer.
 */
function initPercentileSliderUI({
  container,
  sliderSelector,
  stateKey,
  percentiles,
  defaultValue,
  logger,
  valueLabelFormatter = defaultLabelFormatter,
  positionTransformer = identityPositionTransformer,
}) {
  if (percentiles.length === 0) {
    logger.warn(`No percentiles provided to slider UI (${sliderSelector}).`);
    return;
  }

  const slider = container.querySelector(sliderSelector);
  const overlay = container.querySelector(".slider-tick-overlay");
  const thumb = container.querySelector(".slider-thumb-custom");
  const row = slider?.closest(".percentile-slider-row") ?? null;

  // Slider now goes from 0 to 100 (continuous)
  slider.min = 0;
  slider.max = 100;
  slider.step = 1; // or finer if desired

  const basePositions = getProportionalPositions(percentiles);
  const positions =
    positionTransformer(basePositions, percentiles) ?? basePositions;

  // Find proportional value for defaultValue
  let defaultPercent = positions[defaultValue];
  if (defaultPercent === undefined) {
    logger.warn(
      `Default value (${defaultValue}) not found in percentiles: [${percentiles.join(
        ", "
      )}]. Falling back to first item.`
    );
    const fallbackPercentile = percentiles[0];
    defaultPercent =
      fallbackPercentile !== undefined
        ? positions[fallbackPercentile] ?? 0
        : 0;
  }
  slider.value = String(defaultPercent);
  // Find closest index for rendering tick highlights
  let currentIdx = percentiles.indexOf(defaultValue);
  if (currentIdx === -1) currentIdx = 0;

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
    label.textContent = valueLabelFormatter(percentile);
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
  /**
   * Allow pointer/touch interactions anywhere within the slider row (including areas
   * above the native input where the custom thumb overlaps) to move the slider. The
   * native `<input type="range">` only spans the track height, so clicks on the
   * diamond's top half would otherwise be ignored. By mapping the pointer position
   * to a proportional slider value we keep the interaction intuitive.
   * @param {PointerEvent | MouseEvent | TouchEvent} event
   */
  function handleRowPointer(event) {
    if (!row || !slider) return;
    if (event.target === slider) return;
    if (event.button !== undefined && event.button !== 0) return;
    const rect = row.getBoundingClientRect();
    const pointerX = event.clientX ?? (event.touches && event.touches[0]?.clientX);
    if (pointerX === undefined) return;
    const relative = ((pointerX - rect.left) / rect.width) * 100;
    const clamped = Math.max(0, Math.min(100, relative));
    slider.value = String(clamped);
    // Fire the native events so the existing slider listeners snap/highlight as usual.
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (row) {
    row.addEventListener("pointerdown", handleRowPointer);
  }

  // Initial thumb position and filter state
  updateCustomThumb(currentIdx);
  updateFilterValue(stateKey, percentiles[currentIdx]);

  // On input: move thumb visually only (find the "would-be" closest percentile for thumb, but do NOT update state yet)
  slider.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    // Find closest percentile to the slider value
    const closest = findClosestPercentile(value, percentiles, positions);
    const idx = percentiles.indexOf(closest);
    updateCustomThumbByValue(value, thumb); // Move thumb visually to current value
    highlightTickAndLabel(idx, overlay, true); // Optionally show a preview
  });

  // On change: snap to nearest allowed percentile, update state
  slider.addEventListener("change", (e) => {
    const value = parseFloat(e.target.value);
    const closest = findClosestPercentile(value, percentiles, positions);
    const idx = percentiles.indexOf(closest);
    // Snap slider to the allowed value
    slider.value = String(positions[closest]);
    updateCustomThumb(idx); // Move thumb to snapped position
    highlightTickAndLabel(idx, overlay);
    updateFilterValue(stateKey, closest);
  });

  slider.__setPercentileValue = (targetValue, options = {}) => {
    const normalized = Number(targetValue);
    if (Number.isNaN(normalized)) return;
    const idx = percentiles.indexOf(normalized);
    if (idx === -1) return;
    slider.value = String(positions[normalized]);
    updateCustomThumb(idx);
    highlightTickAndLabel(idx, overlay);
    if (!options.silent) {
      updateFilterValue(stateKey, normalized);
    }
  };
}

/**
 * Find the closest percentile value in the array to a given slider position, reusing the caller's
 * positions map so plan-specific spacing overrides (like the reference slider stretch) remain
 * consistent for all interactions.
 * @param {number} sliderValue - Value from the slider (0–100)
 * @param {number[]} percentiles - Sorted array of allowed percentiles
 * @param {Object} positions - Map of percentile → proportional percent
 * @returns {number} Closest percentile
 */
function findClosestPercentile(sliderValue, percentiles, positions) {
  return percentiles.reduce((prev, curr) => {
    const currPos = positions[curr];
    const prevPos = positions[prev];
    if (currPos === undefined) return prev;
    if (prevPos === undefined) return curr;
    return Math.abs(currPos - sliderValue) < Math.abs(prevPos - sliderValue)
      ? curr
      : prev;
  });
}

/**
 * Move the custom thumb overlay to the current slider value (not snapped).
 * @param {number} value - Slider value (0–100)
 * @param {HTMLElement} thumb - The thumb element
 */
function updateCustomThumbByValue(value, thumb) {
  // Just use the slider value directly
  thumb.style.left = `calc(${value}% )`;
}

/**
 * Highlight tick and label overlays for the closest percentile.
 */
function highlightTickAndLabel(idx, overlay, isPreview = false) {
  const allTicks = overlay.querySelectorAll(".slider-tick");
  const allLabels = overlay.querySelectorAll(".slider-tick-label");
  allTicks.forEach((tick, i) => {
    tick.classList.toggle("selected", i === idx);
  });
  allLabels.forEach((lbl, i) => {
    lbl.classList.toggle("visible", i === idx);
    lbl.classList.toggle("preview", isPreview && i === idx);
  });
}

/**
 * Locate a slider by ID and invoke its internal setter helper.
 * Silently no-ops if the slider has not been initialized yet.
 * @param {string} sliderId
 * @param {number} value
 * @param {Object} [options]
 */
function setSliderValueById(sliderId, value, options = {}) {
  const slider = document.getElementById(sliderId);
  if (!slider || typeof slider.__setPercentileValue !== "function") return;
  slider.__setPercentileValue(value, options);
}

/**
 * Programmatically set the main percentile slider and optionally suppress filter broadcasts.
 * @param {number} value
 * @param {Object} [options]
 */
export function setPercentileSliderValue(value, options = {}) {
  setSliderValueById("percentile-slider", value, options);
}

/**
 * Programmatically set the reference percentile slider.
 * @param {number} value
 * @param {Object} [options]
 */
export function setReferencePercentileSliderValue(value, options = {}) {
  setSliderValueById("reference-percentile-slider", value, options);
}

/**
 * Programmatically set the multi-select comparison slider values.
 * Accepts arrays, Sets, or single values and mirrors the click behavior.
 * @param {Iterable<number>|Array<number>|Set<number>} values
 * @param {Object} [options]
 */
export function setComparisonSliderValues(values, options = {}) {
  const container = document.getElementById("comparison-slider-container");
  if (!container || typeof container.__setComparisonValues !== "function") {
    return;
  }
  container.__setComparisonValues(values, options);
}

/**
 * Internal helper accessors so node:test suites can verify the reference slider overrides stay in
 * sync with the documented plan without importing private functions directly in production code.
 */
export const __referenceSliderOverrides = {
  formatReferenceSliderLabel,
  transformReferenceSliderPositions,
};
