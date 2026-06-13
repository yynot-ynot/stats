import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("raidLoadScheduler");

/**
 * Create a scheduler that prioritizes one load target at a time while still
 * allowing background warming of sibling targets and unrelated raids at a fixed
 * low concurrency. The public API keeps the legacy `raid` method names as
 * aliases so existing call sites and tests continue to work.
 *
 * @param {Object} config
 * @param {Array<Object>} config.allFiles
 * @param {Map<string, Array<Object>>} [config.filesByLoadTarget]
 * @param {Map<string, Array<Object>>} [config.filesByTarget]
 * @param {Map<string, Array<Object>>} [config.filesByRaid]
 * @param {Map<string, Array<string>>} [config.loadTargetsByRaid]
 * @param {Map<string, Object>} [config.targetMetadataByKey]
 * @param {(record: Object) => Promise<Array<Object>>} config.loadFile
 * @param {(record: Object, rows: Array<Object>) => void} config.onFileLoaded
 * @param {(record: Object, error: Error) => void} config.onFileFailed
 * @param {number} [config.backgroundConcurrency=2]
 * @returns {Object}
 */
export function createRaidLoadScheduler(config) {
  const {
    allFiles,
    filesByLoadTarget,
    filesByTarget,
    filesByRaid,
    loadTargetsByRaid,
    targetMetadataByKey,
    loadFile,
    onFileLoaded,
    onFileFailed,
    backgroundConcurrency = 2,
  } = config;

  const targetFiles = filesByLoadTarget || filesByTarget || filesByRaid;
  const targetRaidMap =
    targetMetadataByKey ||
    buildFallbackTargetMetadata(targetFiles, loadTargetsByRaid || new Map());
  const targetsByRaid =
    loadTargetsByRaid || buildFallbackTargetsByRaid(targetFiles, targetRaidMap);

  const fileStateByPath = new Map();
  allFiles.forEach((record) => {
    fileStateByPath.set(record.path, {
      status: "not_started",
      attempts: 0,
      promise: null,
      error: null,
    });
  });

  let activeTarget = "";
  let backgroundEnabled = false;
  let inFlight = 0;
  const targetWaiters = new Map();

  /**
   * Raise the supplied load target to the front of the shared per-file queue
   * and resolve once that target's files have all reached terminal state. Any
   * already in-flight file is allowed to finish first, but later queue picks
   * always favor the latest active target.
   *
   * @param {string} target
   * @returns {Promise<void>}
   */
  async function prioritizeTarget(target) {
    activeTarget = target;
    logger.info(
      `[ui-active] prioritize target "${target}"; waiting for ${countPendingFilesForTarget(
        target
      )} pending file(s) to reach terminal state`
    );
    pumpQueue();
    await waitForTargetTerminal(target);
    const lane = target === activeTarget ? "ui-active" : "background-cache";
    logger.info(`[${lane}] target "${target}" load pass resolved`);
  }

  /**
   * Backwards-compatible alias retained for the legacy raid-scoped tests and
   * non-boss load paths.
   *
   * @param {string} raid
   * @returns {Promise<void>}
   */
  function prioritizeRaid(raid) {
    return prioritizeTarget(raid);
  }

  /**
   * Allow the scheduler to warm non-active targets after the first active load
   * target becomes ready to use.
   */
  function startBackgroundLoading() {
    backgroundEnabled = true;
    logger.info(
      `[background-cache] enabled with concurrency=${backgroundConcurrency}`
    );
    pumpQueue();
  }

  /**
   * Update the current active target so later background picks skip it.
   *
   * @param {string} target
   */
  function setActiveTarget(target) {
    if (activeTarget !== target) {
      logger.info(`[ui-active] scheduler target -> "${target}"`);
    }
    activeTarget = target;
    pumpQueue();
  }

  /**
   * Backwards-compatible alias retained for the legacy raid-scoped tests and
   * non-boss load paths.
   *
   * @param {string} raid
   */
  function setActiveRaid(raid) {
    setActiveTarget(raid);
  }

  /**
   * Expose read-only file state so tests and the controller can inspect load
   * progress without mutating the scheduler.
   *
   * @param {string} filePath
   * @returns {Object|undefined}
   */
  function getFileState(filePath) {
    return fileStateByPath.get(filePath);
  }

  function pumpQueue() {
    while (inFlight < backgroundConcurrency) {
      const nextRecord = getNextRecord();
      if (!nextRecord) return;
      startLoad(nextRecord);
    }
  }

  function getNextRecord() {
    const activeRecord = getNextRecordForTarget(activeTarget);
    if (activeRecord) {
      return activeRecord;
    }
    if (!backgroundEnabled) {
      return null;
    }

    for (const target of getBackgroundTargetOrder()) {
      const record = getNextRecordForTarget(target);
      if (record) {
        return record;
      }
    }
    return null;
  }

  function getBackgroundTargetOrder() {
    const orderedTargets = [];
    const activeRaid = targetRaidMap.get(activeTarget)?.raid || activeTarget;
    const siblingTargets = targetsByRaid.get(activeRaid) || [];
    siblingTargets.forEach((target) => {
      if (target && target !== activeTarget) {
        orderedTargets.push(target);
      }
    });

    for (const target of targetFiles.keys()) {
      if (target === activeTarget || orderedTargets.includes(target)) {
        continue;
      }
      orderedTargets.push(target);
    }

    return orderedTargets;
  }

  function getNextRecordForTarget(target) {
    if (!target) return null;
    const files = targetFiles.get(target) || [];
    for (const record of files) {
      const state = fileStateByPath.get(record.path);
      if (!isLoadableState(state)) {
        continue;
      }
      return record;
    }
    return null;
  }

  function isLoadableState(state) {
    if (!state) return false;
    if (state.status === "loaded" || state.status === "failed") return false;
    if (state.status === "loading") return false;
    return true;
  }

  function startLoad(record) {
    const state = fileStateByPath.get(record.path);
    if (!state || state.promise || !isLoadableState(state)) return;

    const lane = record.loadTarget === activeTarget ? "active" : "background";
    inFlight += 1;
    state.attempts += 1;
    state.status = "loading";
    state.error = null;
    state.promise = loadFile(record)
      .then((rows) => {
        state.status = "loaded";
        state.promise = null;
        onFileLoaded(record, rows);
      })
      .catch((error) => {
        state.promise = null;
        state.error = error;
        if (state.attempts < 2) {
          state.status = "queued";
          logger.warn(
            `[${lane}] retry queued for ${record.path} (target="${record.loadTarget || record.raid}", attempt=${state.attempts}, error=${error?.message || error})`
          );
          return;
        }
        state.status = "failed";
        logger.warn(
          `[${lane}] failed ${record.path} after ${state.attempts} attempt(s) (target="${record.loadTarget || record.raid}", error=${error?.message || error})`
        );
        onFileFailed(record, error);
      })
      .finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        notifyTargetWaiters(record.loadTarget || record.raid);
        pumpQueue();
      });
  }

  function waitForTargetTerminal(target) {
    if (isTargetTerminal(target)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const waiters = targetWaiters.get(target) || [];
      waiters.push(resolve);
      targetWaiters.set(target, waiters);
    });
  }

  function isTargetTerminal(target) {
    const files = targetFiles.get(target) || [];
    if (files.length === 0) {
      return true;
    }

    return files.every((record) => {
      const state = fileStateByPath.get(record.path);
      return state?.status === "loaded" || state?.status === "failed";
    });
  }

  function notifyTargetWaiters(target) {
    if (!isTargetTerminal(target)) {
      return;
    }
    const { total, loaded, failed } = summarizeTargetState(target);
    const lane = target === activeTarget ? "ui-active" : "background-cache";
    logger.info(
      `[${lane}] target "${target}" reached terminal state (loaded=${loaded}, failed=${failed}, total=${total})`
    );
    const waiters = targetWaiters.get(target);
    if (!waiters?.length) {
      return;
    }
    targetWaiters.delete(target);
    waiters.forEach((resolve) => resolve());
  }

  function countPendingFilesForTarget(target) {
    const files = targetFiles.get(target) || [];
    return files.filter((record) => {
      const state = fileStateByPath.get(record.path);
      return state?.status !== "loaded" && state?.status !== "failed";
    }).length;
  }

  function summarizeTargetState(target) {
    const files = targetFiles.get(target) || [];
    let loaded = 0;
    let failed = 0;
    files.forEach((record) => {
      const status = fileStateByPath.get(record.path)?.status;
      if (status === "loaded") {
        loaded += 1;
      } else if (status === "failed") {
        failed += 1;
      }
    });
    return {
      total: files.length,
      loaded,
      failed,
    };
  }

  return {
    prioritizeTarget,
    prioritizeRaid,
    setActiveTarget,
    setActiveRaid,
    startBackgroundLoading,
    getFileState,
  };
}

function buildFallbackTargetMetadata(targetFiles, loadTargetsByRaid) {
  const metadata = new Map();
  if (!targetFiles) {
    return metadata;
  }

  for (const [target, files] of targetFiles.entries()) {
    const firstRecord = files[0] || {};
    metadata.set(target, {
      raid: firstRecord.raid || target,
      loadTarget: target,
      scopeType: "raid",
      isBossScoped: false,
    });
  }

  if (loadTargetsByRaid?.size) {
    loadTargetsByRaid.forEach((targets, raid) => {
      targets.forEach((target) => {
        const current = metadata.get(target) || { loadTarget: target };
        metadata.set(target, {
          ...current,
          raid,
        });
      });
    });
  }

  return metadata;
}

function buildFallbackTargetsByRaid(targetFiles, metadataByTarget) {
  const targetsByRaid = new Map();
  if (!targetFiles) {
    return targetsByRaid;
  }

  for (const target of targetFiles.keys()) {
    const raid = metadataByTarget.get(target)?.raid || target;
    if (!targetsByRaid.has(raid)) {
      targetsByRaid.set(raid, []);
    }
    targetsByRaid.get(raid).push(target);
  }

  return targetsByRaid;
}
