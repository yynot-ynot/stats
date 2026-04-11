import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManifestRaidIndex,
  parseManifestFileRecord,
  resolveEffectiveRaid,
} from "../js/core/manifestRaidIndex.js";

test("parseManifestFileRecord resolves known raid slugs from boss-suffixed filenames", () => {
  const record = parseManifestFileRecord(
    "json/20260327_aac-heavyweight_vamp-fatale_red-hot-and-deep-blue_dps.json.gz"
  );

  assert.deepEqual(record, {
    path: "json/20260327_aac-heavyweight_vamp-fatale_red-hot-and-deep-blue_dps.json.gz",
    filename:
      "20260327_aac-heavyweight_vamp-fatale_red-hot-and-deep-blue_dps.json.gz",
    date: "20260327",
    type: "dps",
    raid: "AAC Heavyweight",
    raidSlug: "aac-heavyweight",
  });
});

test("buildManifestRaidIndex sorts raids by latest date then alphabetically", () => {
  const manifestIndex = buildManifestRaidIndex([
    "json/20260327_trials-iii-extreme_doomtrain_dps.json.gz",
    "json/20260327_trials-iii-extreme_doomtrain_healing.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_dps.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_healing.json.gz",
    "json/20250606_aac-cruiserweight_dps.json.gz",
  ]);

  assert.deepEqual(manifestIndex.sortedRaids, [
    "AAC Heavyweight",
    "Trials III (Extreme)",
    "AAC Cruiserweight",
  ]);
  assert.equal(
    resolveEffectiveRaid(manifestIndex, "Trials III (Extreme)"),
    "Trials III (Extreme)"
  );
  assert.equal(
    resolveEffectiveRaid(manifestIndex, "Unknown Raid"),
    "AAC Heavyweight"
  );
});
