import {
  updateFilterValue,
  subscribeToFilterChanges,
  updateSidebarLabelVisibility,
} from "../shared/filterState.js";
import { getLogger } from "../shared/logging/logger.js";
import { JOB_ICONS, JOB_GROUPS, JOB_COLORS } from "../config/appConfig.js";

const logger = getLogger("jobSidebarManager");
let jobSidebarSelectionSync = null;
/**
 * Produce a deterministic signature for the current job selection.
 * Used to detect when updates are redundant so UI redraws can be skipped.
 * @param {Set<string>|Array<string>|null|undefined} jobNames
 * @returns {string}
 */
export function buildJobSelectionSignature(jobNames) {
  if (!jobNames) return "";
  const normalized = normalizeJobList(jobNames);
  if (normalized.length === 0) return "";
  return normalized.slice().sort().join("|");
}

/**
 * Apply an external job selection (e.g., from URL hydration) to the sidebar UI and filter state.
 * @param {Iterable<string>|Set<string>|Array<string>} jobNames
 * @param {Object} [options]
 * @param {boolean} [options.silent=false] - If true, do not emit filter updates.
 */
export function applyJobSelections(jobNames, options = {}) {
  if (typeof jobSidebarSelectionSync !== "function") {
    logger.warn("Job sidebar not initialized; cannot apply job selections.");
    return;
  }
  const normalized = normalizeJobList(jobNames);
  jobSidebarSelectionSync(normalized, options);
}

/**
 * Normalize any incoming representation of job selections (Set, array, single string)
 * into a plain array so downstream helpers can treat them uniformly.
 * @param {Iterable|string|null} jobNames
 * @returns {Array<string>}
 */
function normalizeJobList(jobNames) {
  if (!jobNames) return [];
  if (jobNames instanceof Set) return Array.from(jobNames);
  if (Array.isArray(jobNames)) return jobNames;
  if (typeof jobNames === "string") return [jobNames];
  return [];
}

/**
 * Create a job icon element for use in the sidebar grid.
 * Handles both regular jobs and special paired healer jobs.
 * - For single jobs: loads icon image (if available) from JOB_ICONS, with fallback to text label.
 * - For paired healer jobs (e.g., "White Mage+Sage" or "Scholar (x2)"):
 *     Uses createPairedHealerIconElement to render two icons together, styled as a pair.
 * The returned element will emit a filter update when toggled/selected.
 *
 * @param {string} jobName - The job name or combo string. Used as value and data-attribute.
 * @param {Set<string>} selectedJobs - Set of currently selected job names for updating selection state.
 * @returns {HTMLElement} The sidebar icon element (single or paired).
 */
function createJobIconElement(jobName, selectedJobs) {
  // Check if the jobName represents a special paired healer combo (e.g., "White Mage+Sage").
  // If so, render using the paired icon element (two icons in one cell).
  const paired = parsePairedHealerJobs(jobName);
  if (paired) {
    // Render a large paired healer icon (side-by-side icons with +, for main grid use)
    return createPairedHealerIconElement(jobName, paired, selectedJobs);
  }

  // Create the main icon div for a single job
  const iconDiv = document.createElement("div");
  iconDiv.classList.add("job-icon");
  iconDiv.setAttribute("data-class", jobName);

  // Add a fallback label (the job name text) for use if the image fails or is missing
  const fallbackLabel = document.createElement("span");
  fallbackLabel.textContent = jobName;
  fallbackLabel.classList.add("fallback-label");
  iconDiv.appendChild(fallbackLabel);

  // Attempt to load the icon image from the JOB_ICONS mapping.
  // If no mapping is found, show warning and rely on fallback text label.
  let iconUrl;
  if (JOB_ICONS[jobName]) {
    iconUrl = JOB_ICONS[jobName];
  } else {
    iconUrl = "";
    logger.warn(
      `No icon mapping found for job "${jobName}" in JOB_ICONS. No image will be loaded.`
    );
  }
  const img = document.createElement("img");
  img.src = iconUrl;
  img.alt = jobName;
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
      `Job icon failed to load for "${jobName}". URL attempted: ${img.src}`
    );
  };

  iconDiv.appendChild(img);

  // Allow users to select/deselect the job by clicking this icon
  // Selection state is reflected by the 'selected' job, and filterState is updated accordingly
  iconDiv.addEventListener("click", () => {
    if (iconDiv.classList.toggle("selected")) {
      selectedJobs.add(jobName);
    } else {
      selectedJobs.delete(jobName);
    }
    // Always notify filterState listeners after change
    updateFilterValue("selectedJobs", new Set(selectedJobs));
  });

  return iconDiv;
}

