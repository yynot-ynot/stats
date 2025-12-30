import test from "node:test";
import assert from "node:assert/strict";

import {
  setupReferencePercentileSlider,
  setupComparisonPercentileSlider,
  __referenceSliderOverrides,
} from "../js/ui/percentileSliderControls.js";
import { filterState } from "../js/shared/filterState.js";

const { transformReferenceSliderPositions } = __referenceSliderOverrides;

test("comparison labels rename 0/100 to Min/Max like the reference slider", () => {
  const percentiles = new Set(["0", "25", "50", "75", "100"]);
  const { comparisonRow, cleanup } = renderSliders(percentiles);
  try {
    const labels = comparisonRow.children;
    assert.ok(labels.length > 0, "comparison label row should render labels");

    const firstLabel = labels[0];
    const lastLabel = labels[labels.length - 1];
    assert.equal(
      firstLabel.textContent,
      "Min",
      "Left-most comparison label should rename 0 to 'Min'"
    );
    assert.equal(
      lastLabel.textContent,
      "Max",
      "Right-most comparison label should rename 100 to 'Max'"
    );
  } finally {
    cleanup();
  }
});

test("comparison label positions stay aligned with reference slider ticks", () => {
  const percentiles = new Set(["0", "25", "50", "75", "100"]);
  const { comparisonRow, cleanup } = renderSliders(percentiles);
  try {
    const sortedPercentiles = Array.from(percentiles)
      .map(Number)
      .sort((a, b) => a - b);
    const basePositions = Object.fromEntries(
      sortedPercentiles.map((value) => [value, value])
    );
    const expectedPositions = transformReferenceSliderPositions(
      basePositions,
      sortedPercentiles
    );

    const comparisonPercents = comparisonRow.children.map((child) =>
      extractPercent(child.style.left)
    );
    const expectedPercents = sortedPercentiles.map(
      (value) => expectedPositions[value]
    );

    assert.deepEqual(
      comparisonPercents,
      expectedPercents,
      "Each comparison label should share the same proportional spacing as the reference slider"
    );
  } finally {
    cleanup();
  }
});

test("comparison slider toggles Min/Max selections in filter state", () => {
  const percentiles = new Set(["0", "50", "100"]);
  const restoreFilter = stashComparisonFilter();
  const { comparisonRow, cleanup } = renderSliders(percentiles);
  try {
    const getLabel = (idx) => comparisonRow.children[idx];

    getLabel(0).click();
    assert.ok(
      filterState.selectedComparisonPercentiles.has(0),
      "Clicking the Min label should add percentile 0 to the selected comparison set"
    );
    assert.ok(
      getLabel(0).classList.contains("selected"),
      "Min label should visually reflect selection after click"
    );

    getLabel(comparisonRow.children.length - 1).click();
    assert.ok(
      filterState.selectedComparisonPercentiles.has(100),
      "Clicking the Max label should add percentile 100 to the selected comparison set"
    );
    assert.ok(
      getLabel(comparisonRow.children.length - 1).classList.contains("selected"),
      "Max label should visually reflect selection after click"
    );
  } finally {
    cleanup();
    restoreFilter();
  }
});

function renderSliders(percentiles) {
  const referenceDom = createReferenceSliderDom();
  const comparisonDom = createComparisonSliderDom();
  const nodes = {
    "reference-percentile-container": referenceDom.container,
    "comparison-slider-container": comparisonDom.container,
  };
  const restoreDocument = installMockDocument(nodes);
  setupReferencePercentileSlider(percentiles);
  setupComparisonPercentileSlider(percentiles);
  return {
    comparisonRow: comparisonDom.labelRow,
    cleanup: () => {
      restoreDocument();
    },
  };
}

function installMockDocument(nodes) {
  const originalDocument = global.document;
  global.document = {
    getElementById(id) {
      return nodes[id] || null;
    },
    createElement(tag) {
      return createElement(tag);
    },
  };
  return () => {
    global.document = originalDocument;
  };
}

