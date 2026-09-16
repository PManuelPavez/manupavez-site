// js/features/viewportPause.js
// Pausa animaciones costosas (marquees) cuando salen del viewport.
// Ahorro concreto: en mobile, un marquee corriendo permanente = 1-2%
// CPU + calienta batería. Con esto, cuando el usuario no lo ve, se detiene.
export function initViewportPause() {
  if (!("IntersectionObserver" in window)) return;

  const targets = document.querySelectorAll(
    ".supports-latam, .labels-track, .photo-strip-track"
  );
  if (!targets.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        e.target.classList.toggle("is-visible", e.isIntersecting);
      }
    },
    { rootMargin: "120px 0px", threshold: 0 }
  );

  targets.forEach((el) => io.observe(el));
}
