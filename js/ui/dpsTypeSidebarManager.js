import {
  updateFilterValue,
  subscribeToFilterChanges,
} from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("dpsTypeSidebarManager");

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

  // Debug log: List all available DPS Types
  logger.debug(`Available DPS Types: ${dpsTypeOptions.join(", ")}`);

  // Clear out any old options in <select>
  select.innerHTML = "";

  // Populate select with all available DPS Type options
  dpsTypeOptions.forEach((option, i) => {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (i === 0) opt.selected = true;
    select.appendChild(opt);
  });

  // Set default state and visible label
  const defaultType = dpsTypeOptions[0];
  updateFilterValue("selectedDpsType", defaultType);
  selectedLabel.textContent = defaultType;

  // Listen for changes via dropdown or sidebar (click-to-cycle)
  select.addEventListener("change", (e) => {
    updateFilterValue("selectedDpsType", select.value);
    selectedLabel.textContent = select.value;
  });

  // When the user clicks the persistent label, cycle through options
  container.addEventListener("click", (e) => {
    // Cycle to next DPS type
    let currentIdx = dpsTypeOptions.indexOf(select.value);
    let nextIdx = (currentIdx + 1) % dpsTypeOptions.length;
    select.value = dpsTypeOptions[nextIdx];
    updateFilterValue("selectedDpsType", select.value);
    selectedLabel.textContent = select.value;
  });

  // Sync visible label if filterState changes elsewhere
  subscribeToFilterChanges((state) => {
    if (
      state.selectedDpsType &&
      selectedLabel.textContent !== state.selectedDpsType
    ) {
      selectedLabel.textContent = state.selectedDpsType;
      select.value = state.selectedDpsType;
    }
  });
}
