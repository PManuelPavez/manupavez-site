// theme-boot.js — Modo claro / oscuro del espacio del alumno.
// Se carga en el <head> SIN defer para aplicar el tema antes de pintar (sin parpadeo).
// Prioridad: lo que eligió el alumno (guardado en este navegador) → el modo del sistema.
(function () {
  var KEY = "lab-theme";
  var root = document.documentElement;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch (e) { return null; }
  }
  function system() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function apply(theme) {
    root.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f5f8" : "#050711");
  }

  apply(saved() || system());

  // Si no eligió nada, sigue al sistema cuando cambia
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var follow = function () { if (!saved()) apply(system()); };
    if (mq.addEventListener) mq.addEventListener("change", follow);
  }

  window.labTheme = {
    get: function () { return root.dataset.theme; },
    set: function (theme) {
      apply(theme);
      try { localStorage.setItem(KEY, theme); } catch (e) { /* storage bloqueado: dura hasta recargar */ }
    },
  };
})();
