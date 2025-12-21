import test from "node:test";
import assert from "node:assert/strict";
import { sortDropdownValues, buildBossIndex } from "../js/ui/filterControls.js";

// Exercises the dropdown sorting helper so the data-driven ordering logic can be validated without DOM access.

/**
 * Utility wrapper so the tests read fluently when passing bare value arrays.
 * @param {Array<string>} values - Candidate dropdown options.
 * @param {string} selectId - DOM id whose override rules should be applied.
 * @param {Object<string, string>} [latestDateMap] - Optional YYYYMMDD map for recency ordering.
 * @returns {Array<string>} Sorted copy for inspection inside assertions.
 */
function sort(values, selectId, latestDateMap) {
  return sortDropdownValues(values, selectId, latestDateMap);
}

// Custom order overrides should trump every other rule.
test("sortDropdownValues honors explicit ORDER_OVERRIDES before fallback rules", () => {
  const values = [
    "Howling Blade",
    "Unknown",
    "Sugar Riot",
    "Brute Abombinator",
    "Dancing Green",
  ];
  const result = sort(values, "boss-select");

  assert.deepEqual(result, [
    "Dancing Green",
    "Sugar Riot",
    "Brute Abombinator",
    "Howling Blade",
    "Unknown",
  ]);
});

// The raid -> boss lookup should only include valid pairs and preserve every unique boss globally.
test("buildBossIndex groups bosses under their raids while tracking every unique boss", () => {
  const data = [
    { raid: "Alpha", boss: "One" },
    { raid: "Alpha", boss: "Two" },
    { raid: "Beta", boss: "Two" },
    { raid: "Beta", boss: "Three" },
    { raid: "", boss: "Roaming Foe" },
    { raid: "Gamma" }, // no boss, should be ignored
  ];

  const { bossesByRaid, allBosses } = buildBossIndex(data);

  const alphaBosses = Array.from(bossesByRaid.Alpha).sort();
  const betaBosses = Array.from(bossesByRaid.Beta).sort();
  const allBossList = Array.from(allBosses).sort();

  assert.deepEqual(alphaBosses, ["One", "Two"]);
  assert.deepEqual(betaBosses, ["Three", "Two"]);
  assert.deepEqual(allBossList, ["One", "Roaming Foe", "Three", "Two"]);
  assert.ok(!bossesByRaid.Gamma, "missing boss entries should not generate raid groups");
});

// When no override exists the helper must use the most recent date, falling back to alphabetical ties.
test("sortDropdownValues orders by latest date descending with alpha tie-breaker", () => {
  const values = ["AAC Cruiserweight", "Alpha Ruins", "Beacon Depths"];
  const result = sort(values, "raid-select", {
    "AAC Cruiserweight": "20240101",
    "Alpha Ruins": "20240305",
    "Beacon Depths": "20240305",
  });

  assert.deepEqual(result, [
    "Alpha Ruins",
    "Beacon Depths",
    "AAC Cruiserweight",
  ]);
});

// In the absence of overrides or recency data the helper should degrade gracefully to A-Z sorting.
test("sortDropdownValues falls back to simple alphabetical order", () => {
  const values = ["zeta", "beta", "alpha"];
  const result = sort(values, "class-select");

  assert.deepEqual(result, ["alpha", "beta", "zeta"]);
});
