// core/dataLoader.js

import { getLogger } from "../shared/logging/logger.js"; // updated path

const logger = getLogger("fetchers");

/**
 * Fetch list of available .json.gz files in a given directory (requires server with directory listing).
 * @param {string} directoryPath - Path to directory, e.g., "json/"
 * @returns {Promise<string[]>} List of full paths to .json.gz files.
 */
export async function fetchAvailableJsonFiles(directoryPath) {
  const response = await fetch(directoryPath);
  const html = await response.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const links = Array.from(doc.querySelectorAll("a"));
  const files = links
    .map((link) => link.getAttribute("href"))
    .filter((name) => name.endsWith(".json.gz"))
    .map((name) => `${directoryPath}${name}`);

  logger.info(`Discovered ${files.length} JSON.gz files in ${directoryPath}`);
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
