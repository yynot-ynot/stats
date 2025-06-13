import { parsePairedHealerClasses } from "./classSidebarManager.js";
import { CLASS_COLORS } from "../config/appConfig.js";
import {
  getDisplayLabelForClass,
  getAdjustedValueForClass,
} from "./valueDisplayUtils.js";
import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("chartRenderer");

/**
 * Helper to get ordinal suffix for a number (e.g., 1st, 2nd, 3rd, 4th, etc.)
 * @param {number} n
 * @returns {string}
 */
function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Format date string YYYYMMDD to YYYY-MM-DD
 * @param {string} compact - e.g. "20240605"
 * @returns {string}
 */
function toISODate(compact) {
  return (
    compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8)
  );
}

/**
 * Parse a compact date string (YYYYMMDD) into a Date object.
 * @param {string} dateStr - Date string in format 'YYYYMMDD'.
 * @returns {Date} JavaScript Date object.
 */
function parseCompactDate(dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);
  return new Date(year, month, day);
}

/**
 * Filter the dataset based on provided filter values.
 * Optionally expands any paired/composite class names in the classNames filter
 * (used for HPS; not for DPS). Non-paired classes are always included as-is.
 *
 * @param {Array<Object>} data - Full dataset.
 * @param {Object} filters - Filter criteria.
 * @param {boolean} [expandPairs=false] - Whether to expand paired/composite class names.
 * @returns {Array<Object>} Filtered dataset.
 */
function applyFilters(data, filters, expandPairs = false) {
  const { raid, boss, percentile, classNames, dps_type } = filters;
  const classNamesToUse = expandPairs
    ? expandSelectedClasses(classNames)
    : classNames;
  return data.filter((entry) => {
    return (
      (!raid || entry.raid === raid) &&
      (!boss || entry.boss === boss) &&
      (!percentile || entry.percentile === Number(percentile)) &&
      classNamesToUse.includes(entry.class) &&
      (!dps_type || entry.dps_type === dps_type)
    );
  });
}

/**
 * Group filtered data by class and extract date, year, and value.
 * @param {Array<Object>} filtered - Filtered dataset.
 * @returns {Object} Grouped data and set of all raw date strings.
 */
function groupDataByClass(filtered) {
  const grouped = {};
  const allDates = new Set();

  filtered.forEach((row) => {
    const dateObj = parseCompactDate(row.date);
    const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
    const year = dateObj.getFullYear();
    allDates.add(row.date);

    const key = row.class;
    const y = row.dps ?? row.hps;

    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      x: dateStr,
      year,
      y,
      rawDate: row.date,
      customdata: {
        class: row.class,
        percentile: row.percentile,
        parses: row.parses,
        dps_type: row.dps_type ?? null,
      },
    });
  });

  // 1. Build full range of dates using the helper
  const allDateArr = Array.from(allDates);
  const fullDates = getFullDateRange(allDateArr);

  // 2. Interpolate for each class (simple: carry last value forward)
  for (const key of Object.keys(grouped)) {
    const dataByDate = {};
    grouped[key].forEach((point) => (dataByDate[point.rawDate] = point));
    let lastY = null;
    let lastYear = null;
    grouped[key] = fullDates.map((date) => {
      if (dataByDate[date]) {
        lastY = dataByDate[date].y;
        lastYear = dataByDate[date].year;
        return dataByDate[date];
      } else {
        // You can interpolate here instead of carrying forward if you want
        return {
          x: `${parseInt(date.slice(4, 6))}/${parseInt(date.slice(6, 8))}`,
          year: lastYear,
          y: lastY, // or use null if you want gaps
          rawDate: date,
          customdata: {
            class: key,
            percentile: null,
            parses: null,
            dps_type: null,
          },
        };
      }
    });
  }

  // Replace allDates with fullDates for axis
  return { grouped, allDates: new Set(fullDates) };
}

/**
 * Prepare Plotly traces and log their details.
 * For DPS: composite (paired) healers have their values halved, and legend/tooltip shows "Avg.(PairName)".
 * For HPS: composite (paired) and individual healers are both shown as-is.
 * Non-paired (individual) jobs are always unaffected.
 *
 * @param {Object} grouped - Grouped data by class.
 * @param {boolean} isDPS - Whether the plot is DPS or Healing.
 * @returns {Array<Object>} Plotly traces.
 */
