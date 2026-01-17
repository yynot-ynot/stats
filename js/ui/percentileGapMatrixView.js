import { VALID_PERCENTILES } from "../logic/percentileGapMatrix.js";

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
const TOOLTIP_OFFSET = { x: 18, y: 20 };
const POSITIVE_GRADIENT = VIRIDIS_COLORS;
const ZERO_COLOR = VIRIDIS_COLORS[0];

let tooltipElement = null;

/**
 * Render the Percentile Gap Matrix grid inside the provided container.
 * When no data is available, the container displays a concise empty-state message.
 * @param {Object} params
 * @param {HTMLElement} params.container - Target section for the matrices.
 * @param {Object} params.matrixData - Payload emitted by buildPercentileGapMatrixData.
 * @param {string} params.valueLabel - Human-readable metric label (e.g., "rDPS").
 */
export function renderPercentileGapMatrixView({
  container,
  matrixData,
  valueLabel = "Output",
}) {
  if (!container) return;
  container.innerHTML = "";

  const hasData =
    matrixData &&
    Array.isArray(matrixData.categories) &&
    matrixData.categories.some(
      (category) => Array.isArray(category.tiles) && category.tiles.length > 0,
    );

  if (!hasData) {
    container.classList.add("view-hidden");
    const empty = document.createElement("div");
    empty.className = "percentile-gap-matrix-empty";
    empty.textContent =
      "Select at least one job and date to view percentile gap matrices.";
    container.appendChild(empty);
    return;
  }

  container.classList.remove("view-hidden");
  const header = document.createElement("div");
  header.className = "percentile-gap-matrix-header";
  header.innerHTML = `
    <h3>Percentile Gap Matrices</h3>
    <p>${valueLabel} Percentile-to-Percentile Differences</p>
  `;

  const palette = getPaletteConfig(matrixData.colorScale);
  const legend = buildLegend(palette);
  container.appendChild(header);
  container.appendChild(legend);

  matrixData.categories.forEach((category) => {
    if (!category.tiles || category.tiles.length === 0) return;
    const categorySection = buildCategorySection(category, palette, valueLabel);
    container.appendChild(categorySection);
  });
}

function buildLegend(palette) {
  const legend = document.createElement("div");
  legend.className = "percentile-gap-matrix-legend";
  const bar = document.createElement("div");
  bar.className = "percentile-gap-matrix-legend-bar";
  const labels = document.createElement("div");
  labels.className = "percentile-gap-matrix-legend-labels";
  const minLabel = document.createElement("span");
  const zeroLabel = document.createElement("span");
  const maxLabel = document.createElement("span");
  bar.style.background = buildGradientCss(palette.colors);
  const { startLabel, midLabel, endLabel } = buildLegendLabels(palette);
  minLabel.textContent = startLabel;
  zeroLabel.textContent = midLabel;
  maxLabel.textContent = endLabel;
  labels.append(minLabel, zeroLabel, maxLabel);
  legend.append(bar, labels);
  return legend;
}

