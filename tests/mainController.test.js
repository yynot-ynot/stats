import test from "node:test";
import assert from "node:assert/strict";

import { buildManifestRaidIndex } from "../js/core/manifestRaidIndex.js";
import {
  __buildActivationRequestForTests,
  __shouldIgnoreDuplicateActivationForTests,
  __evaluateBossChangeActivationForTests,
  __syncLoadingOwnedControlVisibilityForTests,
  __buildActiveRaidLoadingMarkupForTests,
  __shouldRebuildActiveRaidLoadingMarkupForTests,
} from "../js/logic/mainController.js";

function createTrialManifestIndex() {
  return buildManifestRaidIndex([
    "json/20260107_trials-iii-extreme_doomtrain_dps.json.gz",
    "json/20260107_trials-iii-extreme_doomtrain_healing.json.gz",
    "json/20260608_trials-iii-extreme_enuo_dps.json.gz",
    "json/20260608_trials-iii-extreme_enuo_healing.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_dps.json.gz",
  ]);
}

function createBossScopedManifestIndex() {
  return buildManifestRaidIndex([
    "json/20260107_trials-iii-extreme_doomtrain_dps.json.gz",
    "json/20260608_trials-iii-extreme_enuo_dps.json.gz",
    "json/20260612_dancing-mad_whole-fight_dps.json.gz",
    "json/20260612_dancing-mad_p1-kefka_dps.json.gz",
    "json/20260612_dancing-mad_p5-ultima-kefka_dps.json.gz",
    "json/20260327_aac-heavyweight_vamp-fatale_dps.json.gz",
  ]);
}

test("activation request resolves Trial boss targets with boss-scoped loading labels", () => {
  const manifestIndex = createTrialManifestIndex();

  const request = __buildActivationRequestForTests(
    manifestIndex,
    "Trials III (Extreme)",
    "Doomtrain"
  );

  assert.equal(request.resolvedBoss, "Doomtrain");
  assert.equal(request.activationTarget, "Trials III (Extreme)::doomtrain");
  assert.equal(request.loadingKind, "boss");
  assert.equal(request.loadingLabel, "Doomtrain");
});

test("activation request resolves UMAD Whole Fight as the default boss-scoped target", () => {
  const manifestIndex = createBossScopedManifestIndex();

  const request = __buildActivationRequestForTests(
    manifestIndex,
    "Dancing Mad",
    ""
  );

  assert.equal(request.resolvedBoss, "Whole Fight");
  assert.equal(request.activationTarget, "Dancing Mad::whole-fight");
  assert.equal(request.loadingKind, "boss");
  assert.equal(request.loadingLabel, "Whole Fight");
});

test("boss change evaluation triggers activation when switching to a different warm or cold Trial boss", () => {
  const manifestIndex = createTrialManifestIndex();

  const result = __evaluateBossChangeActivationForTests({
    manifestIndexArg: manifestIndex,
    nextRaid: "Trials III (Extreme)",
    nextBoss: "Enuo",
    previousBoss: "Doomtrain",
    activeLoadTargetValue: "Trials III (Extreme)::doomtrain",
  });

  assert.deepEqual(result, {
    shouldActivate: true,
    activationTarget: "Trials III (Extreme)::enuo",
  });
});

test("boss change evaluation triggers activation when switching UMAD targets", () => {
  const manifestIndex = createBossScopedManifestIndex();

  const result = __evaluateBossChangeActivationForTests({
    manifestIndexArg: manifestIndex,
    nextRaid: "Dancing Mad",
    nextBoss: "P5: Ultima Kefka",
    previousBoss: "Whole Fight",
    activeLoadTargetValue: "Dancing Mad::whole-fight",
  });

  assert.deepEqual(result, {
    shouldActivate: true,
    activationTarget: "Dancing Mad::p5-ultima-kefka",
  });
});

test("boss change evaluation ignores no-op Trial boss switches after initial load", () => {
  const manifestIndex = createTrialManifestIndex();

  const result = __evaluateBossChangeActivationForTests({
    manifestIndexArg: manifestIndex,
    nextRaid: "Trials III (Extreme)",
    nextBoss: "Enuo",
    previousBoss: "Enuo",
    activeLoadTargetValue: "Trials III (Extreme)::enuo",
  });

  assert.deepEqual(result, {
    shouldActivate: false,
    activationTarget: "Trials III (Extreme)::enuo",
  });
});

