import { getLogger } from "../shared/logging/logger.js";
import { JOB_GROUPS } from "../config/appConfig.js";
import { parsePairedHealerJobs } from "../ui/jobSidebarManager.js";

const logger = getLogger("percentileGapMatrix");

export const VALID_PERCENTILES = Object.freeze([
  10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 99,
]);

const matrixCache = new Map();
const DEFAULT_CATEGORY_NAME = "Other Roles";

/**
 * Clear the cached job/date lookup whenever the data set is replaced.
 */
export function clearPercentileGapMatrixCache() {
  matrixCache.clear();
}

/**
 * Build the full payload required to render the Percentile Gap Matrix view.
 * Filters the dataset by raid/boss/jobs/metric, caches the job/date percentile maps,
 * resolves the target snapshot dates, and emits category grids comprised of every `(job, snapshot)`
 * matrix using the trimmed VALID_PERCENTILES list (intentionally excludes 0th and 100th percentiles
 * so extremes never flatten the diverging scale). Returns the data + color metadata required by the UI.
 *
 * @param {Object} params
 * @param {Array<Object>} params.data - Full percentile dataset (DPS or HPS rows).
 * @param {Object} params.filters - Filter snapshot { raid, boss, jobNames, dps_type }.
 * @param {string} [params.valueKey="dps"] - Field to read from each data row ("dps" or "hps").
 * @param {string[]} [params.targetDates=[]] - Preferred snapshot dates (YYYYMMDD). Falls back to latest available.
 * @returns {{
 *   percentiles: number[],
 *   categories: Array<{ name: string, jobs: Array<{ jobName: string, matrices: Array<Object> }> }>,
 *   colorScale: { min: number|null, max: number|null, domainMin: number, domainMax: number },
 *   snapshotDates: string[]
 * }}
 */
export function buildPercentileGapMatrixData({
  data,
  filters,
  valueKey = "dps",
  targetDates = [],
} = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    return emptyMatrixPayload();
  }
  const normalizedSelection = normalizeJobSelection(filters?.jobNames);
  if (!normalizedSelection.length) {
    return emptyMatrixPayload();
  }
  const expandedJobs = expandJobSelection(normalizedSelection);
  if (!expandedJobs.length) {
    return emptyMatrixPayload();
  }

  const cacheKey = buildCacheKey(filters, expandedJobs, valueKey, data);
  let cached = matrixCache.get(cacheKey);
  if (!cached) {
    cached = buildCachedJobMap({
      data,
      filters,
      expandedJobs,
      valueKey,
    });
    matrixCache.set(cacheKey, cached);
  }

  const resolvedDates = resolveTargetDates(targetDates, cached.availableDates);
  if (!resolvedDates.length) {
    return emptyMatrixPayload();
  }

  const tracker = {
    minDiff: Infinity,
    maxDiff: -Infinity,
  };

  const categories = buildCategoryPayload({
    jobOrder: expandedJobs,
    jobValueMap: cached.jobValueMap,
    dates: resolvedDates,
    tracker,
  });

  const domain = computeColorDomain(tracker.minDiff, tracker.maxDiff);
  return {
    percentiles: VALID_PERCENTILES,
    categories,
    colorScale: domain,
    snapshotDates: resolvedDates,
  };
}

function emptyMatrixPayload() {
  return {
    percentiles: VALID_PERCENTILES,
    categories: [],
    colorScale: { min: null, max: null, domainMin: 0, domainMax: 1 },
    snapshotDates: [],
  };
}

function normalizeJobSelection(jobNames) {
  if (!jobNames) return [];
  if (jobNames instanceof Set) return Array.from(jobNames).filter(Boolean);
  if (Array.isArray(jobNames)) return jobNames.filter(Boolean);
  return [];
}

function expandJobSelection(rawSelection) {
  const expanded = [];
  rawSelection.forEach((name) => {
    const parts = parsePairedHealerJobs(name);
    if (parts && parts.length) {
      parts.forEach((job) => {
        if (!expanded.includes(job)) expanded.push(job);
      });
    } else if (!expanded.includes(name)) {
      expanded.push(name);
    }
  });
  return expanded;
}

function buildCacheKey(filters, expandedJobs, valueKey, dataRef) {
  const jobKey = expandedJobs.slice().sort().join("|") || "ALL";
  const raid = filters?.raid || "ALL";
  const boss = filters?.boss || "ALL";
  const metric = filters?.dps_type || "ALL";
  const dataToken = Array.isArray(dataRef) ? String(dataRef.length) : "0";
  return [raid, boss, metric, jobKey, valueKey, dataToken].join("::");
}

