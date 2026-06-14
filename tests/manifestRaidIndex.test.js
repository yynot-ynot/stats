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

test("parseManifestFileRecord extracts boss-scoped UMAD metadata", () => {
  const record = parseManifestFileRecord(
    "json/20260612_dancing-mad_whole-fight_dps.json.gz"
  );

  assert.deepEqual(record, {
    path: "json/20260612_dancing-mad_whole-fight_dps.json.gz",
    filename: "20260612_dancing-mad_whole-fight_dps.json.gz",
    date: "20260612",
    type: "dps",
    raid: "Dancing Mad",
    raidSlug: "dancing-mad",
    boss: "Whole Fight",
    bossSlug: "whole-fight",
    scopeType: "boss",
    loadTarget: "Dancing Mad::whole-fight",
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

test("buildManifestRaidIndex gives UMAD Whole Fight default priority and boss-scoped targets", () => {
  const manifestIndex = buildManifestRaidIndex([
    "json/20260612_dancing-mad_p3-exdeath-and-chaos_dps.json.gz",
    "json/20260612_dancing-mad_p1-kefka_dps.json.gz",
    "json/20260612_dancing-mad_p5-ultima-kefka_dps.json.gz",
    "json/20260612_dancing-mad_whole-fight_dps.json.gz",
    "json/20260612_dancing-mad_p2-forsaken-kefka_dps.json.gz",
    "json/20260612_dancing-mad_p4-kefka-says_dps.json.gz",
  ]);

  assert.equal(isBossScopedRaid(manifestIndex, "Dancing Mad"), true);
  assert.deepEqual(getManifestBossesForRaid(manifestIndex, "Dancing Mad"), [
    "Whole Fight",
    "P1: Kefka",
    "P2: Forsaken Kefka",
    "P3: Exdeath and Chaos",
    "P4: Kefka Says",
    "P5: Ultima Kefka",
  ]);
  assert.deepEqual(manifestIndex.loadTargetsByRaid.get("Dancing Mad"), [
    "Dancing Mad::whole-fight",
    "Dancing Mad::p1-kefka",
    "Dancing Mad::p2-forsaken-kefka",
    "Dancing Mad::p3-exdeath-and-chaos",
    "Dancing Mad::p4-kefka-says",
    "Dancing Mad::p5-ultima-kefka",
  ]);
  assert.equal(resolveEffectiveBoss(manifestIndex, "Dancing Mad", ""), "Whole Fight");
  assert.equal(
    resolveActivationTarget(manifestIndex, "Dancing Mad", ""),
    "Dancing Mad::whole-fight"
  );
  assert.equal(
    resolveActivationTarget(manifestIndex, "Dancing Mad", "P5: Ultima Kefka"),
    "Dancing Mad::p5-ultima-kefka"
  );
});
