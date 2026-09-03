import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function readConfig() {
  if (window.MP_SUPABASE?.url && window.MP_SUPABASE?.anonKey) {
    return window.MP_SUPABASE;
  }
  return null;
}

export function hasSupabase() {
  const cfg = readConfig();
  return Boolean(cfg?.url && cfg?.anonKey);
}

export const supabase = (() => {
  const cfg = readConfig();
  if (!cfg) return null;

  return createClient(cfg.url, cfg.anonKey);
})();