function prepareTraces(grouped, isDPS) {
  return Object.entries(grouped).map(([key, points]) => {
    const sortedPoints = points.sort(
      (a, b) => parseCompactDate(a.rawDate) - parseCompactDate(b.rawDate)
    );

    // For DPS: use adjusted value (halved for composite), and label as "Avg.(PairName)"
    // For HPS: plot as-is, both composite and individual lines
    const traceX = sortedPoints.map((p) => p.x);
    const traceY = isDPS
      ? sortedPoints.map((p) => getAdjustedValueForClass(key, p.y))
      : sortedPoints.map((p) => p.y);
    const traceCustom = sortedPoints.map((p) => [
      p.customdata.class, // original class (composite or single)
      p.customdata.parses,
      p.customdata.percentile,
      p.customdata.dps_type,
      p.y, // raw value
      isDPS ? getAdjustedValueForClass(key, p.y) : p.y, // adjusted value for DPS (halved if composite)
      getDisplayLabelForClass(key), // legend/label
    ]);

    logger.debug(`Trace for class ${key}:`);
    traceX.forEach((xVal, i) => {
      logger.debug(
        `  Data point ${i + 1}: x=${xVal}, y=${
          traceY[i]
        }, tooltip=${JSON.stringify(traceCustom[i])}`
      );
    });

    const trace = {
      type: "scatter",
      mode: "lines+markers",
      name: getDisplayLabelForClass(key),
      x: traceX,
      y: traceY,
      customdata: traceCustom,
      hovertemplate: isDPS
        ? `
          Job: %{customdata[6]}<br>
          Parses: %{customdata[1]}<br>
          Percentile: %{customdata[2]}<br>
          DPS: %{customdata[5]} (%{customdata[3]})
          <extra></extra>
        `
        : `
          Job: %{customdata[0]}<br>
          Parses: %{customdata[1]}<br>
          Percentile: %{customdata[2]}<br>
          HPS: %{customdata[4]}
          <extra></extra>
        `,
    };
    const color = getClassColor(key);
    trace.line = { color };
    trace.marker = { color };
    return trace;
  });
}

/**
 * Generate year annotation positions for the chart.
 * For single-year data, the year is centered under the full axis, close to the "Date" axis label.
 * For multi-year data, each year label is positioned below its date range or first occurrence,
 * but shifted down so as NOT to overlap tick labels—appearing just beneath the axis label.
 *
 * @param {Array<string>} sortedDates - Chronologically sorted compact date strings (e.g., "20250401").
 * @param {Array<string>} sortedDateLabels - Corresponding "M/D" formatted labels (e.g., "4/1").
 * @returns {Array<Object>} Plotly annotation objects to display below the x-axis.
 */
function generateYearAnnotations(sortedDates, sortedDateLabels) {
  const yearToIndices = {};

  // Build a mapping from year → list of indices where that year occurs
  sortedDates.forEach((d, i) => {
    const year = parseCompactDate(d).getFullYear();
    if (!yearToIndices[year]) {
      yearToIndices[year] = [];
    }
    yearToIndices[year].push(i);
  });

  const totalYears = Object.keys(yearToIndices).length;

  // Set y position lower, so the annotation appears below axis tick labels, but closer to the "Date" axis label.
  // Experimentally, -0.15 aligns better with axis labels without overlapping tick labels.
  const yearAnnotationY = -0.15;

  if (totalYears === 1) {
    // Single-year: align the year label to the center of the full axis, close to the "Date" axis label
    return [
      {
        xref: "paper",
        yref: "paper",
        x: 0.5,
        y: yearAnnotationY,
        text: `<b>${Object.keys(yearToIndices)[0]}</b>`,
        showarrow: false,
        font: { size: 14 },
      },
    ];
  }

  // Multi-year: place each year label below its date range or first occurrence, close to axis label
  return Object.entries(yearToIndices).map(([year, indices], idx) => {
    let posIndex;
    if (idx === 0) {
      // First year: center under its full date range
      const mid = Math.floor((indices[0] + indices[indices.length - 1]) / 2);
      posIndex = mid;
    } else {
      // Subsequent years: place under first occurrence
      posIndex = indices[0];
    }

    return {
      xref: "x",
      yref: "paper",
      x: sortedDateLabels[posIndex],
      y: yearAnnotationY,
      text: `<b>${year}</b>`,
      showarrow: false,
      font: { size: 14 },
    };
  });
}

/**
 * Main function to render the filtered line chart.
 * Handles DPS and HPS requirements for paired healers.
 * - For HPS: plots both individual and paired lines if selected.
 * - For DPS: plots the paired line with DPS halved, using "Avg.(PairName)" as label, individuals unaffected.
 *
 * @param {Array<Object>} data - Full dataset.
 * @param {Object} filters - Filter criteria.
 * @param {HTMLElement} container - DOM element for the chart.
 * @param {string} [titleSuffix=""] - Optional title suffix (e.g., "DPS", "Healing").
 */
