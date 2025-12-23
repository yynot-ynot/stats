import {
  updateFilterValue,
  getCurrentFilterState,
  subscribeToFilterChanges,
} from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("percentileDateSlider");

/**
 * Tracks the distinct sorted date list currently driving the slider.
 * We cache the slider DOM + mapping so we don't rebuild the control unnecessarily.
 */
let availableDates = [];
let sliderEl = null;
let labelEl = null;
let hasSubscribed = false;
let isInternalUpdate = false;
let dateToPosition = new Map();
let lastDatesKey = "";

/**
 * Initialize the percentile date slider with the provided date list.
 * Dates should be compact YYYYMMDD strings sorted ascending.
 * @param {string[]} dates
 */
/**
 * Initialize (or refresh) the percentile date slider.
 * The control defaults to the newest date, but when filters change we keep the existing
 * slider instance and simply realign it if the available date list hasn't changed.
 * @param {string[]} dates - Sorted list of compact YYYYMMDD strings.
 */
export function setupPercentileDateSlider(dates) {
  const container = document.getElementById("percentile-date-slider-container");
  if (!container) return;
  availableDates = Array.isArray(dates) ? [...new Set(dates)] : [];
  availableDates.sort();
  const newKey = availableDates.join(",");
  if (newKey === lastDatesKey && sliderEl) {
    const state = getCurrentFilterState();
    const resolved = resolveDate(state.selectedPercentileDate);
    setSliderToDate(resolved, { updateFilter: false });
    return;
  }
  lastDatesKey = newKey;
  if (availableDates.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <label for="percentile-date-slider">Select Date</label>
    <input id="percentile-date-slider" type="range" min="0" max="100" step="0.1" />
    <div class="percentile-date-display"></div>
  `;
  sliderEl = container.querySelector("#percentile-date-slider");
  labelEl = container.querySelector(".percentile-date-display");
  dateToPosition = buildPositions(availableDates);

  const state = getCurrentFilterState();
  const initialDate = resolveDate(state.selectedPercentileDate);
  setSliderToDate(initialDate, {
    updateFilter: state.selectedPercentileDate !== initialDate,
  });

  /**
   * Continuously emit filter updates as the user drags the slider so charts refresh in real time.
   */
  const updateFromSlider = () => {
    const date = getNearestDate(Number(sliderEl.value));
    updateDisplay(date);
    isInternalUpdate = true;
    updateFilterValue("selectedPercentileDate", date);
    isInternalUpdate = false;
  };

  sliderEl.addEventListener("input", updateFromSlider);
  sliderEl.addEventListener("change", updateFromSlider);

  if (!hasSubscribed) {
    subscribeToFilterChanges((state, change) => {
      if (isInternalUpdate) return;
      const resolved = resolveDate(state.selectedPercentileDate);
      const isDateChange = !change || change.key === "selectedPercentileDate";
      const shouldUpdateFilter =
        !isDateChange && state.selectedPercentileDate !== resolved;
      setSliderToDate(resolved, { updateFilter: shouldUpdateFilter });
    });
    hasSubscribed = true;
  }
}

function resolveDate(preferred) {
  if (preferred && availableDates.includes(preferred)) return preferred;
  if (availableDates.length === 0) return null;
  return availableDates[availableDates.length - 1];
}

/**
 * Update the slider thumb to point at the provided date and optionally push
 * the new value back into the centralized filter state.
 * @param {string} date
 * @param {{updateFilter: boolean}} options
 */
function setSliderToDate(date, { updateFilter }) {
  if (!date || !sliderEl) return;
  const position = dateToPosition.get(date);
  if (position === undefined) return;
  sliderEl.value = String(position);
  updateDisplay(date);
  if (updateFilter) {
    isInternalUpdate = true;
    updateFilterValue("selectedPercentileDate", date);
    isInternalUpdate = false;
  }
}

/**
 * Refresh the visible label under the slider to show the month/day for the provided date.
 * @param {string} date
 */
function updateDisplay(date) {
  if (!labelEl) return;
  labelEl.textContent = formatDateLabel(date);
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
