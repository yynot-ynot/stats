// js/logic/mainController.js

import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("main");

import {
  fetchAvailableJsonFiles,
  fetchAndDecompressJsonGz,
} from "../core/dataLoader.js";
import { populateAllFilters } from "../ui/filterControls.js";
import { setupDataDisplayManager } from "./dataDisplayManager.js";

let allData = [];
let isLoading = false; // ✅ Track internal loading state

/**
 * Get the current loading state.
 * @returns {boolean} True if loading is in progress, false otherwise.
 */
export function getLoadingState() {
  return isLoading;
}

/**
 * Main entry point to initialize data loading, filtering, and rendering.
 */
export async function init() {
  isLoading = true; // ✅ Set loading to true at the start
  const start = performance.now();

  try {
    // Step 1: Discover available JSON files
    const t1 = performance.now();
    const files = await fetchAvailableJsonFiles("json/");
    const t2 = performance.now();
    logger.debug(
      `Discovered ${files.length} files to load. (in ${(t2 - t1).toFixed(1)}ms)`
    );

    // Step 2: Fetch and decompress data
    const tDecompressStart = performance.now();
    for (const file of files) {
      try {
        const data = await fetchAndDecompressJsonGz(file);
        allData.push(...data);
      } catch (err) {
        logger.warn(`Error loading ${file}:`, err);
      }
    }
    const tDecompressEnd = performance.now();
    logger.debug(
      `Total decompression time: ${(tDecompressEnd - tDecompressStart).toFixed(
        1
      )}ms`
    );

    // Step 3: Populate filter dropdowns
    const tFiltersStart = performance.now();
    populateAllFilters(allData);
    const tFiltersEnd = performance.now();
    logger.debug(
      `Populated filters in ${(tFiltersEnd - tFiltersStart).toFixed(1)}ms`
    );

    // Step 4: Setup filter event listeners (no initial render)
    setupDataDisplayManager(allData);
    const tListeners = performance.now();
    logger.debug(
      `Setup filter listeners in ${(tListeners - tFiltersEnd).toFixed(1)}ms`
    );
  } catch (e) {
    logger.error("Discovery failed:", e);
  } finally {
    isLoading = false; // ✅ Always set to false, even on error
  }

  const end = performance.now();
  logger.debug(`Total init() duration: ${(end - start).toFixed(1)}ms`);
}