/**
 * Render a group section with section header and icon rows (max 4 items per row).
 * - Supports displaying paired healer jobs (e.g., "White Mage+Sage" or "Scholar (x2)")
 *   using a special paired icon renderer.
 * - Uses JOB_GROUPS for known roles and job sets.
 * - Regular job names are rendered with createJobIconElement.
 * - Paired healers are detected using parsePairedHealerJobs and rendered as side-by-side mini-icons.
 *
 * @param {string} groupName - The name of the job group.
 * @param {Array<string>} jobList - List of job names in this group.
 * @param {Set<string>} selectedJobs
 * @returns {HTMLElement} The group section element.
 */
function renderGroupSection(groupName, jobList, selectedJobs) {
  const section = document.createElement("div");
  section.classList.add("job-group-section");

  // Section header
  const header = document.createElement("div");
  header.classList.add("job-group-header");
  header.textContent = groupName;
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  section.appendChild(header);

  const selectableJobNames = [];
  const selectableJobElements = [];

  // Helper: returns true if this job is a paired healer combo
  function isPairedHealer(jobName) {
    return groupName === "Healer" && parsePairedHealerJobs(jobName);
  }

  // For row grouping: treat each paired healer as a single "slot"
  let row = null,
    rowCount = 0;
  for (let i = 0; i < jobList.length; ) {
    // Start a new row every 4 items
    if (!row || rowCount === 0) {
      row = document.createElement("div");
      row.classList.add("job-icon-row");
      section.appendChild(row);
      rowCount = 0;
    }

    const jobName = jobList[i];
    if (isPairedHealer(jobName)) {
      const iconDiv = createPairedHealerIconElement(
        jobName,
        parsePairedHealerJobs(jobName),
        selectedJobs
      );
      row.appendChild(iconDiv);
      rowCount++;
      i++;
    } else {
      const iconDiv = createJobIconElement(jobName, selectedJobs);
      row.appendChild(iconDiv);
      selectableJobNames.push(jobName);
      selectableJobElements.push(iconDiv);
      rowCount++;
      i++;
    }
    if (rowCount >= 4) rowCount = 0; // next iteration starts new row
  }

  const toggleGroupSelection = () => {
    if (selectableJobNames.length === 0) return;
    const shouldSelectAll = selectableJobNames.some(
      (job) => !selectedJobs.has(job)
    );
    selectableJobNames.forEach((job, idx) => {
      const iconEl = selectableJobElements[idx];
      if (shouldSelectAll) {
        selectedJobs.add(job);
        iconEl.classList.add("selected");
      } else {
        selectedJobs.delete(job);
        iconEl.classList.remove("selected");
      }
    });
    updateFilterValue("selectedJobs", new Set(selectedJobs));
  };

  header.addEventListener("click", toggleGroupSelection);
  header.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleGroupSelection();
    }
  });

  return section;
}

/**
 * Helper for rendering a single mini healer icon.
 * @param {string} jobName
 * @returns {HTMLElement}
 */
function createMiniHealerIcon(jobName) {
  const iconDiv = document.createElement("div");
  iconDiv.classList.add("mini-job-icon", "mini-healer-pair");
  const iconUrl = JOB_ICONS[jobName];
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = jobName;
    img.loading = "lazy";
    iconDiv.appendChild(img);
  } else {
    iconDiv.textContent = jobName[0];
  }
  return iconDiv;
}

/**
 * Extract individual healer names from a paired/combo string.
 * Uses JOB_GROUPS.Healer for the allowed list.
 */
