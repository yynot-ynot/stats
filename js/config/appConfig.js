import {
  setModuleLogLevel,
  envLogLevel,
} from "../shared/logging/logger.js";

// Configure logging levels for individual modules (debug locally, quieter in prod)
const uiModuleLogLevel = envLogLevel("debug", "warn");
const mainLogLevel = envLogLevel("debug", "info");
const chartRendererLogLevel = envLogLevel("info", "warn");
const filterStateLogLevel = envLogLevel("info", "warn");
const dataDisplayLogLevel = envLogLevel("info", "warn");
const fetchersLogLevel = envLogLevel("info", "warn");
const dpsTypeSidebarManagerLogLevel = envLogLevel("info", "warn");

setModuleLogLevel("main", mainLogLevel);
setModuleLogLevel("filterState", filterStateLogLevel);
setModuleLogLevel("fetchers", fetchersLogLevel);
setModuleLogLevel("chartRenderer", chartRendererLogLevel);
setModuleLogLevel("dataDisplay", dataDisplayLogLevel);
setModuleLogLevel("filterControls", uiModuleLogLevel);
setModuleLogLevel("dpsTypeSidebarManager", dpsTypeSidebarManagerLogLevel);
setModuleLogLevel("jobSidebarManager", uiModuleLogLevel);

// Path to the manifest file listing JSON assets
export const FILE_MANIFEST_PATH = "js/config/file_manifest.json";

// Filters required before rendering begins (mapped to filterState keys)
export const REQUIRED_FILTERS = ["selectedJobs"];

// Full list of unified filter state keys
export const ALL_FILTER_KEYS = [
  "selectedRaid",
  "selectedBoss",
  "selectedPercentile",
  "selectedDpsType",
  "selectedReferencePercentile",
  "selectedComparisonPercentiles",
  "selectedJobs",
  "selectedPercentileDate",
  "showMaxPercentile",
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
export const MULTI_SELECTS = ["job-select", "percentile-compare-select"];

// Custom order overrides (e.g., bosses)
export const ORDER_OVERRIDES = {
  "boss-select": [
    "Vamp Fatale",
    "Red Hot and Deep Blue",
    "The Tyrant",
    "The Lindwurm",
    "Unkown",
    "Dancing Green",
    "Sugar Riot",
    "Brute Abombinator",
    "Howling Blade",
  ],
};

// Job icon URLs for the job sidebar
export const JOB_ICONS = {
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

export const JOB_GROUPS = {
  Tank: ["Paladin", "Warrior", "Dark Knight", "Gunbreaker"],
  Healer: ["White Mage", "Scholar", "Astrologian", "Sage"],
  "Melee DPS": ["Monk", "Dragoon", "Ninja", "Samurai", "Reaper", "Viper"],
  "Physical Ranged DPS": ["Bard", "Machinist", "Dancer"],
  "Magical Ranged DPS": ["Black Mage", "Summoner", "Red Mage", "Pictomancer"],
};

// Default colors per job (for DPS scatter plots and other visualizations)
export const JOB_COLORS = {
  Pictomancer: "#fc92e1", // #fc92e1  light pastel pink
  Dragoon: "#4164CD", // #4164CD  royal blue
  "Black Mage": "#A579D6", // #A579D6  soft lavender purple
  Reaper: "#965A90", // #965A90  dusty mauve
  Ninja: "#AF1964", // #AF1964  deep magenta
  Viper: "#108210", // #108210  forest green
  Monk: "#d69c00", // #d69c00  golden yellow
  Samurai: "#e46d04", // #e46d04  vibrant orange
  "Red Mage": "#e87b7b", // #e87b7b  salmon pink
  Bard: "#91BA5E", // #91BA5E  olive green
  Summoner: "#2D9B78", // #2D9B78  teal green
  Machinist: "#6EE1D6", // #6EE1D6  bright mint/aqua
  Dancer: "#E2B0AF", // #E2B0AF  pale rose
  Gunbreaker: "#796D30", // #796D30  olive brown
  Paladin: "#A8D2E6", // #A8D2E6  sky blue
  "Dark Knight": "#D126CC", // #D126CC  vivid magenta
  Warrior: "#cf2621", // #cf2621  bright red
  Astrologian: "#FFE74A", // #FFE74A  bright yellow
  Scholar: "#8657FF", // #8657FF  vivid violet
  "White Mage": "#E6D2B5", // #E6D2B5  creamy tan
  Sage: "#80A0F0", // #80A0F0  soft blue
};