function buildCategorySection(category, palette, valueLabel) {
  const section = document.createElement("section");
  section.className = "gap-matrix-category";
  const heading = document.createElement("h4");
  heading.textContent = category.name;
  section.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "gap-matrix-category-grid";
  (category.tiles || []).forEach((matrix) => {
    const card = buildMatrixCard(matrix, palette, valueLabel);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  return section;
}

function buildMatrixCard(matrix, palette, valueLabel) {
  const card = document.createElement("article");
  card.className = "gap-matrix-card";
  const header = document.createElement("div");
  header.className = "gap-matrix-card-header";
  const jobSpan = document.createElement("span");
  jobSpan.className = "gap-matrix-job";
  jobSpan.textContent = matrix.jobName;
  const dateSpan = document.createElement("span");
  dateSpan.className = "gap-matrix-date";
  dateSpan.textContent = formatDate(matrix.snapshotDate);
  header.append(jobSpan, dateSpan);

  card.appendChild(header);
  if (!matrix.hasAnyValue) {
    const empty = document.createElement("div");
    empty.className = "gap-matrix-card-empty";
    empty.textContent = "No data for this snapshot.";
    card.appendChild(empty);
    return card;
  }

  const grid = document.createElement("div");
  grid.className = "gap-matrix-triangle";
  grid.style.setProperty("--matrix-size", String(VALID_PERCENTILES.length));

  for (let rowIdx = 0; rowIdx < VALID_PERCENTILES.length; rowIdx += 1) {
    for (let colIdx = 0; colIdx < VALID_PERCENTILES.length; colIdx += 1) {
      const cell = document.createElement("div");
      cell.className = "gap-matrix-cell";
      if (colIdx <= rowIdx) {
        cell.classList.add("gap-matrix-cell--disabled");
        grid.appendChild(cell);
        continue;
      }
      const cellData = matrix.cellMap.get(`${rowIdx}-${colIdx}`);
      if (!cellData || cellData.isMissing) {
        cell.classList.add("gap-matrix-cell--missing");
      } else {
        cell.style.background = getCellColor(cellData.rawDifference, palette);
        cell.setAttribute(
          "data-delta",
          cellData.rawDifference != null ? String(cellData.rawDifference) : "",
        );
      }
      attachTooltipHandlers(cell, cellData, valueLabel);
      grid.appendChild(cell);
    }
  }

  card.appendChild(grid);
  return card;
}

function attachTooltipHandlers(cell, cellData, valueLabel) {
  if (!cellData) return;
  ensureTooltipElement();
  const content = buildTooltipContent(cellData, valueLabel);
  cell.addEventListener("mouseenter", (event) => {
    showTooltip(event, content);
  });
  cell.addEventListener("mousemove", (event) => {
    moveTooltip(event);
  });
  cell.addEventListener("mouseleave", hideTooltip);
}

function buildTooltipContent(cellData, valueLabel) {
  if (cellData.isMissing) {
    return `<strong>Missing Percentiles</strong><br>Data unavailable for P${cellData.lowerPercentile} → P${cellData.upperPercentile}.`;
  }
  const lowerValue = formatValue(cellData.lowerValue);
  const upperValue = formatValue(cellData.upperValue);
  const diff = formatValue(cellData.rawDifference);
  const percent =
    typeof cellData.percentDifference === "number"
      ? `${cellData.percentDifference.toFixed(1)}%`
      : "n/a";
  return `
    <strong>P${cellData.lowerPercentile} → P${
      cellData.upperPercentile
    }</strong><br>
    ${valueLabel} ${cellData.lowerPercentile}: ${lowerValue}<br>
    ${valueLabel} ${cellData.upperPercentile}: ${upperValue}<br>
    Difference: ${diff}<br>
    Percent change: ${percent}<br>
    Snapshot: ${formatDate(cellData.snapshotDate)}
  `;
}

function ensureTooltipElement() {
  if (tooltipElement || typeof document === "undefined") return;
  tooltipElement = document.createElement("div");
  tooltipElement.className = "gap-matrix-tooltip";
  document.body.appendChild(tooltipElement);
}

function showTooltip(event, content) {
  if (!tooltipElement) return;
  tooltipElement.innerHTML = content;
  tooltipElement.classList.add("visible");
  moveTooltip(event);
}

function moveTooltip(event) {
  if (!tooltipElement) return;
  const x = (event.clientX || 0) + TOOLTIP_OFFSET.x;
  const y = (event.clientY || 0) + TOOLTIP_OFFSET.y;
  tooltipElement.style.left = `${x}px`;
  tooltipElement.style.top = `${y}px`;
}

function hideTooltip() {
  if (!tooltipElement) return;
  tooltipElement.classList.remove("visible");
}

function getCellColor(value, palette) {
  if (typeof value !== "number" || !palette) {
    return "rgba(255,255,255,0.05)";
  }
  const clampMin =
    typeof palette.domainMin === "number" ? palette.domainMin : 0;
  const clampMax =
    typeof palette.domainMax === "number" ? palette.domainMax : 1;
  const clampedValue = Math.max(Math.min(value, clampMax), clampMin);
  const range = clampMax - clampMin || 1;
  const normalized = (clampedValue - clampMin) / range;
  return toCssColor(sampleGradient(palette.colors, normalized));
}

function mixColors(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function toCssColor(rgbArray) {
  return `rgb(${rgbArray[0]}, ${rgbArray[1]}, ${rgbArray[2]})`;
}

/**
 * Sample a multi-stop gradient by splitting the 0–1 range into equal segments and
 * interpolating within the segment that contains t.
 * @param {Array<number[]>} colors
 * @param {number} t
 * @returns {number[]}
 */
function sampleGradient(colors, t) {
  if (!Array.isArray(colors) || colors.length === 0) {
    return ZERO_COLOR;
  }
  const clampedT = Math.max(0, Math.min(1, t));
  if (colors.length === 1) return colors[0];
  const segments = colors.length - 1;
  const rawIndex = clampedT * segments;
  const segmentIndex = Math.min(Math.floor(rawIndex), segments - 1);
  const segmentStart = segmentIndex / segments;
  const segmentEnd = (segmentIndex + 1) / segments;
  const localT =
    segmentEnd - segmentStart === 0
      ? 0
      : (clampedT - segmentStart) / (segmentEnd - segmentStart);
  return mixColors(colors[segmentIndex], colors[segmentIndex + 1], localT);
}

/**
 * Determine which palette to use (diverging vs. sequential) based on the aggregated range.
 * @param {{domainMin?: number, domainMax?: number}} scale
 * @returns {{type: string, colors: Array<number[]>}}
 */
function getPaletteConfig(scale = {}) {
  const anchoredMin = 0;
  const anchoredMax =
    typeof scale.domainMax === "number" && scale.domainMax > 0
      ? scale.domainMax
      : 1;
  return {
    type: "sequential-positive",
    colors: POSITIVE_GRADIENT,
    domainMin: anchoredMin,
    domainMax: anchoredMax,
  };
}

/**
 * Build a CSS linear-gradient string from the provided color stops.
 * @param {Array<number[]>} colors
 * @returns {string}
 */
function buildGradientCss(colors) {
  if (!Array.isArray(colors) || colors.length === 0) {
    return "";
  }
  if (colors.length === 1) {
    return toCssColor(colors[0]);
  }
  const denominator = colors.length - 1 || 1;
  const stops = colors.map((color, index) => {
    const percent = (index / denominator) * 100;
    return `${toCssColor(color)} ${percent}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * Produce friendly min/mid/max labels for the legend depending on palette type.
 * @param {{domainMin?: number, domainMax?: number}} scale
 * @param {string} paletteType
 * @returns {{startLabel: string, midLabel: string, endLabel: string}}
 */
function buildLegendLabels(palette = {}) {
  const min = typeof palette.domainMin === "number" ? palette.domainMin : 0;
  const max = typeof palette.domainMax === "number" ? palette.domainMax : 0;
  const midpoint = min + (max - min) / 2;
  return {
    startLabel: formatDiffLabel(min),
    midLabel: formatDiffLabel(midpoint),
    endLabel: formatDiffLabel(max),
  };
}

function formatValue(value) {
  if (typeof value !== "number") return "n/a";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatDate(compact) {
  if (!compact || compact.length !== 8) return compact || "n/a";
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function formatDiffLabel(value) {
  if (typeof value !== "number") return "n/a";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
