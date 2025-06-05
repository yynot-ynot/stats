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
 * @param {Array<Object>} data - Full dataset.
 * @param {Object} filters - Filter criteria.
 * @returns {Array<Object>} Filtered dataset.
 */
function applyFilters(data, filters) {
  const { raid, boss, percentile, classNames, dps_type } = filters;
  return data.filter((entry) => {
    return (
      (!raid || entry.raid === raid) &&
      (!boss || entry.boss === boss) &&
      (!percentile || entry.percentile === Number(percentile)) &&
      classNames.includes(entry.class) &&
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

  return { grouped, allDates };
}

/**
 * Prepare Plotly traces and log their details.
 * @param {Object} grouped - Grouped data by class.
 * @param {boolean} isDPS - Whether the plot is DPS or Healing.
 * @returns {Array<Object>} Plotly traces.
 */
function prepareTraces(grouped, isDPS) {
  return Object.entries(grouped).map(([key, points]) => {
    const sortedPoints = points.sort(
      (a, b) => parseCompactDate(a.rawDate) - parseCompactDate(b.rawDate)
    );
    const traceX = sortedPoints.map((p) => p.x);
    const traceY = sortedPoints.map((p) => p.y);
    const traceCustom = sortedPoints.map((p) => [
      p.customdata.class,
      p.customdata.parses,
      p.customdata.percentile,
      p.customdata.dps_type,
      p.y,
    ]);

    logger.debug(`Trace for class ${key}:`);
    traceX.forEach((xVal, i) => {
      logger.debug(
        `  Data point ${i + 1}: x=${xVal}, y=${
          traceY[i]
        }, tooltip=${JSON.stringify(traceCustom[i])}`
      );
    });

    return {
      type: "scatter",
      mode: "lines+markers",
      name: key,
      x: traceX,
      y: traceY,
      customdata: traceCustom,
      hovertemplate: isDPS
        ? `
          Class: %{customdata[0]}<br>
          Parses: %{customdata[1]}<br>
          Percentile: %{customdata[2]}<br>
          DPS: %{customdata[4]} (%{customdata[3]})
          <extra></extra>
        `
        : `
          Class: %{customdata[0]}<br>
          Parses: %{customdata[1]}<br>
          Percentile: %{customdata[2]}<br>
          HPS: %{customdata[4]}
          <extra></extra>
        `,
    };
  });
}

/**
 * Generate year annotation positions for the chart.
 * For single-year data, the year is centered under the full axis to align with the "Date" label.
 * For multi-year data, the first year is centered under its date range, and each subsequent year
 * is positioned under the first occurrence of its date.
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

  if (totalYears === 1) {
    // Single-year: align the year label to the center of the full axis (aligned with "Date" title)
    return [
      {
        xref: "paper",
        yref: "paper",
        x: 0.5,
        y: -0.15,
        text: `<b>${Object.keys(yearToIndices)[0]}</b>`,
        showarrow: false,
        font: { size: 14 },
      },
    ];
  }

  // Multi-year: place each year label below its date range or first occurrence
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
      y: -0.15,
      text: `<b>${year}</b>`,
      showarrow: false,
      font: { size: 14 },
    };
  });
}

/**
 * Main function to render the filtered line chart.
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
  const filtered = applyFilters(data, filters);
  logger.debug(`Filtered data count: ${filtered.length}`);

  const { grouped, allDates } = groupDataByClass(filtered);

  const sortedDates = Array.from(allDates).sort(
    (a, b) => parseCompactDate(a) - parseCompactDate(b)
  );
  const sortedDateLabels = sortedDates.map((d) => {
    const dt = parseCompactDate(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });

  const isDPS = titleSuffix.toLowerCase().includes("dps");
  const traces = prepareTraces(grouped, isDPS);
  const annotations = generateYearAnnotations(sortedDates, sortedDateLabels);

  const layout = {
    title: `Output Over Time${titleSuffix ? ` (${titleSuffix})` : ""}`,
    xaxis: {
      title: { text: "Date", standoff: 30 },
      type: "category",
      categoryorder: "array",
      categoryarray: sortedDateLabels,
    },
    yaxis: { title: titleSuffix || "Output" },
    margin: { t: 60, l: 50, r: 30, b: 90 },
    annotations,
  };

  Plotly.newPlot(container, traces, layout, { responsive: true });
}

/**
 * Render a line chart showing the difference between selected comparison percentiles and a reference percentile.
 *
 * @param {Array<Object>} data - Full dataset.
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
  // Find data for reference percentile and for each comparison percentile
  // Structure: { class -> { date -> {p25, p50, p75, ...} } }
  const byClassDate = {};
  data.forEach((row) => {
    if (!filters.raid || row.raid === filters.raid) {
      if (!filters.boss || row.boss === filters.boss) {
        if (!filters.dps_type || row.dps_type === filters.dps_type) {
          if (filters.classNames.includes(row.class)) {
            if (!byClassDate[row.class]) byClassDate[row.class] = {};
            if (!byClassDate[row.class][row.date])
              byClassDate[row.class][row.date] = {};
            byClassDate[row.class][row.date][row.percentile] =
              row.dps ?? row.hps;
          }
        }
      }
    }
  });

  // Only show dates that have all required percentiles
  const traces = [];
  for (const className in byClassDate) {
    comparePercentiles.forEach((cmp) => {
      const x = [];
      const y = [];
      const custom = [];

      // Get all available dates where both ref and cmp exist
      for (const date in byClassDate[className]) {
        const refVal = byClassDate[className][date][referencePercentile];
        const cmpVal = byClassDate[className][date][cmp];
        if (refVal !== undefined && cmpVal !== undefined) {
          x.push(date);
          // Calculate diff and percent diff, both rounded to two decimals
          const diff = Number((cmpVal - refVal).toFixed(2));
          const pctDiff =
            refVal !== 0
              ? Number((((cmpVal - refVal) / refVal) * 100).toFixed(2))
              : 0;
          custom.push([
            className, // 0
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

      // Sort by date
      const dateObjs = x.map(parseCompactDate);
      const sortedIndices = [...x.keys()].sort(
        (a, b) => dateObjs[a] - dateObjs[b]
      );
      const xSorted = sortedIndices.map((i) => x[i]);
      const ySorted = sortedIndices.map((i) => y[i]);
      const customSorted = sortedIndices.map((i) => custom[i]);

      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: `${className} (${getOrdinal(cmp)} vs ${getOrdinal(
          referencePercentile
        )})`,
        x: xSorted.map((d) => {
          const dt = parseCompactDate(d);
          return `${dt.getMonth() + 1}/${dt.getDate()}`;
        }),
        y: ySorted,
        customdata: customSorted,
        hovertemplate:
          `Job Class: %{customdata[0]}<br>` +
          `Ref %: %{customdata[1]} (%{customdata[2]})<br>` +
          `Cmp %: %{customdata[3]} (%{customdata[4]})<br>` +
          `Diff: %{customdata[6]}% (%{customdata[5]})<br>` +
          `Date: %{customdata[7]}` +
          `<extra></extra>`,
      });
    });
  }

  const layout = {
    title: titleSuffix,
    xaxis: { title: { text: "Date", standoff: 30 }, type: "category" },
    yaxis: { title: "Difference" },
    margin: { t: 60, l: 50, r: 30, b: 90 },
  };

  Plotly.newPlot(container, traces, layout, { responsive: true });
}
