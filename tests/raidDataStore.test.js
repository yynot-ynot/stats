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
  assert.equal(store.getRaidRows("AAC Heavyweight").length, 1);

  store.markFileFailed(
    "AAC Heavyweight",
    "json/file-b.json.gz",
    new Error("boom")
  );

  record = store.getRaidRecord("AAC Heavyweight");
  assert.equal(record.status, "ready");
  assert.equal(store.getRaidRows("AAC Heavyweight").length, 1);
  assert.equal(record.failedFiles.size, 1);
  assert.deepEqual(store.getTargetProgress("AAC Heavyweight"), {
    expectedCount: 2,
    terminalCount: 2,
    loadedCount: 1,
    failedCount: 1,
    percentLoaded: 100,
  });
});

test("raid data store materializes rows per load target for boss-scoped families", () => {
  const doomtrainFile = {
    path: "json/doomtrain.json.gz",
    raid: "Trials III (Extreme)",
    loadTarget: "Trials III (Extreme)::doomtrain",
  };
  const enuoFile = {
    path: "json/enuo.json.gz",
    raid: "Trials III (Extreme)",
    loadTarget: "Trials III (Extreme)::enuo",
  };

  const store = createRaidDataStore({
    filesByRaid: new Map([
      ["Trials III (Extreme)", [doomtrainFile, enuoFile]],
    ]),
    filesByLoadTarget: new Map([
      ["Trials III (Extreme)::doomtrain", [doomtrainFile]],
      ["Trials III (Extreme)::enuo", [enuoFile]],
    ]),
    loadTargetsByRaid: new Map([
      [
        "Trials III (Extreme)",
        ["Trials III (Extreme)::doomtrain", "Trials III (Extreme)::enuo"],
      ],
    ]),
  });

  store.markTargetLoading("Trials III (Extreme)::doomtrain");
  store.appendFileRows(doomtrainFile, [
    { raid: "Trials III (Extreme)", boss: "Doomtrain", class: "Bard" },
  ]);
  store.appendFileRows(enuoFile, [
    { raid: "Trials III (Extreme)", boss: "Enuo", class: "Bard" },
  ]);

  assert.deepEqual(store.getRowsForTarget("Trials III (Extreme)::doomtrain"), [
    { raid: "Trials III (Extreme)", boss: "Doomtrain", class: "Bard" },
  ]);
  assert.deepEqual(store.getRowsForTarget("Trials III (Extreme)::enuo"), [
    { raid: "Trials III (Extreme)", boss: "Enuo", class: "Bard" },
  ]);
  assert.equal(store.getRaidRows("Trials III (Extreme)").length, 2);
  assert.deepEqual(
    store.getTargetProgress("Trials III (Extreme)::doomtrain"),
    {
      expectedCount: 1,
      terminalCount: 1,
      loadedCount: 1,
      failedCount: 0,
      percentLoaded: 100,
    }
  );
  assert.deepEqual(store.getTargetProgress("Trials III (Extreme)::enuo"), {
    expectedCount: 1,
    terminalCount: 1,
    loadedCount: 1,
    failedCount: 0,
    percentLoaded: 100,
  });
});

test("raid data store reports whole-number target progress while a subset is still loading", () => {
  const files = [
    { path: "json/file-a.json.gz", raid: "AAC Heavyweight", loadTarget: "AAC Heavyweight" },
    { path: "json/file-b.json.gz", raid: "AAC Heavyweight", loadTarget: "AAC Heavyweight" },
    { path: "json/file-c.json.gz", raid: "AAC Heavyweight", loadTarget: "AAC Heavyweight" },
  ];
  const store = createRaidDataStore({
    filesByRaid: new Map([["AAC Heavyweight", files]]),
    filesByLoadTarget: new Map([["AAC Heavyweight", files]]),
    loadTargetsByRaid: new Map([["AAC Heavyweight", ["AAC Heavyweight"]]]),
  });

  store.markTargetLoading("AAC Heavyweight");
  assert.equal(store.getTargetProgress("AAC Heavyweight").percentLoaded, 0);

  store.appendFileRows(files[0], [{ raid: "AAC Heavyweight", boss: "Vamp Fatale" }]);
  assert.equal(store.getTargetProgress("AAC Heavyweight").percentLoaded, 33);

  store.markFileFailed(files[1], new Error("boom"));
  assert.equal(store.getTargetProgress("AAC Heavyweight").percentLoaded, 67);
});
