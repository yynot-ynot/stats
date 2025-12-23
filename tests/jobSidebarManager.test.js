import test from "node:test";
import assert from "node:assert/strict";

import {
  setupSidebarCollapseHandlers,
  buildJobSelectionSignature,
  toggleGroupSelectionState,
} from "../js/ui/jobSidebarManager.js";

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

test("buildJobSelectionSignature returns empty string for empty selections", () => {
  assert.equal(buildJobSelectionSignature(null), "");
  assert.equal(buildJobSelectionSignature(undefined), "");
  assert.equal(buildJobSelectionSignature([]), "");
});

test("buildJobSelectionSignature sorts job names deterministically", () => {
  const setA = new Set(["Paladin", "Warrior", "Dark Knight"]);
  const arrayB = ["Dark Knight", "Paladin", "Warrior"];
  assert.equal(buildJobSelectionSignature(setA), buildJobSelectionSignature(arrayB));
});

/**
 * Minimal stub that mimics the job icon elements in the sidebar.
 * We only need classList semantics so the helper reuses the shared Set-based classList stub.
 */
function createIconStub() {
  return {
    classList: createClassListStub(),
  };
}

// The next two tests ensure the group header toggles add/remove jobs consistently.
// They explicitly assert both the underlying Set state and the DOM class mirror.
test("toggleGroupSelectionState selects all jobs when any are unselected", () => {
  const selectedJobs = new Set(["Dragoon"]);
  const jobNames = ["Paladin", "Warrior"];
  const iconElements = jobNames.map(() => createIconStub());

  const result = toggleGroupSelectionState(
    jobNames,
    iconElements,
    selectedJobs
  );

  assert.equal(result, true, "expected selection pass when jobs missing");
  assert.ok(selectedJobs.has("Paladin"));
  assert.ok(selectedJobs.has("Warrior"));
  iconElements.forEach((icon) => {
    assert.equal(
      icon.classList.contains("selected"),
      true,
      "icon element should reflect selected class"
    );
  });
});

test("toggleGroupSelectionState deselects jobs when all are already selected", () => {
  const selectedJobs = new Set(["Paladin", "Warrior"]);
  const jobNames = ["Paladin", "Warrior"];
  const iconElements = jobNames.map(() => createIconStub());
  iconElements.forEach((icon) => icon.classList.add("selected"));

  const result = toggleGroupSelectionState(
    jobNames,
    iconElements,
    selectedJobs
  );

  assert.equal(result, false, "expected deselection when all jobs selected");
  assert.equal(selectedJobs.has("Paladin"), false);
  assert.equal(selectedJobs.has("Warrior"), false);
  iconElements.forEach((icon) => {
    assert.equal(
      icon.classList.contains("selected"),
      false,
      "icon element should remove selected class"
    );
  });
});
