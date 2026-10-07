// supabase/functions/finance-sheet/index.ts
// Manda cada orden pagada como una fila a la planilla de finanzas de Manu
// (pestaña "FREQUENCY LAB"), vía el Web App de Apps Script (apps_script/finanzas_lab.gs).
// La llama pg_cron cada 5 min, solo si hay órdenes pagadas sin mandar.
//
//  · MercadoPago: antes de mandar se consulta el pago en MP para guardar
//    la comisión (mp_fee_ars) y lo que queda limpio (mp_net_ars).
//  · Pago a mano (transferencia / efectivo / otro): comisión 0.
//  · El Web App ignora pedidos que ya están en la hoja: reintentar no duplica.
//
// Secretos: FINANCE_SHEET_URL (…/exec del Web App), FINANCE_SHEET_KEY, MP_ACCESS_TOKEN.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const METHOD_LABEL: Record<string, string> = {
  mercadopago: "MercadoPago",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  otro: "Otro",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Comisión y neto de un pago de MP (null si MP no responde: se reintenta después)
async function mpFees(paymentId: string, token: string) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const pay = await res.json();
  const fee = (pay.fee_details || []).reduce((s: number, f: any) => s + Number(f.amount || 0), 0);
  const net = Number(pay.transaction_details?.net_received_amount);
  return {
    fee: round2(fee),
    net: round2(Number.isFinite(net) && net > 0 ? net : Number(pay.transaction_amount) - fee),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Solo el cron (secreto generado en Vault, el mismo de lab-notify)
  const secret = req.headers.get("x-notify-secret") || "";
  const { data: allowed } = await db.rpc("verify_notify_secret", { p_secret: secret });
  if (allowed !== true) return json({ error: "unauthorized" }, 401);

  const SHEET_URL = Deno.env.get("FINANCE_SHEET_URL");
  const SHEET_KEY = Deno.env.get("FINANCE_SHEET_KEY");
  if (!SHEET_URL || !SHEET_KEY) return json({ skipped: "sheet_not_configured" });
  const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");

  const { data: orders, error } = await db
    .from("orders")
    .select("id, paid_at, buyer_name, buyer_email, product_name, quantity, price_usd, fx_mep, amount_ars, payment_method, mp_payment_id, mp_fee_ars, mp_net_ars, note, manual_note, source, students(full_name)")
    .eq("status", "paid")
    .is("sheet_synced_at", null)
    .order("paid_at", { ascending: true })
    .limit(50);
  if (error) return json({ error: "db_error" }, 500);
  if (!orders?.length) return json({ sent: 0 });

  const rows: Record<string, unknown>[] = [];
  for (const o of orders as any[]) {
    let fee = o.mp_fee_ars, net = o.mp_net_ars;
    if (o.payment_method === "mercadopago") {
      if (fee == null && o.mp_payment_id && MP_TOKEN) {
        const f = await mpFees(o.mp_payment_id, MP_TOKEN);
        if (!f) continue; // MP no respondió: esta orden queda para la próxima vuelta
        fee = f.fee; net = f.net;
        await db.from("orders").update({ mp_fee_ars: fee, mp_net_ars: net }).eq("id", o.id);
      }
    } else {
      fee = 0; net = Number(o.amount_ars);
    }
    const notes = [o.source === "admin_link" ? "Precio especial" : "", o.note, o.manual_note].filter(Boolean).join(" · ");
    rows.push({
      id: o.id,
      paid_at: o.paid_at,
      buyer: o.students?.full_name || o.buyer_name,
      email: o.buyer_email,
      product: o.product_name,
      quantity: Number(o.quantity || 1),
      usd: Number(o.price_usd),
      mep: Number(o.fx_mep),
      ars: Number(o.amount_ars),
      method: METHOD_LABEL[o.payment_method] || o.payment_method,
      fee: fee == null ? "" : Number(fee),
      net: net == null ? "" : Number(net),
      note: notes,
    });
  }
  if (!rows.length) return json({ sent: 0, waiting_mp: orders.length });

  let res: Response;
  try {
    res = await fetch(SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: SHEET_KEY, rows }),
      redirect: "follow",
    });
  } catch (_e) {
    return json({ error: "sheet_unreachable" }, 502);
  }
  const out = await res.json().catch(() => null);
  if (!res.ok || out?.ok !== true) {
    console.error("[finance-sheet] apps script", res.status, JSON.stringify(out).slice(0, 200));
    return json({ error: "sheet_rejected" }, 502);
  }

  await db.from("orders").update({ sheet_synced_at: new Date().toISOString() }).in("id", rows.map((r) => r.id as string));
  return json({ sent: rows.length, added: out.added });
});
