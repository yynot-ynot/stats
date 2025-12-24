// shared/logging/logger.js

/**
 * Logging levels for controlling output verbosity.
 */
const LOG_LEVELS = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

// Map of moduleName → log level
const moduleLevels = new Map();

/**
 * Set the logging level for a given module.
 * @param {string} moduleName - Identifier for the module using the logger.
 * @param {string} levelName - One of: "none", "error", "warn", "info", "debug".
 *   Use {@link envLogLevel} when you want the level to adapt to host env.
 */
export function setModuleLogLevel(moduleName, levelName) {
  moduleLevels.set(moduleName, LOG_LEVELS[levelName] ?? LOG_LEVELS.info);
}

/**
 * Check if a log at the given level should be emitted for the module.
 * @param {string} moduleName
 * @param {number} level
 * @returns {boolean}
 */
function shouldLog(moduleName, level) {
  const moduleLevel = moduleLevels.get(moduleName);
  return moduleLevel != null && level <= moduleLevel;
}

/**
 * Returns a logger object for the given module, with methods for each log level.
 * @param {string} moduleName - Label for identifying logs from this module.
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 */
export function getLogger(moduleName) {
  return {
    debug: (...args) => {
      if (shouldLog(moduleName, LOG_LEVELS.debug)) {
        console.debug(`[${moduleName}] [DEBUG]`, ...args);
      }
    },
    info: (...args) => {
      if (shouldLog(moduleName, LOG_LEVELS.info)) {
        console.info(`[${moduleName}] [INFO]`, ...args);
      }
    },
    warn: (...args) => {
      if (shouldLog(moduleName, LOG_LEVELS.warn)) {
        console.warn(`[${moduleName}] [WARN]`, ...args);
      }
    },
    error: (...args) => {
      if (shouldLog(moduleName, LOG_LEVELS.error)) {
        console.error(`[${moduleName}] [ERROR]`, ...args);
      }
    },
  };
}

/**
 * Picks a log level string based on whether we are running on localhost.
 * @param {string} [localLevel="debug"] - Level to use when running locally.
 * @param {string} [prodLevel="info"] - Level to use for non-local hosts.
 * @returns {string}
 */
export function envLogLevel(localLevel = "debug", prodLevel = "info") {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  return isLocalhost ? localLevel : prodLevel;
}
