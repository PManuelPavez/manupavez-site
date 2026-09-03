/**
 * Codigo.gs — Web App para leer (GET) y actualizar (POST) la hoja activa.
 * ======================================================================
 *
 * Reemplaza a gspread + Service Account: en vez de autenticar con
 * credenciales, publicamos esta hoja como una Web App y la consumimos
 * desde automation.py:
 *   - doGet():  devuelve la planilla como JSON (lectura).
 *   - doPost(): marca una fila como PROCESADO (write-back), protegido por API key.
 *
 * CÓMO PUBLICAR:
 *   1. Abrí la planilla en Google Sheets.
 *   2. Menú: Extensiones → Apps Script.
 *   3. Pegá este código en el editor (archivo Codigo.gs).
 *   4. ⚠️ Reemplazá el valor de API_KEY (abajo) por tu clave real
 *        (la misma que pongas en WEB_APP_API_KEY del .env). Guardá.
 *   5. Botón "Implementar" (Deploy) → "Nueva implementación".
 *   6. Tipo: "Aplicación web" (Web app).
 *        - Ejecutar como: "Yo" (tu cuenta).
 *        - Quién tiene acceso: "Cualquier persona" (Anyone).
 *   7. Implementar → autorizá los permisos → copiá la "URL de la aplicación web".
 *      Esa URL termina en /exec y es la que usa automation.py (WEB_APP_URL).
 *
 * NOTA: cada vez que cambies el código tenés que crear una NUEVA versión de la
 * implementación ("Gestionar implementaciones" → editar ✏️ → "Nueva versión")
 * para que la URL sirva el código actualizado.
 */

// ⚠️ CLAVE COMPARTIDA — reemplazá este placeholder por tu clave real en el
// editor de Apps Script. NO la subas a git. Debe coincidir EXACTAMENTE con
// WEB_APP_API_KEY del archivo .env del script local.
var API_KEY = "PEGA_ACA_TU_API_KEY_SECRETA";

// Nombres de columnas (deben coincidir con las cabeceras de la hoja).
var COL_ID = "ID";
var COL_ESTADO = "Estado_Soundcloud";
var ESTADO_PROCESADO = "PROCESADO";


/**
 * GET → devuelve la hoja activa como un array JSON de objetos
 * (clave = nombre de columna), igual que gspread.get_all_records().
 */
function doGet(e) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // getDisplayValues() devuelve el texto tal como se ve en cada celda
  // (mantiene el formato de fecha que escribiste, ej. "10/06/2026").
  var datos = hoja.getDataRange().getDisplayValues();
  var cabeceras = datos.shift();

  var filas = datos.map(function (fila) {
    var registro = {};
    cabeceras.forEach(function (cabecera, i) {
      registro[cabecera] = fila[i];
    });
    return registro;
  });

  return jsonResponse(filas);
}


/**
 * POST → marca como PROCESADO la columna Estado_Soundcloud de la fila cuyo
 * ID coincida con el del body. Protegido por una API key simple.
 *
 * Body esperado (JSON):
 *   { "apiKey": "<clave>", "id": "<ID de la fila>" }
 *
 * NOTA sobre seguridad: Apps Script NO expone los headers de la request en
 * doPost(e), por eso la API key viaja en el body (igual cifrado por HTTPS).
 */
function doPost(e) {
  // 1) Parsear el cuerpo JSON.
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "JSON inválido en el body" });
  }

  // 2) Validar la API key.
  if (!body.apiKey || body.apiKey !== API_KEY) {
    return jsonResponse({ ok: false, error: "No autorizado" });
  }

  // 3) Validar que venga un ID.
  var id = body.id;
  if (id === undefined || id === null || String(id).trim() === "") {
    return jsonResponse({ ok: false, error: "Falta 'id' en el body" });
  }

  // 4) Ubicar las columnas por nombre.
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var datos = hoja.getDataRange().getValues();
  var cabeceras = datos[0];
  var colId = cabeceras.indexOf(COL_ID);
  var colEstado = cabeceras.indexOf(COL_ESTADO);

  if (colId === -1 || colEstado === -1) {
    return jsonResponse({
      ok: false,
      error: "No se encontraron las columnas '" + COL_ID + "' y/o '" + COL_ESTADO + "'",
    });
  }

  // 5) Buscar la fila por ID y actualizar el estado.
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][colId]) === String(id)) {
      // i es 0-indexado dentro de 'datos'; la fila real en la hoja es i + 1.
      hoja.getRange(i + 1, colEstado + 1).setValue(ESTADO_PROCESADO);
      return jsonResponse({ ok: true, id: id, estado: ESTADO_PROCESADO });
    }
  }

  return jsonResponse({ ok: false, error: "No se encontró ninguna fila con ID: " + id });
}


/** Helper: arma una respuesta JSON con el MIME type correcto. */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
