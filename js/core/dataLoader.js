// core/dataLoader.js

import { getLogger } from "../shared/logging/logger.js";
const logger = getLogger("fetchers");

/**
 * Fetch list of available .json.gz files from a manifest file.
 * @param {string} directoryPath - Path to directory, e.g., "json/"
 * @returns {Promise<string[]>} List of full paths to .json.gz files.
 */
export async function fetchAvailableJsonFiles(directoryPath) {
  const manifestPath = "config/file_manifest.json";
  const response = await fetch(manifestPath);
  const filenames = await response.json();

  const files = filenames.map((name) => `${directoryPath}${name}`);

  logger.info(`Loaded ${files.length} JSON.gz files from manifest`);
  return files;
}

/**
 * Fetch and decompress a Gzipped JSON file.
 * Logs timing at debug level.
 * @param {string} filePath
 * @returns {Promise<any>}
 */
export async function fetchAndDecompressJsonGz(filePath) {
  const start = performance.now();

  try {
    const response = await fetch(filePath);
    const buffer = await response.arrayBuffer();

    const decompressed = new TextDecoder("utf-8").decode(
      pako.ungzip(new Uint8Array(buffer))
    );

    const parsed = JSON.parse(decompressed);
    return parsed;
  } finally {
    const duration = (performance.now() - start).toFixed(2);
    logger.debug(`Decompressed ${filePath} in ${duration}ms`);
  }
}
