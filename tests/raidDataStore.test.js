import test from "node:test";
import assert from "node:assert/strict";

import { createRaidDataStore } from "../js/logic/raidDataStore.js";

// The per-entity store should treat "loaded plus failed" as ready because the
// controller can render partial data while surfacing missing files separately.
test("raid data store reaches ready when all files in one entity group are terminal", () => {
  const groupKey = "Futures Rewritten::whole-fight";
  const store = createRaidDataStore(
    new Map([
      [
        groupKey,
        [
          { path: "json/fru-whole-dps.json.gz" },
          { path: "json/fru-whole-healing.json.gz" },
        ],
      ],
    ])
  );

  store.markGroupLoading(groupKey);
  store.appendFileRows(groupKey, "json/fru-whole-dps.json.gz", [
    { raid: "Futures Rewritten", boss: "Whole Fight", entitySlug: "whole-fight" },
  ]);

  let record = store.getGroupRecord(groupKey);
  assert.equal(record.status, "loading");
  assert.equal(record.rows.length, 1);

  store.markFileFailed(
    groupKey,
    "json/fru-whole-healing.json.gz",
    new Error("boom")
  );

  record = store.getGroupRecord(groupKey);
  assert.equal(record.status, "ready");
  assert.equal(record.rows.length, 1);
  assert.equal(record.failedFiles.size, 1);
});
