import { supabase, hasSupabase } from "./supabaseClient.js";

function ensure() {
  if (!hasSupabase() || !supabase) {
    throw new Error("Supabase no configurado");
  }
}

export async function getReleases() {
  ensure();
  const { data, error } = await supabase
    .from("releases")
    .select("id,title,type,story,tags,cover_url,spotify_url,beatport_url,soundcloud_url,released_at,is_featured")
    .order("released_at", { ascending: false });
  if (error) throw error;
  return (data || []).filter((r) => r.is_featured !== false);
}

export async function getLabels() {
  ensure();
  const { data, error } = await supabase
    .from("labels")
    .select("name,logo_url,is_support_line,order")
    .order("order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getMedia(kind) {
  ensure();
  const { data, error } = await supabase
    .from("media_items")
    .select("title,description,kind,embed_url,order")
    .eq("kind", kind)
    .order("order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getPresskitAssets() {
  ensure();
  const { data, error } = await supabase
    .from("presskit_assets")
    .select("title,url,order")
    .order("order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getClinics() {
  ensure();
  const { data, error } = await supabase
    .from("clinics")
    .select("title,subtitle,description,bullets,price,cta_label,cta_url,order")
    .order("order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getPageBlocks(keys = []) {
  ensure();
  const uniq = Array.from(new Set(keys)).filter(Boolean);
  if (!uniq.length) return new Map();

  const { data, error } = await supabase
    .from("page_blocks")
    .select("key,content")
    .in("key", uniq);

  if (error) throw error;
  return new Map((data || []).map((r) => [r.key, r.content]));
}

export async function insertBookingLead(payload) {
  ensure();
  const { error } = await supabase.from("booking_leads").insert([payload]);
  if (error) throw error;
}
