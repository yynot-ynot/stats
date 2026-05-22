import test from "node:test";
import assert from "node:assert/strict";

import { createRaidLoadScheduler } from "../js/core/raidLoadScheduler.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The scheduler now operates on raid/entity groups. The tests focus on the
// loading contract the UI depends on: active entity first, then same-raid
// background warming, then unrelated raids.
test("scheduler prioritizes the active raid/entity group before background warming", async () => {
  const started = [];
  const deferredByPath = new Map();

  const allFiles = [
    {
      path: "json/fru-whole-dps.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::whole-fight",
    },
    {
      path: "json/fru-whole-healing.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::whole-fight",
    },
    {
      path: "json/fru-p1-dps.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::p1-fatebreaker",
    },
    {
      path: "json/fru-p1-healing.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::p1-fatebreaker",
    },
    {
      path: "json/other-raid-dps.json.gz",
      raid: "AAC Heavyweight",
      groupKey: "AAC Heavyweight::vamp-fatale",
    },
  ];

  const scheduler = createRaidLoadScheduler({
    allFiles,
    filesByGroup: new Map([
      [
        "Futures Rewritten::whole-fight",
        allFiles.filter((record) => record.groupKey === "Futures Rewritten::whole-fight"),
      ],
      [
        "Futures Rewritten::p1-fatebreaker",
        allFiles.filter((record) => record.groupKey === "Futures Rewritten::p1-fatebreaker"),
      ],
      [
        "AAC Heavyweight::vamp-fatale",
        allFiles.filter((record) => record.groupKey === "AAC Heavyweight::vamp-fatale"),
      ],
    ]),
    filesByRaid: new Map([
      [
        "Futures Rewritten",
        allFiles.filter((record) => record.raid === "Futures Rewritten"),
      ],
      [
        "AAC Heavyweight",
        allFiles.filter((record) => record.raid === "AAC Heavyweight"),
      ],
    ]),
    backgroundConcurrency: 2,
    loadFile: async (record) => {
      started.push(record.path);
      const deferred = createDeferred();
      deferredByPath.set(record.path, deferred);
      return deferred.promise;
    },
    onFileLoaded() {},
    onFileFailed() {},
  });

  const priorityPromise = scheduler.prioritizeSelection(
    "Futures Rewritten::whole-fight"
  );
  assert.deepEqual(started, [
    "json/fru-whole-dps.json.gz",
    "json/fru-whole-healing.json.gz",
  ]);

  deferredByPath.get("json/fru-whole-dps.json.gz").resolve([]);
  deferredByPath.get("json/fru-whole-healing.json.gz").resolve([]);
  await priorityPromise;

  scheduler.startBackgroundLoading();
  assert.deepEqual(started, [
    "json/fru-whole-dps.json.gz",
    "json/fru-whole-healing.json.gz",
    "json/fru-p1-dps.json.gz",
    "json/fru-p1-healing.json.gz",
  ]);

  deferredByPath.get("json/fru-p1-dps.json.gz").resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(started, [
    "json/fru-whole-dps.json.gz",
    "json/fru-whole-healing.json.gz",
    "json/fru-p1-dps.json.gz",
    "json/fru-p1-healing.json.gz",
    "json/other-raid-dps.json.gz",
  ]);

  deferredByPath.get("json/fru-p1-healing.json.gz").resolve([]);
  deferredByPath.get("json/other-raid-dps.json.gz").resolve([]);
});

// Retry behavior is preserved from the old raid-wide scheduler; only the scope
// of "active" work changed.
test("scheduler retries a failed active-selection file once before surfacing final failure", async () => {
  const attemptsByPath = new Map();
  const failures = [];

  const allFiles = [
    {
      path: "json/fru-whole-dps.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::whole-fight",
    },
  ];

  const scheduler = createRaidLoadScheduler({
    allFiles,
    filesByGroup: new Map([["Futures Rewritten::whole-fight", allFiles]]),
    filesByRaid: new Map([["Futures Rewritten", allFiles]]),
    loadFile: async (record) => {
      const attempts = (attemptsByPath.get(record.path) || 0) + 1;
      attemptsByPath.set(record.path, attempts);
      throw new Error(`fail-${attempts}`);
    },
    onFileLoaded() {},
    onFileFailed: (record, error) => {
      failures.push([record.path, error.message]);
    },
  });

  await scheduler.prioritizeSelection("Futures Rewritten::whole-fight");

  assert.equal(attemptsByPath.get("json/fru-whole-dps.json.gz"), 2);
  assert.deepEqual(failures, [["json/fru-whole-dps.json.gz", "fail-2"]]);
  assert.equal(
    scheduler.getFileState("json/fru-whole-dps.json.gz").status,
    "failed"
  );
});

// Reprioritization must not cancel in-flight work, but it should redirect the
// next queue pick toward the newest user selection.
test("scheduler reprioritizes the newest active selection before older same-raid work", async () => {
  const started = [];
  const deferredByPath = new Map();

  const allFiles = [
    {
      path: "json/fru-whole-dps.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::whole-fight",
    },
    {
      path: "json/fru-whole-healing.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::whole-fight",
    },
    {
      path: "json/fru-p1-dps.json.gz",
      raid: "Futures Rewritten",
      groupKey: "Futures Rewritten::p1-fatebreaker",
    },
  ];

  const scheduler = createRaidLoadScheduler({
    allFiles,
    filesByGroup: new Map([
      [
        "Futures Rewritten::whole-fight",
        allFiles.filter((record) => record.groupKey === "Futures Rewritten::whole-fight"),
      ],
      [
        "Futures Rewritten::p1-fatebreaker",
        allFiles.filter((record) => record.groupKey === "Futures Rewritten::p1-fatebreaker"),
      ],
    ]),
    filesByRaid: new Map([["Futures Rewritten", allFiles]]),
    backgroundConcurrency: 1,
    loadFile: async (record) => {
      started.push(record.path);
      const deferred = createDeferred();
      deferredByPath.set(record.path, deferred);
      return deferred.promise;
    },
    onFileLoaded() {},
    onFileFailed() {},
  });

  void scheduler.prioritizeSelection("Futures Rewritten::whole-fight");
  assert.deepEqual(started, ["json/fru-whole-dps.json.gz"]);

  const phasePromise = scheduler.prioritizeSelection(
    "Futures Rewritten::p1-fatebreaker"
  );
  deferredByPath.get("json/fru-whole-dps.json.gz").resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(started, [
    "json/fru-whole-dps.json.gz",
    "json/fru-p1-dps.json.gz",
  ]);

  deferredByPath.get("json/fru-p1-dps.json.gz").resolve([]);
  await phasePromise;
});
