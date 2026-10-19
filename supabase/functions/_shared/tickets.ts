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

async function sendMail(to: string[], subject: string, html: string): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "resend_not_configured";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress(), to, subject, html, reply_to: "manupavez22@gmail.com" }),
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

const dateLong = (d: string) =>
  new Date(`${d}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

// Mail "Estás en la lista". Devuelve null si salió bien o el error de Resend.
// Guarda el resultado en ticket_orders (email_sent_at / email_error).
// deno-lint-ignore no-explicit-any
export async function sendTicketConfirmation(db: any, orderId: string): Promise<string | null> {
  const { data: o } = await db.from("ticket_orders")
    .select("id, quantity, tier_name, total_ars, method, buyer_first_name, buyer_email, event_id")
    .eq("id", orderId).maybeSingle();
  if (!o?.buyer_email) return "no_email";
  const [{ data: ev }, { data: people }] = await Promise.all([
    db.from("events").select("name, event_date, venue, address, time_text, lineup").eq("id", o.event_id).maybeSingle(),
    db.from("attendees").select("first_name, last_name").eq("order_id", o.id).order("created_at"),
  ]);
  if (!ev) return "no_event";

  const tbc = "A confirmar";
  const lineup = (Array.isArray(ev.lineup) ? ev.lineup : [])
    .map((a: { name: string; role?: string }) => `${esc(a.name)}${a.role ? ` <span style="color:#b98a8d">(${esc(a.role)})</span>` : ""}`)
    .join("<br>");
  const names = (people || []).map((p: { first_name: string; last_name: string }) =>
    `<li style="margin:2px 0">${esc(p.first_name)} ${esc(p.last_name)}</li>`).join("");
  const code = o.id.slice(0, 8).toUpperCase();
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#b98a8d;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>`;

  const html = `<div style="background:#5A0F14;padding:28px 16px;font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#f6ecec">
  <div style="max-width:520px;margin:0 auto;background:#3d0a0e;border-radius:16px;padding:28px 24px;line-height:1.55">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#d9a7aa">Entrada confirmada</p>
    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2">${esc(ev.name)}</h1>
    <p style="margin:0 0 20px;font-size:18px"><strong>Estás en la lista. Presentá tu DNI en la puerta.</strong></p>
    <table style="border-collapse:collapse;font-size:15px;margin-bottom:20px">
      ${row("Fecha", esc(dateLong(ev.event_date)))}
      ${row("Horario", esc(ev.time_text || tbc))}
      ${row("Lugar", esc(ev.venue || tbc))}
      ${row("Dirección", esc(ev.address || tbc))}
      ${lineup ? row("Line up", lineup) : ""}
    </table>
    <p style="margin:0 0 6px;font-size:15px"><strong>${o.quantity === 1 ? "En la lista:" : `En la lista (${o.quantity}):`}</strong></p>
    <ul style="margin:0 0 20px;padding-left:20px;font-size:15px">${names}</ul>
    <p style="margin:0;font-size:13px;color:#d9a7aa">${esc(o.tier_name || "")}${o.total_ars ? ` · ${ars(o.total_ars)}` : ""} · Pedido ${code}</p>
    <p style="margin:16px 0 0;font-size:13px;color:#d9a7aa">Cada persona entra con su DNI. Si necesitás cambiar un nombre, respondé este mail.</p>
  </div>
</div>`;

  const err = await sendMail([o.buyer_email], `Estás en la lista — ${ev.name}`, html);
  await db.from("ticket_orders")
    .update(err ? { email_error: err } : { email_sent_at: new Date().toISOString(), email_error: null })
    .eq("id", o.id);
  return err;
}
