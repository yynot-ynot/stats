import {
  updateFilterValue,
  subscribeToFilterChanges,
} from "../shared/filterState.js";
import { DEFAULTS } from "../config/appConfig.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("dpsTypeSidebarManager");
let currentDpsTypeOptions = [];
let dpsTypeSubscriptionInitialized = false;

/**
 * Sets up the sidebar DPS Metric selector as a persistent, top-right fixed UI element.
 * Populates with available DPS types, manages state, and displays the currently selected type.
 * @param {Array<string>} dpsTypeOptions - Array of unique DPS Type strings.
 */
export function setupDpsTypeSidebarManager(dpsTypeOptions) {
  const container = document.getElementById("dps-type-label-container");
  const selectedLabel = document.getElementById("dps-type-selected-label");
  const select = document.getElementById("dps-type-select");

  if (
    !container ||
    !selectedLabel ||
    !select ||
    !Array.isArray(dpsTypeOptions) ||
    dpsTypeOptions.length === 0
  ) {
    logger.warn("DPS Metric selector: required elements or options missing.");
    return;
  }

  currentDpsTypeOptions = [...dpsTypeOptions];
  logger.debug(`Available DPS Types: ${currentDpsTypeOptions.join(", ")}`);

  const configuredDefault = DEFAULTS["dps-type-select"];
  const hasConfiguredDefault =
    typeof configuredDefault === "string" &&
    currentDpsTypeOptions.includes(configuredDefault);
  const defaultType = hasConfiguredDefault
    ? configuredDefault
    : currentDpsTypeOptions[0];

  // Clear out any old options in <select>
  select.innerHTML = "";

  // Populate select with all available DPS Type options
  currentDpsTypeOptions.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === defaultType) opt.selected = true;
    select.appendChild(opt);
  });

  // Set default state and visible label
  select.value = defaultType;
  updateFilterValue("selectedDpsType", defaultType);
  selectedLabel.textContent = defaultType;

  // Listen for changes via dropdown or sidebar (click-to-cycle)
  if (!select.__dpsTypeChangeHandler) {
    select.__dpsTypeChangeHandler = () => {
      updateFilterValue("selectedDpsType", select.value);
      selectedLabel.textContent = select.value;
    };
    select.addEventListener("change", select.__dpsTypeChangeHandler);
  }

  if (!container.__dpsTypeClickHandler) {
    container.__dpsTypeClickHandler = () => {
      let currentIdx = currentDpsTypeOptions.indexOf(select.value);
      if (currentIdx === -1) currentIdx = 0;
      const nextIdx = (currentIdx + 1) % currentDpsTypeOptions.length;
      select.value = currentDpsTypeOptions[nextIdx];
      updateFilterValue("selectedDpsType", select.value);
      selectedLabel.textContent = select.value;
    };
    container.addEventListener("click", container.__dpsTypeClickHandler);
  }

  if (!dpsTypeSubscriptionInitialized) {
    dpsTypeSubscriptionInitialized = true;
    subscribeToFilterChanges((state, change) => {
      if (change && change.key !== "selectedDpsType") return;
      if (
        state.selectedDpsType &&
        selectedLabel.textContent !== state.selectedDpsType
      ) {
        selectedLabel.textContent = state.selectedDpsType;
        select.value = state.selectedDpsType;
      }
    });
  }
}
