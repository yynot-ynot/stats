import { getLogger } from "../shared/logging/logger.js";

const logger = getLogger("viewState");

const VALID_VIEWS = ["trend", "percentile"];
const DEFAULT_VIEW = "trend";

let initialized = false;
let currentView = DEFAULT_VIEW;
const listeners = new Set();

/**
 * Determine if the provided view id exists in the allowed list.
 * This guard prevents unsupported strings from polluting history state.
 * @param {string} view
 * @returns {boolean}
 */
function isValidView(view) {
  return typeof view === "string" && VALID_VIEWS.includes(view);
}

/**
 * Read the current browser URL and resolve the active view.
 * Prefers the `view` query parameter, falling back to the hash.
 * Returns the default view when nothing usable is present.
 * @returns {string}
 */
function resolveViewFromLocation() {
  try {
    const url = new URL(window.location.href);
    const queryView = url.searchParams.get("view");
    if (isValidView(queryView)) {
      return queryView;
    }
    const hash = url.hash?.replace(/^#/, "");
    if (isValidView(hash)) {
      return hash;
    }
  } catch (err) {
    logger.warn("Unable to parse view from URL", err);
  }
  return DEFAULT_VIEW;
}

/**
 * Write the provided view into the URL while keeping other parameters intact.
 * Handles both replaceState/pushState so the user can navigate with the back button.
 * @param {string} view - Target view id.
 * @param {Object} options
 * @param {boolean} [options.replace=false] - Whether to replace the current history entry.
 */
function updateUrl(view, { replace = false } = {}) {
  try {
    const url = new URL(window.location.href);
    if (view === DEFAULT_VIEW) {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    const newUrl = `${url.pathname}${url.search}${url.hash}`;
    if (replace) {
      window.history.replaceState({ view }, "", newUrl);
    } else {
      window.history.pushState({ view }, "", newUrl);
    }
  } catch (err) {
    logger.warn("Failed to update URL for view", err);
  }
}

/**
 * Notify all registered listeners about a view change.
 * Wraps each callback in try/catch so a single error does not halt the others.
 * @param {string} view
 */
function notify(view) {
  listeners.forEach((listener) => {
    try {
      listener(view);
    } catch (err) {
      logger.warn("View listener error", err);
    }
  });
}

/**
 * Browser popstate handler that re-syncs the internal view registry
 * whenever the user navigates via the back/forward buttons.
 */
function handlePopState() {
  const resolved = resolveViewFromLocation();
  if (resolved !== currentView) {
    currentView = resolved;
    notify(currentView);
  }
}

/**
 * Initialize the module by resolving the first view and wiring popstate listeners.
 * Safe to call multiple times; subsequent invocations simply return the current view.
 * @returns {string} The resolved active view.
 */
export function initViewState() {
  if (initialized) return currentView;
  currentView = resolveViewFromLocation();
  window.addEventListener("popstate", handlePopState);
  initialized = true;
  return currentView;
}

/**
 * Retrieve the current in-memory view id.
 * @returns {string}
 */
export function getCurrentView() {
  return currentView;
}

/**
 * Programmatically switch to a new view and optionally sync the URL.
 * No-ops if an invalid id is provided or the view is already active.
 * @param {string} view - Target view id.
 * @param {Object} [options]
 * @param {boolean} [options.syncUrl=true] - Disable URL updates when false.
 * @param {boolean} [options.replaceUrl=false] - Replace history entry instead of pushing.
 */
export function setActiveView(view, options = {}) {
  if (!isValidView(view)) {
    logger.warn(`Attempted to set unknown view: ${view}`);
    return;
  }
  if (view === currentView) return;
  currentView = view;
  if (options.syncUrl !== false) {
    updateUrl(view, { replace: options.replaceUrl });
  }
  notify(currentView);
}

/**
 * Subscribe to view changes. The listener is invoked immediately with the current view.
 * Returns an unsubscribe function to detach the listener later.
 * @param {Function} listener
 * @returns {Function} Unsubscribe callback.
 */
export function subscribeToViewChanges(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  listener(currentView);
  return () => listeners.delete(listener);
}

/**
 * Return a copy of the available view ids.
 * @returns {Array<string>}
 */
export function getAvailableViews() {
  return [...VALID_VIEWS];
}

/**
 * Expose the default view id so callers can remain in sync with this module.
 * @returns {string}
 */
export function getDefaultView() {
  return DEFAULT_VIEW;
}
