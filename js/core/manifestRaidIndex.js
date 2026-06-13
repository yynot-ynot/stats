const KNOWN_RAID_SLUGS = Object.freeze({
  "aac-heavyweight": "AAC Heavyweight",
  "aac-cruiserweight": "AAC Cruiserweight",
  "trials-iii-extreme": "Trials III (Extreme)",
});

const BOSS_SCOPED_RAID_SLUGS = new Set(["trials-iii-extreme"]);

const KNOWN_BOSS_SLUGS = Object.freeze({
  doomtrain: "Doomtrain",
  enuo: "Enuo",
});

/**
 * Convert a manifest path or filename into normalized metadata used by the
 * async loader. Raid-scoped families keep a single load target per raid,
 * while boss-scoped families (currently Trials) expose one load target per
 * boss so the controller can prioritize a narrower file family first.
 *
 * @param {string} filePath
 * @returns {{
 *   path: string,
 *   filename: string,
 *   date: string,
 *   type: string,
 *   raid: string,
 *   raidSlug: string,
 *   boss: string,
 *   bossSlug: string,
 *   scopeType: "raid"|"boss",
 *   loadTarget: string,
 *   isBossScoped: boolean,
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
  const isBossScoped = BOSS_SCOPED_RAID_SLUGS.has(raidSlug);
  const bossSlug = isBossScoped ? resolveBossSlug(slugSegment, raidSlug) : "";
  const boss = bossSlug ? formatBossSlugForDisplay(bossSlug) : "";
  const scopeType = bossSlug ? "boss" : "raid";
  const loadTarget = scopeType === "boss" ? `${raid}::${bossSlug}` : raid;

  return {
    path: filePath,
    filename,
    date,
    type,
    raid,
    raidSlug,
    boss,
    bossSlug,
    scopeType,
    loadTarget,
    isBossScoped,
  };
}

/**
 * Build a manifest index that can answer both legacy raid-scoped questions and
 * the newer boss-scoped load-target questions without needing row data first.
 *
 * @param {Array<string>} filePaths
 * @returns {{
 *   allFiles: Array<Object>,
 *   filesByRaid: Map<string, Array<Object>>,
 *   filesByLoadTarget: Map<string, Array<Object>>,
 *   latestDateByRaid: Object<string, string>,
 *   latestDateByLoadTarget: Object<string, string>,
 *   sortedRaids: Array<string>,
 *   loadTargetsByRaid: Map<string, Array<string>>,
 *   bossOptionsByRaid: Object<string, Array<string>>,
 *   bossLatestDatesByRaid: Object<string, Object<string, string>>,
 *   targetMetadataByKey: Map<string, Object>,
 * }}
 */
