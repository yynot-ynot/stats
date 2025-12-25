import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFilters,
  buildParseTrendSeries,
} from "../js/ui/chartRenderer.js";

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

const PARSE_ROWS = Object.freeze([
  {
    raid: "TOP",
    boss: "Omega",
    date: "20250101",
    job: "Dark Knight",
    percentile: 50,
    dps: 10000,
    parses: 120,
    dps_type: "rdps",
  },
  {
    raid: "TOP",
    boss: "Omega",
    date: "20250103",
    job: "Dark Knight",
    percentile: 50,
    dps: 10500,
    parses: 60,
    dps_type: "rdps",
  },
  {
    raid: "TOP",
    boss: "Omega",
    date: "20250103",
    job: "Monk",
    percentile: 50,
    dps: 13000,
    parses: 40,
    dps_type: "rdps",
  },
  {
    raid: "TOP",
    boss: "Omega",
    date: "20250104",
    job: "Monk",
    percentile: 50,
    dps: 13500,
    parses: 80,
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

/**
 * Validates that buildParseTrendSeries emits per-job totals while still reserving empty days so chart spacing stays daily.
 */
test("buildParseTrendSeries fills missing days per job while aggregating parse totals", () => {
  const { compactDates, jobSeries } = buildParseTrendSeries(PARSE_ROWS);
  assert.deepEqual(compactDates, ["20250101", "20250102", "20250103", "20250104"]);
  const dkSeries = jobSeries.get("Dark Knight");
  const monkSeries = jobSeries.get("Monk");
  assert.ok(dkSeries, "expected Dark Knight totals to be present");
  assert.ok(monkSeries, "expected Monk totals to be present");
  assert.deepEqual(dkSeries.totals, [120, null, 60, null]);
  assert.deepEqual(monkSeries.totals, [null, null, 40, 80]);
});

/**
 * Ensures parse deltas compare against the previous report for each job instead of the prior calendar day.
 */
test("buildParseTrendSeries derives per-job deltas relative to the last report", () => {
  const { jobSeries } = buildParseTrendSeries(PARSE_ROWS);
  const dkSeries = jobSeries.get("Dark Knight");
  const monkSeries = jobSeries.get("Monk");
  assert.deepEqual(dkSeries.deltas, [null, null, -60, null]);
  assert.deepEqual(dkSeries.previousTotals, [null, 120, 120, 60]);
  assert.deepEqual(monkSeries.deltas, [null, null, null, 40]);
  assert.deepEqual(monkSeries.previousTotals, [null, null, null, 40]);
});
