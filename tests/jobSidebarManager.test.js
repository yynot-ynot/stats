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

/**
 * Desktop scroll regression:
 * Confirm the new touch guards do not break the original mouse/trackpad behavior.
 * The test obtains the window scroll handler installed by the sidebar helper,
 * enables auto-collapse, expands the sidebar, then triggers the handler to mimic
 * a wheel scroll outside the sidebar, expecting the sidebar to collapse.
 */
test("window scroll still collapses sidebar for mouse interactions", () => {
  const { windowStub, restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    /**
     * Verify desktop-style scroll collapse still works:
     * 1. Capture the synthetic window scroll handler installed by the helper.
     * 2. Enable auto-collapse and expand the sidebar.
     * 3. Invoke the handler to simulate a mouse/trackpad scroll.
     * Expectation: sidebar collapses because no touch session is active.
     */
    const scrollHandler = windowStub.listeners.scroll?.[0];
    assert.ok(scrollHandler, "expected window scroll handler to exist");

    helpers.setAutoCollapseEnabled(true);
    helpers.expandSidebar();
    scrollHandler({});

    assert.equal(
      sidebar.classList.contains("collapsed"),
      true,
      "scrolling with no touch session should collapse the sidebar"
    );
  } finally {
    restore();
  }
});

/**
 * Single-touch guard:
 * Validates that starting a touch inside the sidebar suppresses collapse while
 * the finger remains down. The test synthesizes a sidebar-touchstart, fires the
 * window scroll handler (which would normally collapse), verifies the sidebar
 * stays open, then ends the touch and confirms a subsequent scroll collapses it.
 */
test("touch sessions keep the sidebar open until touches end", () => {
  const { windowStub, restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    /**
     * Ensures a touch drag originating in the sidebar prevents scroll-induced collapse:
     * 1. Start a touch inside the sidebar (mock touchstart).
     * 2. Fire the window scroll handler; sidebar should stay open.
     * 3. End the touch, then scroll again; sidebar should now collapse.
     */
    helpers.setAutoCollapseEnabled(true);
    helpers.expandSidebar();

    const scrollHandler = windowStub.listeners.scroll?.[0];
    assert.ok(scrollHandler, "expected window scroll handler");

    const sidebarTouchStart = sidebar.listeners.touchstart?.[0];
    const sidebarTouchEnd = sidebar.listeners.touchend?.[0];
    assert.ok(sidebarTouchStart, "sidebar touchstart handler missing");
    assert.ok(sidebarTouchEnd, "sidebar touchend handler missing");

    sidebarTouchStart({ changedTouches: [{}] });
    scrollHandler({});
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "touch drag should hold the sidebar open"
    );

    sidebarTouchEnd({ changedTouches: [{}] });
    scrollHandler({});
    assert.equal(
      sidebar.classList.contains("collapsed"),
      true,
      "sidebar collapses once the touch interaction fully ends"
    );
  } finally {
    restore();
  }
});

/**
 * Outside touch immediacy:
 * Ensures that tapping anywhere outside the sidebar now triggers collapse on
 * touchstart (without waiting for movement). The test fires the document
 * touchstart handler with an unrelated target and expects an immediate collapse.
 */
test("outside touchstart collapses immediately when auto-collapse is enabled", () => {
  const { documentStub, restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    /**
     * Confirms the new outside-touch guard collapses without waiting for movement:
     * 1. Retrieve the document-level touchstart handler.
     * 2. Enable auto-collapse and expand the sidebar.
     * 3. Fire touchstart with a target outside both sidebar and label.
     * Expectation: sidebar collapses immediately.
     */
    const touchStartHandler = documentStub.listeners.touchstart?.[0];
    assert.ok(touchStartHandler, "expected document touchstart handler");

    helpers.setAutoCollapseEnabled(true);
    helpers.expandSidebar();

    touchStartHandler({ target: {}, changedTouches: [{}] });
    assert.equal(
      sidebar.classList.contains("collapsed"),
      true,
      "touching outside should collapse immediately"
    );
  } finally {
    restore();
  }
});

/**
 * Label tap tolerance:
 * Verifies that tapping the persistent label does not accidentally trigger the
 * outside-touch collapse. The test invokes the document touchstart handler with
 * the label element as the target and asserts the sidebar remains open.
 */
test("touching the label does not collapse the sidebar", () => {
  const { documentStub, restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    /**
     * The docs specify that tapping the label should only toggle, not collapse:
     * 1. Fetch the global touchstart handler.
     * 2. Expand the sidebar and simulate a touchstart whose target is the label.
     * 3. Verify the sidebar remains expanded (collapse suppressed).
     */
    helpers.setAutoCollapseEnabled(true);
    helpers.expandSidebar();

    const touchStartHandler = documentStub.listeners.touchstart?.[0];
    assert.ok(touchStartHandler, "expected document touchstart handler");

    touchStartHandler({ target: labelContainer, changedTouches: [{}] });
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "touching the label should not collapse the sidebar"
    );
  } finally {
    restore();
  }
});

/**
 * Multi-touch longevity:
 * Confirms the `touchSessionActive` counter holds the sidebar open for the
 * entire multi-finger gesture. The test starts with two touches, scrolls (no
 * collapse), lifts one finger (still no collapse), then lifts the second and
 * verifies the next scroll collapses the sidebar.
 */
test("multi-touch sessions keep the sidebar open until all touches end", () => {
  const { windowStub, restore } = installDomStubs();
  const sidebar = createElementStub();
  const labelContainer = createElementStub();

  const helpers = setupSidebarCollapseHandlers(
    sidebar,
    labelContainer,
    () => {}
  );

  try {
    /**
     * Multi-touch interactions should keep the sidebar alive until every finger lifts:
     * 1. Dispatch touchstart with two changedTouches to simulate a two-finger gesture.
     * 2. Scroll and assert the sidebar remains open.
     * 3. Lift one finger (touchend), scroll again -> still open.
     * 4. Lift the final finger, scroll again -> sidebar now collapses.
     */
    helpers.setAutoCollapseEnabled(true);
    helpers.expandSidebar();

    const scrollHandler = windowStub.listeners.scroll?.[0];
    assert.ok(scrollHandler, "expected window scroll handler");
    const sidebarTouchStart = sidebar.listeners.touchstart?.[0];
    const sidebarTouchEnd = sidebar.listeners.touchend?.[0];
    assert.ok(sidebarTouchStart && sidebarTouchEnd, "expected touch handlers");

    sidebarTouchStart({ changedTouches: [{}, {}] });
    scrollHandler({});
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "two-finger touch should keep sidebar open"
    );

    sidebarTouchEnd({ changedTouches: [{}] });
    scrollHandler({});
    assert.equal(
      sidebar.classList.contains("collapsed"),
      false,
      "sidebar stays open until all fingers lift"
    );

    sidebarTouchEnd({ changedTouches: [{}] });
    scrollHandler({});
    assert.equal(
      sidebar.classList.contains("collapsed"),
      true,
      "once all touches end, auto-collapse resumes"
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
