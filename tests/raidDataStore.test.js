import test from "node:test";
import assert from "node:assert/strict";

import { createRaidDataStore } from "../js/logic/raidDataStore.js";

test("raid data store reaches ready when all files are terminal, even if one failed", () => {
  const store = createRaidDataStore(
    new Map([
      [
        "AAC Heavyweight",
        [{ path: "json/file-a.json.gz" }, { path: "json/file-b.json.gz" }],
      ],
    ])
  );

  store.markRaidLoading("AAC Heavyweight");
  store.appendFileRows("AAC Heavyweight", "json/file-a.json.gz", [
    { raid: "AAC Heavyweight", boss: "Vamp Fatale" },
  ]);

  let record = store.getRaidRecord("AAC Heavyweight");
  assert.equal(record.status, "loading");
  assert.equal(record.rows.length, 1);

  store.markFileFailed(
    "AAC Heavyweight",
    "json/file-b.json.gz",
    new Error("boom")
  );

  record = store.getRaidRecord("AAC Heavyweight");
  assert.equal(record.status, "ready");
  assert.equal(record.rows.length, 1);
  assert.equal(record.failedFiles.size, 1);
});
