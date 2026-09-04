// js/features/detailsFocus.js
// Auto-abre un <details> cuando la URL apunta a él, para que el usuario que
// llega desde el nav (ej. #sellos) vea el contenido ya abierto sin tener que
// hacer click extra. Cubre tanto load inicial como cambios de hash y clicks
// sobre anchors dentro del nav.
export function initDetailsFocus() {
  const openTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el.tagName === "DETAILS" && !el.open) {
      el.open = true;
    }
  };

  // Al cargar
  openTarget();

  // Al cambiar el hash (nav clicks internos)
  window.addEventListener("hashchange", openTarget, { passive: true });

  // También cuando se hace click en un anchor del nav a un details cerrado
  // (por si el hash ya coincide y hashchange no dispara).
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href*="#"]');
    if (!a) return;
    const href = a.getAttribute("href") || "";
    const idx = href.indexOf("#");
    if (idx < 0) return;
    const id = href.slice(idx + 1);
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el.tagName === "DETAILS" && !el.open) {
      el.open = true;
    }
  });
}
