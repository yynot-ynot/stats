import weekStartConfig from "../../config/weekStartConfig.js";
import { getLogger } from "./logging/logger.js";

const logger = getLogger("weekStartConfig");
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultAnchors = Object.freeze(sanitizeAnchors(weekStartConfig?.weekStartAnchors));
let activeAnchors = { ...defaultAnchors };

/**
 * Resolve the configured week-one anchor for the provided raid/boss selection.
 * The helper checks for a boss-specific override first, then falls back to a raid-wide date,
 * and finally returns null so the charts derive week numbers from the visible dataset.
 * @param {{raid?: string, boss?: string}} params
 * @returns {{iso: string, compact: string, dayIndex: number}|null}
 */
export function getWeekStartAnchor({ raid, boss } = {}) {
  const bossKey = buildBossKey(raid, boss);
  if (bossKey) {
    const bossAnchor = lookupAnchor(bossKey);
    if (bossAnchor) return bossAnchor;
  }
  const raidKey = normalizeKey(raid);
  if (raidKey) {
    const raidAnchor = lookupAnchor(raidKey);
    if (raidAnchor) return raidAnchor;
  }
  return null;
}

/**
 * Test-only escape hatch that swaps the in-memory anchor table.
 * Useful for verifying precedence logic without mutating the committed config file.
 * @param {Record<string, string>} anchors
 */
export function __setWeekStartAnchorsForTests(anchors) {
  activeAnchors = sanitizeAnchors(anchors);
}

/**
 * Test-only reset helper that restores the committed config mapping.
 */
export function __resetWeekStartAnchorsForTests() {
  activeAnchors = { ...defaultAnchors };
}

function lookupAnchor(key) {
  if (!key) return null;
  const iso = activeAnchors[key];
  if (!iso) return null;
  const dayIndex = isoStringToDayIndex(iso);
  if (dayIndex === null) return null;
  return {
    iso,
    compact: iso.replace(/-/g, ""),
    dayIndex,
  };
}

function buildBossKey(raid, boss) {
  const raidKey = normalizeKey(raid);
  const bossKey = normalizeKey(boss);
  if (!raidKey || !bossKey) return "";
  return `${raidKey}::${bossKey}`;
}

function normalizeKey(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function sanitizeAnchors(rawAnchors = {}) {
  const sanitized = {};
  if (!rawAnchors || typeof rawAnchors !== "object") {
    return sanitized;
  }
  Object.entries(rawAnchors).forEach(([rawKey, rawValue]) => {
    const key = normalizeKey(rawKey);
    const iso = normalizeIsoValue(rawValue);
    if (!key || !iso) return;
    const dayIndex = isoStringToDayIndex(iso);
    if (dayIndex === null) {
      logger.warn(`Ignoring week start override "${key}" because the date is invalid (${rawValue}).`);
      return;
    }
    sanitized[key] = iso;
  });
  return sanitized;
}

function normalizeIsoValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    logger.warn(
      `Ignoring week start override "${value}" because it is not in ISO YYYY-MM-DD format.`
    );
    return "";
  }
  return trimmed;
}

function isoStringToDayIndex(isoString) {
  if (!isoString || typeof isoString !== "string") return null;
  const [yearStr, monthStr, dayStr] = isoString.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    return null;
  }
  const utcTime = Date.UTC(year, month - 1, day);
  return Number.isNaN(utcTime) ? null : utcTime / MS_PER_DAY;
}
