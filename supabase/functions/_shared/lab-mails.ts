// supabase/functions/_shared/lab-mails.ts
// Mails de Frequency Lab para los alumnos, con el mismo estilo que el mail de entradas
// (_shared/tickets.ts): fondo #062C33, tarjeta #0B3F48, acento #9FE3E8, fuente del sistema.
// Solo arma el HTML y el asunto: el envío lo hace quien lo importe (lab-notify).

export const PORTAL_URL = "https://manupavez.com/alumnos.html";
const INSTAGRAM_URL = "https://www.instagram.com/manupavez_";

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// "Luciano Sviezzi - Frequency LAB" -> "Luciano"
export const firstName = (fullName: string) =>
  String(fullName || "").replace(/\s*[-–]\s*frequency\s*lab\.?\s*$/i, "").trim().split(/\s+/)[0] || "";

// 2026-12-05T... -> 05/12/2026, en hora de Argentina
export const dayAR = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

const PLAN_LABEL: Record<string, string> = {
  "mentoria-mensual": "Frecuencia",
  "ep-listo-para-enviar": "Resonancia",
};
const PLAN_TAGLINE: Record<string, string> = {
  "mentoria-mensual": "Mentoría 1:1 para terminar tu música con criterio.",
  "ep-listo-para-enviar": "Mentoría, mezcla y estrategia para llevar tu EP a sellos.",
};
export const planLabel = (slug?: string, productName?: string) => PLAN_LABEL[slug || ""] || productName || "Mentoría 1:1";

function layout(inner: string) {
  return `<div style="background:#062C33;padding:28px 16px;font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#FFFFFF">
  <div style="max-width:520px;margin:0 auto;background:#0B3F48;border-radius:16px;overflow:hidden;line-height:1.55">
  <div style="padding:18px 24px;border-bottom:1px solid #145561">
    <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.32em;color:#9FE3E8">FREQUENCY LAB</p>
    <p style="margin:2px 0 0;font-size:12px;color:#D5F2F4;letter-spacing:.04em">Mentorías 1:1 · Manu Pavez</p>
  </div>
  <div style="padding:28px 24px">${inner}</div>
  </div>
  <p style="max-width:520px;margin:14px auto 0;text-align:center;font-size:12px;color:#7FBFC6">
    <a href="${INSTAGRAM_URL}" style="color:#9FE3E8;text-decoration:none">@manupavez_</a> · Pergamino, Argentina
  </p>
</div>`;
}

const eyebrow = (t: string) =>
  `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9FE3E8">${esc(t)}</p>`;
const h1 = (t: string) => `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2">${esc(t)}</h1>`;
const button = (href: string, label: string) =>
  `<p style="margin:24px 0 0;text-align:center"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#9FE3E8;color:#062C33;font-weight:700;font-size:15px;text-decoration:none">${esc(label)}</a></p>`;
const callout = (title: string, body: string) =>
  `<div style="margin:22px 0 0;padding:16px 18px;border-radius:12px;background:#062C33;border-left:4px solid #9FE3E8">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9FE3E8">${esc(title)}</p>
    ${body}
  </div>`;
const foot = (t: string) => `<p style="margin:18px 0 0;font-size:13px;color:#9FE3E8">${esc(t)}</p>`;

// ---------- 1. Aviso: Manu actualizó tu portal ----------
// note: texto opcional que Manu escribe en el panel (máx. 500 caracteres).
export function notionUpdatedMail(p: { fullName: string; note?: string }) {
  const name = firstName(p.fullName);
  const note = String(p.note || "").trim();
  const html = layout(`
    ${eyebrow("Novedades en tu portal")}
    ${h1(`${name ? name + ", a" : "A"}ctualicé tu portal`)}
    <p style="margin:0;font-size:16px;color:#D5F2F4">Ya tenés lo nuevo cargado: el resumen de la clase, tus misiones y lo que sigue.</p>
    ${note ? callout("Nota de Manu", `<p style="margin:0;font-size:16px;white-space:pre-line">${esc(note)}</p>`) : ""}
    ${button(PORTAL_URL, "Ver mi portal")}
    ${foot("Entrás con tu PIN. Si algo no te cierra, respondé este mail.")}`);
  return { subject: "Actualicé tu portal de Frequency Lab", html };
}