export function parsePairedHealerJobs(jobName) {
  const HEALER_NAMES = JOB_GROUPS.Healer;
  // Regex for combos like "White Mage+Sage" or "Astrologian+Scholar"
  const plusCombo = /^([\w\s]+)\+([\w\s]+)$/;
  const matchPlus = jobName.match(plusCombo);
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
  const matchDup = jobName.match(dupCombo);
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
 * @param {string} jobName - The full combo name.
 * @param {string[]} healerNames - The two healer names extracted from the combo string.
 * @param {Set<string>} selectedJobs - Set of currently selected job names.
 * @returns {HTMLElement} - The sidebar element containing the paired healer icon.
 */
function createPairedHealerIconElement(jobName, healerNames, selectedJobs) {
  // Outer div representing the grid slot for this paired icon
  const pairDiv = document.createElement("div");
  pairDiv.classList.add("job-icon", "paired-healer-icon");
  pairDiv.setAttribute("data-class", jobName);

  // Inner flexbox container for the two overlapping avatars
  const innerDiv = document.createElement("div");
  innerDiv.classList.add("paired-healer-inner");

  // Fallback label: only shown if both images fail to load
  const fallbackLabel = document.createElement("span");
  fallbackLabel.textContent = jobName;
  fallbackLabel.classList.add("fallback-label");
  fallbackLabel.style.display = "none";
  pairDiv.appendChild(fallbackLabel);

  // Render healer icons
  let failedCount = 0;
  healerNames.forEach((healer, idx) => {
    const img = document.createElement("img");
    img.src = JOB_ICONS[healer] || "";
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
        `Paired healer icon failed to load for "${healer}" in "${jobName}". URL attempted: ${img.src}`
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
      if (selectedJobs.has(h)) beforeSingles.add(h);
    });

    if (pairDiv.classList.toggle("selected")) {
      // Selecting: add the pair string itself
      selectedJobs.add(jobName);
    } else {
      // Deselecting: remove the pair string,
      // but only remove the individual healers if they weren't selected individually
      selectedJobs.delete(jobName);
      healerNames.forEach((h) => {
        // Only remove if not in the set before (i.e., not picked as a single)
        if (!beforeSingles.has(h)) {
          selectedJobs.delete(h);
        }
      });
    }
    // Always notify filterState listeners after change
    updateFilterValue("selectedJobs", new Set(selectedJobs));
  });

  return pairDiv;
}

/**
 * Setup the job sidebar with grouped icons, section headers, and centralized click updates.
 * Lays out sections/rows synchronously. Image loading is independent.
 * Also handles the persistent "Jobs" label with a vertical mini-icon list
 * that is visible only when the sidebar is collapsed.
 * Any jobs in jobList not found in the predefined groups will appear in an "Other" section at the bottom.
 * Sidebar expand/collapse logic is centralized for maintainability.
 *
 * @param {Array<string>} jobList - List of job names (all available).
 */
