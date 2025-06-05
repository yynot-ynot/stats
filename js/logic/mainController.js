import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("main");

import {
  fetchAvailableJsonFiles,
  fetchAndDecompressJsonGz,
} from "../core/dataLoader.js";
import { filterState, updateFilterValue } from "../shared/filterState.js";
import {
  populateAllFilters,
  setupHeaderBindings,
} from "../ui/filterControls.js";
import { setupClassSidebar } from "../ui/classSidebarManager.js";
import { setupDpsTypeSidebarManager } from "../ui/dpsTypeSidebarManager.js";

import { setupDataDisplayManager } from "./dataDisplayManager.js";

let allData = [];
let isLoading = false;

/**
 * Get the current loading state.
 * @returns {boolean} True if loading is in progress, false otherwise.
 */
export function getLoadingState() {
  return isLoading;
}

/**
 * Main entry point to initialize data loading, filtering, and rendering.
 * 1. Discover available JSON files.
 * 2. Load and decompress data.
 * 3. Populate dropdowns and sidebar.
 * 4. Set up the centralized display manager.
 */
export async function init() {
  isLoading = true;
  const start = performance.now();

  try {
    // Step 1: Discover available JSON files
    const t1 = performance.now();
    const files = await fetchAvailableJsonFiles("json/");
    const t2 = performance.now();
    logger.debug(
      `Discovered ${files.length} files to load. (in ${(t2 - t1).toFixed(1)}ms)`
    );

    // Step 2: Fetch and decompress all files in parallel
    const tDecompressStart = performance.now();
    const allFilePromises = files.map(async (file) => {
      try {
        const data = await fetchAndDecompressJsonGz(file);
        return data;
      } catch (err) {
        logger.warn(`Error loading ${file}:`, err);
        return [];
      }
    });

    const loadedArrays = await Promise.all(allFilePromises);
    allData = loadedArrays.flat(); // Flatten into a single array
    const tDecompressEnd = performance.now();
    logger.debug(
      `Total decompression time (parallel): ${(
        tDecompressEnd - tDecompressStart
      ).toFixed(1)}ms`
    );

    // Step 3: Populate filter dropdowns and sidebar
    const tFiltersStart = performance.now();
    populateAllFilters(allData);
    setupHeaderBindings();

    const dpsTypes = Array.from(
      new Set(allData.filter((d) => d.dps_type).map((d) => d.dps_type))
    );
    setupDpsTypeSidebarManager(dpsTypes);

    const uniqueClasses = Array.from(new Set(allData.map((d) => d.class)));
    setupClassSidebar(uniqueClasses); // uses idle batching to avoid blocking
    // Force initial notification so filter listeners fire on startup
    updateFilterValue("selectedClasses", filterState.selectedClasses); // This will notify listeners

    const tFiltersEnd = performance.now();
    logger.debug(
      `Populated filters in ${(tFiltersEnd - tFiltersStart).toFixed(1)}ms`
    );

    // Step 4: Setup centralized filter event listeners and display manager
    setupDataDisplayManager(allData);
    const tListeners = performance.now();
    logger.debug(
      `Setup filter listeners in ${(tListeners - tFiltersEnd).toFixed(1)}ms`
    );
  } catch (e) {
    logger.error("Discovery failed:", e);
  } finally {
    isLoading = false;
  }

  const end = performance.now();
  logger.debug(`Total init() duration: ${(end - start).toFixed(1)}ms`);
}
