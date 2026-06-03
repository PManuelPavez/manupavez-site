// leadMailer.js — Envío de formularios directo al mail, SIN API keys ni backend.
// Usa FormSubmit (https://formsubmit.co): gratis y sin registro.
//
// IMPORTANTE (una sola vez): la PRIMERA vez que se envíe un formulario, FormSubmit
// te manda un mail de activación a la casilla de abajo. Hacé clic en el link de ese
// mail y a partir de ahí todos los formularios te llegan automáticamente.

const TO_EMAIL = "manupavez22@gmail.com";
const ENDPOINT = `https://formsubmit.co/ajax/${TO_EMAIL}`;

export async function sendLead(data, { subject } = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      ...data,
      _subject: subject || "Nuevo mensaje — manupavez.com",
      _template: "table",
      _captcha: "false",
    }),
  });

  if (!res.ok) throw new Error(`formsubmit ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const ok = json.success === true || json.success === "true";
  if (!ok) throw new Error("formsubmit_failed");
  return json;
}
