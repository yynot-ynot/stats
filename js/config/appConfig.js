// js/config/appConfig.js

import { setModuleLogLevel } from "../shared/logging/logger.js";

// Configure logging levels for individual modules
setModuleLogLevel("main", "debug");
setModuleLogLevel("fetchers", "warn");
setModuleLogLevel("chartRenderer", "warn");

// Path to the manifest file listing JSON assets
export const FILE_MANIFEST_PATH = "js/config/file_manifest.json";

// Filters required before rendering begins
export const REQUIRED_FILTERS = ["class-select"];

// Default values for each dropdown (empty string means no default)
export const DEFAULTS = {
  "percentile-select": "50",
  "dps-type-select": "rdps",
  // other dropdowns default to the first item in the list
};

// List of dropdown IDs that should be multi-select
export const MULTI_SELECTS = ["class-select", "percentile-compare-select"];

// Custom order overrides (e.g., bosses)
export const ORDER_OVERRIDES = {
  "boss-select": [
    "Dancing Green",
    "Sugar Riot",
    "Brute Abombinator",
    "Howling Blade",
  ],
};
