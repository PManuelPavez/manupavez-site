import { $$ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";
import { makeIO } from "../core/observers.js";

export function initReveal() {
  const items = [
    ...$$('[data-reveal]'),
    ...$$('.reveal'),
  ].filter((el, idx, arr) => arr.indexOf(el) === idx);

  if (!items.length) return;

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = makeIO((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  if (!io) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  items.forEach((el) => io.observe(el));
}
