// supabase/functions/_shared/public.ts
// Utilidades para Edge Functions públicas (formularios de la web): CORS y limpieza de texto.

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.some((re) => re.test(origin)) ? origin : "https://manupavez.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export const clean = (v: unknown, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const cleanText = (v: unknown, max = 2000) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

export function responder(req: Request) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
