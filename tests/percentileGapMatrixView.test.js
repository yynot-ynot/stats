import test from "node:test";
import assert from "node:assert/strict";

import { renderPercentileGapMatrixView } from "../js/ui/percentileGapMatrixView.js";
import { VALID_PERCENTILES } from "../js/logic/percentileGapMatrix.js";

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.classList = {
      add: () => {},
      remove: () => {},
    };
    this._innerHTML = "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  querySelectorAll() {
    return [];
  }

  addEventListener() {}
}

function createMockDocument() {
  const body = new MockElement("body");
  return {
    createElement: (tag) => new MockElement(tag),
    body,
  };
}

function findChildByClass(node, className) {
  if (!node || !node.children) return null;
  for (const child of node.children) {
    if (child.className === className) return child;
    const nested = findChildByClass(child, className);
    if (nested) return nested;
  }
  return null;
}

/**
 * Verifies the legend renders the tuned Viridis gradient (beige → violet) so users see the same palette as the cells.
 * Plan:
 * 1. Render a stub matrix with a fake dataset.
 * 2. Locate the legend bar node.
 * 3. Assert the CSS gradient string contains both the beige and violet stops.
 */
test("renderPercentileGapMatrixView applies Viridis gradient in legend", () => {
  const originalDocument = global.document;
  global.document = createMockDocument();

  const container = new MockElement("section");
  const matrixData = {
    percentiles: VALID_PERCENTILES,
    colorScale: { domainMin: 0, domainMax: 500 },
    categories: [
      {
        name: "Tank",
        tiles: [
          {
            jobName: "Paladin",
            snapshotDate: "20240101",
            cellMap: new Map(),
            hasAnyValue: false,
          },
        ],
      },
    ],
  };

  try {
    renderPercentileGapMatrixView({
      container,
      matrixData,
      valueLabel: "rDPS",
    });
  } finally {
    global.document = originalDocument;
  }

  const legendBar = findChildByClass(
    container,
    "percentile-gap-matrix-legend-bar"
  );
  assert.ok(legendBar, "Legend bar should exist.");
  const gradient = legendBar.style.background || "";
  assert.ok(
    gradient.includes("rgb(242, 236, 221)") &&
      gradient.includes("rgb(68, 1, 84)"),
    "Legend should span the tuned Viridis gradient (beige to violet)."
  );
});

/**
 * Ensures zero, mid, and max deltas align with the Viridis beige/teal/violet stops even when colorScale emits negatives.
 * Plan:
 * 1. Feed the renderer a color scale of [-30, 30] to mimic the regression the UI showed in prod.
 * 2. Populate three cells at 0, 15, and 30 rDPS differences.
 * 3. Assert those cells render as beige, teal, and violet respectively.
 */
test("cells map 0, half, and max deltas to beige/teal/violet stops", () => {
  const originalDocument = global.document;
  global.document = createMockDocument();

  const cellData = [
    {
      key: "0-1",
      rawDifference: 0,
      percentDifference: 0,
    },
    {
      key: "0-2",
      rawDifference: 15,
      percentDifference: 50,
    },
    {
      key: "0-3",
      rawDifference: 30,
      percentDifference: 100,
    },
  ];
  const matrixData = {
    percentiles: VALID_PERCENTILES,
    colorScale: { domainMin: -30, domainMax: 30 },
    categories: [
      {
        name: "Tank",
        tiles: [
          {
            jobName: "Paladin",
            snapshotDate: "20240101",
            cellMap: new Map(
              cellData.map(({ key, rawDifference }) => [
                key,
                {
                  jobName: "Paladin",
                  snapshotDate: "20240101",
                  lowerPercentile: VALID_PERCENTILES[0],
                  upperPercentile: VALID_PERCENTILES[1],
                  lowerValue: 100,
                  upperValue: 100 + rawDifference,
                  rawDifference,
                  percentDifference: rawDifference,
                  isMissing: false,
                },
              ])
            ),
            hasAnyValue: true,
          },
        ],
      },
    ],
  };

  const container = new MockElement("section");
  try {
    renderPercentileGapMatrixView({
      container,
      matrixData,
      valueLabel: "rDPS",
    });
  } finally {
    global.document = originalDocument;
  }

  const zeroCell = findCellByDelta(container, 0);
  const midCell = findCellByDelta(container, 15);
  const maxCell = findCellByDelta(container, 30);
  assert.ok(zeroCell && midCell && maxCell, "Expected cells for each delta.");
  assert.ok(
    zeroCell.style.background.includes("rgb(242, 236, 221)"),
    "Zero-delta cells should use the beige Viridis stop."
  );
  const expectedMid = toCssColor(sampleViridisColor(0.5));
  assert.ok(
    midCell.style.background.includes(expectedMid),
    "Midpoint delta should render with the teal Viridis tone."
  );
  assert.ok(
    maxCell.style.background.includes("rgb(68, 1, 84)"),
    "Max delta should use the violet Viridis stop."
  );
});
const VIRIDIS_COLORS = [
  [242, 236, 221],
  [180, 222, 44],
  [109, 205, 89],
  [53, 183, 121],
  [31, 158, 137],
  [38, 130, 142],
  [49, 104, 142],
  [62, 74, 137],
  [72, 40, 120],
  [68, 1, 84],
];

function findCellByDelta(container, delta) {
  const queue = [...container.children];
  const target = String(delta);
  while (queue.length) {
    const node = queue.shift();
    if (!node) continue;
    if (
      typeof node.getAttribute === "function" &&
      node.getAttribute("data-delta") === target
    ) {
      return node;
    }
    if (node.children) queue.push(...node.children);
  }
  return null;
}

function toCssColor(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function sampleViridisColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const segments = VIRIDIS_COLORS.length - 1;
  const rawIndex = clamped * segments;
  const segmentIndex = Math.min(Math.floor(rawIndex), segments - 1);
  const segmentStart = segmentIndex / segments;
  const segmentEnd = (segmentIndex + 1) / segments;
  const localT =
    segmentEnd - segmentStart === 0
      ? 0
      : (clamped - segmentStart) / (segmentEnd - segmentStart);
  const start = VIRIDIS_COLORS[segmentIndex];
  const end = VIRIDIS_COLORS[segmentIndex + 1];
  return [
    Math.round(start[0] + (end[0] - start[0]) * localT),
    Math.round(start[1] + (end[1] - start[1]) * localT),
    Math.round(start[2] + (end[2] - start[2]) * localT),
  ];
}
