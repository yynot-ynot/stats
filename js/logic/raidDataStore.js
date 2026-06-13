/**
 * Create a data store that can expose either raid-wide rows or narrower
 * load-target rows from the same underlying file blobs. The store keeps row
 * payloads keyed by file path so a boss-scoped target can be materialized
 * without duplicating row arrays.
 *
 * The constructor accepts either the legacy `Map<raid, files>` signature or a
 * richer config object containing both raid-wide and load-target file maps.
 *
 * @param {Map<string, Array<Object>>|Object} configOrFilesByRaid
 * @returns {Object}
 */
export function createRaidDataStore(configOrFilesByRaid) {
  const {
    filesByRaid,
    filesByLoadTarget,
    loadTargetsByRaid,
  } = normalizeStoreConfig(configOrFilesByRaid);

  const fileRowsByPath = new Map();
  const raids = new Map();
  const targets = new Map();

  Array.from(filesByRaid.keys()).forEach((raid) => {
    raids.set(raid, createScopeRecord(raid, filesByRaid.get(raid) || []));
  });

  Array.from(filesByLoadTarget.keys()).forEach((target) => {
    targets.set(target, createScopeRecord(target, filesByLoadTarget.get(target) || []));
  });

  function ensureRaid(raid) {
    if (!raids.has(raid)) {
      raids.set(raid, createScopeRecord(raid, []));
    }
    return raids.get(raid);
  }

  function ensureTarget(target) {
    if (!targets.has(target)) {
      targets.set(target, createScopeRecord(target, []));
    }
    return targets.get(target);
  }

  /**
   * Append the supplied file rows into the normalized file cache and update any
   * raid/target records that reference the file path. Supports both the new
   * `(record, rows)` signature and the legacy `(raid, filePath, rows)` form.
   *
   * @param {Object|string} recordOrRaid
   * @param {Array<Object>|string} filePathOrRows
   * @param {Array<Object>} [rows]
   * @returns {Object}
   */
  function appendFileRows(recordOrRaid, filePathOrRows, rows) {
    const normalized = normalizeStoreMutationArgs(
      recordOrRaid,
      filePathOrRows,
      rows,
      filesByLoadTarget
    );
    if (!normalized.filePath) {
      return createScopeRecord("", []);
    }

    if (!fileRowsByPath.has(normalized.filePath)) {
      fileRowsByPath.set(normalized.filePath, normalized.rows.slice());
    }

    const targetRecord = ensureTarget(normalized.loadTarget);
    const raidRecord = ensureRaid(normalized.raid);

    if (!targetRecord.loadedFiles.has(normalized.filePath)) {
      targetRecord.loadedFiles.add(normalized.filePath);
      targetRecord.terminalFiles.add(normalized.filePath);
      refreshStatus(targetRecord);
    }

    if (!raidRecord.loadedFiles.has(normalized.filePath)) {
      raidRecord.loadedFiles.add(normalized.filePath);
      raidRecord.terminalFiles.add(normalized.filePath);
      refreshStatus(raidRecord);
    }

    return targetRecord;
  }

  /**
   * Mark a file as permanently failed for whichever raid/target scopes contain
   * it. Supports both the new `(record, error)` signature and the legacy
   * `(raid, filePath, error)` form.
   *
   * @param {Object|string} recordOrRaid
   * @param {Error|string} filePathOrError
   * @param {Error} [error]
   * @returns {Object}
   */
  function markFileFailed(recordOrRaid, filePathOrError, error) {
    const normalized = normalizeStoreFailureArgs(
      recordOrRaid,
      filePathOrError,
      error,
      filesByLoadTarget
    );
    const targetRecord = ensureTarget(normalized.loadTarget);
    const raidRecord = ensureRaid(normalized.raid);

    targetRecord.failedFiles.set(normalized.filePath, normalized.error);
    targetRecord.terminalFiles.add(normalized.filePath);
    refreshStatus(targetRecord);

    raidRecord.failedFiles.set(normalized.filePath, normalized.error);
    raidRecord.terminalFiles.add(normalized.filePath);
    refreshStatus(raidRecord);

    return targetRecord;
  }

  /**
   * Mark a load target as currently loading. This is the preferred method for
   * boss-scoped activation paths.
   *
   * @param {string} target
   * @returns {Object}
   */
  function markTargetLoading(target) {
    const record = ensureTarget(target);
    record.status = "loading";
    return record;
  }

  /**
   * Backwards-compatible alias retained for the legacy raid-scoped controller
   * behavior and existing unit tests.
   *
   * @param {string} raid
   * @returns {Object}
   */
  function markRaidLoading(raid) {
    const record = ensureRaid(raid);
    record.status = "loading";
    return record;
  }

  /**
   * Materialize the loaded rows for a concrete load target.
   *
   * @param {string} target
   * @returns {Array<Object>}
   */
  function getRowsForTarget(target) {
    const record = ensureTarget(target);
    return flattenRows(record.loadedFiles, fileRowsByPath);
  }

  /**
   * Materialize the loaded rows for a raid-wide scope. Boss-scoped families can
   * still use this for diagnostics or future warm-cache views.
   *
   * @param {string} raid
   * @returns {Array<Object>}
   */
  function getRaidRows(raid) {
    const record = ensureRaid(raid);
    return flattenRows(record.loadedFiles, fileRowsByPath);
  }

  /**
   * Retrieve the mutable target record for inspection in tests and controller
   * diagnostics.
   *
   * @param {string} target
   * @returns {Object}
   */
  function getTargetRecord(target) {
    return ensureTarget(target);
  }

  /**
   * Retrieve the mutable raid record for inspection in tests and controller
   * diagnostics.
   *
   * @param {string} raid
   * @returns {Object}
   */
  function getRaidRecord(raid) {
    return ensureRaid(raid);
  }

  /**
   * Summarize load progress for a concrete target using the known file subset
   * from the manifest. Failed files count as terminal because activation
   * readiness already treats them as exhausted work for that target.
   *
   * @param {string} target
   * @returns {{expectedCount: number, terminalCount: number, loadedCount: number, failedCount: number, percentLoaded: number}}
   */
  function getTargetProgress(target) {
    const record = ensureTarget(target);
    const expectedCount = record.expectedFiles.size;
    const terminalCount = record.terminalFiles.size;
    const loadedCount = record.loadedFiles.size;
    const failedCount = record.failedFiles.size;
    const percentLoaded =
      expectedCount === 0 ? 0 : Math.round((terminalCount / expectedCount) * 100);

    return {
      expectedCount,
      terminalCount,
      loadedCount,
      failedCount,
      percentLoaded,
    };
  }

  return {
    appendFileRows,
    markFileFailed,
    markTargetLoading,
    markRaidLoading,
    getRowsForTarget,
    getRaidRows,
    getTargetRecord,
    getRaidRecord,
    getTargetProgress,
    loadTargetsByRaid,
  };
}

