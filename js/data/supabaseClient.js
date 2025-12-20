import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function readConfig() {
  // Opción A: config del proyecto
  if (window.MP_SUPABASE?.url && window.MP_SUPABASE?.anonKey) return window.MP_SUPABASE;

  // Opción B: estándar alternativo
  if (window.__SUPABASE__?.url && window.__SUPABASE__?.anonKey) return window.__SUPABASE__;

  // Opción C: meta tags
  const url = document.querySelector("meta[name='supabase-url']")?.content;
  const anonKey = document.querySelector("meta[name='supabase-anon-key']")?.content;
  if (url && anonKey) return { url, anonKey };

  return null;
}

function isValid(cfg) {
  if (!cfg?.url || !cfg?.anonKey) return false;
  const bad = String(cfg.url).includes("YOUR_") || String(cfg.anonKey).includes("YOUR_");
  return !bad;
}

// Live binding: otros módulos pueden importar { supabase } y va a actualizarse cuando se cree.
export let supabase = null;
let _sig = "";

function sig(cfg) {
  return `${cfg.url}::${cfg.anonKey}`;
}

export function hasSupabase() {
  const cfg = readConfig();
  return isValid(cfg);
}

export function getSupabase() {
  const cfg = readConfig();
  if (!isValid(cfg)) return null;

  const s = sig(cfg);
  if (supabase && _sig === s) return supabase;

  _sig = s;
  supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return supabase;
}

// Útil si el HTML carga /js/supabase-config.js después de /js/main.js.
// No hace magia, solo espera un ratito a que aparezca el config.
export async function waitForSupabase({ timeoutMs = 1500, intervalMs = 50 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const sb = getSupabase();
    if (sb) return sb;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}