export function renderFilteredLineChart(
  data,
  filters,
  container,
  titleSuffix = ""
) {
  let filtered;
  const isDPS = titleSuffix.toLowerCase().includes("dps");

  if (isDPS) {
    // For DPS: Only use the selected class names as-is (including pairs)
    filtered = applyFilters(data, filters, false);
  } else {
    // For HPS:
    // 1. Plot all individual healers (expand pairs into individuals)
    const individualRows = applyFilters(data, filters, true);
    // 2. Plot all paired healers (match exact paired names in selection)
    const pairedNames = filters.classNames.filter((n) =>
      parsePairedHealerClasses(n)
    );
    let pairedRows = [];
    if (pairedNames.length > 0) {
      const pairedFilters = { ...filters, classNames: pairedNames };
      pairedRows = applyFilters(data, pairedFilters, false);
    }
    // Merge and dedup rows so we don't double plot if data is the same
    filtered = mergeAndDedup(individualRows, pairedRows);
  }

  logger.debug(`Filtered data count: ${filtered.length}`);

  const { grouped, allDates } = groupDataByClass(filtered);

  const sortedDates = Array.from(allDates).sort(
    (a, b) => parseCompactDate(a) - parseCompactDate(b)
  );
  const sortedDateLabels = getDateLabels(sortedDates);

  const traces = prepareTraces(grouped, isDPS);
  const annotations = generateYearAnnotations(sortedDates, sortedDateLabels);

  // Find x labels to show every 7 days, starting from first
  const tickvals = sortedDateLabels.filter((_, i) => i % 7 === 0);
  const ticktext = tickvals;

  plotChartWithLayout(
    traces,
    container,
    sortedDateLabels,
    `Output Over Time${titleSuffix ? ` (${titleSuffix})` : ""}`,
    annotations,
    titleSuffix || "Output"
  );
}

/**
 * Render a line chart showing the difference between selected comparison percentiles and a reference percentile,
 * with the following features:
 *   1. X-axis always covers the complete date range (no gaps even if some dates missing from input).
 *   2. For missing dates in a class/percentile time series, uses the most recent previous value for interpolation (carry-forward).
 *   3. X-axis tick labels show only every 7 days, starting from the first date.
 *   4. Year annotation is placed below the axis.
 *
 * @param {Array<Object>} data - Full dataset, each row should have {raid, boss, date, class, percentile, dps|hps, dps_type}.
 * @param {Object} filters - Filter criteria except percentile.
 * @param {HTMLElement} container - DOM element for the chart.
 * @param {string} titleSuffix - Chart title (e.g., "DPS Comparison").
 * @param {number} referencePercentile - Reference percentile (e.g., 50).
 * @param {Array<number>} comparePercentiles - Array of selected comparison percentiles (e.g., [25, 75]).
 */
