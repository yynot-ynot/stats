import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRaidDropdownSections,
  populateDropdown,
  setupRaidBossFiltering,
  setupHeaderBindings,
  __setBossIndexCacheForTests,
  __getBossIndexCacheForTests,
  setManifestBossOptionsByRaid,
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
    contains(cls) {
      return this.values.has(cls);
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

test("buildRaidDropdownSections groups known raids into Trial and Savage buckets", () => {
  const sections = buildRaidDropdownSections([
    "AAC Heavyweight",
    "Trials III (Extreme)",
    "AAC Cruiserweight",
    "Dancing Mad",
  ]);

  assert.deepEqual(sections, [
    {
      label: "Trial",
      items: ["Trials III (Extreme)"],
    },
    {
      label: "Savage",
      items: ["AAC Heavyweight", "AAC Cruiserweight"],
    },
    {
      label: "Ultimate",
      items: ["Dancing Mad"],
    },
  ]);
});

test("buildRaidDropdownSections falls back unknown raids into Other", () => {
  const sections = buildRaidDropdownSections([
    "Mystery Raid",
    "AAC Heavyweight",
  ]);

  assert.deepEqual(sections, [
    {
      label: "Savage",
      items: ["AAC Heavyweight"],
    },
    {
      label: "Other",
      items: ["Mystery Raid"],
    },
  ]);
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

test("setupHeaderBindings keeps the raid selector interactive before boss data exists", () => {
  const raidSelect = createInteractiveSelect("raid-select", [
    "AAC Heavyweight",
    "AAC Cruiserweight",
  ]);
  const bossSelect = createInteractiveSelect("boss-select");
  bossSelect.options = [];
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

  withDomAndUrl("http://localhost:8080/", nodes, () => {
    setupHeaderBindings();

    assert.equal(nodes["raid-title"].textContent, "AAC Heavyweight");
    assert.equal(
      nodes["raid-title"].classList.contains("non-interactive"),
      false,
      "raid selector should stay interactive when manifest-derived raid choices exist"
    );
    assert.equal(
      nodes["boss-subheader"].classList.contains("non-interactive"),
      true,
      "boss selector should remain non-interactive until row data populates boss choices"
    );
  });
});

test("setupRaidBossFiltering can surface manifest-derived boss options before row data loads", () => {
  const raidSelect = createMockSelect("raid-select");
  raidSelect.value = "Trials III (Extreme)";
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
    bossesByRaid: {},
    manifestBossesByRaid: {},
    allBosses: new Set(),
  });
  setManifestBossOptionsByRaid({
    "Trials III (Extreme)": ["Enuo", "Doomtrain"],
  });

  const originalBoss = filterState.selectedBoss;
  filterState.selectedBoss = "";

  try {
    setupRaidBossFiltering();

    assert.deepEqual(
      bossSelect.options.map((opt) => opt.value),
      ["Enuo", "Doomtrain"]
    );
    assert.equal(filterState.selectedBoss, "Enuo");
  } finally {
    filterState.selectedBoss = originalBoss;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});

test("setupRaidBossFiltering does not briefly switch to the newest Trial boss when a preferred boss is already selected", () => {
  const raidSelect = createMockSelect("raid-select");
  raidSelect.value = "Trials III (Extreme)";
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
  const originalBoss = filterState.selectedBoss;
  const originalListeners = filterState.listeners;
  const selectedBossChanges = [];

  filterState.selectedBoss = "Doomtrain";
  filterState.listeners = new Set([
    (_, change) => {
      if (change?.key === "selectedBoss") {
        selectedBossChanges.push(change.nextValue);
      }
    },
  ]);

  __setBossIndexCacheForTests({
    bossesByRaid: {},
    manifestBossesByRaid: {
      "Trials III (Extreme)": new Set(["Enuo", "Doomtrain"]),
    },
    manifestBossLatestDatesByRaid: {
      "Trials III (Extreme)": {
        Enuo: "20260608",
        Doomtrain: "20260107",
      },
    },
    allBosses: new Set(["Enuo", "Doomtrain"]),
  });

  try {
    setupRaidBossFiltering();

    assert.equal(filterState.selectedBoss, "Doomtrain");
    assert.equal(
      selectedBossChanges.includes("Enuo"),
      false,
      "boss repopulation should not emit a transient switch to the newest Trial boss"
    );
  } finally {
    filterState.selectedBoss = originalBoss;
    filterState.listeners = originalListeners;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});

test("setupRaidBossFiltering clears stale Trial bosses immediately when switching to a row-driven raid with no loaded boss data yet", () => {
  const raidSelect = createMockSelect("raid-select");
  raidSelect.value = "AAC Heavyweight";
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
  const originalBoss = filterState.selectedBoss;

  __setBossIndexCacheForTests({
    bossesByRaid: {
      "Trials III (Extreme)": new Set(["Doomtrain", "Enuo"]),
    },
    manifestBossesByRaid: {
      "Trials III (Extreme)": new Set(["Enuo", "Doomtrain"]),
    },
    manifestBossLatestDatesByRaid: {
      "Trials III (Extreme)": {
        Enuo: "20260608",
        Doomtrain: "20260107",
      },
    },
    allBosses: new Set(["Doomtrain", "Enuo"]),
  });
  filterState.selectedBoss = "Doomtrain";

  try {
    setupRaidBossFiltering();

    assert.equal(
      filterState.selectedBoss,
      "",
      "row-driven raids should clear the previous raid's boss immediately when no boss is known yet"
    );
    assert.equal(
      bossTitle.textContent,
      "[Select Boss]",
      "row-driven raids should show the boss placeholder instead of stale Trial text while loading"
    );
    assert.deepEqual(
      bossSelect.options.map((opt) => opt.value),
      [],
      "boss dropdown should not inherit stale Trial boss options for the new raid"
    );
  } finally {
    filterState.selectedBoss = originalBoss;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});

test("setupRaidBossFiltering immediately swaps from a row-driven placeholder to the manifest default when the user changes into Trial", () => {
  const raidSelect = createInteractiveSelect("raid-select", [
    "AAC Heavyweight",
    "Trials III (Extreme)",
  ]);
  raidSelect.value = "AAC Heavyweight";
  const bossSelect = createInteractiveSelect("boss-select");
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
  const originalBoss = filterState.selectedBoss;

  __setBossIndexCacheForTests({
    bossesByRaid: {},
    manifestBossesByRaid: {
      "Trials III (Extreme)": new Set(["Enuo", "Doomtrain"]),
    },
    manifestBossLatestDatesByRaid: {
      "Trials III (Extreme)": {
        Enuo: "20260608",
        Doomtrain: "20260107",
      },
    },
    allBosses: new Set(["Enuo", "Doomtrain"]),
  });
  filterState.selectedBoss = "Doomtrain";

  try {
    setupRaidBossFiltering();

    assert.equal(
      bossTitle.textContent,
      "[Select Boss]",
      "row-driven raids should clear the stale boss header before any Trial boss becomes active"
    );
    assert.equal(filterState.selectedBoss, "");

    raidSelect.value = "Trials III (Extreme)";
    raidSelect.dispatchEvent(new Event("change"));

    assert.equal(
      filterState.selectedBoss,
      "Enuo",
      "Trial should immediately adopt the manifest-derived default boss on raid change"
    );
    assert.equal(
      bossTitle.textContent,
      "Enuo",
      "the boss header should show the manifest-derived default during loading"
    );
    assert.deepEqual(bossSelect.options.map((opt) => opt.value), [
      "Enuo",
      "Doomtrain",
    ]);
  } finally {
    filterState.selectedBoss = originalBoss;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});

test("setupRaidBossFiltering immediately shows the manifest-derived default boss for boss-scoped raids", () => {
  const raidSelect = createMockSelect("raid-select");
  raidSelect.value = "Trials III (Extreme)";
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
  const originalBoss = filterState.selectedBoss;

  __setBossIndexCacheForTests({
    bossesByRaid: {},
    manifestBossesByRaid: {
      "Trials III (Extreme)": new Set(["Enuo", "Doomtrain"]),
    },
    manifestBossLatestDatesByRaid: {
      "Trials III (Extreme)": {
        Enuo: "20260608",
        Doomtrain: "20260107",
      },
    },
    allBosses: new Set(["Enuo", "Doomtrain"]),
  });
  filterState.selectedBoss = "";

  try {
    setupRaidBossFiltering();

    assert.equal(filterState.selectedBoss, "Enuo");
    assert.equal(bossTitle.textContent, "Enuo");
  } finally {
    filterState.selectedBoss = originalBoss;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});

test("setupRaidBossFiltering preserves explicit UMAD manifest boss ordering with Whole Fight first", () => {
  const raidSelect = createMockSelect("raid-select");
  raidSelect.value = "Dancing Mad";
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
  const originalBoss = filterState.selectedBoss;

  __setBossIndexCacheForTests({
    bossesByRaid: {},
    manifestBossesByRaid: {
      "Dancing Mad": new Set([
        "Whole Fight",
        "P1: Kefka",
        "P2: Forsaken Kefka",
        "P3: Exdeath and Chaos",
        "P4: Kefka Says",
        "P5: Ultima Kefka",
      ]),
    },
    manifestBossLatestDatesByRaid: {
      "Dancing Mad": {
        "Whole Fight": "20260612",
        "P1: Kefka": "20260612",
        "P2: Forsaken Kefka": "20260612",
        "P3: Exdeath and Chaos": "20260612",
        "P4: Kefka Says": "20260612",
        "P5: Ultima Kefka": "20260612",
      },
    },
    allBosses: new Set([
      "Whole Fight",
      "P1: Kefka",
      "P2: Forsaken Kefka",
      "P3: Exdeath and Chaos",
      "P4: Kefka Says",
      "P5: Ultima Kefka",
    ]),
  });
  filterState.selectedBoss = "";

  try {
    setupRaidBossFiltering();

    assert.deepEqual(bossSelect.options.map((opt) => opt.value), [
      "Whole Fight",
      "P1: Kefka",
      "P2: Forsaken Kefka",
      "P3: Exdeath and Chaos",
      "P4: Kefka Says",
      "P5: Ultima Kefka",
    ]);
    assert.equal(filterState.selectedBoss, "Whole Fight");
    assert.equal(bossTitle.textContent, "Whole Fight");
  } finally {
    filterState.selectedBoss = originalBoss;
    __setBossIndexCacheForTests(previousCache);
    restoreDocument();
  }
});