// ---------- 2. Pago de la mentoría confirmado ----------
// first: es su primer mes pago (nunca tuvo un período activo).
// month: número de mes (cantidad de órdenes de plan pagadas de ese alumno, contando esta).
export function membershipPaidMail(p: { fullName: string; first: boolean; month?: number; until: string; productSlug?: string; productName?: string }) {
  const name = firstName(p.fullName);
  const plan = planLabel(p.productSlug, p.productName);
  const lanzar = p.productSlug === "ep-listo-para-enviar";
  const tagline = PLAN_TAGLINE[p.productSlug || ""] || "";
  const planLine = `<p style="margin:0 ${tagline ? "0 2px" : "0 20px"};font-size:15px;font-weight:700;letter-spacing:.03em;color:#9FE3E8">${esc(plan.toUpperCase())} · ACTIVO HASTA EL ${esc(dayAR(p.until))}</p>${tagline ? `<p style="margin:0 0 20px;font-size:14px;color:#D5F2F4">${esc(tagline)}</p>` : ""}`;
  const li = (t: string) => `<li style="margin:4px 0">${t}</li>`;

  if (p.first) {
    const html = layout(`
      ${eyebrow("Mentoría confirmada")}
      ${h1(`Bienvenido a Frequency Lab${name ? ", " + name : ""}`)}
      <p style="margin:0 0 20px;font-size:18px"><strong>Tu lugar está confirmado. Arrancamos.</strong></p>
      ${planLine}
      <p style="margin:0 0 6px;font-size:15px"><strong>Cómo vamos a trabajar</strong></p>
      <ul style="margin:0;padding-left:20px;font-size:15px;color:#D5F2F4">
        ${li("4 sesiones 1:1 por mes, siempre sobre tu música.")}
        ${li("Después de cada clase, misiones concretas para aplicar antes de la siguiente.")}
        ${li("En tu portal quedan tus objetivos, tus misiones y el resumen de cada clase.")}
        ${li("Una vez por mes revisamos juntos cuánto avanzaste y fijamos el objetivo que sigue.")}
        ${lanzar ? li("Resonancia suma la mezcla de hasta 2 tracks, los masters para enviar y la estrategia de envío a sellos.") : ""}
      </ul>
      ${callout("Para la primera clase", `<p style="margin:0;font-size:16px">Traé el proyecto en el que estás trabajando y pensá qué querés lograr con tu música en los próximos meses. Desde ahí armamos el camino.</p>`)}
      ${button(PORTAL_URL, "Entrar a mi portal")}
      ${foot("Entrás con el PIN que te paso por mensaje. Si no lo tenés o necesitás algo, respondé este mail.")}`);
    return { subject: `Bienvenido a Frequency Lab${name ? ", " + name : ""}`, html };
  }

  const n = p.month && p.month > 1 ? p.month : 0;
  const html = layout(`
    ${eyebrow(n ? `Mes ${n} confirmado` : "Mes confirmado")}
    ${h1(`Seguimos${name ? ", " + name : ""}`)}
    <p style="margin:0 0 20px;font-size:18px"><strong>Se acreditó tu pago y tu acceso quedó activo.</strong></p>
    ${planLine}
    <p style="margin:0;font-size:16px;color:#D5F2F4">Seguimos con tus objetivos y tus misiones donde los dejamos. En la próxima clase repasamos cómo vas y qué nos proponemos para este mes.</p>
    ${lanzar ? callout("Incluido este mes", `<p style="margin:0;font-size:16px">Mezcla de hasta 2 tracks, masters para enviar y estrategia de envío a sellos.</p>`) : ""}
    ${button(PORTAL_URL, "Ver mi portal")}
    ${foot("Gracias por seguir. Cualquier duda, respondé este mail.")}`);
  return { subject: n ? `Tu mes ${n} en Frequency Lab está confirmado` : "Tu mes en Frequency Lab está confirmado", html };
}
