import test from "node:test";
import assert from "node:assert/strict";
import { setupSidebarCollapseHandlers } from "../js/ui/jobSidebarManager.js";

// Verifies the auto-collapse gating logic on the job sidebar using lightweight DOM stubs.

/**
 * Lightweight mock of the DOMTokenList interface so tests can assert on
 * `classList` interactions without needing a real DOM implementation.
 * @returns {{add: Function, remove: Function, toggle: Function, contains: Function}}
 */
function createClassListStub() {
  const classes = new Set();
  return {
    add(cls) {
      classes.add(cls);
    },
    remove(cls) {
      classes.delete(cls);
    },
    toggle(cls) {
      if (classes.has(cls)) {
        classes.delete(cls);
        return false;
      }
      classes.add(cls);
      return true;
    },
    contains(cls) {
      return classes.has(cls);
    },
  };
}

/**
 * Build a generic HTMLElement stub that tracks classList and event listeners.
 * Provides `dispatchEvent` helpers so tests can simulate user input.
 * @returns {Object}
 */
function createElementStub() {
  const listeners = {};
  const classList = createClassListStub();
  return {
    classList,
    style: {},
    listeners,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    dispatchEvent(type, event) {
      (listeners[type] || []).forEach((handler) => handler(event));
    },
    contains(target) {
      return target === this;
    },
  };
}

/**
 * Install global `document` and `window` stubs so the sidebar manager can
 * register listeners without referencing the real browser APIs.
 * @returns {{documentStub: Object, windowStub: Object, restore: Function}}
 */
function installDomStubs() {
  const documentListeners = {};
  const windowListeners = {};
  const originalDocument = global.document;
  const originalWindow = global.window;

  const documentStub = {
    listeners: documentListeners,
    addEventListener(type, handler) {
      documentListeners[type] = documentListeners[type] || [];
      documentListeners[type].push(handler);
    },
    elementFromPoint() {
      return null;
    },
  };

  const windowStub = {
    listeners: windowListeners,
    addEventListener(type, handler) {
      windowListeners[type] = windowListeners[type] || [];
      windowListeners[type].push(handler);
    },
  };

  global.document = documentStub;
  global.window = windowStub;

  return {
    documentStub,
    windowStub,
    restore() {
      global.document = originalDocument;
      global.window = originalWindow;
    },
  };
}

// Sidebar must ignore collapse calls until gating is turned on.
test("job sidebar stays open until auto-collapse is enabled", () => {
  const { restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    helpers.collapseSidebar();
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "sidebar should not collapse before a selection is made"
    );

    helpers.setAutoCollapseEnabled(true);
    helpers.collapseSidebar();
    assert.equal(
      sidebar.classList.contains("collapsed"),
      true,
      "auto-collapse may run once enabled"
    );
  } finally {
    restore();
  }
});

// Turning auto-collapse off after enabling should reopen the panel immediately.
test("disabling auto-collapse re-expands the sidebar", () => {
  const { restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    helpers.setAutoCollapseEnabled(true);
    helpers.collapseSidebar();
    assert.equal(sidebar.classList.contains("collapsed"), true);

    helpers.setAutoCollapseEnabled(false);
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "toggling auto-collapse off should reopen the sidebar"
    );
  } finally {
    restore();
  }
});

// Outside clicks only collapse once the user has made an initial selection.
test("document clicks collapse the sidebar only after enabling auto-collapse", () => {
  const { documentStub, restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    const outsideTarget = {};
    const clickHandler = documentStub.listeners.click?.[0];
    assert.ok(
      clickHandler,
      "expected a document click handler to be registered"
    );

    helpers.expandSidebar();
    clickHandler({ target: outsideTarget });
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "sidebar should ignore outside clicks before any selection"
    );

    helpers.setAutoCollapseEnabled(true);
    helpers.expandSidebar();
    clickHandler({ target: outsideTarget });
    assert.equal(
      sidebar.classList.contains("collapsed"),
      true,
      "sidebar should collapse on outside click once auto-collapse is enabled"
    );
  } finally {
    restore();
  }
});
