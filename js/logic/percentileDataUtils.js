import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("percentileDataUtils");

/**
 * Build percentile-series metadata for chart rendering. Filters the provided dataset by raid/boss/job/metric,
 * restricts the results to the requested date (falling back to the most recent), and collects percentile buckets for each job.
 * While the series only contains rows for the active date, the helper also precomputes the minimum/maximum metric value across
 * all available dates that match the filters so percentile charts can reuse a stable y-axis range while the user scrubs the slider.
 *
 * @param {Array<Object>} data - Raw data rows containing { raid, boss, job|class, percentile, date, dps|hps, dps_type }.
 * @param {Object} filters - Filter criteria { raid, boss, jobNames, dps_type }.
 * @param {Object} options - Additional settings.
 * @param {string} options.valueKey - The numeric field to read (e.g., "dps" or "hps").
 * @param {string} [options.targetDate] - Preferred compact date (YYYYMMDD). Defaults to latest available.
 * @returns {{ selectedDate: (string|null), buckets: number[], series: Map<string, Map<number, number>>, valueRange: ({min: number, max: number}|null) }}
 */
export function buildPercentileSeries(data, filters, { valueKey, targetDate }) {
  if (!Array.isArray(data) || data.length === 0) {
    return createEmptySeriesResult();
  }

  const jobFilter = normalizeJobFilter(filters?.jobNames);
  const filteredRows = data.filter((row) => {
    const jobName = row.job ?? row.class;
    if (!jobName) return false;
    if (jobFilter && !jobFilter.has(jobName)) return false;
    if (filters?.raid && row.raid !== filters.raid) return false;
    if (filters?.boss && row.boss !== filters.boss) return false;
    if (filters?.dps_type && row.dps_type !== filters.dps_type) return false;
    const percentileValue = Number(row.percentile);
    // Ignore 0th percentile rows so the percentile view charts and scaling skip them entirely,
    // preventing their extremely low values from flattening the y-axis when comparing other percentiles.
    if (Number.isNaN(percentileValue) || percentileValue === 0) return false;
    return typeof row[valueKey] === "number";
  });

  if (filteredRows.length === 0) {
    return createEmptySeriesResult();
  }

  const valueRange = computeValueRange(filteredRows, valueKey);
  const dateSet = new Set(
    filteredRows.filter((row) => row.date).map((row) => row.date)
  );
  if (dateSet.size === 0) {
    logger.warn("No date information found in percentile data.");
    return createEmptySeriesResult();
  }
  const sortedDates = Array.from(dateSet).sort();
  const preferred =
    targetDate && dateSet.has(targetDate)
      ? targetDate
      : sortedDates[sortedDates.length - 1];

  const rowsForLatest = filteredRows.filter((row) => row.date === preferred);
  const bucketSet = new Set();
  const series = new Map();

  rowsForLatest.forEach((row) => {
    const percentile = Number(row.percentile);
    if (Number.isNaN(percentile)) return;
    bucketSet.add(percentile);
    const jobName = row.job ?? row.class;
    if (!series.has(jobName)) {
      series.set(jobName, new Map());
    }
    series.get(jobName).set(percentile, row[valueKey]);
  });
  const buckets = Array.from(bucketSet).sort((a, b) => a - b);
  return { selectedDate: preferred, buckets, series, valueRange };
}

function normalizeJobFilter(jobNames) {
  if (!jobNames) return null;
  if (jobNames instanceof Set) return jobNames.size ? new Set(jobNames) : null;
  if (Array.isArray(jobNames)) return jobNames.length ? new Set(jobNames) : null;
  return null;
}

function computeValueRange(rows, valueKey) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  rows.forEach((row) => {
    const value = row[valueKey];
    if (typeof value !== "number" || Number.isNaN(value)) return;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  if (min === Infinity || max === -Infinity) return null;
  return { min, max };
}

function createEmptySeriesResult() {
  return { selectedDate: null, buckets: [], series: new Map(), valueRange: null };
}

/**
 * Collect all distinct dates present in the dataset, optionally filtered by raid/boss.
 * @param {Array<Object>} data
 * @param {{raid?: string, boss?: string}} filters
 * @returns {string[]} Sorted list of compact dates (YYYYMMDD).
 */
export function collectAvailableDates(data, filters = {}) {
  if (!Array.isArray(data)) return [];
  const { raid, boss } = filters;
  const dateSet = new Set();
  data.forEach((row) => {
    if (!row?.date) return;
    if (raid && row.raid !== raid) return;
    if (boss && row.boss !== boss) return;
    dateSet.add(row.date);
  });
  return Array.from(dateSet).sort();
}
