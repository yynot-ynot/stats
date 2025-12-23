import test from "node:test";
import assert from "node:assert/strict";

import { toggleTrendViewVisibility } from "../js/logic/dataDisplayManager.js";

function createElementWithClassList(initialClasses = []) {
  const classes = new Set(initialClasses);
  return {
    style: {},
    classList: {
      add(cls) {
        classes.add(cls);
      },
      remove(cls) {
        classes.delete(cls);
      },
      contains(cls) {
        return classes.has(cls);
      },
    },
  };
}

/**
 * Ensures the trend prompt remains visible and all slider/chart sections stay hidden while no jobs are selected.
 */
test("toggleTrendViewVisibility hides trend sections until jobs exist", () => {
  const placeholder = { style: {}, textContent: "" };
  const slider = createElementWithClassList();
  const dps = createElementWithClassList();
  const hps = createElementWithClassList();
  const reference = createElementWithClassList();
  const comparison = createElementWithClassList();
  const dpsComp = createElementWithClassList();
  const hpsComp = createElementWithClassList();
  const comparisonMsg = createElementWithClassList();

  const originalDocument = global.document;
  global.document = {
    getElementById(id) {
      switch (id) {
        case "trend-view-placeholder":
          return placeholder;
        case "percentile-slider-container":
          return slider;
        case "dps-plot-container":
          return dps;
        case "healing-plot-container":
          return hps;
        case "reference-percentile-container":
          return reference;
        case "comparison-slider-container":
          return comparison;
        case "dps-comparison-plot-container":
          return dpsComp;
        case "healing-comparison-plot-container":
          return hpsComp;
        case "comparison-message":
          return comparisonMsg;
        default:
          return null;
      }
    },
  };

  try {
    toggleTrendViewVisibility(false);
    assert.equal(placeholder.style.display, "");
    assert.ok(slider.classList.contains("view-hidden"));
    assert.ok(dps.classList.contains("view-hidden"));
    assert.ok(hps.classList.contains("view-hidden"));
    assert.ok(reference.classList.contains("view-hidden"));
    assert.ok(comparison.classList.contains("view-hidden"));
    assert.ok(dpsComp.classList.contains("view-hidden"));
    assert.ok(hpsComp.classList.contains("view-hidden"));
    assert.ok(comparisonMsg.classList.contains("view-hidden"));
  } finally {
    global.document = originalDocument;
  }
});

/**
 * Verifies that once a job selection exists, the trend prompt hides and all slider/chart sections become visible.
 */
test("toggleTrendViewVisibility reveals trend sections after job selection", () => {
  const placeholder = { style: {}, textContent: "" };
  const slider = createElementWithClassList(["view-hidden"]);
  const dps = createElementWithClassList(["view-hidden"]);
  const hps = createElementWithClassList(["view-hidden"]);
  const reference = createElementWithClassList(["view-hidden"]);
  const comparison = createElementWithClassList(["view-hidden"]);
  const dpsComp = createElementWithClassList(["view-hidden"]);
  const hpsComp = createElementWithClassList(["view-hidden"]);
  const comparisonMsg = createElementWithClassList(["view-hidden"]);

  const originalDocument = global.document;
  global.document = {
    getElementById(id) {
      switch (id) {
        case "trend-view-placeholder":
          return placeholder;
        case "percentile-slider-container":
          return slider;
        case "dps-plot-container":
          return dps;
        case "healing-plot-container":
          return hps;
        case "reference-percentile-container":
          return reference;
        case "comparison-slider-container":
          return comparison;
        case "dps-comparison-plot-container":
          return dpsComp;
        case "healing-comparison-plot-container":
          return hpsComp;
        case "comparison-message":
          return comparisonMsg;
        default:
          return null;
      }
    },
  };

  try {
    toggleTrendViewVisibility(true);
    assert.equal(placeholder.style.display, "none");
    assert.ok(!slider.classList.contains("view-hidden"));
    assert.ok(!dps.classList.contains("view-hidden"));
    assert.ok(!hps.classList.contains("view-hidden"));
    assert.ok(!reference.classList.contains("view-hidden"));
    assert.ok(!comparison.classList.contains("view-hidden"));
    assert.ok(!dpsComp.classList.contains("view-hidden"));
    assert.ok(!hpsComp.classList.contains("view-hidden"));
    assert.ok(!comparisonMsg.classList.contains("view-hidden"));
  } finally {
    global.document = originalDocument;
  }
});
