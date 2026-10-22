// supabase/functions/_shared/tickets.ts
// Utilidades compartidas de la venta de entradas: mail de confirmación y aviso a Manu.
// Secretos: RESEND_API_KEY. Opcionales: TICKETS_FROM_EMAIL (o LAB_FROM_EMAIL), LAB_TO_EMAIL.
// Ojo: con el remitente de prueba de Resend (onboarding@resend.dev) solo llegan mails al dueño
// de la cuenta. Para escribirle a los compradores hay que verificar manupavez.com en Resend.

export const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const ars = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

const fromAddress = () =>
  Deno.env.get("TICKETS_FROM_EMAIL") || Deno.env.get("LAB_FROM_EMAIL") || "Manu Pavez <onboarding@resend.dev>";

export async function sendMail(to: string[], subject: string, html: string, from = fromAddress()): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "resend_not_configured";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, reply_to: "manupavez22@gmail.com" }),
    });
    if (res.ok) return null;
    return `resend_${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    return `resend_error: ${String(e).slice(0, 200)}`;
  }
}

export async function notifyAdmin(subject: string, html: string) {
  const to = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  await sendMail(to, subject, html);
}

const INSTAGRAM_URL = "https://www.instagram.com/manupavez_";

type TicketEvent = { name: string; event_date: string; venue?: string; address?: string; time_text?: string; lineup?: unknown; flyer_url?: string | null };
type TicketOrder = { id: string; quantity: number; tier_name?: string; total_ars?: number };
type Person = { first_name: string; last_name: string };

// HTML del mail "Estás en la lista" (también lo usa el envío de ejemplo de tickets-sample).
export function ticketEmailHtml(ev: TicketEvent, o: TicketOrder, people: Person[]) {
  const names = people.map((p) =>
    `<li style="margin:2px 0">${esc(p.first_name)} ${esc(p.last_name)}</li>`).join("");
  const code = o.id.slice(0, 8).toUpperCase();

  // Una sola línea: 13/11/2026 · 23:30HS · CREME MUSIC CLUB (el line up ya está en el flyer)
  const [y, m, d] = ev.event_date.split("-");
  const whenWhere = [
    `${d}/${m}/${y}`,
    ev.time_text ? ev.time_text.replace(/\s+/g, "").toUpperCase() : "",
    (ev.venue || "").toUpperCase(),
  ].filter(Boolean).join(" · ");

  const flyer = ev.flyer_url && /^https:\/\//.test(ev.flyer_url)
    ? `<img src="${esc(ev.flyer_url)}" alt="Flyer: ${esc(ev.name)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:16px 16px 0 0;border:0">`
    : "";

  return `<div style="background:#062C33;padding:28px 16px;font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#FFFFFF">
  <div style="max-width:520px;margin:0 auto;background:#0B3F48;border-radius:16px;overflow:hidden;line-height:1.55">
  ${flyer}
  <div style="padding:28px 24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9FE3E8">Entrada confirmada</p>
    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2">${esc(ev.name)}</h1>
    <p style="margin:0 0 20px;font-size:18px"><strong>Estás en la lista. Presentá tu DNI en la puerta.</strong></p>
    <p style="margin:0 0 20px;font-size:17px;font-weight:700;letter-spacing:.03em;color:#9FE3E8">${esc(whenWhere)}</p>
    <p style="margin:0 0 6px;font-size:15px"><strong>${o.quantity === 1 ? "En la lista:" : `En la lista (${o.quantity}):`}</strong></p>
    <ul style="margin:0 0 20px;padding-left:20px;font-size:15px">${names}</ul>
    <p style="margin:0;font-size:13px;color:#9FE3E8">${esc(o.tier_name || "")}${o.total_ars ? ` · ${ars(o.total_ars)}` : ""} · Pedido ${code}</p>
    <div style="margin:22px 0 0;padding:16px 18px;border-radius:12px;background:#062C33;border-left:4px solid #9FE3E8">
      <p style="margin:0 0 6px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9FE3E8">En la pista</p>
      <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:.02em">Permiso, perdón y gracias.</p>
      <p style="margin:6px 0 0;font-size:14px;color:#D5F2F4">Tres palabras que hacen la noche de todos. Cuidemos la pista y a quien tenemos al lado.</p>
    </div>
    <p style="margin:22px 0 0;text-align:center">
      <a href="${INSTAGRAM_URL}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#9FE3E8;color:#062C33;font-weight:700;font-size:15px;text-decoration:none">Seguime en Instagram → @manupavez_</a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#9FE3E8">Cada persona entra con su DNI. Si necesitás cambiar un nombre, respondé este mail.</p>
  </div>
  </div>
</div>`;
}

// Mail "Estás en la lista". Devuelve null si salió bien o el error de Resend.
// Guarda el resultado en ticket_orders (email_sent_at / email_error).
// deno-lint-ignore no-explicit-any
export async function sendTicketConfirmation(db: any, orderId: string): Promise<string | null> {
  const { data: o } = await db.from("ticket_orders")
    .select("id, quantity, tier_name, total_ars, method, buyer_first_name, buyer_email, event_id")
    .eq("id", orderId).maybeSingle();
  if (!o?.buyer_email) return "no_email";
  const [{ data: ev }, { data: people }] = await Promise.all([
    db.from("events").select("name, event_date, venue, address, time_text, lineup, flyer_url").eq("id", o.event_id).maybeSingle(),
    db.from("attendees").select("first_name, last_name").eq("order_id", o.id).order("created_at"),
  ]);
  if (!ev) return "no_event";

  const err = await sendMail([o.buyer_email], `Estás en la lista — ${ev.name}`, ticketEmailHtml(ev, o, people || []));
  await db.from("ticket_orders")
    .update(err ? { email_error: err } : { email_sent_at: new Date().toISOString(), email_error: null })
    .eq("id", o.id);
  return err;
}
