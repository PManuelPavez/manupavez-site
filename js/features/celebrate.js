// celebrate.js — Festejo visual al cumplir misiones (sin librerías).
// burst(): confetti que sale desde un punto. toast(): cartel breve abajo.
// Respeta "reducir movimiento": en ese caso solo se muestra el cartel.

const COLORS = ["#59c6ba", "#f39a4a", "#8fa3ff", "#f0c36b", "#d58bb4"];
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let layer = null;
function getLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement("div");
  layer.className = "celebrate-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  return layer;
}

/** Confetti desde el centro de `el` (o desde x/y). size: "small" | "big" */
export function burst(el, size = "small") {
  if (reduced() || !el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const count = size === "big" ? 70 : 16;
  const spread = size === "big" ? 260 : 90;
  const root = getLayer();

  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "celebrate-bit";
    // estilos por CSSOM (la CSP no permite style="" en el HTML, esto sí)
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = COLORS[i % COLORS.length];
    if (i % 3 === 0) p.style.borderRadius = "50%";
    root.appendChild(p);

    const angle = (Math.random() * Math.PI * 2);
    const dist = spread * (0.35 + Math.random() * 0.65);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - (size === "big" ? 120 : 40);
    const rot = (Math.random() - 0.5) * 720;
    const dur = (size === "big" ? 1300 : 750) + Math.random() * 500;

    p.animate(
      [
        { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 160}px)) scale(0.6) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: dur, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
    ).onfinish = () => p.remove();
  }
}

/** Cartel breve (se va solo). Uno por vez. */
let toastTimer = null;
export function toast(text) {
  const root = getLayer();
  let t = root.querySelector(".celebrate-toast");
  if (!t) {
    t = document.createElement("p");
    t.className = "celebrate-toast";
    t.setAttribute("role", "status");
    root.appendChild(t);
  }
  // El layer es aria-hidden: el cartel se anuncia aparte
  root.removeAttribute("aria-hidden");
  t.textContent = text;
  t.classList.remove("is-out");
  t.classList.add("is-in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.replace("is-in", "is-out");
    setTimeout(() => { if (t.classList.contains("is-out")) root.setAttribute("aria-hidden", "true"); }, 500);
  }, 3200);
}
