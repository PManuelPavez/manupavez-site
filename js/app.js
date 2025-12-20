// js/app.js (legacy)
// Este archivo existía en versiones anteriores y llegó a romper el sitio por errores de sintaxis.
// El frontend actual corre con módulos ESM desde /js/main.js.
//
// Si tu HTML aún incluye app.js, que no te apague la página: lo dejamos como stub seguro.
// (Y sí: esto es a propósito. Mejor una advertencia que un pantallazo negro.)

if (!window.__MP_ESM__) {
  console.warn("[app.js] Legacy cargado sin main.js. Este archivo está desactivado.");
} else {
  console.info("[app.js] Legacy desactivado: usando main.js modular.");
}
