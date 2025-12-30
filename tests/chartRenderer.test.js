import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFilters,
  buildParseTrendSeries,
  __buildWeekTickConfigForTests,
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

/**
 * Verifies the legacy behavior remains intact when no week start anchor is provided:
 * the helper should emit labels every seven plotted data points starting from the first date.
 */
test("__buildWeekTickConfigForTests falls back to index-based weeks when no anchor exists", () => {
  const labels = ["4/1", "4/2", "4/3", "4/4", "4/5", "4/6", "4/7", "4/8"];
  const compact = [
    "20250401",
    "20250402",
    "20250403",
    "20250404",
    "20250405",
    "20250406",
    "20250407",
    "20250408",
  ];
  const result = __buildWeekTickConfigForTests(labels, compact, null);
  assert.deepEqual(result.ticktext, ["4/1 (wk1)", "4/8 (wk2)"]);
});

/**
 * Confirms that when the configured week-one date predates the dataset the helper still honors it,
 * rolling the week numbers forward so the visible labels reflect the canonical week count rather than the index.
 */
test("__buildWeekTickConfigForTests honors the configured anchor even when it predates the dataset", () => {
  const labels = [
    "4/1",
    "4/2",
    "4/3",
    "4/4",
    "4/5",
    "4/6",
    "4/7",
    "4/8",
    "4/9",
    "4/10",
    "4/11",
    "4/12",
    "4/13",
    "4/14",
  ];
  const compact = [
    "20250401",
    "20250402",
    "20250403",
    "20250404",
    "20250405",
    "20250406",
    "20250407",
    "20250408",
    "20250409",
    "20250410",
    "20250411",
    "20250412",
    "20250413",
    "20250414",
  ];
  const anchor = {
    iso: "2025-03-18",
    compact: "20250318",
    dayIndex: Date.UTC(2025, 2, 18) / (24 * 60 * 60 * 1000),
  };
  const result = __buildWeekTickConfigForTests(labels, compact, anchor);
  assert.deepEqual(result.ticktext, ["4/1 (wk3)", "4/8 (wk4)"]);
});

/**
 * Ensures that when the anchor lands between two missing days (i.e., before the dataset begins),
 * the helper waits until the next true seven-day boundary relative to the anchor before surfacing a tick.
 */
test("__buildWeekTickConfigForTests delays the first label until the next 7-day boundary when the anchor predates available data", () => {
  const labels = [
    "4/1",
    "4/2",
    "4/3",
    "4/4",
    "4/5",
    "4/6",
    "4/7",
    "4/8",
    "4/9",
    "4/10",
    "4/11",
    "4/12",
    "4/13",
    "4/14",
  ];
  const compact = [
    "20250401",
    "20250402",
    "20250403",
    "20250404",
    "20250405",
    "20250406",
    "20250407",
    "20250408",
    "20250409",
    "20250410",
    "20250411",
    "20250412",
    "20250413",
    "20250414",
  ];
  const anchor = {
    iso: "2025-03-17",
    compact: "20250317",
    dayIndex: Date.UTC(2025, 2, 17) / (24 * 60 * 60 * 1000),
  };
  const result = __buildWeekTickConfigForTests(labels, compact, anchor);
  assert.deepEqual(result.ticktext, ["4/7 (wk4)", "4/14 (wk5)"]);
});

/**
 * Guards against anchors that post-date the dataset by falling back to the index-driven labels instead of
 * emitting no ticks.
 */
test("__buildWeekTickConfigForTests ignores anchors that post-date the available timeline", () => {
  const labels = ["4/1", "4/2", "4/3", "4/4", "4/5", "4/6", "4/7", "4/8"];
  const compact = [
    "20250401",
    "20250402",
    "20250403",
    "20250404",
    "20250405",
    "20250406",
    "20250407",
    "20250408",
  ];
  const anchor = {
    iso: "2026-01-01",
    compact: "20260101",
    dayIndex: Date.UTC(2026, 0, 1) / (24 * 60 * 60 * 1000),
  };
  const result = __buildWeekTickConfigForTests(labels, compact, anchor);
  assert.deepEqual(result.ticktext, ["4/1 (wk1)", "4/8 (wk2)"]);
});
