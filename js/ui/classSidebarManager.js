import {
  updateFilterValue,
  subscribeToFilterChanges,
  updateSidebarLabelVisibility,
} from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";
import {
  CLASS_ICONS,
  CLASS_GROUPS,
  CLASS_COLORS,
} from "../config/appConfig.js";

const logger = getLogger("classSidebarManager");

/**
 * Create a class icon element for use in the sidebar grid.
 * Handles both regular classes and special paired healer classes.
 * - For single classes: loads icon image (if available) from CLASS_ICONS, with fallback to text label.
 * - For paired healer classes (e.g., "White Mage+Sage" or "Scholar (x2)"):
 *     Uses createPairedHealerIconElement to render two icons together, styled as a pair.
 * The returned element will emit a filter update when toggled/selected.
 *
 * @param {string} className - The class name or combo string. Used as value and data-attribute.
 * @param {Set<string>} selectedClasses - Set of currently selected class names for updating selection state.
 * @returns {HTMLElement} The sidebar icon element (single or paired).
 */
function createClassIconElement(className, selectedClasses) {
  // Check if the className represents a special paired healer combo (e.g., "White Mage+Sage").
  // If so, render using the paired icon element (two icons in one cell).
  const paired = parsePairedHealerClasses(className);
  if (paired) {
    // Render a large paired healer icon (side-by-side icons with +, for main grid use)
    return createPairedHealerIconElement(className, paired, selectedClasses);
  }

  // Create the main icon div for a single class
  const iconDiv = document.createElement("div");
  iconDiv.classList.add("class-icon");
  iconDiv.setAttribute("data-class", className);

  // Add a fallback label (the class name text) for use if the image fails or is missing
  const fallbackLabel = document.createElement("span");
  fallbackLabel.textContent = className;
  fallbackLabel.classList.add("fallback-label");
  iconDiv.appendChild(fallbackLabel);

  // Attempt to load the icon image from the CLASS_ICONS mapping.
  // If no mapping is found, show warning and rely on fallback text label.
  let iconUrl;
  if (CLASS_ICONS[className]) {
    iconUrl = CLASS_ICONS[className];
  } else {
    iconUrl = "";
    logger.warn(
      `No icon mapping found for class "${className}" in CLASS_ICONS. No image will be loaded.`
    );
  }
  const img = document.createElement("img");
  img.src = iconUrl;
  img.alt = className;
  img.loading = "lazy";

  img.onload = () => {
    // Hide fallback label when image successfully loads
    fallbackLabel.style.display = "none";
  };
  img.onerror = () => {
    // If image fails to load, remove the img and show fallback label
    img.remove();
    fallbackLabel.style.display = "block";
    logger.warn(
      `Class icon failed to load for "${className}". URL attempted: ${img.src}`
    );
  };

  iconDiv.appendChild(img);

  // Allow users to select/deselect the class by clicking this icon
  // Selection state is reflected by the 'selected' class, and filterState is updated accordingly
  iconDiv.addEventListener("click", () => {
    if (iconDiv.classList.toggle("selected")) {
      selectedClasses.add(className);
    } else {
      selectedClasses.delete(className);
    }
    // Always notify filterState listeners after change
    updateFilterValue("selectedClasses", new Set(selectedClasses));
  });

  return iconDiv;
}

/**
 * Render a group section with section header and icon rows (max 4 items per row).
 * - Supports displaying paired healer classes (e.g., "White Mage+Sage" or "Scholar (x2)")
 *   using a special paired icon renderer.
 * - Uses CLASS_GROUPS for known roles and class sets.
 * - Regular class names are rendered with createClassIconElement.
 * - Paired healers are detected using parsePairedHealerClasses and rendered as side-by-side mini-icons.
 *
 * @param {string} groupName - The name of the class group.
 * @param {Array<string>} classList - List of class names in this group.
 * @param {Set<string>} selectedClasses
 * @returns {HTMLElement} The group section element.
 */