function createReferenceSliderDom() {
  const slider = createRangeInput();
  const overlay = createOverlay();
  const thumb = createThumb();
  const container = {
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(val) {
      this._innerHTML = val;
    },
    querySelector(selector) {
      if (selector === "#reference-percentile-slider") return slider;
      if (selector === ".slider-tick-overlay") return overlay;
      if (selector === ".slider-thumb-custom") return thumb;
      return null;
    },
  };
  return { container, overlay };
}

function createComparisonSliderDom() {
  const labelRow = createLabelRow();
  const container = {
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(val) {
      this._innerHTML = val;
    },
    querySelector(selector) {
      if (selector === ".comparison-label-row") return labelRow;
      return null;
    },
  };
  return { container, labelRow };
}

function createLabelRow() {
  const row = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
  Object.defineProperty(row, "innerHTML", {
    get() {
      return "";
    },
    set() {
      this.children = [];
    },
  });
  return row;
}

function createRangeInput() {
  const row = createSliderRow();
  return {
    min: "0",
    max: "100",
    step: "1",
    value: "0",
    addEventListener() {},
    dispatchEvent() {},
    closest() {
      return row;
    },
  };
}

function createSliderRow() {
  return {
    classList: {
      add() {},
      remove() {},
    },
    addEventListener() {},
    getBoundingClientRect() {
      return { left: 0, width: 100 };
    },
  };
}

function createOverlay() {
  const overlay = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    querySelectorAll(selector) {
      if (selector === ".slider-tick") {
        return this.children.filter((child) =>
          child.className.includes("slider-tick")
        );
      }
      if (selector === ".slider-tick-label") {
        return this.children.filter((child) =>
          child.className.includes("slider-tick-label")
        );
      }
      return [];
    },
  };
  Object.defineProperty(overlay, "innerHTML", {
    get() {
      return "";
    },
    set() {
      this.children = [];
    },
  });
  return overlay;
}

function createThumb() {
  return {
    style: { left: "" },
  };
}

function createElement(tag) {
  const element = {
    tagName: tag,
    className: "",
    style: {},
    textContent: "",
    children: [],
  };
  const listeners = {};
  element.addEventListener = (type, handler) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(handler);
  };
  element.removeEventListener = (type, handler) => {
    listeners[type] = (listeners[type] || []).filter((fn) => fn !== handler);
  };
  element.dispatchEvent = (evt) => {
    const type = typeof evt === "string" ? evt : evt?.type;
    (listeners[type] || []).forEach((handler) => handler(evt));
  };
  element.click = () => {
    element.dispatchEvent({ type: "click" });
  };
  element.appendChild = (child) => {
    element.children.push(child);
  };
  element.classList = createClassList(element);
  return element;
}

function createClassList(target) {
  const classes = new Set();
  return {
    add(cls) {
      classes.add(cls);
      target.className = Array.from(classes).join(" ");
    },
    remove(cls) {
      classes.delete(cls);
      target.className = Array.from(classes).join(" ");
    },
    toggle(cls, force) {
      if (force === true) {
        classes.add(cls);
      } else if (force === false) {
        classes.delete(cls);
      } else if (classes.has(cls)) {
        classes.delete(cls);
      } else {
        classes.add(cls);
      }
      target.className = Array.from(classes).join(" ");
    },
    contains(cls) {
      return classes.has(cls);
    },
  };
}

function extractPercent(styleLeft) {
  const match = /([\d.]+)%/.exec(styleLeft || "");
  return match ? Number(match[1]) : NaN;
}

function stashComparisonFilter() {
  const previous = filterState.selectedComparisonPercentiles;
  filterState.selectedComparisonPercentiles = new Set(previous);
  return () => {
    filterState.selectedComparisonPercentiles = previous;
  };
}
