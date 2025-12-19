export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export function motionBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}
