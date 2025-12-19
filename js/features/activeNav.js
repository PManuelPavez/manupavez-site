import { $$ } from "../core/dom.js";
import { makeIO } from "../core/observers.js";

export function initActiveNav() {
  // Links del nav con hash (soporta "#id" y "index.html#id")
  const links = $$('header .nav a[href*="#"], header #mobile-nav a[href*="#"]');
  if (!links.length) return;

  const map = new Map();
  for (const a of links) {
    const href = a.getAttribute("href") || "";
    const hash = href.includes("#") ? href.split("#").pop() : "";
    const id = hash ? decodeURIComponent(hash) : "";
    if (!id) continue;
    const section = document.getElementById(id);
    if (section) map.set(section, a);
  }
  if (!map.size) return;

  const io = makeIO((entries) => {
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;

    for (const a of map.values()) a.removeAttribute("aria-current");
    const a = map.get(visible.target);
    a?.setAttribute("aria-current", "page");
  }, { rootMargin: "-35% 0px -55% 0px", threshold: [0.12, 0.25, 0.5] });

  if (!io) return;
  for (const section of map.keys()) io.observe(section);
}
