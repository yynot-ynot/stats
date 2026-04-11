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
  let backgroundInFlight = 0;

  /**
   * Attempt every file for the active raid immediately. Files already loading
   * are reused, and a first failure is retried once at active priority.
   *
   * @param {string} raid
   * @returns {Promise<void>}
   */
  async function prioritizeRaid(raid) {
    activeRaid = raid;
    const files = filesByRaid.get(raid) || [];
    await Promise.all(files.map((record) => ensurePriorityLoad(record)));
    pumpBackgroundQueue();
  }

  /**
   * Allow the scheduler to warm non-active raids after the first active raid
   * becomes ready to use.
   */
  function startBackgroundLoading() {
    backgroundEnabled = true;
    pumpBackgroundQueue();
  }

  /**
   * Update the current active raid so later background picks skip it.
   *
   * @param {string} raid
   */
  function setActiveRaid(raid) {
    activeRaid = raid;
    pumpBackgroundQueue();
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

  function pumpBackgroundQueue() {
    if (!backgroundEnabled) return;

    while (backgroundInFlight < backgroundConcurrency) {
      const nextRecord = getNextBackgroundRecord();
      if (!nextRecord) return;

      backgroundInFlight += 1;
      ensureBackgroundLoad(nextRecord).finally(() => {
        backgroundInFlight = Math.max(0, backgroundInFlight - 1);
        pumpBackgroundQueue();
      });
    }
  }

  function getNextBackgroundRecord() {
    for (const record of allFiles) {
      if (record.raid === activeRaid) continue;
      const state = fileStateByPath.get(record.path);
      if (!state) continue;
      if (state.status === "loaded" || state.status === "failed") continue;
      if (state.status === "loading") continue;
      return record;
    }
    return null;
  }

  async function ensurePriorityLoad(record) {
    const state = fileStateByPath.get(record.path);
    if (!state) return;
    if (state.status === "loaded" || state.status === "failed") return;
    if (state.promise) {
      await state.promise;
      return;
    }

    state.attempts += 1;
    state.status = "loading";
    state.error = null;
    state.promise = loadFile(record)
      .then((rows) => {
        state.status = "loaded";
        state.promise = null;
        onFileLoaded(record, rows);
      })
      .catch(async (error) => {
        state.promise = null;
        state.error = error;
        if (state.attempts < 2) {
          state.status = "queued";
          await ensurePriorityLoad(record);
          return;
        }
        state.status = "failed";
        onFileFailed(record, error);
      });

    await state.promise;
  }

  async function ensureBackgroundLoad(record) {
    const state = fileStateByPath.get(record.path);
    if (!state) return;
    if (state.status === "loaded" || state.status === "failed") return;
    if (state.promise) {
      await state.promise;
      return;
    }

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
          return;
        }
        state.status = "failed";
        onFileFailed(record, error);
      });

    await state.promise;
  }

  return {
    prioritizeRaid,
    setActiveRaid,
    startBackgroundLoading,
    getFileState,
  };
}