test("duplicate activation detection does not suppress switching Trial bosses during initial load", () => {
  const manifestIndex = createTrialManifestIndex();
  const doomtrainRequest = __buildActivationRequestForTests(
    manifestIndex,
    "Trials III (Extreme)",
    "Doomtrain"
  );
  const enuoRequest = __buildActivationRequestForTests(
    manifestIndex,
    "Trials III (Extreme)",
    "Enuo"
  );

  assert.equal(
    __shouldIgnoreDuplicateActivationForTests({
      hasActivationInFlight: true,
      raid: "Trials III (Extreme)",
      processingRaid: "Trials III (Extreme)",
      activationTarget: enuoRequest.activationTarget,
      processingLoadTarget: doomtrainRequest.activationTarget,
    }),
    false
  );
});

test("duplicate activation detection suppresses exact Trial target duplicates during initial load", () => {
  const manifestIndex = createTrialManifestIndex();
  const doomtrainRequest = __buildActivationRequestForTests(
    manifestIndex,
    "Trials III (Extreme)",
    "Doomtrain"
  );

  assert.equal(
    __shouldIgnoreDuplicateActivationForTests({
      hasActivationInFlight: true,
      raid: "Trials III (Extreme)",
      processingRaid: "Trials III (Extreme)",
      activationTarget: doomtrainRequest.activationTarget,
      processingLoadTarget: doomtrainRequest.activationTarget,
    }),
    true
  );
});

test("loading-owned controls are hidden during target activation and restored afterward", () => {
  const jobSidebar = { style: { display: "" }, dataset: {} };
  const sidebarLabel = { style: { display: "flex" }, dataset: {} };
  const dpsTypeLabel = { style: { display: "flex" }, dataset: {} };
  const originalDocument = global.document;

  global.document = {
    getElementById(id) {
      switch (id) {
        case "job-sidebar":
          return jobSidebar;
        case "sidebar-label-container":
          return sidebarLabel;
        case "dps-type-label-container":
          return dpsTypeLabel;
        default:
          return null;
      }
    },
  };

  try {
    __syncLoadingOwnedControlVisibilityForTests(true);
    assert.equal(jobSidebar.style.display, "none");
    assert.equal(sidebarLabel.style.display, "none");
    assert.equal(dpsTypeLabel.style.display, "none");

    __syncLoadingOwnedControlVisibilityForTests(false);
    assert.equal(jobSidebar.style.display, "");
    assert.equal(sidebarLabel.style.display, "flex");
    assert.equal(dpsTypeLabel.style.display, "flex");
  } finally {
    global.document = originalDocument;
  }
});

test("loading banner markup keeps the dots and adds a dedicated percentage row", () => {
  const markup = __buildActiveRaidLoadingMarkupForTests(
    "Enuo",
    "Loading boss data",
    67.4
  );

  assert.match(markup, /Loading Enuo/);
  assert.match(markup, /Loading boss data/);
  assert.match(
    markup,
    /active-raid-loading-progress" data-loading-progress="true">67%<\/div>/
  );
  assert.match(markup, /active-raid-loading-pulse/);
  assert.equal((markup.match(/<span><\/span>/g) || []).length, 3);
});

test("loading banner progress updates reuse the same DOM for the same active target", () => {
  assert.equal(
    __shouldRebuildActiveRaidLoadingMarkupForTests({
      nextTarget: "Trials III (Extreme)::enuo",
      nextLabel: "Enuo",
      nextKind: "boss",
      currentTarget: "Trials III (Extreme)::enuo",
      currentLabel: "Enuo",
      currentKind: "boss",
      isVisible: true,
    }),
    false
  );
});

test("loading banner rebuilds when switching to a different boss or raid target", () => {
  assert.equal(
    __shouldRebuildActiveRaidLoadingMarkupForTests({
      nextTarget: "Trials III (Extreme)::doomtrain",
      nextLabel: "Doomtrain",
      nextKind: "boss",
      currentTarget: "Trials III (Extreme)::enuo",
      currentLabel: "Enuo",
      currentKind: "boss",
      isVisible: true,
    }),
    true
  );

  assert.equal(
    __shouldRebuildActiveRaidLoadingMarkupForTests({
      nextTarget: "AAC Heavyweight",
      nextLabel: "AAC Heavyweight",
      nextKind: "raid",
      currentTarget: "Trials III (Extreme)::enuo",
      currentLabel: "Enuo",
      currentKind: "boss",
      isVisible: true,
    }),
    true
  );
});