function buildCachedJobMap({ data, filters, expandedJobs, valueKey }) {
  const jobValueMap = new Map();
  const allowedJobs = new Set(expandedJobs);
  expandedJobs.forEach((job) => {
    if (!jobValueMap.has(job)) jobValueMap.set(job, new Map());
  });

  const availableDates = new Set();

  data.forEach((row) => {
    const jobName = row.job ?? row.class;
    if (!jobName || !allowedJobs.has(jobName)) return;
    if (filters?.raid && row.raid !== filters.raid) return;
    if (filters?.boss && row.boss !== filters.boss) return;
    if (filters?.dps_type && row.dps_type !== filters.dps_type) return;
    if (!row.date) return;

    const percent = Number(row.percentile);
    const value = row[valueKey];
    if (Number.isNaN(percent) || typeof value !== "number") return;
    if (!jobValueMap.has(jobName)) {
      jobValueMap.set(jobName, new Map());
    }
    const perDate = jobValueMap.get(jobName);
    if (!perDate.has(row.date)) {
      perDate.set(row.date, new Map());
    }
    perDate.get(row.date).set(percent, value);
    availableDates.add(row.date);
  });

  return {
    jobValueMap,
    availableDates: Array.from(availableDates).sort(),
  };
}

function resolveTargetDates(preferredDates, availableDates) {
  if (!availableDates.length) return [];
  if (Array.isArray(preferredDates) && preferredDates.length) {
    const filtered = preferredDates.filter((date) => availableDates.includes(date));
    if (filtered.length) return filtered;
  }
  return [availableDates[availableDates.length - 1]];
}

function buildCategoryPayload({ jobOrder, jobValueMap, dates, tracker }) {
  const categories = [];
  const categoryOrder = Object.keys(JOB_GROUPS);
  const jobToCategory = new Map();
  categoryOrder.forEach((category) => {
    JOB_GROUPS[category].forEach((job) => {
      jobToCategory.set(job, category);
    });
  });

  const jobsByCategory = new Map();
  categoryOrder.forEach((category) => jobsByCategory.set(category, []));
  jobsByCategory.set(DEFAULT_CATEGORY_NAME, []);

  jobOrder.forEach((jobName) => {
    const category = jobToCategory.get(jobName) || DEFAULT_CATEGORY_NAME;
    jobsByCategory.get(category).push(jobName);
  });

  jobsByCategory.forEach((jobList, categoryName) => {
    if (!jobList.length) return;
    const tiles = [];
    jobList.forEach((jobName) => {
      dates.forEach((date) => {
        tiles.push(
          buildMatrixForJob({
            jobName,
            date,
            values: jobValueMap.get(jobName),
            tracker,
          })
        );
      });
    });
    categories.push({ name: categoryName, tiles });
  });
  return categories;
}

function buildMatrixForJob({ jobName, date, values, tracker }) {
  const cellMap = new Map();
  const perDateValues = values?.get(date) ?? new Map();
  let hasAnyValue = false;

  for (let rowIdx = 0; rowIdx < VALID_PERCENTILES.length; rowIdx += 1) {
    for (
      let colIdx = 0;
      colIdx < VALID_PERCENTILES.length;
      colIdx += 1
    ) {
      if (colIdx <= rowIdx) continue;
      const lower = VALID_PERCENTILES[rowIdx];
      const upper = VALID_PERCENTILES[colIdx];
      const lowerValue = perDateValues.get(lower);
      const upperValue = perDateValues.get(upper);
      const hasBoth =
        typeof lowerValue === "number" && typeof upperValue === "number";

      let diff = null;
      let percentDiff = null;
      if (hasBoth) {
        diff = upperValue - lowerValue;
        hasAnyValue = true;
        tracker.minDiff = Math.min(tracker.minDiff, diff);
        tracker.maxDiff = Math.max(tracker.maxDiff, diff);
        percentDiff =
          lowerValue === 0 ? null : ((diff / lowerValue) * 100);
      }

      cellMap.set(`${rowIdx}-${colIdx}`, {
        jobName,
        snapshotDate: date,
        lowerPercentile: lower,
        upperPercentile: upper,
        lowerValue: hasBoth ? lowerValue : null,
        upperValue: hasBoth ? upperValue : null,
        rawDifference: hasBoth ? diff : null,
        percentDifference:
          typeof percentDiff === "number" && Number.isFinite(percentDiff)
            ? percentDiff
            : null,
        lowerIndex: rowIdx,
        upperIndex: colIdx,
        isMissing: !hasBoth,
      });
    }
  }

  return {
    jobName,
    snapshotDate: date,
    cellMap,
    hasAnyValue,
  };
}

/**
 * Produce the sequential `[0 → maxDiff]` domain required by the Viridis heatmap.
 * Even if the minimum observed difference is larger than zero (which can happen when every
 * percentile spread is sizable), we still anchor the lower bound at zero so the UI always
 * renders the soft beige “no change” stop and the legend labels remain `[0, mid, max]`.
 *
 * @param {number} minDiff
 * @param {number} maxDiff
 * @returns {{min: number|null, max: number|null, domainMin: number, domainMax: number}}
 */
function computeColorDomain(minDiff, maxDiff) {
  if (minDiff === Infinity || maxDiff === -Infinity) {
    return { min: null, max: null, domainMin: 0, domainMax: 1 };
  }
  const safeMax = Math.max(0, maxDiff);
  return {
    min: minDiff,
    max: maxDiff,
    domainMin: 0,
    domainMax: safeMax || 1,
  };
}
