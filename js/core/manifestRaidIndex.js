const KNOWN_RAID_SLUGS = Object.freeze({
  "aac-heavyweight": "AAC Heavyweight",
  "aac-cruiserweight": "AAC Cruiserweight",
  "trials-iii-extreme": "Trials III (Extreme)",
  "futures-rewritten": "Futures Rewritten",
});

/**
 * Convert a manifest path or filename into normalized metadata used by the
 * raid/entity loader. The middle filename segment keeps the raid slug first
 * and then appends an entity slug, which lets the UI decide what to load
 * before any JSON rows are downloaded.
 *
 * @param {string} filePath
 * @returns {{
 *   path: string,
 *   filename: string,
 *   date: string,
 *   type: string,
 *   raid: string,
 *   raidSlug: string,
 *   entitySlug: string,
 *   entityLabel: string,
 *   groupKey: string,
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
  const entitySlug = resolveEntitySlug(slugSegment, raidSlug);
  const entityLabel = entityLabelFromSlug(entitySlug);

  return {
    path: filePath,
    filename,
    date,
    type,
    raid,
    raidSlug,
    entitySlug,
    entityLabel,
    groupKey: buildRaidEntityKey(raid, entitySlug),
  };
}

/**
 * Build manifest indexes that expose both top-level raids and independently
 * loadable entities under those raids.
 *
 * @param {Array<string>} filePaths
 * @returns {{
 *   allFiles: Array<Object>,
 *   filesByRaid: Map<string, Array<Object>>,
 *   filesByGroup: Map<string, Array<Object>>,
 *   latestDateByRaid: Object<string, string>,
 *   latestDateByGroup: Object<string, string>,
 *   entitiesByRaid: Map<string, Array<{slug: string, label: string}>>,
 *   sortedRaids: Array<string>,
 * }}
 */
export function buildManifestRaidIndex(filePaths) {
  const filesByRaid = new Map();
  const filesByGroup = new Map();
  const latestDateByRaid = {};
  const latestDateByGroup = {};
  const entitiesByRaid = new Map();
  const allFiles = [];

  filePaths.forEach((filePath) => {
    const record = parseManifestFileRecord(filePath);
    if (!record) return;

    allFiles.push(record);

    if (!filesByRaid.has(record.raid)) {
      filesByRaid.set(record.raid, []);
    }
    filesByRaid.get(record.raid).push(record);

    if (!filesByGroup.has(record.groupKey)) {
      filesByGroup.set(record.groupKey, []);
    }
    filesByGroup.get(record.groupKey).push(record);

    const currentRaidLatest = latestDateByRaid[record.raid] || "";
    if (record.date > currentRaidLatest) {
      latestDateByRaid[record.raid] = record.date;
    }

    const currentGroupLatest = latestDateByGroup[record.groupKey] || "";
    if (record.date > currentGroupLatest) {
      latestDateByGroup[record.groupKey] = record.date;
    }

    const entities = entitiesByRaid.get(record.raid) || [];
    if (!entities.some((entry) => entry.slug === record.entitySlug)) {
      entities.push({ slug: record.entitySlug, label: record.entityLabel });
      entitiesByRaid.set(record.raid, entities);
    }
  });

  entitiesByRaid.forEach((entities, raid) => {
    entities.sort((a, b) => {
      if (a.slug === "whole-fight") return -1;
      if (b.slug === "whole-fight") return 1;
      if (!a.slug) return 1;
      if (!b.slug) return -1;
      return a.label.localeCompare(b.label);
    });
    entitiesByRaid.set(raid, entities);
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
    filesByGroup,
    latestDateByRaid,
    latestDateByGroup,
    entitiesByRaid,
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
 * Resolve the first entity to load for a raid. Whole-fight wins when present.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @param {string} requestedEntitySlug
 * @returns {string}
 */
export function resolveEffectiveEntitySlug(
  manifestIndex,
  raid,
  requestedEntitySlug
) {
  const entities = manifestIndex?.entitiesByRaid?.get(raid) || [];
  if (requestedEntitySlug && entities.some((entry) => entry.slug === requestedEntitySlug)) {
    return requestedEntitySlug;
  }
  const wholeFight = entities.find((entry) => entry.slug === "whole-fight");
  if (wholeFight) {
    return wholeFight.slug;
  }
  const firstNamedEntity = entities.find((entry) => entry.slug);
  if (firstNamedEntity) {
    return firstNamedEntity.slug;
  }
  return entities[0]?.slug || "";
}

/**
 * Fetch the file records associated with one raid/entity selection.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @param {string} entitySlug
 * @returns {Array<Object>}
 */
export function getManifestFilesForSelection(manifestIndex, raid, entitySlug) {
  const groupKey = buildRaidEntityKey(raid, entitySlug);
  return manifestIndex?.filesByGroup?.get(groupKey) || [];
}

/**
 * Build the stable lookup key used across manifest, scheduler, and store.
 *
 * @param {string} raid
 * @param {string} entitySlug
 * @returns {string}
 */
export function buildRaidEntityKey(raid, entitySlug) {
  return `${raid}::${entitySlug || ""}`;
}

/**
 * Resolve the raid portion from the middle manifest slug segment.
 *
 * The manifest keeps the raid slug as a prefix and then appends a boss/entity
 * suffix. Matching the longest known raid slug first prevents future
 * raid/entity names from being mis-split when they share prefixes.
 *
 * @param {string} slugSegment
 * @returns {string}
 */
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

/**
 * Peel the entity suffix off the slug segment after the raid slug is known.
 *
 * Whole-fight legacy files may contain only the raid slug, in which case the
 * entity slug is blank and later resolution falls back to the raid-level
 * defaults.
 *
 * @param {string} slugSegment
 * @param {string} raidSlug
 * @returns {string}
 */
function resolveEntitySlug(slugSegment, raidSlug) {
  if (slugSegment === raidSlug) {
    return "";
  }
  if (slugSegment.startsWith(`${raidSlug}_`)) {
    return slugSegment.slice(raidSlug.length + 1);
  }
  return "";
}

/**
 * Convert a manifest entity slug into the label shown in the selector.
 *
 * Phase-aware files intentionally encode enough information in the filename for
 * the UI to offer useful choices before downloading JSON. This helper is the
 * one place that turns those slugs back into visible labels.
 *
 * @param {string} entitySlug
 * @returns {string}
 */
function entityLabelFromSlug(entitySlug) {
  if (!entitySlug) {
    return "All Bosses";
  }
  if (entitySlug === "whole-fight") {
    return "Whole Fight";
  }
  const phaseMatch = entitySlug.match(/^p(\d+)(?:-(.+))?$/);
  if (phaseMatch) {
    const [, phaseNumber, phaseNameSlug] = phaseMatch;
    if (!phaseNameSlug) {
      return `P${phaseNumber}:`;
    }
    return `P${phaseNumber}: ${formatSlugForDisplay(phaseNameSlug)}`;
  }
  return formatSlugForDisplay(entitySlug);
}

/**
 * Expand a slug into readable title text.
 *
 * This formatter is intentionally lightweight: it preserves selector-friendly
 * readability for manifest-derived labels without turning old boss slugs into a
 * strict schema contract.
 *
 * @param {string} slug
 * @returns {string}
 */
function formatSlugForDisplay(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part, index) => {
      if (index > 0 && SMALL_WORDS.has(part)) {
        return part;
      }
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

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);