export function buildManifestRaidIndex(filePaths) {
  const filesByRaid = new Map();
  const filesByLoadTarget = new Map();
  const latestDateByRaid = {};
  const latestDateByLoadTarget = {};
  const loadTargetsByRaid = new Map();
  const bossOptionsByRaid = {};
  const bossLatestDatesByRaid = {};
  const targetMetadataByKey = new Map();
  const allFiles = [];

  filePaths.forEach((filePath) => {
    const record = parseManifestFileRecord(filePath);
    if (!record) return;

    allFiles.push(record);

    if (!filesByRaid.has(record.raid)) {
      filesByRaid.set(record.raid, []);
    }
    filesByRaid.get(record.raid).push(record);

    if (!filesByLoadTarget.has(record.loadTarget)) {
      filesByLoadTarget.set(record.loadTarget, []);
      targetMetadataByKey.set(record.loadTarget, {
        raid: record.raid,
        raidSlug: record.raidSlug,
        boss: record.boss,
        bossSlug: record.bossSlug,
        scopeType: record.scopeType,
        isBossScoped: record.isBossScoped,
        loadTarget: record.loadTarget,
      });
    }
    filesByLoadTarget.get(record.loadTarget).push(record);

    if (!loadTargetsByRaid.has(record.raid)) {
      loadTargetsByRaid.set(record.raid, []);
    }
    if (!loadTargetsByRaid.get(record.raid).includes(record.loadTarget)) {
      loadTargetsByRaid.get(record.raid).push(record.loadTarget);
    }

    const currentRaidLatest = latestDateByRaid[record.raid] || "";
    if (record.date > currentRaidLatest) {
      latestDateByRaid[record.raid] = record.date;
    }

    const currentTargetLatest = latestDateByLoadTarget[record.loadTarget] || "";
    if (record.date > currentTargetLatest) {
      latestDateByLoadTarget[record.loadTarget] = record.date;
    }

    if (record.isBossScoped && record.boss) {
      bossOptionsByRaid[record.raid] = bossOptionsByRaid[record.raid] || [];
      bossLatestDatesByRaid[record.raid] =
        bossLatestDatesByRaid[record.raid] || {};
      if (!bossOptionsByRaid[record.raid].includes(record.boss)) {
        bossOptionsByRaid[record.raid].push(record.boss);
      }
      const currentBossLatest =
        bossLatestDatesByRaid[record.raid][record.boss] || "";
      if (record.date > currentBossLatest) {
        bossLatestDatesByRaid[record.raid][record.boss] = record.date;
      }
    }
  });

  const sortedRaids = Array.from(filesByRaid.keys()).sort((a, b) => {
    const dateA = latestDateByRaid[a] || "";
    const dateB = latestDateByRaid[b] || "";
    if (dateA === dateB) return a.localeCompare(b);
    return dateB.localeCompare(dateA);
  });

  loadTargetsByRaid.forEach((targets, raid) => {
    targets.sort((targetA, targetB) => {
      const dateA = latestDateByLoadTarget[targetA] || "";
      const dateB = latestDateByLoadTarget[targetB] || "";
      if (dateA === dateB) {
        const metaA = targetMetadataByKey.get(targetA);
        const metaB = targetMetadataByKey.get(targetB);
        const labelA = metaA?.boss || metaA?.raid || targetA;
        const labelB = metaB?.boss || metaB?.raid || targetB;
        return labelA.localeCompare(labelB);
      }
      return dateB.localeCompare(dateA);
    });

    if (bossOptionsByRaid[raid]?.length) {
      bossOptionsByRaid[raid].sort((bossA, bossB) => {
        const targetA = resolveLoadTargetForBossLabel(
          raid,
          bossA,
          targetMetadataByKey
        );
        const targetB = resolveLoadTargetForBossLabel(
          raid,
          bossB,
          targetMetadataByKey
        );
        const dateA = latestDateByLoadTarget[targetA] || "";
        const dateB = latestDateByLoadTarget[targetB] || "";
        if (dateA === dateB) {
          return bossA.localeCompare(bossB);
        }
        return dateB.localeCompare(dateA);
      });
    }
  });

  return {
    allFiles,
    filesByRaid,
    filesByLoadTarget,
    latestDateByRaid,
    latestDateByLoadTarget,
    sortedRaids,
    loadTargetsByRaid,
    bossOptionsByRaid,
    bossLatestDatesByRaid,
    targetMetadataByKey,
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
 * Resolve the effective boss label for the supplied raid. Boss-scoped families
 * prefer the requested boss when it is present in the manifest-derived catalog,
 * otherwise they fall back to the newest boss target within that raid.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @param {string} requestedBoss
 * @returns {string}
 */
export function resolveEffectiveBoss(manifestIndex, raid, requestedBoss) {
  const bossOptions = getManifestBossesForRaid(manifestIndex, raid);
  if (!bossOptions.length) {
    return "";
  }

  if (requestedBoss) {
    const matchedBoss = bossOptions.find(
      (boss) =>
        boss === requestedBoss ||
        normalizeBossLabelForComparison(boss) ===
          normalizeBossLabelForComparison(requestedBoss)
    );
    if (matchedBoss) {
      return matchedBoss;
    }
  }

  return bossOptions[0] || "";
}

/**
 * Convert a raid + boss selection into the concrete load target key used by
 * the scheduler and data store. Non-boss-scoped families continue to resolve to
 * the raid label itself so the legacy behavior stays intact.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @param {string} boss
 * @returns {string}
 */
export function resolveActivationTarget(manifestIndex, raid, boss) {
  if (!raid) {
    return "";
  }

  const resolvedBoss = resolveEffectiveBoss(manifestIndex, raid, boss);
  if (!resolvedBoss) {
    return raid;
  }

  return (
    resolveLoadTargetForBossLabel(
      raid,
      resolvedBoss,
      manifestIndex?.targetMetadataByKey
    ) || raid
  );
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

/**
 * Fetch the file records associated with a concrete load target, preserving
 * manifest order.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} loadTarget
 * @returns {Array<Object>}
 */
export function getManifestFilesForLoadTarget(manifestIndex, loadTarget) {
  return manifestIndex?.filesByLoadTarget?.get(loadTarget) || [];
}

/**
 * Retrieve the manifest-derived boss labels for a raid. Non-boss-scoped raids
 * return an empty array so the caller can continue using row-derived bosses.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @returns {Array<string>}
 */
export function getManifestBossesForRaid(manifestIndex, raid) {
  return [...(manifestIndex?.bossOptionsByRaid?.[raid] || [])];
}

/**
 * Determine whether the supplied raid family is currently treated as
 * boss-scoped by the manifest layer.
 *
 * @param {ReturnType<typeof buildManifestRaidIndex>} manifestIndex
 * @param {string} raid
 * @returns {boolean}
 */
export function isBossScopedRaid(manifestIndex, raid) {
  if (!raid || !manifestIndex?.loadTargetsByRaid) {
    return false;
  }
  const targets = manifestIndex.loadTargetsByRaid.get(raid) || [];
  return targets.some((target) => {
    const meta = manifestIndex.targetMetadataByKey.get(target);
    return meta?.scopeType === "boss";
  });
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

function resolveBossSlug(slugSegment, raidSlug) {
  if (!raidSlug) {
    return "";
  }
  const prefix = `${raidSlug}_`;
  if (!slugSegment.startsWith(prefix)) {
    return "";
  }

  const remainder = slugSegment.slice(prefix.length);
  const bossSlug = remainder.split("_")[0] || "";
  return bossSlug;
}

function formatBossSlugForDisplay(slug) {
  return KNOWN_BOSS_SLUGS[slug] || formatSlugForDisplay(slug);
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

function normalizeBossLabelForComparison(value) {
  return String(value).trim().toLowerCase();
}

function resolveLoadTargetForBossLabel(raid, boss, targetMetadataByKey) {
  if (!raid || !boss || !targetMetadataByKey) {
    return "";
  }

  for (const [loadTarget, metadata] of targetMetadataByKey.entries()) {
    if (metadata?.raid !== raid) {
      continue;
    }
    if (
      metadata?.boss === boss ||
      metadata?.bossSlug === normalizeBossLabelForComparison(boss)
    ) {
      return loadTarget;
    }
  }

  return "";
}
