import test from "node:test";
import assert from "node:assert/strict";

import { setupPercentileDateSlider } from "../js/ui/percentileDateSlider.js";
import { filterState } from "../js/shared/filterState.js";

function createMockSliderEnvironment() {
  const slider = {
    value: "0",
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  };
  const label = { textContent: "" };
  const container = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === "#percentile-date-slider") return slider;
      if (selector === ".percentile-date-display") return label;
      return null;
    },
  };
  return { slider, label, container };
}

/**
 * Verifies the percentile slider resets to the latest available date whenever a new raid/boss/job
 * combination changes the date catalog, ensuring the default date is always valid.
 */
test("setupPercentileDateSlider selects latest date when available dates change", () => {
  const { container } = createMockSliderEnvironment();
  const originalDocument = global.document;
  global.document = {
    getElementById(id) {
      if (id === "percentile-date-slider-container") return container;
      return null;
    },
  };

  const originalDate = filterState.selectedPercentileDate;
  try {
    filterState.selectedPercentileDate = "";
    setupPercentileDateSlider(["20240101", "20240108"]);
    assert.equal(filterState.selectedPercentileDate, "20240108");

    setupPercentileDateSlider(["20240202"]);
    assert.equal(filterState.selectedPercentileDate, "20240202");
  } finally {
    filterState.selectedPercentileDate = originalDate;
    global.document = originalDocument;
  }
});