function normalizeStoreConfig(configOrFilesByRaid) {
  if (configOrFilesByRaid instanceof Map) {
    return {
      filesByRaid: configOrFilesByRaid,
      filesByLoadTarget: configOrFilesByRaid,
      loadTargetsByRaid: new Map(
        Array.from(configOrFilesByRaid.keys()).map((raid) => [raid, [raid]])
      ),
    };
  }

  const filesByRaid = configOrFilesByRaid?.filesByRaid || new Map();
  const filesByLoadTarget =
    configOrFilesByRaid?.filesByLoadTarget || filesByRaid;
  const loadTargetsByRaid =
    configOrFilesByRaid?.loadTargetsByRaid ||
    new Map(Array.from(filesByRaid.keys()).map((raid) => [raid, [raid]]));

  return {
    filesByRaid,
    filesByLoadTarget,
    loadTargetsByRaid,
  };
}

function normalizeStoreMutationArgs(
  recordOrRaid,
  filePathOrRows,
  rows,
  filesByLoadTarget
) {
  if (recordOrRaid && typeof recordOrRaid === "object" && rows === undefined) {
    return {
      raid: recordOrRaid.raid || recordOrRaid.loadTarget || "",
      loadTarget: recordOrRaid.loadTarget || recordOrRaid.raid || "",
      filePath: recordOrRaid.path || "",
      rows: Array.isArray(filePathOrRows) ? filePathOrRows : [],
    };
  }

  return {
    raid: recordOrRaid || "",
    loadTarget: findOwningTarget(recordOrRaid, filePathOrRows, filesByLoadTarget),
    filePath: filePathOrRows || "",
    rows: Array.isArray(rows) ? rows : [],
  };
}

function normalizeStoreFailureArgs(
  recordOrRaid,
  filePathOrError,
  error,
  filesByLoadTarget
) {
  if (recordOrRaid && typeof recordOrRaid === "object" && error === undefined) {
    return {
      raid: recordOrRaid.raid || recordOrRaid.loadTarget || "",
      loadTarget: recordOrRaid.loadTarget || recordOrRaid.raid || "",
      filePath: recordOrRaid.path || "",
      error: filePathOrError,
    };
  }

  return {
    raid: recordOrRaid || "",
    loadTarget: findOwningTarget(recordOrRaid, filePathOrError, filesByLoadTarget),
    filePath: filePathOrError || "",
    error,
  };
}

function findOwningTarget(raid, filePath, filesByLoadTarget) {
  if (!filePath || !filesByLoadTarget) {
    return raid || "";
  }

  for (const [target, files] of filesByLoadTarget.entries()) {
    if (files.some((file) => file.path === filePath)) {
      return target;
    }
  }

  return raid || "";
}

function createScopeRecord(scope, files) {
  return {
    scope,
    expectedFiles: new Set(files.map((file) => file.path)),
    terminalFiles: new Set(),
    loadedFiles: new Set(),
    failedFiles: new Map(),
    status: "empty",
  };
}

function flattenRows(filePaths, fileRowsByPath) {
  const rows = [];
  filePaths.forEach((filePath) => {
    const fileRows = fileRowsByPath.get(filePath);
    if (fileRows?.length) {
      rows.push(...fileRows);
    }
  });
  return rows;
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