export function renderComparisonLineChart(
  data,
  filters,
  container,
  titleSuffix,
  referencePercentile,
  comparePercentiles
) {
  const isDPS = titleSuffix.toLowerCase().includes("dps");
  const classNamesToUse = isDPS
    ? filters.classNames
    : expandSelectedClasses(filters.classNames);

  // Organize input into: { class -> { date -> { percentile -> value } } }
  const byClassDate = {};

  data.forEach((row) => {
    if (!filters.raid || row.raid === filters.raid) {
      if (!filters.boss || row.boss === filters.boss) {
        if (!filters.dps_type || row.dps_type === filters.dps_type) {
          if (classNamesToUse.includes(row.class)) {
            if (!byClassDate[row.class]) byClassDate[row.class] = {};
            if (!byClassDate[row.class][row.date])
              byClassDate[row.class][row.date] = {};
            byClassDate[row.class][row.date][row.percentile] = isDPS
              ? getAdjustedValueForClass(row.class, row.dps ?? row.hps)
              : row.dps ?? row.hps;
          }
        }
      }
    }
  });

  // --- Build a complete date range (no missing dates) ---
  const allDatesRaw = Object.values(byClassDate).flatMap((obj) =>
    Object.keys(obj)
  );
  const dateList = getFullDateRange(allDatesRaw);

  // --- Build traces for each class/percentile, filling missing dates by interpolation (carry-forward) ---
  const traces = [];
  for (const className in byClassDate) {
    comparePercentiles.forEach((cmp) => {
      const x = [];
      const y = [];
      const custom = [];
      let lastRefVal = null;
      let lastCmpVal = null;

      for (const date of dateList) {
        const pObj = byClassDate[className][date] || {};
        // Carry forward last known value for missing data points
        const refVal =
          pObj[referencePercentile] !== undefined
            ? pObj[referencePercentile]
            : lastRefVal;
        const cmpVal = pObj[cmp] !== undefined ? pObj[cmp] : lastCmpVal;
        // Update last known values if defined
        if (refVal !== undefined) lastRefVal = refVal;
        if (cmpVal !== undefined) lastCmpVal = cmpVal;
        // Only plot points after first known (skip leading missing)
        if (refVal !== undefined && cmpVal !== undefined) {
          x.push(date);
          // Calculate diff and percent diff, both rounded to two decimals
          const diff = Number((cmpVal - refVal).toFixed(2));
          const pctDiff =
            refVal !== 0
              ? Number((((cmpVal - refVal) / refVal) * 100).toFixed(2))
              : 0;
          custom.push([
            getDisplayLabelForClass(className), // 0: Use display label here
            `${getOrdinal(referencePercentile)}`, // 1: Reference Percentile (with suffix)
            Math.round(refVal), // 2: Rounded reference value
            `${getOrdinal(cmp)}`, // 3: Comparison Percentile (with suffix)
            Math.round(cmpVal), // 4: Rounded comparison value
            diff, // 5: Difference (absolute)
            pctDiff, // 6: Percent diff
            toISODate(date), // 7: YYYY-MM-DD
          ]);
          y.push(diff);
        }
      }

      // Sort by date (should already be sorted, but keep for robustness)
      const dateObjs = x.map(parseCompactDate);
      const sortedIndices = [...x.keys()].sort(
        (a, b) => dateObjs[a] - dateObjs[b]
      );
      const xSorted = sortedIndices.map((i) => x[i]);
      const ySorted = sortedIndices.map((i) => y[i]);
      const customSorted = sortedIndices.map((i) => custom[i]);

      const trace = {
        type: "scatter",
        mode: "lines+markers",
        name: `${getDisplayLabelForClass(className)} (${getOrdinal(
          cmp
        )} vs ${getOrdinal(referencePercentile)})`,
        x: xSorted.map((d) => {
          const dt = parseCompactDate(d);
          return `${dt.getMonth() + 1}/${dt.getDate()}`;
        }),
        y: ySorted,
        customdata: customSorted,
        hovertemplate:
          `Job : %{customdata[0]}<br>` +
          `Ref %: %{customdata[1]} (%{customdata[2]})<br>` +
          `Cmp %: %{customdata[3]} (%{customdata[4]})<br>` +
          `Diff: %{customdata[6]}% (%{customdata[5]})<br>` +
          `Date: %{customdata[7]}` +
          `<extra></extra>`,
      };
      const color = getClassColor(className);
      trace.line = { color };
      trace.marker = { color };
      traces.push(trace);
    });
  }

  // --- X axis setup: use all dates in dateList, labels only every 7 days ---
  const sortedDates = dateList;
  const sortedDateLabels = getDateLabels(sortedDates);
  // Show tick labels every 7 days (starting at the first date)
  const tickvals = sortedDateLabels.filter((_, i) => i % 7 === 0);
  const ticktext = tickvals;

  // Year annotation(s)
  const annotations = generateYearAnnotations(sortedDates, sortedDateLabels);

  plotChartWithLayout(
    traces,
    container,
    sortedDateLabels,
    titleSuffix,
    annotations,
    "Difference"
  );
}

/**
 * Expands an array of selected class names, replacing any paired/composite names
 * with their constituent classes. For example, "White Mage+Sage" becomes ["White Mage", "Sage"].
 * Non-paired names are included as-is.
 *
 * @param {Array<string>} classNames - The class names selected (may include paired/composite).
 * @returns {Array<string>} Expanded list of class names for data filtering.
 */
function expandSelectedClasses(classNames) {
  const expanded = new Set();
  for (const name of classNames) {
    const parts = parsePairedHealerClasses(name);
    if (parts) {
      parts.forEach((p) => expanded.add(p));
    } else {
      expanded.add(name);
    }
  }
  return Array.from(expanded);
}

/**
 * Merges two arrays of data objects and removes duplicates based on class/date/percentile.
 * @param {Array<Object>} arr1
 * @param {Array<Object>} arr2
 * @returns {Array<Object>}
 */
