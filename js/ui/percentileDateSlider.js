import {
  updateFilterValue,
  getCurrentFilterState,
  subscribeToFilterChanges,
} from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("percentileDateSlider");
const SLIDER_CONTAINER_SELECTOR = "[data-role='percentile-date-slider']";
const EXTERNAL_MAX_TOGGLE_SELECTOR =
  "[data-role='percentile-max-toggle-standalone']";

/**
 * Tracks the distinct sorted date list currently driving the slider.
 * We cache the slider DOM + mapping so we don't rebuild the control unnecessarily.
 */
let availableDates = [];
let hasSubscribed = false;
let isInternalUpdate = false;
let dateToPosition = new Map();
let lastDatesKey = "";
let lastContainerSignature = "";
const sliderInstances = new Map();
const externalMaxToggleButtons = new Set();

/**
 * Initialize (or refresh) every percentile date slider instance.
 * All rendered sliders stay in sync because they publish to the shared filter state.
 * @param {string[]} dates - Sorted list of compact YYYYMMDD strings.
 */
export function setupPercentileDateSlider(dates) {
  const containers = getSliderContainers();
  setupExternalMaxToggles();
  if (containers.length === 0) {
    sliderInstances.clear();
    lastContainerSignature = "";
    return;
  }

  availableDates = Array.isArray(dates) ? [...new Set(dates)] : [];
  availableDates.sort();
  const newKey = availableDates.join(",");
  const containerSignature = getContainerSignature(containers);

  if (availableDates.length === 0) {
    containers.forEach((container) => {
      if (container) container.innerHTML = "";
      sliderInstances.delete(container);
    });
    lastDatesKey = "";
    lastContainerSignature = containerSignature;
    return;
  }

  dateToPosition = buildPositions(availableDates);

  const needsRebuild =
    newKey !== lastDatesKey ||
    containerSignature !== lastContainerSignature ||
    sliderInstances.size !== containers.length ||
    containers.some((container) => !sliderInstances.has(container));

  if (needsRebuild) {
    sliderInstances.clear();
    containers.forEach((container, index) => {
      if (!container) return;
      sliderInstances.set(container, buildSliderInstance(container, index));
    });
  }

  lastDatesKey = newKey;
  lastContainerSignature = containerSignature;

  const state = getCurrentFilterState();
  const initialDate = resolveDate(state.selectedPercentileDate);
  setSlidersToDate(initialDate, {
    updateFilter: state.selectedPercentileDate !== initialDate,
  });
  updateMaxToggleUiForAll(shouldShowMaxPercentile(state));

  if (!hasSubscribed) {
    subscribeToFilterChanges((state, change) => {
      if (isInternalUpdate) return;
      const resolved = resolveDate(state.selectedPercentileDate);
      const isDateChange = !change || change.key === "selectedPercentileDate";
      const shouldUpdateFilter =
        !isDateChange && state.selectedPercentileDate !== resolved;
      setSlidersToDate(resolved, { updateFilter: shouldUpdateFilter });
      if (!change || change.key === "showMaxPercentile") {
        updateMaxToggleUiForAll(shouldShowMaxPercentile(state));
      }
    });
    hasSubscribed = true;
  }
}

function getSliderContainers() {
  if (typeof document === "undefined" || !document.querySelectorAll) {
    return [];
  }
  return Array.from(document.querySelectorAll(SLIDER_CONTAINER_SELECTOR));
}

function setupExternalMaxToggles() {
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  const buttons = document.querySelectorAll(EXTERNAL_MAX_TOGGLE_SELECTOR);
  buttons.forEach((button) => {
    if (!button || externalMaxToggleButtons.has(button)) return;
    button.addEventListener("click", () => {
      const currentState = getCurrentFilterState();
      const nextValue = !shouldShowMaxPercentile(currentState);
      updateFilterValue("showMaxPercentile", nextValue);
    });
    externalMaxToggleButtons.add(button);
  });
}

function getContainerSignature(containers) {
  return containers
    .map((container, index) => {
      if (!container) return `missing-${index}`;
      if (container.dataset && container.dataset.sliderKey) {
        return container.dataset.sliderKey;
      }
      if (container.id) return container.id;
      return `idx-${index}`;
    })
    .join("|");
}

/**
 * Build the DOM markup for a single percentile date slider instance. Containers may opt-out
 * of rendering the 0th/100th-percentile toggle (e.g., the matrix-specific slider) by setting
 * data-hide-max-toggle="true".
 * @param {HTMLElement} container - Target element for the slider UI.
 * @param {number} index - Fallback index used to derive unique IDs when no id attribute exists.
 * @returns {{sliderEl: HTMLElement|null, labelEl: HTMLElement|null, maxToggleButtonEl: HTMLElement|null}}
 */
