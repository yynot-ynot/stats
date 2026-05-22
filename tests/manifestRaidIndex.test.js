import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManifestRaidIndex,
  buildRaidEntityKey,
  getManifestFilesForSelection,
  parseManifestFileRecord,
  resolveEffectiveEntitySlug,
  resolveEffectiveRaid,
} from "../js/core/manifestRaidIndex.js";

// Manifest parsing is the first place the stats app learns that whole-fight and
// phases are separate loadable entities. These tests lock that contract down so
// later scheduler/UI work can trust filename-derived metadata.
test("parseManifestFileRecord preserves legacy boss-suffixed filenames as one entity", () => {
  const record = parseManifestFileRecord(
    "json/20260327_aac-heavyweight_vamp-fatale_red-hot-and-deep-blue_dps.json.gz"
  );

  assert.equal(
    record.path,
    "json/20260327_aac-heavyweight_vamp-fatale_red-hot-and-deep-blue_dps.json.gz"
  );
  assert.equal(
    record.filename,
    "20260327_aac-heavyweight_vamp-fatale_red-hot-and-deep-blue_dps.json.gz"
  );
  assert.equal(record.date, "20260327");
  assert.equal(record.type, "dps");
  assert.equal(record.raid, "AAC Heavyweight");
  assert.equal(record.raidSlug, "aac-heavyweight");
  assert.equal(record.entitySlug, "vamp-fatale_red-hot-and-deep-blue");
  assert.equal(record.groupKey, "AAC Heavyweight::vamp-fatale_red-hot-and-deep-blue");
  // Legacy boss artifacts only need a stable file-derived label for selector
  // parity; exact title casing is not part of the contract for old slugs.
  assert.match(record.entityLabel, /fatale/i);
  assert.match(record.entityLabel, /deep/i);
});

// Phase-aware files must expose a human-usable label before JSON download while
// still keeping a compact slug for routing and URL state.
test("parseManifestFileRecord derives phase-aware entity labels from manifest filenames", () => {
  const wholeFight = parseManifestFileRecord(
    "json/20260502_futures-rewritten_whole-fight_dps.json.gz"
  );
  const phase = parseManifestFileRecord(
    "json/20260502_futures-rewritten_p3-oracle-of-darkness_healing.json.gz"
  );
  const fallback = parseManifestFileRecord(
    "json/20260502_futures-rewritten_p5_dps.json.gz"
  );

  assert.equal(wholeFight.entitySlug, "whole-fight");
  assert.equal(wholeFight.entityLabel, "Whole Fight");
  assert.equal(phase.entitySlug, "p3-oracle-of-darkness");
  assert.equal(phase.entityLabel, "P3: Oracle of Darkness");
  assert.equal(fallback.entitySlug, "p5");
  assert.equal(fallback.entityLabel, "P5:");
});

// The manifest index is the bridge from flat filenames to the two-level
// raid/entity loading model used by the scheduler and controller.
test("buildManifestRaidIndex groups files by raid and independently loadable entity", () => {
  const manifestIndex = buildManifestRaidIndex([
    "json/20260502_futures-rewritten_whole-fight_dps.json.gz",
    "json/20260502_futures-rewritten_whole-fight_healing.json.gz",
    "json/20260502_futures-rewritten_p1-fatebreaker_dps.json.gz",
    "json/20260502_futures-rewritten_p1-fatebreaker_healing.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_dps.json.gz",
  ]);

  assert.deepEqual(manifestIndex.sortedRaids, [
    "Futures Rewritten",
    "AAC Heavyweight",
  ]);
  assert.deepEqual(manifestIndex.entitiesByRaid.get("Futures Rewritten"), [
    { slug: "whole-fight", label: "Whole Fight" },
    { slug: "p1-fatebreaker", label: "P1: Fatebreaker" },
  ]);
  assert.deepEqual(
    getManifestFilesForSelection(
      manifestIndex,
      "Futures Rewritten",
      "p1-fatebreaker"
    ).map((record) => record.type),
    ["dps", "healing"]
  );
  assert.equal(
    manifestIndex.latestDateByGroup[
      buildRaidEntityKey("Futures Rewritten", "whole-fight")
    ],
    "20260502"
  );
  assert.equal(
    resolveEffectiveRaid(manifestIndex, "Unknown Raid"),
    "Futures Rewritten"
  );
  assert.equal(
    resolveEffectiveEntitySlug(
      manifestIndex,
      "Futures Rewritten",
      "missing-entity"
    ),
    "whole-fight"
  );
});
