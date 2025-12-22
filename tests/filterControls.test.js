import test from "node:test";
import assert from "node:assert/strict";
import {
  sortDropdownValues,
  buildBossIndex,
  populateAllFilters,
  setupHeaderBindings,
} from "../js/ui/filterControls.js";

// Exercises the dropdown sorting helper so the data-driven ordering logic can be validated without DOM access.

/**
 * Utility wrapper so the tests read fluently when passing bare value arrays.
 * @param {Array<string>} values - Candidate dropdown options.
 * @param {string} selectId - DOM id whose override rules should be applied.
 * @param {Object<string, string>} [latestDateMap] - Optional YYYYMMDD map for recency ordering.
 * @returns {Array<string>} Sorted copy for inspection inside assertions.
 */
function sort(values, selectId, latestDateMap) {
  return sortDropdownValues(values, selectId, latestDateMap);
}

// Custom order overrides should trump every other rule.
test("sortDropdownValues honors explicit ORDER_OVERRIDES before fallback rules", () => {
  const values = [
    "Howling Blade",
    "Unknown",
    "Sugar Riot",
    "Brute Abombinator",
    "Dancing Green",
  ];
  const result = sort(values, "boss-select");

  assert.deepEqual(result, [
    "Dancing Green",
    "Sugar Riot",
    "Brute Abombinator",
    "Howling Blade",
    "Unknown",
  ]);
});

// The raid -> boss lookup should only include valid pairs and preserve every unique boss globally.
test("buildBossIndex groups bosses under their raids while tracking every unique boss", () => {
  const data = [
    { raid: "Alpha", boss: "One" },
    { raid: "Alpha", boss: "Two" },
    { raid: "Beta", boss: "Two" },
    { raid: "Beta", boss: "Three" },
    { raid: "", boss: "Roaming Foe" },
    { raid: "Gamma" }, // no boss, should be ignored
  ];

  const { bossesByRaid, allBosses } = buildBossIndex(data);

  const alphaBosses = Array.from(bossesByRaid.Alpha).sort();
  const betaBosses = Array.from(bossesByRaid.Beta).sort();
  const allBossList = Array.from(allBosses).sort();

  assert.deepEqual(alphaBosses, ["One", "Two"]);
  assert.deepEqual(betaBosses, ["Three", "Two"]);
  assert.deepEqual(allBossList, ["One", "Roaming Foe", "Three", "Two"]);
  assert.ok(!bossesByRaid.Gamma, "missing boss entries should not generate raid groups");
});

// When no override exists the helper must use the most recent date, falling back to alphabetical ties.
test("sortDropdownValues orders by latest date descending with alpha tie-breaker", () => {
  const values = ["AAC Cruiserweight", "Alpha Ruins", "Beacon Depths"];
  const result = sort(values, "raid-select", {
    "AAC Cruiserweight": "20240101",
    "Alpha Ruins": "20240305",
    "Beacon Depths": "20240305",
  });

  assert.deepEqual(result, [
    "Alpha Ruins",
    "Beacon Depths",
    "AAC Cruiserweight",
  ]);
});

// In the absence of overrides or recency data the helper should degrade gracefully to A-Z sorting.
test("sortDropdownValues falls back to simple alphabetical order", () => {
  const values = ["zeta", "beta", "alpha"];
  const result = sort(values, "class-select");

  assert.deepEqual(result, ["alpha", "beta", "zeta"]);
});