export function setupJobSidebar(jobList) {
  const container = document.getElementById("job-icons-container");
  if (!container) {
    logger.warn("Job icons container not found; skipping sidebar setup.");
    return;
  }

  container.innerHTML = ""; // Clear old content if any
  const selectedJobs = new Set();
  const iconMap = new Map();

  // Track which job names are already displayed, so we can find "leftover" jobs later
  const displayedJobNames = new Set();

  // --- Grouped Section/Row Layout ---
  const groupOrder = [
    "Tank",
    "Healer",
    "Melee DPS",
    "Physical Ranged DPS",
    "Magical Ranged DPS",
  ];
  for (const group of groupOrder) {
    let groupJobNames = [];
    if (group === "Healer") {
      // Use all singles PLUS all pair names in jobList that parse as paired healers
      const singles = JOB_GROUPS["Healer"];
      const pairs = jobList.filter((name) => parsePairedHealerJobs(name));
      groupJobNames = [...singles, ...pairs];
    } else {
      groupJobNames = JOB_GROUPS[group] || [];
    }
    // Mark as displayed
    groupJobNames.forEach((name) => displayedJobNames.add(name));
    const groupSection = renderGroupSection(group, groupJobNames, selectedJobs);
    container.appendChild(groupSection);
  }

  // --- Add "Other" section for any job names in jobList not already displayed ---
  const leftovers = jobList.filter(
    (jobName) => !displayedJobNames.has(jobName)
  );
  if (leftovers.length > 0) {
    const otherSection = renderGroupSection("Other", leftovers, selectedJobs);
    container.appendChild(otherSection);
  }

  container
    .querySelectorAll(".job-icon[data-class]")
    .forEach((node) => {
      const jobName = node.getAttribute("data-class");
      if (jobName) {
        iconMap.set(jobName, node);
      }
    });

  /**
   * Apply a list of job names to the sidebar UI and optionally emit filter updates.
   * This powers both URL hydration and state-to-UI synchronization.
   * @param {Iterable|string} jobNames
   * @param {Object} [options]
   * @param {boolean} [options.silent=false]
   */
  const syncSelectionFromState = (jobNames, { silent } = {}) => {
    const normalized = normalizeJobList(jobNames);
    selectedJobs.clear();
    normalized.forEach((name) => selectedJobs.add(name));
    iconMap.forEach((el, jobName) => {
      const shouldSelect = selectedJobs.has(jobName);
      el.classList.toggle("selected", shouldSelect);
    });
    if (!silent) {
      updateFilterValue("selectedJobs", new Set(selectedJobs));
    }
  };

  jobSidebarSelectionSync = (jobNames, options = {}) =>
    syncSelectionFromState(jobNames, options);

  const sidebar = document.getElementById("job-sidebar");
  const labelContainer = document.getElementById("sidebar-label-container");
  const selectedIconsDiv = document.getElementById("sidebar-selected-icons");

  /**
   * Helper: Render mini selected icons vertically under the label.
   * Each selected job (including pairs) is shown with its icon and color line.
   * @param {Array<string>} selectedJobNames
   */
  function updateSelectedMiniIcons(selectedJobNames) {
    if (!selectedIconsDiv) return;
    selectedIconsDiv.innerHTML = "";
    selectedJobNames.forEach((jobName) => {
      const paired = parsePairedHealerJobs(jobName);
      let iconDiv;
      if (paired) {
        // Overlapping mini-paired style for collapsed mini icons
        iconDiv = document.createElement("div");
        iconDiv.classList.add("mini-job-icon", "mini-healer-pair-mini");

        paired.forEach((healer, idx) => {
          const img = document.createElement("img");
          img.src = JOB_ICONS[healer] || "";
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
        iconDiv.title = jobName;
      } else {
        iconDiv = document.createElement("div");
        iconDiv.classList.add("mini-job-icon");
        const iconUrl = JOB_ICONS[jobName];
        if (iconUrl) {
          const img = document.createElement("img");
          img.src = iconUrl;
          img.alt = jobName;
          img.loading = "lazy";
          iconDiv.appendChild(img);
        } else {
          iconDiv.textContent = jobName[0]; // fallback: first letter
        }
        iconDiv.title = jobName;
      }
      // Add job color line after the icon
      const colorLine = createJobColorLine(jobName);

      // Wrap icon and line in a container for correct alignment
      const iconLineContainer = document.createElement("div");
      iconLineContainer.classList.add("mini-icon-line-container");
      iconLineContainer.style.display = "flex";
      iconLineContainer.style.alignItems = "center";

      iconLineContainer.appendChild(iconDiv);
      if (colorLine) iconLineContainer.appendChild(colorLine);

      selectedIconsDiv.appendChild(iconLineContainer);
    });
  }

  // === Centralized collapse/expand logic ===
  let collapseHelpers;
  if (sidebar && labelContainer) {
    // Pass updateSidebarLabelVisibility so label always stays in sync with state
    collapseHelpers = setupSidebarCollapseHandlers(
      sidebar,
      labelContainer,
      updateSidebarLabelVisibility
    );
    // Ensure auto-collapse stays disabled until the first job selection occurs.
    collapseHelpers.setAutoCollapseEnabled(false);

    // Initial label visibility on load
    updateSidebarLabelVisibility();
    const observer = new MutationObserver(() => {
      updateSidebarLabelVisibility();
    });
    observer.observe(sidebar, { attributes: true, attributeFilter: ["class"] });
  }

  // Track last rendered selection signature so slider-only updates don't thrash the mini icons.
  let lastRenderedSignature = null;

  // Expand sidebar automatically if no jobs are selected, and update mini icon list only when jobs change.
  subscribeToFilterChanges((state, change) => {
    if (!sidebar || !labelContainer) return;
    if (!state) return;
    if (change && change.key !== "selectedJobs") return;
    const jobsSignature = buildJobSelectionSignature(state.selectedJobs);
    const selectionChanged = jobsSignature !== lastRenderedSignature;
    if (selectionChanged) {
      lastRenderedSignature = jobsSignature;
      syncSelectionFromState(state?.selectedJobs || [], { silent: true });
    }
    // Open sidebar if no jobs are selected
    const hasSelection =
      state.selectedJobs && state.selectedJobs.size > 0 ? true : false;
    if (collapseHelpers) {
      collapseHelpers.setAutoCollapseEnabled(hasSelection);
    }

    if (!hasSelection) {
      collapseHelpers && collapseHelpers.expandSidebar();
      logger.info("No job selected: expanding the job sidebar.");
    } else {
      logger.debug(
        `Current selected jobs: ${
          state.selectedJobs && state.selectedJobs.size > 0
            ? Array.from(state.selectedJobs).join(", ")
            : "(none)"
        }`
      );
    }
    if (selectionChanged) {
      updateSelectedMiniIcons(
        state.selectedJobs ? Array.from(state.selectedJobs) : []
      );
    }
    updateSidebarLabelVisibility(); // Always sync label visibility with sidebar state
  });
}

/**
 * Create a colored line (div) that visually indicates a job's color.
 * - For regular jobs with a defined color, returns a single colored line.
 * - For paired/composite jobs (e.g., "White Mage+Sage") with colors for either/both components,
 *   returns two stacked lines (one per matching component, vertically separated).
 * - If neither the job nor its paired components have a color, returns null.
 *
 * @param {string} jobName - The job name or paired job string.
 * @returns {HTMLElement|null} The colored line element(s), or null if no color found.
 */
function createJobColorLine(jobName) {
  const color = JOB_COLORS[jobName];
  if (color) {
    // Single color line (normal job)
    const line = document.createElement("div");
    line.classList.add("mini-job-color-line");
    line.style.background = color;
    return line;
  }

  // Try to split as a paired job and get colors for both
  const paired = parsePairedHealerJobs(jobName);
  if (paired) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "4px"; // spacing between lines

    paired.forEach((p) => {
      const c = JOB_COLORS[p];
      if (c) {
        const line = document.createElement("div");
        line.classList.add("mini-job-color-line");
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

/**
 * Centralizes all sidebar collapse/expand/toggle logic and event handlers.
 * Ensures a single source of truth for sidebar UI state and user interactions.
 *
 * @param {HTMLElement} sidebar - The sidebar DOM element.
 * @param {HTMLElement} labelContainer - The label/minibar DOM element used for toggling.
 * @param {function=} updateLabelVisibility - Optional callback to update label visibility after state change.
 * @returns {Object} Helper methods for external control: {collapseSidebar, expandSidebar, toggleSidebar, isCollapsed}
 */
function setupSidebarCollapseHandlers(
  sidebar,
  labelContainer,
  updateLabelVisibility
) {
  // Auto-collapse only kicks in after a user has picked at least one job.
  let autoCollapseEnabled = false;

  /**
   * Determine whether passive collapse actions are allowed.
   * Keeping this off ensures the sidebar remains visible until the user
   * intentionally interacts with the job grid for the first time.
   * @returns {boolean}
   */
  function shouldAutoCollapse() {
    return autoCollapseEnabled;
  }

  /**
   * Enables/disables passive collapse triggers (scroll, outside click, etc.).
   * When disabled, the sidebar is forced open so the user keeps seeing the grid.
   * @param {boolean} enabled
   */
  function setAutoCollapseEnabled(enabled) {
    autoCollapseEnabled = Boolean(enabled);
    if (!autoCollapseEnabled) {
      expandSidebar();
    }
  }

  /**
   * Collapse the sidebar by adding the 'collapsed' job.
   */
  function collapseSidebar({ force = false } = {}) {
    if (!force && !shouldAutoCollapse()) {
      return;
    }
    sidebar.classList.add("collapsed");
    if (updateLabelVisibility) updateLabelVisibility();
  }

  /**
   * Expand the sidebar by removing the 'collapsed' job.
   */
  function expandSidebar() {
    sidebar.classList.remove("collapsed");
    if (updateLabelVisibility) updateLabelVisibility();
  }

  /**
   * Toggle the sidebar's collapsed state.
   */
  function toggleSidebar() {
    sidebar.classList.toggle("collapsed");
    if (updateLabelVisibility) updateLabelVisibility();
  }

  /**
   * Returns true if the sidebar is currently collapsed.
   * @returns {boolean}
   */
  function isCollapsed() {
    return sidebar.classList.contains("collapsed");
  }

  // Track whether the mouse is currently over the sidebar
  let mouseOverSidebar = false;
  let mouseX = 0,
    mouseY = 0;

  sidebar.addEventListener("mouseenter", () => {
    mouseOverSidebar = true;
  });
  sidebar.addEventListener("mouseleave", () => {
    mouseOverSidebar = false;
  });

  sidebar.addEventListener("mouseenter", () => {
    mouseOverSidebar = true;
  });

  sidebar.addEventListener("mouseleave", () => {
    mouseOverSidebar = false;
    if (!isCollapsed()) {
      collapseSidebar();
    }
  });

  // Handler for clicking the label (persistent minibar)
  labelContainer.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSidebar();
  });

  // Accessibility: Keyboard "Enter"/"Space" toggles sidebar
  labelContainer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Collapse sidebar when clicking anywhere outside sidebar or labelContainer
  document.addEventListener("click", function (event) {
    if (
      !isCollapsed() &&
      !sidebar.contains(event.target) &&
      event.target !== labelContainer &&
      shouldAutoCollapse()
    ) {
      collapseSidebar();
    }
  });

  // Collapse sidebar when the user scrolls anywhere, but only if the mouse is not over the sidebar
  window.addEventListener(
    "scroll",
    function () {
      const mouseElement = document.elementFromPoint(mouseX, mouseY);

      if (!isCollapsed() && !mouseOverSidebar && shouldAutoCollapse()) {
        logger.info(
          "[Sidebar] Collapsing sidebar due to window scroll and mouse not over sidebar."
        );
        collapseSidebar();
      }
    },
    { capture: true, passive: true }
  );

  // --- Touch scroll elsewhere collapse for mobile devices ---

  let touchScrollStartedInsideSidebar = false;
  let touchStarted = false;

  sidebar.addEventListener(
    "touchstart",
    function (e) {
      touchScrollStartedInsideSidebar = true;
      touchStarted = true;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchstart",
    function (e) {
      // Only update if touch is outside sidebar
      if (!sidebar.contains(e.target)) {
        touchScrollStartedInsideSidebar = false;
        touchStarted = true;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    function (e) {
      // Only handle the first touchmove after a touchstart
      if (!touchStarted || !shouldAutoCollapse()) return;
      touchStarted = false;

      if (!isCollapsed() && !touchScrollStartedInsideSidebar) {
        logger.info(
          "[Sidebar] Collapsing sidebar due to touch scroll outside sidebar."
        );
        collapseSidebar();
      }
    },
    { passive: true }
  );

  // Return helper functions for use in setupJobSidebar or elsewhere
  return {
    collapseSidebar,
    expandSidebar,
    toggleSidebar,
    isCollapsed,
    setAutoCollapseEnabled,
  };
}

// Exported for testing auto-collapse behavior.
export { setupSidebarCollapseHandlers };
