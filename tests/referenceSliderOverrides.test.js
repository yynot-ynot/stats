import test from "node:test";
import assert from "node:assert/strict";

import { __referenceSliderOverrides } from "../js/ui/percentileSliderControls.js";

const {
  formatReferenceSliderLabel,
  transformReferenceSliderPositions,
} = __referenceSliderOverrides;

test(
  "reference slider label formatter surfaces the Min/Max copy promised in the plan",
  () => {
    assert.equal(formatReferenceSliderLabel(0), "Min");
    assert.equal(formatReferenceSliderLabel(100), "Max");
    assert.equal(formatReferenceSliderLabel(75), "75");
  }
);

test(
  "reference slider position transformer stretches spacing as if the max were 110",
  () => {
    const percentiles = [0, 50, 100];
    const basePositions = { 0: 0, 50: 50, 100: 100 };
    const transformed = transformReferenceSliderPositions(
      basePositions,
      percentiles
    );

    // Original map remains untouched so other sliders keep the vanilla proportional spacing.
    assert.equal(basePositions[50], 50);

    // Values are scaled using a 0–110 visual range, so 50 and 100 both shift.
    assert.equal(transformed[0], 0);
    const expectedMidpoint = (50 / 110) * 100;
    assert.ok(
      Math.abs(transformed[50] - expectedMidpoint) < 1e-9,
      "50th percentile should compress according to the 0–110 visual range"
    );
    assert.equal(transformed[100], 100);
  }
);
