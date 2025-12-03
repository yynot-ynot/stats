import { parsePairedHealerJobs } from "./jobSidebarManager.js";

/**
 * Determines if the provided job name is a paired/composite (currently only healer) job.
 * @param {string} jobName
 * @returns {boolean}
 */
export function isCompositeJob(jobName) {
  return !!parsePairedHealerJobs(jobName);
}

/**
 * Gets the display label for a job.
 * If composite (paired) job, returns "Avg.(JobName)".
 * @param {string} jobName
 * @returns {string}
 */
export function getDisplayLabelForJob(jobName) {
  if (isCompositeJob(jobName)) {
    return `Avg.(${jobName})`;
  }
  return jobName;
}

/**
 * Returns the adjusted value for a job.
 * If paired/composite, halves the value (future logic could extend to other types).
 * @param {string} jobName
 * @param {number} value
 * @returns {number}
 */
export function getAdjustedValueForJob(jobName, value) {
  if (isCompositeJob(jobName)) {
    return value / 2;
  }
  return value;
}
