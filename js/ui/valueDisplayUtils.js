// js/ui/valueDisplayUtils.js

import { parsePairedHealerClasses } from "./classSidebarManager.js";

/**
 * Determines if the provided class name is a paired/composite (currently only healer) class.
 * @param {string} className
 * @returns {boolean}
 */
export function isCompositeClass(className) {
  return !!parsePairedHealerClasses(className);
}

/**
 * Gets the display label for a class.
 * If composite (paired) class, returns "Avg.(ClassName)".
 * @param {string} className
 * @returns {string}
 */
export function getDisplayLabelForClass(className) {
  if (isCompositeClass(className)) {
    return `Avg.(${className})`;
  }
  return className;
}

/**
 * Returns the adjusted value for a class.
 * If paired/composite, halves the value (future logic could extend to other types).
 * @param {string} className
 * @param {number} value
 * @returns {number}
 */
export function getAdjustedValueForClass(className, value) {
  if (isCompositeClass(className)) {
    return value / 2;
  }
  return value;
}
