/**
 * Frequency Lab → planilla FINANZAS PERSONALES, pestaña "FREQUENCY LAB".
 *
 * Recibe los pagos desde Supabase (Edge Function finance-sheet) y agrega una
 * fila por pago en las columnas A:M. Solo puede AGREGAR filas en esa pestaña:
 * no lee ni modifica el resto de la planilla.
 *
 * Instalación: Extensiones → Apps Script → pegar este archivo → Implementar →
 * Nueva implementación → Aplicación web (Ejecutar como: yo · Acceso: cualquier usuario).
 *
 * API_KEY: en el repo va un marcador. La clave real está en
 * apps_script/finanzas_lab.local.gs (no se sube a GitHub) y en el secreto
 * FINANCE_SHEET_KEY de Supabase. Tienen que ser iguales.
 */

const API_KEY = 'PEGAR_CLAVE_AQUI';
const SHEET_NAME = 'FREQUENCY LAB';
const ID_COL = 13; // M: id del pedido (evita duplicados si Supabase reintenta)

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'bad_json' });
  }
  if (!body || body.apiKey !== API_KEY || API_KEY === 'PEGAR_CLAVE_AQUI') {
    return reply_({ ok: false, error: 'unauthorized' });
  }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 100) : [];

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh) return reply_({ ok: false, error: 'sheet_not_found' });

    // Última fila con datos en la columna A (los gastos y el resumen van en otras columnas)
    const colA = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
    let last = 1;
    for (let i = colA.length - 1; i >= 1; i--) {
      if (colA[i][0] !== '') { last = i + 1; break; }
    }
    const known = new Set(
      last > 1 ? sh.getRange(2, ID_COL, last - 1, 1).getValues().map((r) => String(r[0])) : []
    );

    const out = [];
    rows.forEach((r) => {
      const id = String(r.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id) || known.has(id)) return;
      known.add(id);
      out.push([
        new Date(r.paid_at),
        text_(r.buyer),
        text_(r.email),
        text_(r.product),
        num_(r.quantity),
        num_(r.usd),
        num_(r.mep),
        num_(r.ars),
        text_(r.method),
        num_(r.fee),
        num_(r.net),
        text_(r.note),
        id,
      ]);
    });

    if (out.length) {
      if (last + out.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), out.length + 50);
      sh.getRange(last + 1, 1, out.length, out[0].length).setValues(out);
    }
    return reply_({ ok: true, added: out.length });
  } finally {
    lock.releaseLock();
  }
}

// Texto plano: si empieza con = + - @ se antepone ' para que la hoja no lo tome como fórmula
function text_(v) {
  const s = String(v == null ? '' : v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num_(v) {
  const n = Number(v);
  return v === '' || v == null || !isFinite(n) ? '' : n;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
