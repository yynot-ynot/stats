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

test("scheduler prioritizes the active raid before background loading", async () => {
  const started = [];
  const deferredByPath = new Map();
  const loaded = [];

  const allFiles = [
    { path: "json/a-1.json.gz", raid: "Raid A" },
    { path: "json/a-2.json.gz", raid: "Raid A" },
    { path: "json/b-1.json.gz", raid: "Raid B" },
    { path: "json/b-2.json.gz", raid: "Raid B" },
    { path: "json/b-3.json.gz", raid: "Raid B" },
  ];

  const scheduler = createRaidLoadScheduler({
    allFiles,
    filesByRaid: new Map([
      ["Raid A", allFiles.filter((file) => file.raid === "Raid A")],
      ["Raid B", allFiles.filter((file) => file.raid === "Raid B")],
    ]),
    backgroundConcurrency: 2,
    loadFile: async (record) => {
      started.push(record.path);
      const deferred = createDeferred();
      deferredByPath.set(record.path, deferred);
      return deferred.promise;
    },
    onFileLoaded: (record, rows) => {
      loaded.push([record.path, rows]);
    },
    onFileFailed() {},
  });

  const priorityPromise = scheduler.prioritizeRaid("Raid A");
  assert.deepEqual(started, ["json/a-1.json.gz", "json/a-2.json.gz"]);

  deferredByPath.get("json/a-1.json.gz").resolve([]);
  deferredByPath.get("json/a-2.json.gz").resolve([]);
  await priorityPromise;

  scheduler.startBackgroundLoading();
  assert.deepEqual(started, [
    "json/a-1.json.gz",
    "json/a-2.json.gz",
    "json/b-1.json.gz",
    "json/b-2.json.gz",
  ]);

  deferredByPath.get("json/b-1.json.gz").resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(started, [
    "json/a-1.json.gz",
    "json/a-2.json.gz",
    "json/b-1.json.gz",
    "json/b-2.json.gz",
    "json/b-3.json.gz",
  ]);

  deferredByPath.get("json/b-2.json.gz").resolve([]);
  deferredByPath.get("json/b-3.json.gz").resolve([]);
});

test("scheduler retries a failed priority file once before surfacing final failure", async () => {
  const attemptsByPath = new Map();
  const failures = [];

  const allFiles = [{ path: "json/a-1.json.gz", raid: "Raid A" }];
  const scheduler = createRaidLoadScheduler({
    allFiles,
    filesByRaid: new Map([["Raid A", allFiles]]),
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

  await scheduler.prioritizeRaid("Raid A");

  assert.equal(attemptsByPath.get("json/a-1.json.gz"), 2);
  assert.deepEqual(failures, [["json/a-1.json.gz", "fail-2"]]);
  assert.equal(scheduler.getFileState("json/a-1.json.gz").status, "failed");
});