function renderGroupSection(groupName, classList, selectedClasses) {
  const section = document.createElement("div");
  section.classList.add("class-group-section");

  // Section header
  const header = document.createElement("div");
  header.classList.add("class-group-header");
  header.textContent = groupName;
  section.appendChild(header);

  // Helper: returns true if this class is a paired healer combo
  function isPairedHealer(className) {
    return groupName === "Healer" && parsePairedHealerClasses(className);
  }

  // For row grouping: treat each paired healer as a single "slot"
  let row = null,
    rowCount = 0;
  for (let i = 0; i < classList.length; ) {
    // Start a new row every 4 items
    if (!row || rowCount === 0) {
      row = document.createElement("div");
      row.classList.add("class-icon-row");
      section.appendChild(row);
      rowCount = 0;
    }

    const className = classList[i];
    if (isPairedHealer(className)) {
      const iconDiv = createPairedHealerIconElement(
        className,
        parsePairedHealerClasses(className),
        selectedClasses
      );
      row.appendChild(iconDiv);
      rowCount++;
      i++;
    } else {
      const iconDiv = createClassIconElement(className, selectedClasses);
      row.appendChild(iconDiv);
      rowCount++;
      i++;
    }
    if (rowCount >= 4) rowCount = 0; // next iteration starts new row
  }

  return section;
}

/**
 * Helper for rendering a single mini healer icon.
 * @param {string} className
 * @returns {HTMLElement}
 */
function createMiniHealerIcon(className) {
  const iconDiv = document.createElement("div");
  iconDiv.classList.add("mini-class-icon", "mini-healer-pair");
  const iconUrl = CLASS_ICONS[className];
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = className;
    img.loading = "lazy";
    iconDiv.appendChild(img);
  } else {
    iconDiv.textContent = className[0];
  }
  return iconDiv;
}

/**
 * Extract individual healer names from a paired/combo string.
 * Uses CLASS_GROUPS.Healer for the allowed list.
 */
export function parsePairedHealerClasses(className) {
  const HEALER_NAMES = CLASS_GROUPS.Healer;
  // Regex for combos like "White Mage+Sage" or "Astrologian+Scholar"
  const plusCombo = /^([\w\s]+)\+([\w\s]+)$/;
  const matchPlus = className.match(plusCombo);
  if (matchPlus) {
    const [_, first, second] = matchPlus;
    if (
      HEALER_NAMES.includes(first.trim()) &&
      HEALER_NAMES.includes(second.trim())
    ) {
      return [first.trim(), second.trim()];
    }
  }
  // Regex for "Healer (x2)" e.g. "White Mage (x2)"
  const dupCombo = /^([\w\s]+)\s*\(x2\)$/;
  const matchDup = className.match(dupCombo);
  if (matchDup) {
    const healer = matchDup[1].trim();
    if (HEALER_NAMES.includes(healer)) {
      return [healer, healer];
    }
  }
  return null;
}

/**
 * Render a paired/combo healer icon: two overlapping avatars as siblings, with robust fallback handling.
 * When selected, ensures both individual healers are included for HPS plotting.
 * When deselected, only removes the healers if they weren't selected as singles separately.
 * @param {string} className - The full combo name.
 * @param {string[]} healerNames - The two healer names extracted from the combo string.
 * @param {Set<string>} selectedClasses - Set of currently selected class names.
 * @returns {HTMLElement} - The sidebar element containing the paired healer icon.
 */
function createPairedHealerIconElement(
  className,
  healerNames,
  selectedClasses
) {
  // Outer div representing the grid slot for this paired icon
  const pairDiv = document.createElement("div");
  pairDiv.classList.add("class-icon", "paired-healer-icon");
  pairDiv.setAttribute("data-class", className);

  // Inner flexbox container for the two overlapping avatars
  const innerDiv = document.createElement("div");
  innerDiv.classList.add("paired-healer-inner");

  // Fallback label: only shown if both images fail to load
  const fallbackLabel = document.createElement("span");
  fallbackLabel.textContent = className;
  fallbackLabel.classList.add("fallback-label");
  fallbackLabel.style.display = "none";
  pairDiv.appendChild(fallbackLabel);

  // Render healer icons
  let failedCount = 0;
  healerNames.forEach((healer, idx) => {
    const img = document.createElement("img");
    img.src = CLASS_ICONS[healer] || "";
    img.alt = healer;
    img.classList.add("paired-healer-img");
    img.loading = "lazy";

    img.onload = () => {
      fallbackLabel.style.display = "none";
    };
    img.onerror = () => {
      failedCount++;
      img.style.display = "none";
      if (failedCount === healerNames.length) {
        fallbackLabel.style.display = "block";
      }
      logger.warn(
        `Paired healer icon failed to load for "${healer}" in "${className}". URL attempted: ${img.src}`
      );
    };

    innerDiv.appendChild(img);
  });
  pairDiv.appendChild(innerDiv);

  // Click logic for toggling this healer pair
  pairDiv.addEventListener("click", () => {
    // Save a snapshot of single-healer selection *before* this click
    const beforeSingles = new Set();
    healerNames.forEach((h) => {
      if (selectedClasses.has(h)) beforeSingles.add(h);
    });

    if (pairDiv.classList.toggle("selected")) {
      // Selecting: add the pair string itself
      selectedClasses.add(className);
    } else {
      // Deselecting: remove the pair string,
      // but only remove the individual healers if they weren't selected individually
      selectedClasses.delete(className);
      healerNames.forEach((h) => {
        // Only remove if not in the set before (i.e., not picked as a single)
        if (!beforeSingles.has(h)) {
          selectedClasses.delete(h);
        }
      });
    }
    // Always notify filterState listeners after change
    updateFilterValue("selectedClasses", new Set(selectedClasses));
  });

  return pairDiv;
}

