import {
  getCurrentFilterState,
  subscribeToFilterChanges,
  updateFilterValue,
} from "../shared/filterState.js";

const BUTTON_SELECTOR = ".parse-scale-toggle-btn";
const VALID_SCALE_VALUES = new Set(["original", "signed-log"]);
let initialized = false;

/**
 * Wire the two-button linear/log toggle into shared filter state.
 * The control is intentionally state-driven so URL hydration and rerenders
 * can reuse the same source of truth as the rest of the trend filters.
 */
export function setupParseScaleControl() {
  const buttons = getButtons();
  if (buttons.length === 0) return;

  syncButtons(getCurrentFilterState().parseDeltaScale);

  if (initialized) {
    return;
  }

  initialized = true;
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextValue = normalizeScaleValue(button.dataset.scaleValue);
      if (getCurrentFilterState().parseDeltaScale === nextValue) return;
      updateFilterValue("parseDeltaScale", nextValue);
    });
  });

  subscribeToFilterChanges((state, change) => {
    if (change && change.key !== "parseDeltaScale") return;
    syncButtons(state.parseDeltaScale);
  });
}

/**
 * Apply a scale value programmatically during URL hydration or startup.
 * Normalization happens here so unknown values fall back to linear mode.
 * @param {string} value
 */
export function setParseScaleControlValue(value) {
  const normalizedValue = normalizeScaleValue(value);
  if (getCurrentFilterState().parseDeltaScale === normalizedValue) return;
  updateFilterValue("parseDeltaScale", normalizedValue);
}

/**
 * Collapse any unsupported external value back to the linear default.
 * @param {string} value
 * @returns {"original"|"signed-log"}
 */
function normalizeScaleValue(value) {
  return VALID_SCALE_VALUES.has(value) ? value : "original";
}

/**
 * Retrieve the rendered scale-toggle buttons.
 * @returns {HTMLButtonElement[]}
 */
function getButtons() {
  return Array.from(document.querySelectorAll(BUTTON_SELECTOR));
}

/**
 * Reflect the centralized scale state into the pressed-button UI.
 * @param {string} value
 */
function syncButtons(value) {
  const normalizedValue = normalizeScaleValue(value);
  getButtons().forEach((button) => {
    const isActive = button.dataset.scaleValue === normalizedValue;
    button.setAttribute("aria-pressed", String(isActive));
  });
}
