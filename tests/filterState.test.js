import test from "node:test";
import assert from "node:assert/strict";

import {
  updateSidebarLabelVisibility,
  subscribeToFilterChanges,
  updateFilterValue,
  filterState,
} from "../js/shared/filterState.js";

function createElementWithClassList(initialClasses = []) {
  const classes = new Set(initialClasses);
  return {
    style: {},
    classList: {
      add(cls) {
        classes.add(cls);
      },
      remove(cls) {
        classes.delete(cls);
      },
      contains(cls) {
        return classes.has(cls);
      },
    },
  };
}

/**
 * Regression test ensuring the job sidebar header controls remain mutually exclusive with the full sidebar.
 * The helper stubs the DOM nodes used by updateSidebarLabelVisibility and verifies it flips the
 * header/mini-panel visibility when the job sidebar adds/removes the "collapsed" class.
 */
test("updateSidebarLabelVisibility toggles label visibility with job sidebar", () => {
  const jobSidebar = createElementWithClassList(["collapsed"]);
  const labelContainer = { style: {} };
  const dpsLabel = { style: {} };

  const originalDocument = global.document;
  global.document = {
    getElementById(id) {
      switch (id) {
        case "job-sidebar":
          return jobSidebar;
        case "sidebar-label-container":
          return labelContainer;
        case "dps-type-label-container":
          return dpsLabel;
        default:
          return null;
      }
    },
  };

  try {
    // When the sidebar is collapsed, both header controls should be visible.
    updateSidebarLabelVisibility();
    assert.equal(labelContainer.style.display, "flex");
    assert.equal(dpsLabel.style.display, "flex");

    // When the sidebar opens, the header controls must hide.
    jobSidebar.classList.remove("collapsed");
    updateSidebarLabelVisibility();
    assert.equal(labelContainer.style.display, "none");
    assert.equal(dpsLabel.style.display, "none");
  } finally {
    global.document = originalDocument;
  }
});

/**
 * Ensures the helper falls back to the legacy sidebar id when the job sidebar
 * is missing, maintaining backward compatibility with the old DOM structure.
 */
test("updateSidebarLabelVisibility falls back to class-sidebar id", () => {
  const classSidebar = createElementWithClassList(); // not collapsed
  const labelContainer = { style: {} };
  const dpsLabel = { style: {} };

  const originalDocument = global.document;
  global.document = {
    getElementById(id) {
      switch (id) {
        case "job-sidebar":
          return null;
        case "class-sidebar":
          return classSidebar;
        case "sidebar-label-container":
          return labelContainer;
        case "dps-type-label-container":
          return dpsLabel;
        default:
          return null;
      }
    },
  };

  try {
    classSidebar.classList.add("collapsed");
    updateSidebarLabelVisibility();
    assert.equal(labelContainer.style.display, "flex");
    assert.equal(dpsLabel.style.display, "flex");
    classSidebar.classList.remove("collapsed");
    updateSidebarLabelVisibility();
    assert.equal(labelContainer.style.display, "none");
    assert.equal(dpsLabel.style.display, "none");
  } finally {
    global.document = originalDocument;
  }
});

/**
 * Ensures filter change listeners receive the change metadata so UI components
 * can quickly determine whether to re-render.
 */
test("subscribeToFilterChanges provides change metadata", () => {
  const events = [];
  const unsubscribe = subscribeToFilterChanges((state, change) => {
    events.push({ state, change });
  });
  const originalRaid = filterState.selectedRaid;
  try {
    updateFilterValue("selectedRaid", "TestRaid");
    assert.equal(events.length, 1);
    assert.equal(events[0].change.key, "selectedRaid");
    assert.equal(events[0].change.nextValue, "TestRaid");
  } finally {
    unsubscribe();
    updateFilterValue("selectedRaid", originalRaid);
  }
});
