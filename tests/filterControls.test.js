import test from "node:test";
import assert from "node:assert/strict";

import {
  populateDropdown,
  setupRaidBossFiltering,
  setupHeaderBindings,
  __setBossIndexCacheForTests,
  __getBossIndexCacheForTests,
} from "../js/ui/filterControls.js";
import { filterState, updateFilterValue } from "../js/shared/filterState.js";
import { parseFilterStateFromUrl } from "../js/shared/urlState.js";

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

function createClassList() {
  return {
    values: new Set(),
    add(cls) {
      this.values.add(cls);
    },
    remove(cls) {
      this.values.delete(cls);
    },
    toggle(cls) {
      if (this.values.has(cls)) {
        this.values.delete(cls);
      } else {
        this.values.add(cls);
      }
    },
  };
}

function createInteractiveSelect(id, options = []) {
  const select = createMockSelect(id);
  const listeners = {};
  select.addEventListener = (event, handler) => {
    listeners[event] = listeners[event] || [];
    listeners[event].push(handler);
  };
  select.dispatchEvent = (evt) => {
    const type = evt?.type || evt;
    (listeners[type] || []).forEach((handler) => handler(evt));
  };
  options.forEach((value) => {
    select.appendChild({ value, textContent: value, selected: false });
  });
  if (options.length > 0) {
    select.value = options[0];
    select.selectedIndex = 0;
  }
  return select;
}

function createTitleElement(id) {
  return {
    id,
    textContent: "",
    dataset: {},
    classList: createClassList(),
    contains() {
      return false;
    },
    addEventListener() {},
  };
}

function createDropdownElement(id) {
  return {
    id,
    innerHTML: "",
    classList: createClassList(),
    contains() {
      return false;
    },
    appendChild() {},
  };
}

function withDomAndUrl(url, nodes, fn) {
  const originalDocument = global.document;
  const originalWindow = global.window;
  const dropdowns = [nodes["raid-dropdown"], nodes["boss-dropdown"]].filter(
    Boolean
  );
  global.document = {
    getElementById(id) {
      return nodes[id] || null;
    },
    createElement(tag) {
      if (tag === "div") {
        return {
          textContent: "",
          addEventListener() {},
        };
      }
      return { tagName: tag };
    },
    querySelectorAll() {
      return dropdowns;
    },
    addEventListener() {},
  };
  global.window = {
    location: { href: url },
    history: { state: {}, replaceState() {} },
  };
  try {
    fn();
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
  }
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

/**
 * Validates the end-to-end hydration path where a URL containing raid/boss query
 * params flows through the DOM-backed selects and keeps the faux headers in sync.
 *
 * The test fabricates a minimal DOM, loads the provided URL via the urlState parser,
 * executes the same sequence mainController runs (header bindings, raid-boss filtering,
 * URL hydration, and final broadcast), and asserts that the raid/boss titles mirror
 * the incoming selections even after the raid filter is re-broadcast during init.
 * This ensures the boss dropdown honors an existing selection when its option still
 * exists after the list is rebuilt for the chosen raid.
 */
test("setupHeaderBindings keeps titles synced after raid rebroadcast", () => {
  const raidSelect = createInteractiveSelect("raid-select", [
    "AAC Cruiserweight",
    "Trials III (Extreme)",
  ]);
  raidSelect.value = "";
  raidSelect.selectedIndex = -1;

  const bossSelect = createInteractiveSelect("boss-select");
  bossSelect.value = "";
  bossSelect.selectedIndex = -1;

  const nodes = {
    "raid-select": raidSelect,
    "boss-select": bossSelect,
    "raid-title": createTitleElement("raid-title"),
    "boss-subheader": createTitleElement("boss-subheader"),
    "raid-dropdown": createDropdownElement("raid-dropdown"),
    "boss-dropdown": createDropdownElement("boss-dropdown"),
  };

  const testUrl =
    "http://localhost:8080/?raid=AAC+Cruiserweight&boss=Howling+Blade&pct=50&metric=cdps&refpct=50&comp=25,75&pdate=20250606&view=percentile&jobs=Bard,Machinist,Dancer";

  const previousCache = __getBossIndexCacheForTests();
  const originalRaid = filterState.selectedRaid;
  const originalBoss = filterState.selectedBoss;
  const originalListeners = filterState.listeners;

  filterState.selectedRaid = "";
  filterState.selectedBoss = "";
  filterState.listeners = new Set();

  __setBossIndexCacheForTests({
    bossesByRaid: {
      "AAC Cruiserweight": new Set(["Dancing Green", "Howling Blade"]),
      "Trials III (Extreme)": new Set(["Another Boss"]),
    },
    allBosses: new Set(["Dancing Green", "Howling Blade", "Another Boss"]),
  });

  withDomAndUrl(testUrl, nodes, () => {
    setupHeaderBindings();
    setupRaidBossFiltering();

    const filters = parseFilterStateFromUrl();
    assert.equal(filters.selectedRaid, "AAC Cruiserweight");
    assert.equal(filters.selectedBoss, "Howling Blade");

    // Simulate select hydration performed in mainController after parsing filters.
    raidSelect.value = filters.selectedRaid;
    raidSelect.dispatchEvent({ type: "change" });
    bossSelect.value = filters.selectedBoss;
    bossSelect.dispatchEvent({ type: "change" });

    assert.equal(
      nodes["boss-subheader"].textContent,
      "Howling Blade",
      "Boss header should mirror the URL-provided boss after hydration"
    );
    assert.equal(
      nodes["raid-title"].textContent,
      "AAC Cruiserweight",
      "Raid header should mirror the URL-provided raid after hydration"
    );

    // Broadcast the current raid selection (mirrors init() behavior) and ensure
    // the boss header stays in sync even though the boss dropdown repopulates.
    updateFilterValue("selectedRaid", filterState.selectedRaid);

    assert.equal(
      nodes["boss-subheader"].textContent,
      "Howling Blade",
      "Boss header should remain synced after raid rebroadcast"
    );
    assert.equal(
      nodes["raid-title"].textContent,
      "AAC Cruiserweight",
      "Raid header should remain synced after raid rebroadcast"
    );
  });

  filterState.selectedRaid = originalRaid;
  filterState.selectedBoss = originalBoss;
  filterState.listeners = originalListeners;
  __setBossIndexCacheForTests(previousCache);
});
