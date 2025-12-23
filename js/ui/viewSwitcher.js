import { getLogger } from "../shared/logging/logger.js";
import {
  initViewState,
  subscribeToViewChanges,
  setActiveView,
} from "../shared/viewState.js";

const logger = getLogger("viewSwitcher");

/**
 * Initialize the tab/toggle UI that lets users hop between Trend and Percentile views.
 * - Ensures the URL-derived view is honored on load.
 * - Wires button clicks to call setActiveView.
 * - Shows/hides DOM fragments tagged with data-view attributes.
 */
export function setupViewSwitcher() {
  initViewState();
  const switcher = document.getElementById("view-switcher");
  if (!switcher) {
    logger.warn("View switcher container not found");
    return;
  }
  const buttons = Array.from(
    switcher.querySelectorAll("[data-view-id]")
  );
  if (buttons.length === 0) {
    logger.warn("No view buttons configured");
    return;
  }
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewId = btn.dataset.viewId;
      setActiveView(viewId);
    });
  });
  /**
   * Visually reflect the current view in the button group.
   * @param {string} activeView
   */
  const updateActiveButton = (activeView) => {
    buttons.forEach((btn) => {
      const targetView = btn.dataset.viewId;
      if (targetView === activeView) {
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
      }
    });
  };
  /**
   * Toggle DOM fragments based on their data-view attribute.
   * Elements can opt into multiple views by supplying a comma-separated list or "all".
   * @param {string} activeView
   */
  const syncContentVisibility = (activeView) => {
    const sections = document.querySelectorAll("[data-view]");
    sections.forEach((section) => {
      const config = section.dataset.view
        .split(",")
        .map((v) => v.trim());
      const isVisible =
        config.includes("all") || config.includes(activeView);
      section.classList.toggle("view-hidden", !isVisible);
    });
  };
  subscribeToViewChanges((activeView) => {
    updateActiveButton(activeView);
    syncContentVisibility(activeView);
  });
}