// Regression coverage ensuring the faux boss dropdown can toggle between interactive and static states
// as raids with different boss counts are selected.
test("boss dropdown header toggles interactivity when raid boss counts change", () => {
  const raidSelect = createSelectElementStub("raid-select");
  const bossSelect = createSelectElementStub("boss-select");
  const raidTitle = createHeaderStub("raid-title");
  const bossTitle = createHeaderStub("boss-subheader");
  const raidDropdown = createDropdownStub("raid-dropdown");
  const bossDropdown = createDropdownStub("boss-dropdown");

  const { restore } = installFilterDom({
    "raid-select": raidSelect,
    "boss-select": bossSelect,
    "raid-title": raidTitle,
    "boss-subheader": bossTitle,
    "raid-dropdown": raidDropdown,
    "boss-dropdown": bossDropdown,
  });

  const dataset = [
    {
      raid: "Beta Trials",
      boss: "Solo Watcher",
      percentile: "50",
      class: "Warrior",
      dps_type: "rdps",
      date: "20240101",
    },
    {
      raid: "Alpha Vault",
      boss: "Twin Fang",
      percentile: "75",
      class: "Paladin",
      dps_type: "rdps",
      date: "20240210",
    },
    {
      raid: "Alpha Vault",
      boss: "Serpent Queen",
      percentile: "90",
      class: "Paladin",
      dps_type: "rdps",
      date: "20240211",
    },
  ];

  try {
    populateAllFilters(dataset);
    setupHeaderBindings();

    assert.equal(
      bossTitle.classList.contains("non-interactive"),
      false,
      "multi-boss raids should keep the faux header interactive"
    );

    raidSelect.value = "Beta Trials";
    raidSelect.dispatchEvent({ type: "change" });
    assert.equal(
      bossTitle.classList.contains("non-interactive"),
      true,
      "switching to a single-boss raid should disable the custom dropdown"
    );
    assert.equal(
      bossDropdown.classList.contains("hidden-dropdown"),
      true,
      "single-boss raids should also force-close the faux dropdown contents"
    );

    raidSelect.value = "Alpha Vault";
    raidSelect.dispatchEvent({ type: "change" });
    assert.equal(
      bossTitle.classList.contains("non-interactive"),
      false,
      "returning to a multi-boss raid re-enables the header interaction"
    );
  } finally {
    restore();
  }
});

/**
 * --- Test helpers below ---
 * Lightweight DOM stubs so filterControls can run outside the browser.
 */

function createClassListStub(initial = []) {
  const classes = new Set(initial);
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

function createEventTargetStub() {
  const listeners = {};
  return {
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      const group = listeners[type];
      if (!group) return;
      const idx = group.indexOf(handler);
      if (idx !== -1) {
        group.splice(idx, 1);
      }
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      (listeners[type] || []).forEach((handler) => handler(event));
    },
    __listeners: listeners,
  };
}

function createSelectElementStub(id) {
  const target = createEventTargetStub();
  const classList = createClassListStub();
  const select = {
    id,
    multiple: false,
    options: [],
    value: "",
    classList,
    ...target,
  };
  Object.defineProperty(select, "innerHTML", {
    set() {
      select.options = [];
      select.value = "";
      select._selectedIndex = -1;
    },
    get() {
      return "";
    },
  });
  Object.defineProperty(select, "selectedIndex", {
    get() {
      return select._selectedIndex ?? -1;
    },
    set(idx) {
      select._selectedIndex = idx;
      select.value = select.options[idx]?.value ?? "";
    },
  });
  select.appendChild = function appendChild(option) {
    select.options.push(option);
  };
  select.contains = (targetEl) => targetEl === select;
  return select;
}

function createHeaderStub(id) {
  const target = createEventTargetStub();
  return {
    id,
    textContent: "",
    classList: createClassListStub(),
    contains(targetEl) {
      return targetEl === this;
    },
    ...target,
  };
}

function createDropdownStub(id) {
  const classList = createClassListStub(["custom-dropdown", "hidden-dropdown"]);
  return {
    id,
    classList,
    contains(targetEl) {
      return targetEl === this;
    },
    __isCustomDropdown: true,
  };
}

function installFilterDom(elements) {
  const originalDocument = global.document;
  const docListeners = {};
  const docStub = {
    listeners: docListeners,
    getElementById(id) {
      return elements[id] ?? null;
    },
    createElement(tag) {
      if (tag === "option") {
        return { value: "", textContent: "" };
      }
      return {
        textContent: "",
        classList: createClassListStub(),
        appendChild() {},
        addEventListener() {},
      };
    },
    addEventListener(type, handler) {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(handler);
    },
    querySelectorAll(selector) {
      if (selector === ".custom-dropdown") {
        return Object.values(elements).filter((el) => el?.__isCustomDropdown);
      }
      return [];
    },
  };
  global.document = docStub;
  return {
    restore() {
      global.document = originalDocument;
    },
    document: docStub,
  };
}
