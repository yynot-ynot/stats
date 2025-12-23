import test from "node:test";
import assert from "node:assert/strict";

import {
  populateDropdown,
  setupRaidBossFiltering,
  __setBossIndexCacheForTests,
  __getBossIndexCacheForTests,
} from "../js/ui/filterControls.js";
import { filterState, updateFilterValue } from "../js/shared/filterState.js";

function withMockDocument(fn) {
  const originalDocument = global.document;
  global.document = {
    createElement(tag) {
      if (tag === "option") {
        return { value: "", textContent: "", selected: false };
      }
      return { tagName: tag, textContent: "", addEventListener() {} };
    },
  };
  try {
    fn();
  } finally {
    global.document = originalDocument;
  }
}

function createMockSelect(id, { multiple = false } = {}) {
  const select = {
    id,
    multiple,
    options: [],
    value: "",
    selectedIndex: -1,
    _innerHTML: "",
    __filterControlsChangeHandler: null,
    addEventListener() {},
    dispatchEvent() {},
    appendChild(option) {
      this.options.push(option);
    },
    get selectedOptions() {
      return this.options.filter((opt) => opt.selected);
    },
  };
  Object.defineProperty(select, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(val) {
      this._innerHTML = val;
      this.options.length = 0;
    },
  });
  return select;
}

function installDocumentWithNodes(nodes) {
  const originalDocument = global.document;
  global.document = {
    createElement(tag) {
      if (tag === "option") {
        return { value: "", textContent: "", selected: false };
      }
      return { tagName: tag, textContent: "", addEventListener() {} };
    },
    getElementById(id) {
      return nodes[id] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return () => {
    global.document = originalDocument;
  };
}

/**
 * Ensures raid changes rebuild the boss dropdown, forcing a new default boss selection
 * rather than leaving the previous raid's boss active.
 */
test("populateDropdown resets boss selection when options change", () => {
  const originalBoss = filterState.selectedBoss;
  withMockDocument(() => {
    const bossSelect = createMockSelect("boss-select");
    populateDropdown(bossSelect, new Set(["Doomtrain", "Phantom Train"]), "Boss");
    const firstBoss = bossSelect.options[0].value;
    assert.equal(filterState.selectedBoss, firstBoss);

    populateDropdown(bossSelect, new Set(["Cerberus"]), "Boss");
    assert.equal(filterState.selectedBoss, "Cerberus");

    populateDropdown(bossSelect, new Set(), "Boss");
    assert.equal(filterState.selectedBoss, "");
  });
  filterState.selectedBoss = originalBoss;
});

test("raid filter changes rebuild boss options even without DOM events", () => {
  const raidSelect = createMockSelect("raid-select");
  raidSelect.value = "RaidA";
  const bossSelect = createMockSelect("boss-select");
  const bossTitle = {
    textContent: "",
    __updateDropdownInteractivity: () => {},
  };
  const bossDropdown = {
    classList: {
      add() {},
    },
  };
  const restoreDocument = installDocumentWithNodes({
    "raid-select": raidSelect,
    "boss-select": bossSelect,
    "boss-subheader": bossTitle,
    "boss-dropdown": bossDropdown,
  });
  const previousCache = __getBossIndexCacheForTests();
  __setBossIndexCacheForTests({
    bossesByRaid: {
      RaidA: new Set(["BossA1", "BossA2"]),
      RaidB: new Set(["BossB1"]),
    },
    allBosses: new Set(["BossA1", "BossA2", "BossB1"]),
  });

  const originalBoss = filterState.selectedBoss;
  filterState.selectedBoss = "";

  try {
    setupRaidBossFiltering();
    assert.equal(filterState.selectedBoss, "BossA1");

    updateFilterValue("selectedRaid", "RaidB");
    assert.equal(filterState.selectedBoss, "BossB1");
  } finally {
    filterState.selectedBoss = originalBoss;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});
