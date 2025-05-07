import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("chartRenderer");

/**
 * Render filtered DPS or Healing data as a Plotly line chart with a range slider.
 *
 * @param {Array<Object>} data - Array of JSON records, either DPS or Healing.
 * @param {Object} filters - Filter criteria: { raid, boss, percentile, classNames, dps_type }.
 * @param {HTMLElement} container - DOM element to render the chart into.
 * @param {string} [titleSuffix=""] - Optional label to display in chart title (e.g., "DPS", "Healing").
 */
export function renderFilteredLineChart(
  data,
  filters,
  container,
  titleSuffix = ""
) {
  const { raid, boss, percentile, classNames, dps_type } = filters;

  const filtered = data.filter((entry) => {
    const match =
      (!raid || entry.raid === raid) &&
      (!boss || entry.boss === boss) &&
      (!percentile || entry.percentile === Number(percentile)) &&
      classNames.includes(entry.class) &&
      (!dps_type || entry.dps_type === dps_type);
    return match;
  });

  logger.debug(`Filtered data count: ${filtered.length}`);

  const grouped = {};
  for (const row of filtered) {
    const key = row.class;
    const date = row.date;
    const y = row.dps ?? row.hps;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      x: date,
      y,
      customdata: {
        class: row.class,
        percentile: row.percentile,
        parses: row.parses,
        dps_type: row.dps_type ?? null,
      },
    });
  }

  const isDPS = titleSuffix.toLowerCase().includes("dps");

  const traces = Object.entries(grouped).map(([key, points]) => ({
    type: "scatter",
    mode: "lines+markers",
    name: key,
    x: points.map((p) => p.x),
    y: points.map((p) => p.y),
    customdata: points.map((p) => [
      p.customdata.class,
      p.customdata.parses,
      p.customdata.percentile,
      p.customdata.dps_type,
      p.y,
    ]),
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
  }));

  const layout = {
    title: `Output Over Time${titleSuffix ? ` (${titleSuffix})` : ""}`,
    xaxis: {
      title: "Date",
      rangeslider: { visible: true },
      type: "category",
    },
    yaxis: {
      title: titleSuffix || "Output",
    },
    margin: { t: 40, l: 50, r: 30, b: 50 },
  };

  Plotly.newPlot(container, traces, layout, { responsive: true });
}
