import { $ } from "../core/dom.js";
import { motionBehavior } from "../core/motion.js";

export function initScrollTop() {
  const btn = $("[data-scroll-top]") || $(".scroll-top");
  if (!btn) return;

  const update = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    btn.classList.toggle("visible", y >= 600);
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  };

  update();
  window.addEventListener("scroll", onScroll, { passive: true });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: motionBehavior() });
  });
}
