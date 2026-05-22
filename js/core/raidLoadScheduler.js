import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("raidLoadScheduler");

/**
 * Create a scheduler that prioritizes one raid/entity file set while still
 * allowing background warming of related entities and then other raids.
 *
 * Queue policy:
 * 1. Finish the currently selected raid/entity group first.
 * 2. Then warm sibling entities in that same raid.
 * 3. Only after that spend capacity on unrelated raids.
 *
 * Any already in-flight file is allowed to finish; reprioritization only
 * changes what the scheduler starts next.
 *
 * @param {Object} config
 * @param {Array<Object>} config.allFiles
 * @param {Map<string, Array<Object>>} config.filesByGroup
 * @param {Map<string, Array<Object>>} config.filesByRaid
 * @param {(record: Object) => Promise<Array<Object>>} config.loadFile
 * @param {(record: Object, rows: Array<Object>) => void} config.onFileLoaded
 * @param {(record: Object, error: Error) => void} config.onFileFailed
 * @param {number} [config.backgroundConcurrency=2]
 * @returns {Object}
 */
export function createRaidLoadScheduler(config) {
  const {
    allFiles,
    filesByGroup,
    filesByRaid,
    loadFile,
    onFileLoaded,
    onFileFailed,
    backgroundConcurrency = 2,
  } = config;

  const fileStateByPath = new Map();
  allFiles.forEach((record) => {
    fileStateByPath.set(record.path, {
      status: "not_started",
      attempts: 0,
      promise: null,
      error: null,
    });
  });

  let activeGroupKey = "";
  let activeRaid = "";
  let backgroundEnabled = false;
  let inFlight = 0;
  const groupWaiters = new Map();

  /**
   * Raise the supplied raid/entity selection to the front of the shared queue
   * and resolve once only that entity's files have all reached terminal state.
   *
   * Important nuance: any already in-flight file is allowed to finish first,
   * but later queue picks always favor the latest active selection.
   *
   * @param {string} groupKey
   * @returns {Promise<void>}
   */
  async function prioritizeSelection(groupKey) {
    activeGroupKey = groupKey;
    activeRaid = groupKey.split("::")[0] || "";
    logger.info(
      `[ui-active] prioritize selection "${groupKey}"; waiting for ${countPendingFilesForGroup(
        groupKey
      )} pending file(s) to reach terminal state`
    );
    pumpQueue();
    await waitForGroupTerminal(groupKey);
    const lane = groupKey === activeGroupKey ? "ui-active" : "background-cache";
    logger.info(`[${lane}] selection "${groupKey}" load pass resolved`);
  }

  /**
   * Allow the scheduler to warm non-active work after the first active
   * selection becomes usable. Background work still prefers sibling entities in
   * the active raid before unrelated raids so the UI can offer nearby slices
   * with less waiting.
   */
  function startBackgroundLoading() {
    backgroundEnabled = true;
    logger.info(
      `[background-cache] enabled with concurrency=${backgroundConcurrency}`
    );
    pumpQueue();
  }

  /**
   * Update the current active selection so later queue picks favor it.
   * This does not cancel current network/file work; it only reprioritizes the
   * next record chosen once capacity frees up.
   *
   * @param {string} groupKey
   */
  function setActiveSelection(groupKey) {
    if (activeGroupKey !== groupKey) {
      logger.info(`[ui-active] scheduler target selection -> "${groupKey}"`);
    }
    activeGroupKey = groupKey;
    activeRaid = groupKey.split("::")[0] || "";
    pumpQueue();
  }

  function getFileState(filePath) {
    return fileStateByPath.get(filePath);
  }

  /**
   * Keep the worker slots full up to the configured concurrency while obeying
   * the current selection priority rules.
   */
  function pumpQueue() {
    while (inFlight < backgroundConcurrency) {
      const nextRecord = getNextRecord();
      if (!nextRecord) return;
      startLoad(nextRecord);
    }
  }

  function getNextRecord() {
    const activeRecord = getNextRecordForGroup(activeGroupKey);
    if (activeRecord) {
      return activeRecord;
    }
    if (!backgroundEnabled) {
      return null;
    }

    const sameRaidRecord = getNextBackgroundRecordForActiveRaid();
    if (sameRaidRecord) {
      return sameRaidRecord;
    }

    for (const record of allFiles) {
      if (record.raid === activeRaid) {
        continue;
      }
      const state = fileStateByPath.get(record.path);
      if (!isLoadableState(state)) {
        continue;
      }
      return record;
    }
    return null;
  }

  function getNextBackgroundRecordForActiveRaid() {
    if (!activeRaid) return null;
    const files = filesByRaid.get(activeRaid) || [];
    for (const record of files) {
      if (record.groupKey === activeGroupKey) {
        continue;
      }
      const state = fileStateByPath.get(record.path);
      if (!isLoadableState(state)) {
        continue;
      }
      return record;
    }
    return null;
  }

  function getNextRecordForGroup(groupKey) {
    if (!groupKey) return null;
    const files = filesByGroup.get(groupKey) || [];
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

    const lane = record.groupKey === activeGroupKey ? "active" : "background";
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
            `[${lane}] retry queued for ${record.path} (selection="${record.groupKey}", attempt=${state.attempts}, error=${error?.message || error})`
          );
          return;
        }
        state.status = "failed";
        logger.warn(
          `[${lane}] failed ${record.path} after ${state.attempts} attempt(s) (selection="${record.groupKey}", error=${error?.message || error})`
        );
        onFileFailed(record, error);
      })
      .finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        notifyGroupWaiters(record.groupKey);
        pumpQueue();
      });
  }

  function waitForGroupTerminal(groupKey) {
    if (isGroupTerminal(groupKey)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const waiters = groupWaiters.get(groupKey) || [];
      waiters.push(resolve);
      groupWaiters.set(groupKey, waiters);
    });
  }

  function isGroupTerminal(groupKey) {
    const files = filesByGroup.get(groupKey) || [];
    if (files.length === 0) {
      return true;
    }

    return files.every((record) => {
      const state = fileStateByPath.get(record.path);
      return state?.status === "loaded" || state?.status === "failed";
    });
  }

  function notifyGroupWaiters(groupKey) {
    if (!isGroupTerminal(groupKey)) {
      return;
    }
    const { total, loaded, failed } = summarizeGroupState(groupKey);
    const lane = groupKey === activeGroupKey ? "ui-active" : "background-cache";
    logger.info(
      `[${lane}] selection "${groupKey}" reached terminal state (loaded=${loaded}, failed=${failed}, total=${total})`
    );
    const waiters = groupWaiters.get(groupKey);
    if (!waiters?.length) {
      return;
    }
    groupWaiters.delete(groupKey);
    waiters.forEach((resolve) => resolve());
  }

  function countPendingFilesForGroup(groupKey) {
    const files = filesByGroup.get(groupKey) || [];
    return files.filter((record) => {
      const state = fileStateByPath.get(record.path);
      return state?.status !== "loaded" && state?.status !== "failed";
    }).length;
  }

  function summarizeGroupState(groupKey) {
    const files = filesByGroup.get(groupKey) || [];
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
    prioritizeSelection,
    setActiveSelection,
    startBackgroundLoading,
    getFileState,
  };
}
