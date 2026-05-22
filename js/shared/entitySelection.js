/**
 * Resolve the stable entity identifier carried on a row. Phase-aware and
 * boss-aware manifest loading attaches `entitySlug` during file load so the UI
 * can use compact slugs internally while preserving legacy row labels in `boss`.
 *
 * @param {Object} row
 * @returns {string}
 */
export function getRowEntitySlug(row) {
  return row?.entitySlug || row?.boss || "";
}

/**
 * Match a row against the currently selected entity identifier.
 *
 * Backward compatibility note: older datasets and many unit tests still only
 * provide `boss`. Falling back to boss preserves those callers while new
 * entity-aware selections can use `entitySlug`.
 *
 * @param {Object} row
 * @param {string} selectedEntity
 * @returns {boolean}
 */
export function rowMatchesSelectedEntity(row, selectedEntity) {
  if (!selectedEntity) return true;
  return getRowEntitySlug(row) === selectedEntity || row?.boss === selectedEntity;
}
