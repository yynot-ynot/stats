import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPercentileSeries,
  collectAvailableDates,
} from "../js/logic/percentileDataUtils.js";

test("buildPercentileSeries picks latest date and buckets", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240101", dps: 1000 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 75, date: "20240101", dps: 1200 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 1500 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 90, date: "20240201", dps: 1700 },
  ];
  const result = buildPercentileSeries(data, { raid: "Eden", boss: "Prime", jobNames: ["Warrior"] }, { valueKey: "dps" });
  assert.equal(result.selectedDate, "20240201");
  assert.deepEqual(result.buckets, [50, 90]);
  assert.equal(result.series.get("Warrior").get(50), 1500);
  assert.equal(result.series.get("Warrior").get(90), 1700);
});

test("buildPercentileSeries respects job filter and ignores missing values", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 1500 },
    { raid: "Eden", boss: "Prime", class: "Sage", percentile: 50, date: "20240201", dps: 1300 },
    { raid: "Eden", boss: "Prime", class: "Sage", percentile: 75, date: "20240201", dps: "n/a" },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: new Set(["Sage"]) },
    { valueKey: "dps" }
  );
  assert.deepEqual(result.buckets, [50]);
  assert.ok(result.series.has("Sage"));
  assert.equal(result.series.get("Sage").get(50), 1300);
  assert.equal(result.series.get("Sage").get(75), undefined);
});

test("buildPercentileSeries captures min/max across all filtered dates", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240101", dps: 900 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 90, date: "20240101", dps: 1400 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 1600 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 90, date: "20240201", dps: 2100 },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: ["Warrior"] },
    { valueKey: "dps", targetDate: "20240201" }
  );
  assert.equal(result.selectedDate, "20240201");
  assert.deepEqual(result.valueRange, { min: 900, max: 2100 });
});

test("buildPercentileSeries excludes 0th percentile rows from buckets and range", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 0, date: "20240201", dps: 100 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 200 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 90, date: "20240201", dps: 400 },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: ["Warrior"] },
    { valueKey: "dps" }
  );
  assert.deepEqual(result.buckets, [50, 90]);
  assert.equal(result.series.get("Warrior").get(0), undefined);
  assert.deepEqual(result.valueRange, { min: 200, max: 400 });
});

/**
 * Validates that buildPercentileSeries discards 100th-percentile rows entirely when
 * the caller opts out via includeMaxPercentile=false, ensuring both buckets and the
 * derived min/max range reflect only the lower percentiles.
 */
test("buildPercentileSeries omits 100th percentile rows when includeMaxPercentile=false", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 200 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 75, date: "20240201", dps: 500 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 100, date: "20240201", dps: 800 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 100, date: "20240101", dps: 1000 },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: ["Warrior"] },
    { valueKey: "dps", includeMaxPercentile: false }
  );
  assert.deepEqual(result.buckets, [50, 75]);
  assert.equal(result.series.get("Warrior").get(100), undefined);
  assert.deepEqual(result.valueRange, { min: 200, max: 500 });
});

test("buildPercentileSeries handles dps_type filter", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps_type: "rdps", dps: 1500 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps_type: "adps", dps: 1100 },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: ["Warrior"], dps_type: "rdps" },
    { valueKey: "dps" }
  );
  assert.equal(result.series.get("Warrior").get(50), 1500);
});

/**
 * Ensures buildPercentileSeries honors an explicit targetDate override instead of always
 * defaulting to the latest snapshot, enabling the new slider to drive chart selection.
 */
test("buildPercentileSeries uses provided targetDate when available", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240101", dps: 1000 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 90, date: "20240101", dps: 1200 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 1500 },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: ["Warrior"] },
    { valueKey: "dps", targetDate: "20240101" }
  );
  assert.equal(result.selectedDate, "20240101");
  assert.deepEqual(result.buckets, [50, 90]);
  assert.equal(result.series.get("Warrior").get(90), 1200);
});

/**
 * Regression test: when the preferred targetDate no longer exists for the current raid/boss selection
 * (e.g., after switching raids in the percentile view), the helper should gracefully fall back to
 * the most recent snapshot rather than returning an empty series.
 */
test("buildPercentileSeries falls back to latest date when preferred snapshot is missing", () => {
  const data = [
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 50, date: "20240201", dps: 1600 },
    { raid: "Eden", boss: "Prime", class: "Warrior", percentile: 90, date: "20240201", dps: 1900 },
    { raid: "Anabaseios", boss: "Athena", class: "Warrior", percentile: 50, date: "20240601", dps: 2100 },
  ];
  const result = buildPercentileSeries(
    data,
    { raid: "Eden", boss: "Prime", jobNames: ["Warrior"] },
    { valueKey: "dps", targetDate: "20240601" }
  );
  assert.equal(result.selectedDate, "20240201");
  assert.deepEqual(result.buckets, [50, 90]);
  assert.equal(result.series.get("Warrior").get(90), 1900);
});

/**
 * Confirms collectAvailableDates narrows the date list to the selected raid/boss combination
 * so the percentile date slider only exposes relevant snapshots.
 */
test("collectAvailableDates filters by raid and boss", () => {
  const data = [
    { raid: "Eden", boss: "Prime", date: "20240101" },
    { raid: "Eden", boss: "Prime", date: "20240201" },
    { raid: "Eden", boss: "Guardian", date: "20240215" },
    { raid: "Anabaseios", boss: "Athena", date: "20240101" },
  ];
  const raidDates = collectAvailableDates(data, { raid: "Eden" });
  assert.deepEqual(raidDates, ["20240101", "20240201", "20240215"]);
  const bossDates = collectAvailableDates(data, {
    raid: "Eden",
    boss: "Guardian",
  });
  assert.deepEqual(bossDates, ["20240215"]);
});
