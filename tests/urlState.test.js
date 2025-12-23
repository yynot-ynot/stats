import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFilterStateFromUrl,
  startFilterUrlSync,
  __resetUrlStateForTests,
  __setFilterChangeSubscriberForTests,
} from "../js/shared/urlState.js";

function withWindow(locationHref, fn) {
  const originalWindow = global.window;
  const replaceCalls = [];
  global.window = {
    location: { href: locationHref },
    history: {
      state: {},
      replaceState(...args) {
        replaceCalls.push(args);
      },
    },
  };
  try {
    return fn(replaceCalls);
  } finally {
    global.window = originalWindow;
  }
}

test("parseFilterStateFromUrl decodes primitives and sets", () => {
  withWindow(
    "https://example.com/stats?view=trend&raid=Eden&boss=Leviathan&pct=95&metric=rdps&refpct=50&comp=10,90&jobs=Warrior,Sage&pdate=20240201",
    () => {
      const snapshot = parseFilterStateFromUrl();
      assert.deepEqual(snapshot.selectedRaid, "Eden");
      assert.deepEqual(snapshot.selectedBoss, "Leviathan");
      assert.equal(snapshot.selectedPercentile, 95);
      assert.equal(snapshot.selectedDpsType, "rdps");
      assert.equal(snapshot.selectedReferencePercentile, 50);
      assert.ok(snapshot.selectedComparisonPercentiles instanceof Set);
      assert.deepEqual(
        Array.from(snapshot.selectedComparisonPercentiles).sort(),
        [10, 90]
      );
      assert.ok(snapshot.selectedJobs instanceof Set);
      assert.deepEqual(
        Array.from(snapshot.selectedJobs).sort(),
        ["Sage", "Warrior"]
      );
      assert.equal(snapshot.selectedPercentileDate, "20240201");
    }
  );
});

test("startFilterUrlSync mirrors filter changes into the query string", async () => {
  await withWindow("https://example.com/stats?view=percentile", (calls) => {
    __resetUrlStateForTests();
    const listeners = [];
    __setFilterChangeSubscriberForTests((listener) => listeners.push(listener));
    startFilterUrlSync();
    assert.equal(listeners.length, 1, "listener should register exactly once");

    const mockState = {
      selectedRaid: "Anabaseios",
      selectedBoss: "Athena",
      selectedPercentile: 50,
      selectedReferencePercentile: 50,
      selectedComparisonPercentiles: new Set([25, 95]),
      selectedJobs: new Set(["Warrior", "Sage"]),
      selectedDpsType: "rdps",
      selectedPercentileDate: "20240201",
    };

    listeners[0](mockState);
    assert.equal(calls.length, 1, "history.replaceState should run once");
    const [, , newUrl] = calls[0];
    const parsed = new URL(`https://dummy${newUrl}`);
    assert.equal(parsed.searchParams.get("view"), "percentile");
    assert.equal(parsed.searchParams.get("raid"), "Anabaseios");
    assert.equal(parsed.searchParams.get("boss"), "Athena");
    assert.equal(parsed.searchParams.get("pct"), "50");
    assert.equal(parsed.searchParams.get("metric"), "rdps");
    assert.equal(parsed.searchParams.get("refpct"), "50");
    assert.equal(parsed.searchParams.get("comp"), "25,95");
    assert.equal(parsed.searchParams.get("jobs"), "Warrior,Sage");
    assert.equal(parsed.searchParams.get("pdate"), "20240201");
  });
});

test("startFilterUrlSync drops params when filters are cleared", async () => {
  await withWindow(
    "https://example.com/stats?view=trend&raid=Eden&jobs=Warrior&pdate=20240201",
    (calls) => {
      __resetUrlStateForTests();
      const listeners = [];
      __setFilterChangeSubscriberForTests((listener) => listeners.push(listener));
      startFilterUrlSync();

      listeners[0]({
        selectedRaid: "",
        selectedJobs: new Set(),
        selectedPercentileDate: "",
      });
      const [, , newUrl] = calls.at(-1);
      const parsed = new URL(`https://dummy${newUrl}`);
      assert.equal(parsed.searchParams.get("raid"), null);
      assert.equal(parsed.searchParams.get("jobs"), null);
      assert.equal(parsed.searchParams.get("pdate"), null);
      assert.equal(parsed.searchParams.get("view"), "trend");
    }
  );
});
