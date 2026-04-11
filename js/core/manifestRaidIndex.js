const KNOWN_RAID_SLUGS = Object.freeze({
  "aac-heavyweight": "AAC Heavyweight",
  "aac-cruiserweight": "AAC Cruiserweight",
  "trials-iii-extreme": "Trials III (Extreme)",
});

/**
 * Convert a manifest path or filename into normalized metadata used by the
 * raid-priority loader. The current manifest is expected to contain exactly
 * one raid per file.
 *
 * @param {string} filePath
 * @returns {{
 *   path: string,
 *   filename: string,
 *   date: string,
 *   type: string,
 *   raid: string,
 *   raidSlug: string,
 * }|null}
 */
export function parseManifestFileRecord(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return null;
  }

  const filename = filePath.split("/").pop() || filePath;
  const match = filename.match(/^(\d{8})_(.+)_(dps|healing)\.json\.gz$/);
  if (!match) {
    return null;
  }

  const [, date, slugSegment, type] = match;
  const raidSlug = resolveRaidSlug(slugSegment);
  const raid = KNOWN_RAID_SLUGS[raidSlug] || formatSlugForDisplay(raidSlug);

  return {
    path: filePath,
    filename,
    date,
    type,
    raid,
    raidSlug,
  };
}

/**
 * Build a raid-centric manifest index that the controller and scheduler can
 * use without needing to inspect row data first.
 *
 * @param {Array<string>} filePaths
 * @returns {{
 *   allFiles: Array<Object>,
 *   filesByRaid: Map<string, Array<Object>>,
 *   latestDateByRaid: Object<string, string>,
 *   sortedRaids: Array<string>,
 * }}
 */
export function buildManifestRaidIndex(filePaths) {
  const filesByRaid = new Map();
  const latestDateByRaid = {};
  const allFiles = [];

  filePaths.forEach((filePath) => {
    const record = parseManifestFileRecord(filePath);
    if (!record) return;

    allFiles.push(record);
    if (!filesByRaid.has(record.raid)) {
      filesByRaid.set(record.raid, []);
    }
    filesByRaid.get(record.raid).push(record);

    const currentLatest = latestDateByRaid[record.raid] || "";
    if (record.date > currentLatest) {
      latestDateByRaid[record.raid] = record.date;
    }
  });

  const sortedRaids = Array.from(filesByRaid.keys()).sort((a, b) => {
    const dateA = latestDateByRaid[a] || "";
    const dateB = latestDateByRaid[b] || "";
    if (dateA === dateB) return a.localeCompare(b);
    return dateB.localeCompare(dateA);
  });

  return {
    allFiles,
    filesByRaid,
    latestDateByRaid,
    sortedRaids,
  };
}

/**
 * Resolve the effective raid for startup based on the requested URL value and
 * the raids discoverable from the manifest.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} requestedRaid
 * @returns {string}
 */
export function resolveEffectiveRaid(manifestIndex, requestedRaid) {
  if (
    requestedRaid &&
    manifestIndex?.filesByRaid &&
    manifestIndex.filesByRaid.has(requestedRaid)
  ) {
    return requestedRaid;
  }
  return manifestIndex?.sortedRaids?.[0] || "";
}

/**
 * Fetch the file records associated with a raid, preserving manifest order.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @returns {Array<Object>}
 */
export function getManifestFilesForRaid(manifestIndex, raid) {
  return manifestIndex?.filesByRaid?.get(raid) || [];
}

function resolveRaidSlug(slugSegment) {
  const knownRaidSlugs = Object.keys(KNOWN_RAID_SLUGS).sort(
    (a, b) => b.length - a.length
  );
  const matched = knownRaidSlugs.find(
    (raidSlug) =>
      slugSegment === raidSlug || slugSegment.startsWith(`${raidSlug}_`)
  );

  if (matched) {
    return matched;
  }

  const fallbackRaidSlug = slugSegment.split("_")[0] || slugSegment;
  return fallbackRaidSlug;
}

function formatSlugForDisplay(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(part)) {
        return part.toUpperCase();
      }
      if (/^[a-z]{2,4}$/i.test(part)) {
        return part.toUpperCase();
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}