function buildSliderInstance(container, index) {
  const baseId = container.id || `percentile-date-slider-${index}`;
  const sliderId = `${baseId}-input`;
  const displayId = `${baseId}-display`;
  const shouldHideToggle =
    container?.dataset?.hideMaxToggle === "true" ||
    container?.dataset?.hideMaxToggle === "1";
  if (container.dataset) {
    container.dataset.sliderKey = container.dataset.sliderKey || baseId;
  }

  container.innerHTML = `
    ${
      shouldHideToggle
        ? ""
        : `<button
      type="button"
      class="percentile-max-toggle-btn"
      data-role="percentile-max-toggle"
      aria-pressed="false"
    >Show/Hide 100th Percentile</button>`
    }
    <label for="${sliderId}">Select Date</label>
    <input
      id="${sliderId}"
      type="range"
      min="0"
      max="100"
      step="0.1"
      data-role="percentile-date-input"
    />
    <div
      id="${displayId}"
      class="percentile-date-display"
      data-role="percentile-date-display"
    ></div>
  `;

  const sliderEl = container.querySelector(
    "[data-role='percentile-date-input']"
  );
  const labelEl = container.querySelector(
    "[data-role='percentile-date-display']"
  );
  const maxToggleButtonEl = shouldHideToggle
    ? null
    : container.querySelector("[data-role='percentile-max-toggle']");

  const instance = { sliderEl, labelEl, maxToggleButtonEl };

  if (sliderEl) {
    const updateFromSlider = () => {
      handleSliderInput(instance);
    };
    sliderEl.addEventListener("input", updateFromSlider);
    sliderEl.addEventListener("change", updateFromSlider);
  } else {
    logger.warn("Percentile date slider input not found for container", baseId);
  }

  if (maxToggleButtonEl) {
    maxToggleButtonEl.addEventListener("click", () => {
      const currentState = getCurrentFilterState();
      const nextValue = !shouldShowMaxPercentile(currentState);
      updateFilterValue("showMaxPercentile", nextValue);
    });
  }

  return instance;
}

function handleSliderInput(instance) {
  if (!instance || !instance.sliderEl) return;
  const date = getNearestDate(Number(instance.sliderEl.value));
  setSlidersToDate(date, { updateFilter: false });
  isInternalUpdate = true;
  updateFilterValue("selectedPercentileDate", date);
  isInternalUpdate = false;
}

function resolveDate(preferred) {
  if (preferred && availableDates.includes(preferred)) return preferred;
  if (availableDates.length === 0) return null;
  return availableDates[availableDates.length - 1];
}

/**
 * Update every slider thumb to point at the provided date and optionally
 * synchronize the shared filter state.
 * @param {string} date
 * @param {{updateFilter: boolean}} options
 */
function setSlidersToDate(date, { updateFilter }) {
  if (!date || !dateToPosition.has(date)) return;
  const position = dateToPosition.get(date);
  sliderInstances.forEach((instance) => {
    if (!instance || !instance.sliderEl) return;
    instance.sliderEl.value = String(position);
    updateInstanceDisplay(instance, date);
  });
  if (updateFilter) {
    isInternalUpdate = true;
    updateFilterValue("selectedPercentileDate", date);
    isInternalUpdate = false;
  }
}

/**
 * Refresh the visible label under a slider to show the month/day for the provided date.
 * @param {{labelEl: HTMLElement}} instance
 * @param {string} date
 */
function updateInstanceDisplay(instance, date) {
  if (!instance || !instance.labelEl) return;
  instance.labelEl.textContent = formatDateLabel(date);
}

/**
 * Sync every 100th-percentile toggle button with the active filter state
 * by updating the aria-pressed attribute while keeping the label text static.
 * @param {boolean} isVisible
 */
function updateMaxToggleUiForAll(isVisible) {
  sliderInstances.forEach((instance) => {
    if (!instance || !instance.maxToggleButtonEl) return;
    instance.maxToggleButtonEl.setAttribute("aria-pressed", String(isVisible));
  });
  externalMaxToggleButtons.forEach((button) => {
    if (!button) return;
    button.setAttribute("aria-pressed", String(isVisible));
  });
}

function formatDateLabel(compact) {
  if (!compact || compact.length !== 8) return compact || "";
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  return `${month}/${day}`;
}

/**
 * Map each date to a normalized 0–100 position so the slider can move smoothly
 * even when the dataset has irregular date spacing.
 * @param {string[]} dates
 * @returns {Map<string, number>}
 */
function buildPositions(dates) {
  const map = new Map();
  if (dates.length === 1) {
    map.set(dates[0], 50);
    return map;
  }
  const span = dates.length - 1;
  dates.forEach((date, idx) => {
    map.set(date, (idx / span) * 100);
  });
  return map;
}

/**
 * Convert a raw slider value (0–100) into the closest available date.
 * @param {number} value
 * @returns {string|null}
 */
function getNearestDate(value) {
  if (availableDates.length === 0) return null;
  let nearest = availableDates[0];
  let bestDiff = Math.abs(value - (dateToPosition.get(nearest) ?? 0));
  for (let i = 1; i < availableDates.length; i++) {
    const date = availableDates[i];
    const diff = Math.abs(value - (dateToPosition.get(date) ?? 0));
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = date;
    }
  }
  return nearest;
}

/**
 * Determine if the percentile charts should include the 100th percentile bucket.
 * Defaults to hiding the max when the toggle has never been touched.
 * @param {Object} state
 * @returns {boolean}
 */
function shouldShowMaxPercentile(state = {}) {
  return state.showMaxPercentile !== false;
}
