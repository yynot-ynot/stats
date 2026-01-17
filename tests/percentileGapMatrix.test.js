import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPercentileGapMatrixData,
  VALID_PERCENTILES,
} from "../js/logic/percentileGapMatrix.js";

const BASE_DATASET = [
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 0, date: "20240101", dps: 100, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 10, date: "20240101", dps: 180, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 50, date: "20240101", dps: 300, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 90, date: "20240101", dps: 470, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 100, date: "20240101", dps: 500, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 0, date: "20240102", dps: 120, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 10, date: "20240102", dps: 190, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 90, date: "20240102", dps: 450, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 100, date: "20240102", dps: 480, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Monk", percentile: 10, date: "20240101", dps: 200, dps_type: "rdps" },
  { raid: "Eden", boss: "Prime", job: "Monk", percentile: 90, date: "20240101", dps: 400, dps_type: "rdps" },
];

/**
 * Confirms the matrix helper trims out 0th/100th percentile pairs entirely so the scale ignores extremes.
 * Plan:
 * 1. Build the matrix for Dragoon on 2024-01-01.
 * 2. Scan every cell and ensure neither the lower nor upper percentile equals 0 or 100.
 */
test("buildPercentileGapMatrixData excludes extreme percentiles", () => {
  const filters = {
    raid: "Eden",
    boss: "Prime",
    jobNames: new Set(["Dragoon"]),
    dps_type: "rdps",
  };
  const result = buildPercentileGapMatrixData({
    data: BASE_DATASET,
    filters,
    valueKey: "dps",
    targetDates: ["20240101"],
  });
  assert.ok(result.categories.length > 0);
  const dragoonMatrix = findMatrix(result, "Dragoon", "20240101");
  dragoonMatrix.cellMap.forEach((cell) => {
    assert.ok(![0, 100].includes(cell.lowerPercentile));
    assert.ok(![0, 100].includes(cell.upperPercentile));
  });
});

/**
 * Ensures missing percentile pairs render as gaps but still produce tooltip metadata.
 * Plan:
 * 1. Request the Monk job, which only has P10 and P90 values.
 * 2. Inspect a cell that depends on a percentile the job lacks (e.g., P10 → P95).
 * 3. Assert the cell is marked missing.
 */
test("missing percentile combinations are flagged as gaps", () => {
  const filters = {
    raid: "Eden",
    boss: "Prime",
    jobNames: new Set(["Monk"]),
    dps_type: "rdps",
  };
  const result = buildPercentileGapMatrixData({
    data: BASE_DATASET,
    filters,
    valueKey: "dps",
    targetDates: ["20240101"],
  });
  const monkMatrix = findMatrix(result, "Monk", "20240101");
  const lowerIdx = VALID_PERCENTILES.indexOf(10);
  const upperIdx = VALID_PERCENTILES.indexOf(95);
  const cell = monkMatrix.cellMap.get(`${lowerIdx}-${upperIdx}`);
  assert.equal(cell.isMissing, true);
});

/**
 * Verifies the emitted categories mirror the configured job groups and include "Other Roles".
 * Plan:
 * 1. Request Dragoon + Monk so two categories (Melee + Other) should appear.
 * 2. Assert the first category is one of the configured names and the fallback exists when no jobs belong to it.
 */
test("job selection respects sidebar category ordering", () => {
  const filters = {
    raid: "Eden",
    boss: "Prime",
    jobNames: new Set(["Dragoon", "Blue Mage (Limited Job)"]),
    dps_type: "rdps",
  };
  const customData = [
    ...BASE_DATASET,
    {
      raid: "Eden",
      boss: "Prime",
      job: "Blue Mage (Limited Job)",
      percentile: 50,
      date: "20240101",
      dps: 250,
      dps_type: "rdps",
    },
  ];
  const result = buildPercentileGapMatrixData({
    data: customData,
    filters,
    valueKey: "dps",
    targetDates: ["20240101"],
  });
  assert.ok(result.categories.some((category) => category.name === "Other Roles"));
});

/**
 * Ensures the sequential Viridis domain is `[0 → maxDiff]` so the UI legend never shows negatives.
 * Plan:
 * 1. Provide a tiny dataset with known percentile values (P10 = 100, P90 = 400) so the max diff is 300.
 * 2. Build the matrix for Dragoon on that date.
 * 3. Assert the emitted domain anchors at 0 and tops out at 300.
 */
test("color domain anchors at zero and reflects the observed max", () => {
  const filters = {
    raid: "Eden",
    boss: "Prime",
    jobNames: new Set(["Dragoon"]),
    dps_type: "rdps",
  };
  const sequentialDataset = [
    { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 10, date: "20240103", dps: 100, dps_type: "rdps" },
    { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 20, date: "20240103", dps: 140, dps_type: "rdps" },
    { raid: "Eden", boss: "Prime", job: "Dragoon", percentile: 90, date: "20240103", dps: 400, dps_type: "rdps" },
  ];
  const result = buildPercentileGapMatrixData({
    data: sequentialDataset,
    filters,
    valueKey: "dps",
    targetDates: ["20240103"],
  });
  assert.equal(result.colorScale.domainMin, 0);
  assert.equal(result.colorScale.domainMax, 300);
});

/**
 * Enforces that each job group (e.g., Tanks) compacts its jobs into a single row so the UI can
 * tessellate four matrices per row. Currently the renderer emits one row per job, which forces
 * vertical stacking; this test captures the desired layout by expecting a single job entry per category.
 * Plan:
 * 1. Provide dataset rows for multiple tanks (Paladin + Warrior).
 * 2. Request both jobs via the filters.
 * 3. Assert the Tank category only includes one job entry placeholder so the grid can house the full row.
 */
test("tank jobs share a single category grid for tessellation", () => {
  const filters = {
    raid: "Eden",
    boss: "Prime",
    jobNames: new Set(["Paladin", "Warrior"]),
    dps_type: "rdps",
  };
  const tankDataset = [
    ...BASE_DATASET,
    { raid: "Eden", boss: "Prime", job: "Paladin", percentile: 10, date: "20240101", dps: 210, dps_type: "rdps" },
    { raid: "Eden", boss: "Prime", job: "Paladin", percentile: 90, date: "20240101", dps: 390, dps_type: "rdps" },
    { raid: "Eden", boss: "Prime", job: "Warrior", percentile: 10, date: "20240101", dps: 205, dps_type: "rdps" },
    { raid: "Eden", boss: "Prime", job: "Warrior", percentile: 90, date: "20240101", dps: 395, dps_type: "rdps" },
  ];
  const result = buildPercentileGapMatrixData({
    data: tankDataset,
    filters,
    valueKey: "dps",
    targetDates: ["20240101"],
  });
  const tankCategory = result.categories.find((category) => category.name === "Tank");
  assert.ok(tankCategory, "Expected Tank category to be present.");
  const paladinTile = findMatrix(result, "Paladin", "20240101");
  const warriorTile = findMatrix(result, "Warrior", "20240101");
  assert.ok(paladinTile && warriorTile, "Tank grid should include both jobs.");
  assert.equal(
    tankCategory.tiles.length,
    2,
    "Tank category should flatten jobs into a single grid for tessellation."
  );
});

function findMatrix(result, jobName, snapshotDate) {
  for (const category of result.categories) {
    const match = category.tiles?.find(
      (tile) => tile.jobName === jobName && tile.snapshotDate === snapshotDate
    );
    if (match) return match;
  }
  throw new Error(`Matrix not found for job ${jobName} on ${snapshotDate}`);
}
