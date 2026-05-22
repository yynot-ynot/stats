import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("raidLoadScheduler");

/**
 * Create a scheduler that prioritizes one raid's file set while still allowing
 * background warming of non-active raids at a fixed low concurrency.
 *
 * @param {Object} config
 * @param {Array<Object>} config.allFiles
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

  let activeRaid = "";
  let backgroundEnabled = false;
  let inFlight = 0;
  const raidWaiters = new Map();

  /**
   * Raise the supplied raid to the front of the shared per-file queue and
   * resolve once that raid's files have all reached a terminal state. Any
   * already in-flight file is allowed to finish first, but later queue picks
   * always favor the latest active raid.
   *
   * @param {string} raid
   * @returns {Promise<void>}
   */
  async function prioritizeRaid(raid) {
    activeRaid = raid;
    logger.info(
      `[ui-active] prioritize raid "${raid}"; waiting for ${countPendingFilesForRaid(
        raid
      )} pending file(s) to reach terminal state`
    );
    pumpQueue();
    await waitForRaidTerminal(raid);
    const lane = raid === activeRaid ? "ui-active" : "background-cache";
    logger.info(`[${lane}] raid "${raid}" load pass resolved`);
  }

  /**
   * Allow the scheduler to warm non-active raids after the first active raid
   * becomes ready to use.
   */
  function startBackgroundLoading() {
    backgroundEnabled = true;
    logger.info(
      `[background-cache] enabled with concurrency=${backgroundConcurrency}`
    );
    pumpQueue();
  }

  /**
   * Update the current active raid so later background picks skip it.
   *
   * @param {string} raid
   */
  function setActiveRaid(raid) {
    if (activeRaid !== raid) {
      logger.info(`[ui-active] scheduler target raid -> "${raid}"`);
    }
    activeRaid = raid;
    pumpQueue();
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
    const activeRecord = getNextRecordForRaid(activeRaid);
    if (activeRecord) {
      return activeRecord;
    }
    if (!backgroundEnabled) {
      return null;
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

  function getNextRecordForRaid(raid) {
    if (!raid) return null;
    const files = filesByRaid.get(raid) || [];
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

    const lane = record.raid === activeRaid ? "active" : "background";
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
            `[${lane}] retry queued for ${record.path} (raid="${record.raid}", attempt=${state.attempts}, error=${error?.message || error})`
          );
          return;
        }
        state.status = "failed";
        logger.warn(
          `[${lane}] failed ${record.path} after ${state.attempts} attempt(s) (raid="${record.raid}", error=${error?.message || error})`
        );
        onFileFailed(record, error);
      })
      .finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        notifyRaidWaiters(record.raid);
        pumpQueue();
      });
  }

  function waitForRaidTerminal(raid) {
    if (isRaidTerminal(raid)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const waiters = raidWaiters.get(raid) || [];
      waiters.push(resolve);
      raidWaiters.set(raid, waiters);
    });
  }

  function isRaidTerminal(raid) {
    const files = filesByRaid.get(raid) || [];
    if (files.length === 0) {
      return true;
    }

    return files.every((record) => {
      const state = fileStateByPath.get(record.path);
      return state?.status === "loaded" || state?.status === "failed";
    });
  }

  function notifyRaidWaiters(raid) {
    if (!isRaidTerminal(raid)) {
      return;
    }
    const { total, loaded, failed } = summarizeRaidState(raid);
    const lane = raid === activeRaid ? "ui-active" : "background-cache";
    logger.info(
      `[${lane}] raid "${raid}" reached terminal state (loaded=${loaded}, failed=${failed}, total=${total})`
    );
    const waiters = raidWaiters.get(raid);
    if (!waiters?.length) {
      return;
    }
    raidWaiters.delete(raid);
    waiters.forEach((resolve) => resolve());
  }

  function countPendingFilesForRaid(raid) {
    const files = filesByRaid.get(raid) || [];
    return files.filter((record) => {
      const state = fileStateByPath.get(record.path);
      return state?.status !== "loaded" && state?.status !== "failed";
    }).length;
  }

  function summarizeRaidState(raid) {
    const files = filesByRaid.get(raid) || [];
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
    prioritizeRaid,
    setActiveRaid,
    startBackgroundLoading,
    getFileState,
  };
}
