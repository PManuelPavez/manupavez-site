export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, type, handler, options) {
  if (!el) return () => {};
  el.addEventListener(type, handler, options);
  return () => el.removeEventListener(type, handler, options);
}

export const isFocusable = (el) => {
  if (!el) return false;
  const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
  const hidden = el.getAttribute("aria-hidden") === "true";
  return !disabled && !hidden && el.tabIndex >= 0;
};

export function getFocusable(container) {
  if (!container) return [];
  const candidates = $$(
    `a[href], button, input, select, textarea, details summary, [tabindex]:not([tabindex="-1"])`,
    container
  );
  return candidates.filter(isFocusable);
}

export function setAttrs(el, attrs = {}) {
  if (!el) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) el.removeAttribute(k);
    else el.setAttribute(k, String(v));
  }
}
