// js/logic/dataDisplayManager.js

import { getLogger } from "../shared/logging/logger.js";
import { REQUIRED_FILTERS } from "../config/appConfig.js";

const logger = getLogger("dataDisplay");
let globalData = [];

/**
 * Initialize the data display manager:
 * - Sets up dropdown listeners.
 * - Holds a reference to the full dataset.
 *
 * @param {Array<Object>} allData - Full dataset (DPS + healing data).
 */
export function setupDataDisplayManager(allData) {
  globalData = allData;

  const dropdownIds = [
    "raid-select",
    "boss-select",
    "percentile-select",
    "class-select",
    "dps-type-select",
  ];

  dropdownIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        if (areRequiredFiltersSelected()) {
          logger.debug("Required filters selected. Rendering full chart.");
          updateChart();
        } else {
          logger.debug(
            "Filter change detected but required filters not fully selected."
          );
        }
      });
    }
  });

  logger.debug("Data display manager initialized and listeners attached.");
}

/**
 * Check if all required filters have valid selections.
 */
function areRequiredFiltersSelected() {
  return REQUIRED_FILTERS.every((id) => {
    const value = document.getElementById(id)?.value || "";
    return value !== "" && value !== "All";
  });
}

/**
 * Rerender charts based on current dropdown filter values.
 */
function updateChart() {
  const baseFilters = {
    raid: document.getElementById("raid-select")?.value || "",
    boss: document.getElementById("boss-select")?.value || "",
    percentile: document.getElementById("percentile-select")?.value || "",
    classNames: Array.from(
      document.getElementById("class-select")?.selectedOptions || []
    ).map((o) => o.value),
  };

  const dpsFilters = {
    ...baseFilters,
    dps_type: document.getElementById("dps-type-select")?.value || "",
  };

  const healingFilters = baseFilters; // No dps_type included

  const dpsData = globalData.filter((d) => "dps" in d);
  const healingData = globalData.filter((d) => "hps" in d);

  const dpsContainer = document.getElementById("dps-plot-container");
  const healingContainer = document.getElementById("healing-plot-container");

  import(`../ui/chartRenderer.js`).then(({ renderFilteredLineChart }) => {
    renderFilteredLineChart(dpsData, dpsFilters, dpsContainer, "DPS");
    renderFilteredLineChart(
      healingData,
      healingFilters,
      healingContainer,
      "Healing"
    );
  });
}
