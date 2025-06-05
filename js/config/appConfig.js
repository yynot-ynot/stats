import { setModuleLogLevel } from "../shared/logging/logger.js";

// Configure logging levels for individual modules
setModuleLogLevel("main", "debug");
setModuleLogLevel("filterState", "debug");
setModuleLogLevel("fetchers", "warn");
setModuleLogLevel("chartRenderer", "warn");
setModuleLogLevel("dataDisplay", "warn");
setModuleLogLevel("filterControls", "warn");
setModuleLogLevel("dpsTypeSidebarManager", "debug");
setModuleLogLevel("classSidebarManager", "warn");

// Path to the manifest file listing JSON assets
export const FILE_MANIFEST_PATH = "js/config/file_manifest.json";

// Filters required before rendering begins (mapped to filterState keys)
export const REQUIRED_FILTERS = ["selectedClasses"];

// Full list of unified filter state keys
export const ALL_FILTER_KEYS = [
  "selectedRaid",
  "selectedBoss",
  "selectedPercentile",
  "selectedDpsType",
  "selectedReferencePercentile",
  "selectedComparisonPercentiles",
  "selectedClasses",
];

// Default values for each dropdown (empty string means no default)
// For comparison percentiles, use an array of strings (multi-select)
export const DEFAULTS = {
  "percentile-select": "50",
  "percentile-reference-select": "50",
  "percentile-compare-select": ["25", "75"],
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

// Class icon URLs for the class sidebar
export const CLASS_ICONS = {
  Paladin:
    "https://lds-img.finalfantasyxiv.com/promo/h/V/NUXU4h6iXzF8HS4BxHKYf7vOa0.png",
  Warrior:
    "https://lds-img.finalfantasyxiv.com/promo/h/0/U3f8Q98TbAeGvg_vXiHGOaa2d4.png",
  "Dark Knight":
    "https://lds-img.finalfantasyxiv.com/promo/h/9/5JT3hJnBNPZSLAijAF9u7zrueQ.png",
  Gunbreaker:
    "https://lds-img.finalfantasyxiv.com/promo/h/8/fc5PYpEFGrg4qPYDq_YBbCy1X0.png",
  "White Mage":
    "https://lds-img.finalfantasyxiv.com/promo/h/G/Na619RGtVtbEvNn1vyFoSlvZ84.png",
  Scholar:
    "https://lds-img.finalfantasyxiv.com/promo/h/s/2r8fm3U0Io7Pw1XT1tvnjPthp4.png",
  Astrologian:
    "https://lds-img.finalfantasyxiv.com/promo/h/E/g7JY4S1D-9S26VarEuIkPGIrFM.png",
  Sage: "https://lds-img.finalfantasyxiv.com/promo/h/e/G0lQTD01LdCGk5pECSc7fbbmbM.png",
  Monk: "https://lds-img.finalfantasyxiv.com/promo/h/C/Ce_VQB6VPPJKTGJwxf3h5iujp4.png",
  Dragoon:
    "https://lds-img.finalfantasyxiv.com/promo/h/1/zWRkXGJIJhN7WHGGv1gVscRxmA.png",
  Ninja:
    "https://lds-img.finalfantasyxiv.com/promo/h/N/EXvdQYvr1Rn4En8AKssbVwwcac.png",
  Samurai:
    "https://lds-img.finalfantasyxiv.com/promo/h/J/Ra2GV79gVQhy6SwCrU19boTghc.png",
  Reaper:
    "https://lds-img.finalfantasyxiv.com/promo/h/p/y8GHAXX4qhY7D-yqnCqtEPkjoo.png",
  Viper:
    "https://lds-img.finalfantasyxiv.com/promo/h/p/sS2MK2LmSHGjziXHE6DIOw7_4U.png",
  Bard: "https://lds-img.finalfantasyxiv.com/promo/h/b/d7BM1x8OZRZU-9fTk-D7g1t2oc.png",
  Machinist:
    "https://lds-img.finalfantasyxiv.com/promo/h/2/oHLJxTt_OLDK_eQkRTBVNwwxeE.png",
  Dancer:
    "https://lds-img.finalfantasyxiv.com/promo/h/0/ZzzbixB1HHW9FaxNXdfY7Y7lvw.png",
  "Black Mage":
    "https://lds-img.finalfantasyxiv.com/promo/h/A/7JuT00VSwaFqTfcTYUCUnGPFQE.png",
  Summoner:
    "https://lds-img.finalfantasyxiv.com/promo/h/b/ZwJFxv3XnfqB5N6tKbgXKnj6BU.png",
  "Red Mage":
    "https://lds-img.finalfantasyxiv.com/promo/h/C/NRnqJxzRtbDKR1ZHzxazWBBR2Y.png",
  Pictomancer:
    "https://lds-img.finalfantasyxiv.com/promo/h/e/t0iiQ-ja8O8YNZaVimL5Qb6Tnw.png",
  "Blue Mage (Limited Job)":
    "https://lds-img.finalfantasyxiv.com/promo/h/p/KOfXNPzKVJHsLIjefN16FbZ6bw.png",
};

export const CLASS_GROUPS = {
  Tank: ["Paladin", "Warrior", "Dark Knight", "Gunbreaker"],
  Healer: ["White Mage", "Scholar", "Astrologian", "Sage"],
  "Melee DPS": ["Monk", "Dragoon", "Ninja", "Samurai", "Reaper", "Viper"],
  "Physical Ranged DPS": ["Bard", "Machinist", "Dancer"],
  "Magical Ranged DPS": ["Black Mage", "Summoner", "Red Mage", "Pictomancer"],
};
