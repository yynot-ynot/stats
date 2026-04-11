/**
 * Create a per-raid data store that holds row blobs and terminal file state for
 * each raid. The controller treats a raid as ready once every file for that
 * raid has either loaded or failed after retry.
 *
 * @param {Map<string, Array<Object>>} filesByRaid
 * @returns {Object}
 */
export function createRaidDataStore(filesByRaid) {
  const raids = new Map();

  Array.from(filesByRaid.keys()).forEach((raid) => {
    raids.set(raid, createRaidRecord(raid, filesByRaid.get(raid) || []));
  });

  function ensureRaid(raid) {
    if (!raids.has(raid)) {
      raids.set(raid, createRaidRecord(raid, []));
    }
    return raids.get(raid);
  }

  function appendFileRows(raid, filePath, rows) {
    const record = ensureRaid(raid);
    if (record.loadedFiles.has(filePath)) return record;

    record.rows.push(...rows);
    record.loadedFiles.add(filePath);
    record.terminalFiles.add(filePath);
    refreshStatus(record);
    return record;
  }

  function markFileFailed(raid, filePath, error) {
    const record = ensureRaid(raid);
    record.failedFiles.set(filePath, error);
    record.terminalFiles.add(filePath);
    refreshStatus(record);
    return record;
  }

  function markRaidLoading(raid) {
    const record = ensureRaid(raid);
    record.status = "loading";
    return record;
  }

  function getRaidRows(raid) {
    return ensureRaid(raid).rows.slice();
  }

  function getRaidRecord(raid) {
    return ensureRaid(raid);
  }

  return {
    appendFileRows,
    markFileFailed,
    markRaidLoading,
    getRaidRows,
    getRaidRecord,
  };
}

function createRaidRecord(raid, files) {
  return {
    raid,
    expectedFiles: new Set(files.map((file) => file.path)),
    terminalFiles: new Set(),
    loadedFiles: new Set(),
    failedFiles: new Map(),
    rows: [],
    status: "empty",
  };
}

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
