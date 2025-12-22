import { supabase, hasSupabase } from "./supabaseClient.js";

function ensure() {
  if (!hasSupabase() || !supabase) throw new Error("Supabase no configurado");
  return supabase;
}

function isMissingRelation(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("schema cache") || msg.includes("could not find") || msg.includes("not found");
}

async function fromAny(sources, buildQuery) {
  const sb = ensure();
  let lastErr = null;

  for (const name of sources) {
    const { data, error } = await buildQuery(sb.from(name));
    if (!error) return { data: data || [], source: name };

    lastErr = error;
    if (isMissingRelation(error)) continue; // probá la siguiente fuente
    throw error; // error real: RLS, 401, etc.
  }
  throw lastErr || new Error("No se encontró ninguna fuente válida en Supabase");
}

const pick = (obj, keys) => keys.map(k => obj?.[k]).find(v => v !== null && v !== undefined && v !== "") ?? "";
const toTags = (v) =>
  Array.isArray(v) ? v :
  (typeof v === "string" ? v.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : []);

function normalizeRelease(r) {
  return {
    id: r.id ?? r.slug ?? null,
    title: pick(r, ["title", "name"]),
    subtitle: pick(r, ["subtitle", "sub_title", "headline"]),
    type: pick(r, ["type", "category"]),
    story: pick(r, ["story", "description", "bio"]),
    tags: toTags(r.tags ?? r.tag_list ?? r.taglist),
    cover_url: pick(r, ["cover_url", "cover", "image_url", "img_url", "artwork_url"]),
    // Links: soporta JSON (obj/array/string) en platform_urls
    platform_urls: r.platform_urls ?? r.platforms ?? r.platform_links ?? null,
    spotify_url: pick(r, ["spotify_url", "spotify", "spotify_link"]),
    beatport_url: pick(r, ["beatport_url", "beatport", "beatport_link"]),
    soundcloud_url: pick(r, ["soundcloud_url", "soundcloud", "soundcloud_link"]),
    youtube_url: pick(r, ["youtube_url", "youtube", "youtube_link"]),
    bandcamp_url: pick(r, ["bandcamp_url", "bandcamp", "bandcamp_link"]),
    released_at: pick(r, ["released_at", "release_date", "date"]),
    is_featured: r.is_featured ?? true,
    order: r.order ?? r.sort ?? null,
  };
}

function looksLikeImageUrl(url) {
  const u = String(url || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/.test(u);
}

function normalizePresskitItem(r) {
  const url = pick(r, ["url", "file_url", "image_url", "asset_url", "download_url"]);
  return {
    title: pick(r, ["title", "name", "label"]) || "Presskit",
    url,
    alt: pick(r, ["alt", "caption", "title"]) || "Presskit",
    order: r.order ?? r.sort ?? null,
  };
}

// HOME releases (tu screenshot muestra v_home_releases / home_releases)
export async function getReleases() {
  const { data } = await fromAny(
    ["v_home_releases", "home_releases", "releases"],
    (q) => q.select("*")
  );

  const items = data.map(normalizeRelease).filter(r => r.is_featured !== false);

  // orden flexible
  items.sort((a, b) => {
    const ao = a.order ?? 9999, bo = b.order ?? 9999;
    if (ao !== bo) return ao - bo;
    return String(b.released_at).localeCompare(String(a.released_at));
  });

  return items;
}

// LINKS (tu screenshot muestra v_site_links / site_links)
export async function getSiteLinks() {
  const { data } = await fromAny(
    ["v_site_links", "site_links"],
    (q) => q.select("*")
  );
  return data;
}

// LABELS support (v_labels_support / labels_support)
export async function getLabels() {
  const { data } = await fromAny(
    ["v_labels_support", "labels_support", "labels"],
    (q) => q.select("*")
  );
  return data;
}

// MEDIA (tenés v_media_mixes / v_media_videos y también media_items)
export async function getMedia(kind) {
  const view =
    kind === "mixes" ? "v_media_mixes" :
    kind === "videos" ? "v_media_videos" :
    null;

  if (view) {
    const { data } = await fromAny([view], (q) => q.select("*"));
    return data;
  }

  const { data } = await fromAny(
    ["media_items"],
    (q) => q.select("*").eq("kind", kind)
  );
  return data;
}

// PRESSKIT: en tu Supabase veo presskit_packages + v_presskit_download (no veo presskit_photos)
export async function getPresskitPhotos() {
  const { data } = await fromAny(
    ["presskit_photos", "presskit_packages", "v_presskit_download"],
    (q) => q.select("*")
  );

  const items = data.map(normalizePresskitItem).filter(it => looksLikeImageUrl(it.url));
  items.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  return items;
}

export async function getPresskitAssets() {
  const { data } = await fromAny(
    ["v_presskit_download", "presskit_packages", "presskit_assets"],
    (q) => q.select("*")
  );

  const items = data.map(normalizePresskitItem).filter(it => it.url && !looksLikeImageUrl(it.url));
  items.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  return items;
}

// Link principal de descarga del presskit (zip/pdf)
export async function getPresskitDownload() {
  const { data } = await fromAny(
    ["v_presskit_download", "presskit_packages", "presskit_assets"],
    (q) => q.select("*")
  );

  const first = data?.[0] || null;
  if (!first) return "";
  return pick(first, ["url", "download_url", "file_url", "asset_url", "zip_url", "pdf_url"]);
}

// Bloques de texto (bio, presskit bio, etc.)
// Intenta primero page_blocks (si existe) y, si no, cae a profiles.
export async function getBlocks(keys = []) {
  const wanted = Array.isArray(keys) ? keys.filter(Boolean) : [];
  if (!wanted.length) return new Map();

  try {
    const { data } = await fromAny(
      ["page_blocks"],
      (q) => q.select("key,content").in("key", wanted)
    );

    const map = new Map();
    for (const row of data) map.set(row.key, row.content);
    return map;
  } catch (e) {
    // fallback a profiles
  }

  try {
    const { data } = await fromAny(
      ["profiles"],
      (q) => q.select("*").limit(1)
    );

    const row = data?.[0] || {};
    const map = new Map();
    for (const k of wanted) {
      if (row[k] != null) map.set(k, row[k]);
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

// Navegación (desktop/mobile)
export async function getNav(kind = "desktop") {
  const source = kind === "mobile" ? ["v_nav_mobile", "nav_items"] : ["v_nav_desktop", "nav_items"];
  const { data } = await fromAny(source, (q) => q.select("*"));
  return data || [];
}

// Clínicas (si existe tabla). Si no existe, devuelve [].
export async function getClinics() {
  try {
    const { data } = await fromAny(["clinics", "clinic_packages", "packages"], (q) => q.select("*"));
    return data || [];
  } catch (e) {
    return [];
  }
}
// --- Leads (contacto/booking) ---
// Si no existe tabla o RLS bloquea, forms.js ya cae a mailto (plan B).
export async function insertBookingLead(payload) {
  const sb = ensure();

  const candidates = ["booking_leads", "contact_leads", "leads", "contact_messages"];
  let lastError = null;

  for (const table of candidates) {
    const { error } = await sb.from(table).insert([payload]);
    if (!error) return { table };

    lastError = error;
    const msg = String(error?.message || "").toLowerCase();

    // tabla inexistente => probá la siguiente
    if (msg.includes("schema cache") || msg.includes("not found") || msg.includes("could not find")) {
      continue;
    }

    // cualquier otro error (RLS/401/validación) => lo reportamos para que forms haga fallback
    throw error;
  }

  throw lastError || new Error("No hay tabla disponible para guardar leads");
}
