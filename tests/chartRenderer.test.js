import test from "node:test";
import assert from "node:assert/strict";

import { applyFilters } from "../js/ui/chartRenderer.js";

/**
 * Minimal DPS/HPS rows used to exercise the percentile filter logic.
 * Percentile is intentionally stored as numbers to mirror the data files,
 * while the filters pass strings just like the UI slider.
 */
const SAMPLE_ROWS = Object.freeze([
  {
    raid: "The Omega Protocol",
    boss: "Omega",
    date: "20250101",
    job: "Dark Knight",
    percentile: 0,
    dps: 10000,
    parses: 200,
    dps_type: "rdps",
  },
  {
    raid: "The Omega Protocol",
    boss: "Omega",
    date: "20250101",
    job: "Dark Knight",
    percentile: 25,
    dps: 18000,
    parses: 200,
    dps_type: "rdps",
  },
  {
    raid: "The Omega Protocol",
    boss: "Omega",
    date: "20250101",
    job: "Dark Knight",
    percentile: 100,
    dps: 22000,
    parses: 200,
    dps_type: "rdps",
  },
]);

/**
 * Ensures the filtering helper treats the string "0" as a distinct percentile value
 * so 0th-percentile time-series do not inherit data from higher percentiles.
 */
test("applyFilters retains 0th percentile rows when slider selects zero", () => {
  const rows = applyFilters(SAMPLE_ROWS, {
    raid: "The Omega Protocol",
    boss: "Omega",
    percentile: "0",
    dps_type: "rdps",
    jobNames: ["Dark Knight"],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].percentile, 0);
  assert.equal(rows[0].dps, 10000);
});

/**
 * Verifies that invalid percentile inputs (e.g., slider glitch or query param)
 * fail open by disabling percentile filtering, matching the prior behavior.
 */
test("applyFilters ignores percentile when slider provides a non-numeric value", () => {
  const rows = applyFilters(SAMPLE_ROWS, {
    raid: "The Omega Protocol",
    boss: "Omega",
    percentile: "not-a-number",
    dps_type: "rdps",
    jobNames: ["Dark Knight"],
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.percentile).sort((a, b) => a - b),
    [0, 25, 100],
  );
});

