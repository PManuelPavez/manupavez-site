import { supabase, hasSupabase } from "./supabaseClient.js";
if (!hasSupabase() || !supabase) throw new Error("Supabase no configurado");
function readConfig() {
  // Opción A: config del proyecto (ya existe en el repo)
  if (window.MP_SUPABASE?.url && window.MP_SUPABASE?.anonKey) return window.MP_SUPABASE;

  // Opción B: estándar alternativo
  if (window.__SUPABASE__?.url && window.__SUPABASE__?.anonKey) return window.__SUPABASE__;

  // Opción C: meta tags
  const url = document.querySelector("meta[name='supabase-url']")?.content;
  const anonKey = document.querySelector("meta[name='supabase-anon-key']")?.content;
  if (url && anonKey) return { url, anonKey };

  return null;
}

export function hasSupabase() {
  const cfg = readConfig();
  if (!cfg) return false;
  const bad = String(cfg.url).includes("YOUR_") || String(cfg.anonKey).includes("YOUR_");
  return Boolean(cfg.url && cfg.anonKey && !bad);
}

export const supabase = (() => {
  const cfg = readConfig();
  if (!cfg || !hasSupabase()) return null;

  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
})();
