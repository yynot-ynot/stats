/**
 * Create a per-entity data store that holds row blobs and terminal file state
 * for each independently loadable raid/entity selection.
 *
 * @param {Map<string, Array<Object>>} filesByGroup
 * @returns {Object}
 */
export function createRaidDataStore(filesByGroup) {
  const groups = new Map();

  Array.from(filesByGroup.keys()).forEach((groupKey) => {
    groups.set(groupKey, createGroupRecord(groupKey, filesByGroup.get(groupKey) || []));
  });

  /**
   * Ensure the store always has a record for the requested entity group, even
   * if callers ask about it before any file transitions have happened.
   *
   * @param {string} groupKey
   * @returns {Object}
   */
  function ensureGroup(groupKey) {
    if (!groups.has(groupKey)) {
      groups.set(groupKey, createGroupRecord(groupKey, []));
    }
    return groups.get(groupKey);
  }

  /**
   * Append one file's decompressed rows into the owning entity group.
   *
   * Files are idempotent at the path level so duplicate load callbacks cannot
   * double-count rows if retries or repeated signals occur.
   *
   * @param {string} groupKey
   * @param {string} filePath
   * @param {Array<Object>} rows
   * @returns {Object}
   */
  function appendFileRows(groupKey, filePath, rows) {
    const record = ensureGroup(groupKey);
    if (record.loadedFiles.has(filePath)) return record;

    record.rows.push(...rows);
    record.loadedFiles.add(filePath);
    record.terminalFiles.add(filePath);
    refreshStatus(record);
    return record;
  }

  /**
   * Mark one file as terminally failed while preserving any rows already loaded
   * from sibling files in the same entity group.
   *
   * @param {string} groupKey
   * @param {string} filePath
   * @param {Error} error
   * @returns {Object}
   */
  function markFileFailed(groupKey, filePath, error) {
    const record = ensureGroup(groupKey);
    record.failedFiles.set(filePath, error);
    record.terminalFiles.add(filePath);
    refreshStatus(record);
    return record;
  }

  /**
   * Surface that the controller has begun waiting on this entity group.
   *
   * @param {string} groupKey
   * @returns {Object}
   */
  function markGroupLoading(groupKey) {
    const record = ensureGroup(groupKey);
    record.status = "loading";
    return record;
  }

  /**
   * Return a defensive copy so callers can derive UI state without mutating the
   * canonical row cache.
   *
   * @param {string} groupKey
   * @returns {Array<Object>}
   */
  function getGroupRows(groupKey) {
    return ensureGroup(groupKey).rows.slice();
  }

  /**
   * Expose the bookkeeping record for tests and controller diagnostics.
   *
   * @param {string} groupKey
   * @returns {Object}
   */
  function getGroupRecord(groupKey) {
    return ensureGroup(groupKey);
  }

  return {
    appendFileRows,
    markFileFailed,
    markGroupLoading,
    getGroupRows,
    getGroupRecord,
  };
}

/**
 * Build the mutable bookkeeping record used for one raid/entity selection.
 *
 * @param {string} groupKey
 * @param {Array<Object>} files
 * @returns {Object}
 */
function createGroupRecord(groupKey, files) {
  return {
    groupKey,
    expectedFiles: new Set(files.map((file) => file.path)),
    terminalFiles: new Set(),
    loadedFiles: new Set(),
    failedFiles: new Map(),
    rows: [],
    status: "empty",
  };
}

/**
 * Collapse file-level terminal state into the coarse store status used by the
 * controller. A group is "ready" once every expected file either loaded or
 * failed, because the UI can render partial data and surface failures
 * separately.
 *
 * @param {Object} record
 */
function refreshStatus(record) {
  if (record.terminalFiles.size === 0) {
    record.status = "loading";
    return;
  }
  if (record.terminalFiles.size < record.expectedFiles.size) {
    record.status = "loading";
    return;
  }
  record.status = "ready";
}
