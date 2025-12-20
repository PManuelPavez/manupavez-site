import { getSupabase, hasSupabase } from "./supabaseClient.js";

function ensure() {
  const sb = getSupabase();
  if (!hasSupabase() || !sb) throw new Error("Supabase no configurado");
  return sb;
}

function isMissingRelation(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("schema cache") || msg.includes("not found") || msg.includes("could not find");
}

function isMissingColumn(error, col) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("column") && msg.includes(String(col).toLowerCase()) && msg.includes("does not exist");
}

async function selectAllMaybeOrdered(sb, tableName, col = "order") {
  // Intento 1: con order (si existe)
  let res = await sb.from(tableName).select("*").order(col, { ascending: true });
  if (!res.error) return res;

  // Si el error es "la columna no existe", reintenta sin order.
  if (isMissingColumn(res.error, col)) {
    res = await sb.from(tableName).select("*");
    return res;
  }

  return res;
}

async function fromAny(names, runner) {
  const sb = ensure();
  let last = null;

  for (const n of names) {
    const { data, error } = await runner(sb, n);
    if (!error) return data || [];

    last = error;
    if (isMissingRelation(error)) continue;
    throw error;
  }

  throw last || new Error("No se encontró tabla/view válida");
}

// ---------- HOME ----------
export async function getReleases() {
  // En tu Supabase existen views v_home_releases y tabla home_releases.
  return await fromAny(
    ["v_home_releases", "home_releases", "releases"],
    (sb, t) => selectAllMaybeOrdered(sb, t)
  );
}

export async function getLabels() {
  return await fromAny(
    ["v_labels_support", "labels_support", "labels"],
    (sb, t) => selectAllMaybeOrdered(sb, t)
  );
}

export async function getMedia(kind) {
  const k0 = String(kind || "").toLowerCase();
  const k = k0 === "mixes" ? "mix" : k0 === "videos" ? "video" : k0;

  const view = k === "mix" ? "v_media_mixes" : k === "video" ? "v_media_videos" : null;
  if (view) {
    return await fromAny([view], (sb, t) => selectAllMaybeOrdered(sb, t));
  }

  // fallback genérico si usás una tabla media_items
  return await fromAny(["media_items"], async (sb, t) => {
    let res = await sb.from(t).select("*").eq("kind", k).order("order", { ascending: true });
    if (!res.error) return res;
    if (isMissingColumn(res.error, "order")) {
      res = await sb.from(t).select("*").eq("kind", k);
    }
    return res;
  });
}

// ---------- PRESSKIT ----------
export async function getPresskitAssets() {
  // v_presskit_download suele ser la forma más cómoda de exponer assets
  return await fromAny(
    ["v_presskit_download", "presskit_packages", "presskit_assets"],
    (sb, t) => selectAllMaybeOrdered(sb, t)
  );
}

export async function getPresskitPhotos() {
  const assets = await getPresskitAssets();
  return assets
    .map((a) => {
      const url = a.url || a.file_url || a.asset_url || a.download_url || "";
      return {
        title: a.title || a.name || "",
        alt: a.alt || a.caption || a.title || a.name || "Manu Pavez",
        url,
        order: a.order ?? a.sort ?? null,
      };
    })
    .filter((a) => isImageUrl(a.url));
}

function isImageUrl(url) {
  const u = String(url || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/.test(u);
}

// ---------- CLINICAS ----------
export async function getClinics() {
  // Si la tabla se llama distinto en tu proyecto, agregala acá.
  return await fromAny(
    ["clinics", "clinicas", "clinic_items"],
    (sb, t) => selectAllMaybeOrdered(sb, t)
  );
}

// ---------- BLOQUES DE TEXTO (BIO / PÁGINAS) ----------
export async function getBlocks(keys = []) {
  const uniq = Array.from(new Set(keys)).filter(Boolean);
  if (!uniq.length) return new Map();

  const sb = ensure();

  // Intentamos primero con page_blocks (estructura típica)
  // Si no existe, probamos blocks.
  const sources = ["page_blocks", "blocks", "profiles"]; // profiles es “plan C” por si ahí tenés bio
  let lastErr = null;

  for (const src of sources) {
    const { data, error } = await sb.from(src).select("*").in("key", uniq);
    if (!error) {
      // Normalizamos a Map(key -> content)
      const map = new Map();
      (data || []).forEach((r) => {
        const k = r.key || r.slug || r.id;
        const v = r.content || r.value || r.text || r.bio || r.description;
        if (k != null && v != null) map.set(String(k), String(v));
      });
      return map;
    }

    lastErr = error;
    if (isMissingRelation(error)) continue;
    throw error;
  }

  throw lastErr || new Error("No se encontró tabla de bloques");
}

// ---------- FORMS ----------
export async function insertBookingLead(payload) {
  const sb = ensure();

  const candidates = ["booking_leads", "contact_leads", "leads", "contact_messages"];
  let last = null;

  for (const table of candidates) {
    const { error } = await sb.from(table).insert([payload]);
    if (!error) return { table };
    last = error;

    if (isMissingRelation(error)) continue;
    throw error;
  }

  throw last || new Error("No hay tabla para guardar leads");
}
