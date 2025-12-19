import { $, on, getFocusable, setAttrs } from "../core/dom.js";

export function initNav() {
  // Hooks preferidos
  const toggle = $("[data-nav-toggle]") || $(".menu-toggle");
  const panel = $("[data-nav-panel]") || document.getElementById("mobile-nav");
  if (!toggle || !panel) return;

  // A11y wiring
  if (!panel.id) panel.id = "mobile-nav";
  setAttrs(toggle, { "aria-controls": panel.id, "aria-expanded": "false" });
  panel.setAttribute("aria-hidden", panel.hasAttribute("hidden") ? "true" : "false");

  let lastFocus = null;
  let cleanupTrap = () => {};

  const open = () => {
    lastFocus = document.activeElement;
    panel.removeAttribute("hidden");
    panel.setAttribute("aria-hidden", "false");
    setAttrs(toggle, { "aria-expanded": "true" });

    // lock scroll (simple)
    document.documentElement.style.overflow = "hidden";

    cleanupTrap = trapFocus(panel, () => close());
    const focusables = getFocusable(panel);
    (focusables[0] || panel).focus?.();
  };

  const close = () => {
    panel.setAttribute("hidden", "");
    panel.setAttribute("aria-hidden", "true");
    setAttrs(toggle, { "aria-expanded": "false" });

    document.documentElement.style.overflow = "";

    cleanupTrap();
    lastFocus?.focus?.();
  };

  const isOpen = () => !panel.hasAttribute("hidden");

  // Arranca cerrado
  close();

  on(toggle, "click", (e) => {
    e.preventDefault();
    isOpen() ? close() : open();
  });

  // Close on Esc
  on(document, "keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  // Close when clicking a link inside panel
  on(panel, "click", (e) => {
    const a = e.target?.closest?.("a[href]");
    if (a && isOpen()) close();
  });

  // Click outside closes
  on(document, "click", (e) => {
    if (!isOpen()) return;
    if (panel.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });

  // Desktop breakpoint safety
  window.addEventListener("resize", () => {
    if (window.innerWidth > 860 && isOpen()) close();
  });
}

function trapFocus(container, onEscape) {
  const handleKeydown = (e) => {
    if (e.key === "Escape") onEscape?.();

    if (e.key !== "Tab") return;

    const list = getFocusable(container);
    if (!list.length) return;

    const first = list[0];
    const last = list[list.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", handleKeydown);
  return () => container.removeEventListener("keydown", handleKeydown);
}
