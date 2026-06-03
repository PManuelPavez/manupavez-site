// supabase/functions/send-lead-email/index.ts
// Notifica por mail (vía Resend) cada vez que se completa el form del Lab.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return json({ error: "missing_resend_api_key" }, 500);

  const FROM = Deno.env.get("LAB_FROM_EMAIL") || "Frequency Lab <onboarding@resend.dev>";
  const TO = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim();
  const level = String(payload.level ?? "").trim();
  const goal = String(payload.goal ?? "").trim();
  const type = String(payload.type ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const source = String(payload.source ?? "lab").trim().toLowerCase();

  if (!name || !email) return json({ error: "missing_required_fields" }, 422);

  const isBooking = source === "booking";
  const heading = isBooking ? "Nuevo booking — Manu Pavez" : "Nuevo lead — Frequency Lab";
  const subject = isBooking ? `Nuevo booking — ${name}` : `Nuevo lead Lab — ${name}`;

  // Filas según origen: el booking muestra "Tipo de evento"; el lab, "Nivel/Objetivo".
  const rows = isBooking
    ? [["Tipo de evento", type]]
    : [["Nivel", level], ["Objetivo", goal]];

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="opacity:.6">${esc(label)}</td><td>${esc(value) || "—"}</td></tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.55;color:#0a0a0a;max-width:560px">
      <h2 style="font-weight:600;letter-spacing:.04em;margin:0 0 12px">${esc(heading)}</h2>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
        <tr><td style="opacity:.6">Nombre</td><td><strong>${esc(name)}</strong></td></tr>
        <tr><td style="opacity:.6">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        ${rowsHtml}
      </table>
      <p style="margin-top:18px;white-space:pre-wrap;background:#f6f6f8;padding:14px;border-radius:8px;font-size:14px">
        ${esc(message) || "<em style='opacity:.6'>Sin mensaje extra.</em>"}
      </p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: email || undefined,
        subject,
        html,
      }),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok) return json({ error: "resend_failed", detail: result }, 502);

    return json({ ok: true, id: (result as { id?: string })?.id ?? null });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
