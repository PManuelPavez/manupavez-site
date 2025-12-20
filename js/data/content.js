import { supabase, hasSupabase } from "./supabaseClient.js";

function ensure() {
  if (!hasSupabase() || !supabase) throw new Error("Supabase no configurado");
}

function isMissingRelation(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("schema cache") || msg.includes("not found") || msg.includes("could not find");
}

async function fromAny(names, builder) {
  ensure();
  const sb = supabase; // alias (NO redeclarar "supabase")
  let last = null;

  for (const n of names) {
    const { data, error } = await builder(sb.from(n));
    if (!error) return data || [];
    last = error;

    if (isMissingRelation(error)) continue; // siguiente view/tabla
    throw error; // RLS / 401 / validación: error real
  }

  throw last || new Error("No se encontró tabla/view válida");
}

// --- HOME ---
export async function getReleases() {
  return await fromAny(
    ["v_home_releases", "home_releases", "releases"],
    (q) => q.select("*").order("order", { ascending: true })
  );
}

export async function getLabels() {
  return await fromAny(
    ["v_labels_support", "labels_support", "labels"],
    (q) => q.select("*").order("order", { ascending: true })
  );
}

export async function getMedia(kind) {
  const k = String(kind || "").toLowerCase();
  const view = k === "mix" ? "v_media_mixes" : k === "video" ? "v_media_videos" : null;

  if (view) {
    return await fromAny([view], (q) => q.select("*").order("order", { ascending: true }));
  }

  // fallback genérico
  return await fromAny(["media_items"], (q) =>
    q.select("*").eq("kind", k).order("order", { ascending: true })
  );
}

// --- PRESSKIT (si lo necesitás) ---
export async function getPresskitAssets() {
  return await fromAny(
    ["v_presskit_download", "presskit_packages", "presskit_assets"],
    (q) => q.select("*").order("order", { ascending: true })
  );
}

// --- FORMS ---
export async function insertBookingLead(payload) {
  ensure();
  const sb = supabase;

  // Probamos algunos nombres típicos (por si tu tabla se llama distinto)
  const candidates = ["booking_leads", "contact_leads", "leads", "contact_messages"];
  let last = null;

  for (const table of candidates) {
    const { error } = await sb.from(table).insert([payload]);
    if (!error) return { table };
    last = error;

    if (isMissingRelation(error)) continue; // probar siguiente
    throw error; // RLS/validación
  }

  throw last || new Error("No hay tabla para guardar leads");
}