/**
 * Setup the class sidebar with grouped icons, section headers, and centralized click updates.
 * Lays out sections/rows synchronously. Image loading is independent.
 * Also handles the persistent "Classes" label with a vertical mini-icon list
 * that is visible only when the sidebar is collapsed.
 * Any classes in classList not found in the predefined groups will appear in an "Other" section at the bottom.
 * @param {Array<string>} classList - List of class names (all available).
 */
export function setupClassSidebar(classList) {
  const container = document.getElementById("class-icons-container");
  if (!container) {
    console.warn("Class icons container not found; skipping sidebar setup.");
    return;
  }

  container.innerHTML = ""; // Clear old content if any
  const selectedClasses = new Set();

  // Track which class names are already displayed, so we can find "leftover" classes later
  const displayedClassNames = new Set();

  // --- Grouped Section/Row Layout (Recommended) ---
  const groupOrder = [
    "Tank",
    "Healer",
    "Melee DPS",
    "Physical Ranged DPS",
    "Magical Ranged DPS",
  ];
  for (const group of groupOrder) {
    let groupClassNames = [];
    if (group === "Healer") {
      // Use all singles PLUS all pair names in classList that parse as paired healers
      const singles = CLASS_GROUPS["Healer"];
      const pairs = classList.filter((name) => parsePairedHealerClasses(name));
      groupClassNames = [...singles, ...pairs];
    } else {
      groupClassNames = CLASS_GROUPS[group] || [];
    }
    // Mark as displayed
    groupClassNames.forEach((name) => displayedClassNames.add(name));
    const groupSection = renderGroupSection(
      group,
      groupClassNames,
      selectedClasses
    );
    container.appendChild(groupSection);
  }

  // --- Add "Other" section for any class names in classList not already displayed ---
  const leftovers = classList.filter(
    (className) => !displayedClassNames.has(className)
  );
  if (leftovers.length > 0) {
    const otherSection = renderGroupSection(
      "Other",
      leftovers,
      selectedClasses
    );
    container.appendChild(otherSection);
  }

  const sidebar = document.getElementById("class-sidebar");
  // Use the new persistent label container
  const labelContainer = document.getElementById("sidebar-label-container");
  const selectedIconsDiv = document.getElementById("sidebar-selected-icons");

  /**
   * Helper: Render mini selected icons vertically under the label
   * @param {Array<string>} selectedClassNames
   */
  function updateSelectedMiniIcons(selectedClassNames) {
    if (!selectedIconsDiv) return;
    selectedIconsDiv.innerHTML = "";
    selectedClassNames.forEach((className) => {
      const paired = parsePairedHealerClasses(className);
      let iconDiv;
      if (paired) {
        // Overlapping mini-paired style for collapsed mini icons
        iconDiv = document.createElement("div");
        iconDiv.classList.add("mini-class-icon", "mini-healer-pair-mini");

        paired.forEach((healer, idx) => {
          const img = document.createElement("img");
          img.src = CLASS_ICONS[healer] || "";
          img.alt = healer;
          img.loading = "lazy";
          img.classList.add("mini-healer-pair-img");
          // Add z-index to overlap the second image on top
          if (idx === 1) {
            img.style.marginLeft = "-5px";
            img.style.zIndex = "2";
          } else {
            img.style.zIndex = "1";
          }
          iconDiv.appendChild(img);
        });
        // Tooltip for accessibility
        iconDiv.title = className;
      } else {
        iconDiv = document.createElement("div");
        iconDiv.classList.add("mini-class-icon");
        const iconUrl = CLASS_ICONS[className];
        if (iconUrl) {
          const img = document.createElement("img");
          img.src = iconUrl;
          img.alt = className;
          img.loading = "lazy";
          iconDiv.appendChild(img);
        } else {
          iconDiv.textContent = className[0]; // fallback: first letter
        }
        iconDiv.title = className;
      }
      // === Add class color line after the icon ===
      const colorLine = createClassColorLine(className);

      // --- NEW: Wrap icon and line in a container ---
      const iconLineContainer = document.createElement("div");
      iconLineContainer.classList.add("mini-icon-line-container");
      iconLineContainer.style.display = "flex";
      iconLineContainer.style.alignItems = "center";

      // Move iconDiv and colorLine into the new container
      iconLineContainer.appendChild(iconDiv);
      if (colorLine) iconLineContainer.appendChild(colorLine);

      // Now append the container, not the iconDiv, to selectedIconsDiv:
      selectedIconsDiv.appendChild(iconLineContainer);
    });
  }

  // Sidebar toggle handler using the whole label container (label + mini icons)
  if (sidebar && labelContainer) {
    labelContainer.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent triggering the document click handler
      sidebar.classList.toggle("collapsed");
      updateSidebarLabelVisibility();
    });

    // Accessibility: allow keyboard "Enter"/"Space" to toggle
    labelContainer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        sidebar.classList.toggle("collapsed");
        updateSidebarLabelVisibility();
      }
    });

    // Collapse sidebar when clicking anywhere outside the sidebar or the label container
    document.addEventListener("click", function (event) {
      if (
        !sidebar.classList.contains("collapsed") && // Only collapse if open
        !sidebar.contains(event.target) && // Not a click inside sidebar
        event.target !== labelContainer // Not a click on the label container
      ) {
        sidebar.classList.add("collapsed");
        updateSidebarLabelVisibility();
      }
    });

    // Initial label visibility on load
    updateSidebarLabelVisibility();
  }

  // Subscribe to filter changes to expand sidebar if none selected, and update mini icons
  subscribeToFilterChanges((state) => {
    if (!sidebar || !labelContainer) return;
    // Open sidebar if no classes are selected, else just update the mini icon list
    if (state.selectedClasses && state.selectedClasses.size === 0) {
      sidebar.classList.remove("collapsed");
      logger.info("No class selected: expanding the class sidebar.");
    } else {
      logger.debug(
        `Current selected classes: ${
          state.selectedClasses && state.selectedClasses.size > 0
            ? Array.from(state.selectedClasses).join(", ")
            : "(none)"
        }`
      );
    }
    updateSelectedMiniIcons(
      state.selectedClasses ? Array.from(state.selectedClasses) : []
    );
    updateSidebarLabelVisibility(); // Always sync label visibility with sidebar state
  });
}

/**
 * Create a colored line (div) that visually indicates a class's color.
 * - For regular classes with a defined color, returns a single colored line.
 * - For paired/composite classes (e.g., "White Mage+Sage") with colors for either/both components,
 *   returns two stacked lines (one per matching component, vertically separated).
 * - If neither the class nor its paired components have a color, returns null.
 *
 * @param {string} className - The class name or paired class string.
 * @returns {HTMLElement|null} The colored line element(s), or null if no color found.
 */
function createClassColorLine(className) {
  const color = CLASS_COLORS[className];
  if (color) {
    // Single color line (normal class)
    const line = document.createElement("div");
    line.classList.add("mini-class-color-line");
    line.style.background = color;
    return line;
  }

  // Try to split as a paired class and get colors for both
  const paired = parsePairedHealerClasses(className);
  if (paired) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "4px"; // spacing between lines

    paired.forEach((p) => {
      const c = CLASS_COLORS[p];
      if (c) {
        const line = document.createElement("div");
        line.classList.add("mini-class-color-line");
        line.style.background = c;
        wrapper.appendChild(line);
      }
    });

    // If at least one line added, return wrapper
    if (wrapper.children.length > 0) {
      return wrapper;
    }
  }

  // No color found, no match
  return null;
}
