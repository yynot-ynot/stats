import test from "node:test";
import assert from "node:assert/strict";

import { setupPercentileDateSlider } from "../js/ui/percentileDateSlider.js";
import { filterState } from "../js/shared/filterState.js";

const SLIDER_SELECTOR = "[data-role='percentile-date-slider']";
const MAX_TOGGLE_SELECTOR = "[data-role='percentile-max-toggle-standalone']";

/**
 * Fabricate a slider container for DOM-less tests.
 * @param {string} id
 * @param {{ hideToggle?: boolean }} [options]
 */
function createMockContainer(id, { hideToggle = false } = {}) {
  const slider = {
    value: "0",
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  };
  const label = { textContent: "" };
  const toggleButton = {
    attributes: {},
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const container = {
    id,
    dataset: hideToggle ? { hideMaxToggle: "true" } : {},
    innerHTML: "",
    querySelector(selector) {
      if (selector === "[data-role='percentile-date-input']") return slider;
      if (selector === "[data-role='percentile-date-display']") return label;
      if (selector === "[data-role='percentile-max-toggle']") {
        return hideToggle ? null : toggleButton;
      }
      return null;
    },
  };
  return { container, slider, label, toggleButton };
}

function createDocumentStub(containers, toggleButtons = []) {
  return {
    querySelectorAll(selector) {
      if (selector === SLIDER_SELECTOR) {
        return containers.map((entry) => entry.container);
      }
      if (selector === MAX_TOGGLE_SELECTOR) {
        return toggleButtons;
      }
      return [];
    },
  };
}

function createStandaloneToggleButton() {
  return {
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  };
}

/**
 * Verifies the percentile slider resets to the latest available date whenever a new raid/boss/job
 * combination changes the date catalog, ensuring the default date is always valid.
 * Plan:
 * 1. Mount a single slider container.
 * 2. Initialize with two dates then reinitialize with a new single date.
 * 3. Assert the selectedPercentileDate filter matches the most recent entry each time.
 */
test("setupPercentileDateSlider selects latest date when available dates change", () => {
  const primary = createMockContainer("percentile-date-slider-container", {
    hideToggle: true,
  });
  const originalDocument = global.document;
  global.document = createDocumentStub([primary]);

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

/**
 * Ensures the pinned percentile date slider (now the sole slider) updates the filter state and label.
 * Plan:
 * 1. Mount a single container.
 * 2. Initialize with two dates.
 * 3. Simulate user drag to the earliest date and assert the filter + display update.
 */
test("pinned percentile date slider updates filter state and label", () => {
  const primary = createMockContainer("percentile-date-slider-container", {
    hideToggle: true,
  });
  const originalDocument = global.document;
  global.document = createDocumentStub([primary]);

  const originalDate = filterState.selectedPercentileDate;
  try {
    filterState.selectedPercentileDate = "";
    setupPercentileDateSlider(["20240101", "20240105"]);

    // Simulate sliding to the earliest date.
    primary.slider.value = "0";
    primary.slider.listeners.input();

    assert.equal(filterState.selectedPercentileDate, "20240101");
    assert.equal(primary.label.textContent, "1/1");
  } finally {
    filterState.selectedPercentileDate = originalDate;
    global.document = originalDocument;
  }
});

/**
 * Ensures the pinned slider surfaces the Max Percentile toggle so users can show/hide 0/100.
 * Plan:
 * 1. Mount the sidebar slider container.
 * 2. Initialize the slider.
 * 3. Assert the toggle button exists, reflects the filter state, and triggers filter updates on click.
 */
test("standalone max-percentile toggle stays in sync with filter state", () => {
  const sliderEntry = createMockContainer("percentile-date-slider-container", {
    hideToggle: true,
  });
  const standaloneToggle = createStandaloneToggleButton();
  const originalDocument = global.document;
  global.document = createDocumentStub([sliderEntry], [standaloneToggle]);

  const originalDate = filterState.selectedPercentileDate;
  const originalToggle = filterState.showMaxPercentile;
  try {
    filterState.selectedPercentileDate = "";
    filterState.showMaxPercentile = false;
    setupPercentileDateSlider(["20240101"]);
    assert.equal(standaloneToggle.attributes["aria-pressed"], "false");
    const clickHandler = standaloneToggle.listeners.click;
    assert.ok(clickHandler, "toggle should register a click handler");
    clickHandler();
    assert.equal(filterState.showMaxPercentile, true);
  } finally {
    filterState.selectedPercentileDate = originalDate;
    filterState.showMaxPercentile = originalToggle;
    global.document = originalDocument;
  }
});