function mergeAndDedup(arr1, arr2) {
  const seen = new Set();
  const result = [];
  for (const row of [...arr1, ...arr2]) {
    const key = `${row.class}|${row.date}|${row.percentile}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }
  return result;
}

/**
 * Builds a list of all dates in compact YYYYMMDD format from minDate to maxDate (inclusive).
 * @param {string[]} compactDates - Array of compact date strings ('YYYYMMDD')
 * @returns {string[]} Array of all dates in compact format, sorted.
 */
function getFullDateRange(compactDates) {
  if (!compactDates.length) return [];
  const sorted = compactDates
    .slice()
    .sort((a, b) => parseCompactDate(a) - parseCompactDate(b));
  const minDate = parseCompactDate(sorted[0]);
  const maxDate = parseCompactDate(sorted[sorted.length - 1]);
  let current = new Date(minDate);
  const dateList = [];
  while (current <= maxDate) {
    const y = current.getFullYear(),
      m = current.getMonth() + 1,
      d = current.getDate();
    dateList.push(
      y.toString().padStart(4, "0") +
        m.toString().padStart(2, "0") +
        d.toString().padStart(2, "0")
    );
    current.setDate(current.getDate() + 1);
  }
  return dateList;
}

/**
 * Converts a list of compact date strings to M/D formatted labels.
 * @param {string[]} compactDates
 * @returns {string[]} Array of "M/D" labels
 */
function getDateLabels(compactDates) {
  return compactDates.map((d) => {
    const dt = parseCompactDate(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });
}

/**
 * Plots the given traces in a container with shared layout logic.
 * @param {Array<Object>} traces - Plotly traces.
 * @param {HTMLElement} container - Plotly render target.
 * @param {Array<string>} sortedDateLabels - X axis categories ("M/D" format).
 * @param {string} title - Chart title.
 * @param {Array<Object>} annotations - Plotly annotation objects.
 * @param {string} yAxisTitle - Y axis title.
 * @param {boolean} [fixedRange=true] - Lock y axis zoom.
 */
function plotChartWithLayout(
  traces,
  container,
  sortedDateLabels,
  title,
  annotations,
  yAxisTitle,
  fixedRange = true
) {
  const tickvals = sortedDateLabels.filter((_, i) => i % 7 === 0);
  // Add (wkN) starting at 1 for each 7-day label
  const ticktext = sortedDateLabels
    .map((label, i) =>
      i % 7 === 0 ? `${label} (wk${Math.floor(i / 7) + 1})` : null
    )
    .filter((v) => v !== null);

  const layout = {
    title,
    xaxis: {
      title: { text: "Date", standoff: 30 },
      type: "category",
      categoryorder: "array",
      categoryarray: sortedDateLabels,
      tickvals,
      ticktext,
    },
    yaxis: {
      title: yAxisTitle,
      fixedrange: fixedRange,
    },
    margin: { t: 60, l: 50, r: 30, b: 90 },
    annotations,
    showlegend: false,
  };
  Plotly.newPlot(container, traces, layout, { responsive: true });
}

/**
 * Blends two hex colors equally (50/50 mix).
 * @param {string} colorA - First color in hex, e.g. "#AABBCC"
 * @param {string} colorB - Second color in hex, e.g. "#112233"
 * @returns {string} Blended color in hex.
 */
function blendHexColors(colorA, colorB) {
  // Remove # if present
  colorA = colorA.replace("#", "");
  colorB = colorB.replace("#", "");
  // Convert to RGB
  const rgbA = [
    parseInt(colorA.substring(0, 2), 16),
    parseInt(colorA.substring(2, 4), 16),
    parseInt(colorA.substring(4, 6), 16),
  ];
  const rgbB = [
    parseInt(colorB.substring(0, 2), 16),
    parseInt(colorB.substring(2, 4), 16),
    parseInt(colorB.substring(4, 6), 16),
  ];
  // Blend 50/50
  const blended = rgbA.map((a, i) => Math.round((a + rgbB[i]) / 2));
  // Convert back to hex
  return (
    "#" +
    blended
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/**
 * Returns the color for a given class or paired class.
 * 1) Try CLASS_COLORS.
 * 2) If not found, expand class name and blend their colors if both found.
 * 3) Else, generate a random color.
 * @param {string} className
 * @returns {string} Hex color.
 */
function getClassColor(className) {
  if (CLASS_COLORS[className]) {
    return CLASS_COLORS[className];
  }
  // Try expanding paired healers and blending
  const parts = parsePairedHealerClasses(className);
  if (parts && parts.length === 2) {
    const colorA = CLASS_COLORS[parts[0]];
    const colorB = CLASS_COLORS[parts[1]];
    if (colorA && colorB) {
      return blendHexColors(colorA, colorB);
    }
  }
  // Fallback to random pastel color (as before)
  const randColor =
    "#" +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
  return randColor;
}
