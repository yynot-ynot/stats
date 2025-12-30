import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getWeekStartAnchor,
  __setWeekStartAnchorsForTests,
  __resetWeekStartAnchorsForTests,
} from "../js/shared/weekStartConfig.js";

afterEach(() => {
  __resetWeekStartAnchorsForTests();
});

/**
 * Boss-level overrides should always win so trials with unique timelines can diverge
 * from the raid-wide anchor. This test ensures the helper resolves the more specific key.
 */
test("getWeekStartAnchor prefers boss-specific overrides when present", () => {
  __setWeekStartAnchorsForTests({
    "Raid Prime": "2025-01-01",
    "Raid Prime::Final Boss": "2025-01-15",
  });
  const result = getWeekStartAnchor({
    raid: "Raid Prime",
    boss: "Final Boss",
  });
  assert.ok(result, "expected to resolve boss-specific override");
  assert.equal(result.iso, "2025-01-15");
  assert.equal(result.compact, "20250115");
});

/**
 * When no boss-specific entry exists we still want a stable week-one definition,
 * so the helper must return the raid-level date instead of null.
 */
test("getWeekStartAnchor falls back to raid-level override when boss entry is missing", () => {
  __setWeekStartAnchorsForTests({
    "Raid Prime": "2025-01-01",
  });
  const result = getWeekStartAnchor({
    raid: "Raid Prime",
    boss: "Any Boss",
  });
  assert.ok(result, "expected to resolve raid-level date");
  assert.equal(result.iso, "2025-01-01");
});

/**
 * If neither the raid nor the boss has an entry we deliberately fall back to the auto-derived
 * week numbering, so the helper should signal that by returning null.
 */
test("getWeekStartAnchor returns null when no configured overrides match", () => {
  __setWeekStartAnchorsForTests({
    "Other Raid": "2025-02-02",
  });
  const result = getWeekStartAnchor({
    raid: "Missing Raid",
    boss: "Missing Boss",
  });
  assert.equal(result, null);
});

/**
 * Defensive guard: malformed ISO strings in config should be ignored so we don't crash or mislabel
 * charts after a bad commit. This verifies the helper emits null for invalid entries.
 */
test("invalid ISO dates are ignored so the caller falls back to derived behavior", () => {
  __setWeekStartAnchorsForTests({
    "Raid Prime": "not-a-date",
  });
  const result = getWeekStartAnchor({
    raid: "Raid Prime",
    boss: "Final Boss",
  });
  assert.equal(result, null);
});
