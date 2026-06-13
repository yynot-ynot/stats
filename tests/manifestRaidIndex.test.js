import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManifestRaidIndex,
  parseManifestFileRecord,
  resolveEffectiveRaid,
  resolveEffectiveBoss,
  resolveActivationTarget,
  getManifestBossesForRaid,
  isBossScopedRaid,
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
    boss: "",
    bossSlug: "",
    scopeType: "raid",
    loadTarget: "AAC Heavyweight",
    isBossScoped: false,
  });
});

test("parseManifestFileRecord extracts boss-scoped Trial metadata", () => {
  const record = parseManifestFileRecord(
    "json/20260608_trials-iii-extreme_enuo_dps.json.gz"
  );

  assert.deepEqual(record, {
    path: "json/20260608_trials-iii-extreme_enuo_dps.json.gz",
    filename: "20260608_trials-iii-extreme_enuo_dps.json.gz",
    date: "20260608",
    type: "dps",
    raid: "Trials III (Extreme)",
    raidSlug: "trials-iii-extreme",
    boss: "Enuo",
    bossSlug: "enuo",
    scopeType: "boss",
    loadTarget: "Trials III (Extreme)::enuo",
    isBossScoped: true,
  });
});

test("buildManifestRaidIndex sorts raids by latest date then alphabetically", () => {
  const manifestIndex = buildManifestRaidIndex([
    "json/20260608_trials-iii-extreme_enuo_dps.json.gz",
    "json/20260608_trials-iii-extreme_enuo_healing.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_dps.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_healing.json.gz",
    "json/20250606_aac-cruiserweight_dps.json.gz",
  ]);

  assert.deepEqual(manifestIndex.sortedRaids, [
    "Trials III (Extreme)",
    "AAC Heavyweight",
    "AAC Cruiserweight",
  ]);
  assert.equal(
    resolveEffectiveRaid(manifestIndex, "Trials III (Extreme)"),
    "Trials III (Extreme)"
  );
  assert.equal(
    resolveEffectiveRaid(manifestIndex, "Unknown Raid"),
    "Trials III (Extreme)"
  );
});

test("buildManifestRaidIndex builds boss-scoped Trial load targets and default boss order", () => {
  const manifestIndex = buildManifestRaidIndex([
    "json/20260107_trials-iii-extreme_doomtrain_dps.json.gz",
    "json/20260107_trials-iii-extreme_doomtrain_healing.json.gz",
    "json/20260608_trials-iii-extreme_enuo_dps.json.gz",
    "json/20260608_trials-iii-extreme_enuo_healing.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_dps.json.gz",
  ]);

  assert.deepEqual(
    manifestIndex.loadTargetsByRaid.get("Trials III (Extreme)"),
    ["Trials III (Extreme)::enuo", "Trials III (Extreme)::doomtrain"]
  );
  assert.deepEqual(getManifestBossesForRaid(manifestIndex, "Trials III (Extreme)"), [
    "Enuo",
    "Doomtrain",
  ]);
  assert.equal(resolveEffectiveBoss(manifestIndex, "Trials III (Extreme)", ""), "Enuo");
  assert.equal(
    resolveActivationTarget(manifestIndex, "Trials III (Extreme)", ""),
    "Trials III (Extreme)::enuo"
  );
  assert.equal(
    resolveActivationTarget(manifestIndex, "Trials III (Extreme)", "Doomtrain"),
    "Trials III (Extreme)::doomtrain"
  );
  assert.equal(isBossScopedRaid(manifestIndex, "Trials III (Extreme)"), true);
  assert.equal(isBossScopedRaid(manifestIndex, "AAC Heavyweight"), false);
});

test("resolveEffectiveBoss falls back to the newest manifest-derived Trial boss", () => {
  const manifestIndex = buildManifestRaidIndex([
    "json/20260107_trials-iii-extreme_doomtrain_dps.json.gz",
    "json/20260608_trials-iii-extreme_enuo_dps.json.gz",
  ]);

  assert.equal(
    resolveEffectiveBoss(manifestIndex, "Trials III (Extreme)", "Invalid Boss"),
    "Enuo"
  );
  assert.equal(
    resolveEffectiveBoss(manifestIndex, "Trials III (Extreme)", "doomtrain"),
    "Doomtrain"
  );
});
