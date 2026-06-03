#!/usr/bin/env node
/**
 * sync-music.js — Spotify catalog sync
 *
 * Lee artist albums + top tracks de la API pública de Spotify (Client Credentials)
 * y escribe data/music.json. Pensado para correr en GitHub Actions vía cron.
 *
 * Nota: Spotify NO expone "stream count" en su API pública. Lo que sí tenemos:
 *   - track.popularity (0–100)
 *   - artist.followers.total
 *   - artist.popularity (0–100)
 * "Monthly listeners" y "plays totales" sólo viven en Spotify for Artists.
 *
 * Variables de entorno requeridas:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 * Opcionales:
 *   SPOTIFY_ARTIST_ID   (default: 1m15KTr2Qsf1JkdkBam27h — Manu Pavez)
 *   OUTPUT_PATH         (default: data/music.json)
 *   MARKET              (default: AR)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ARTIST_ID = process.env.SPOTIFY_ARTIST_ID || "1m15KTr2Qsf1JkdkBam27h";
const MARKET = process.env.MARKET || "AR";
const OUTPUT_PATH = resolve(ROOT, process.env.OUTPUT_PATH || "data/music.json");

// YouTube (sin API key — usa el RSS público del canal)
const YT_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "";
const YT_HANDLE = process.env.YOUTUBE_HANDLE || "@manupavez";
const YT_OUTPUT_PATH = resolve(ROOT, process.env.YOUTUBE_OUTPUT_PATH || "data/youtube.json");
const YT_MAX = Number(process.env.YOUTUBE_MAX || 8);

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Falta SPOTIFY_CLIENT_ID o SPOTIFY_CLIENT_SECRET en el entorno.");
  process.exit(1);
}

// ---------- Spotify helpers ----------

async function getAccessToken() {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

async function api(token, path) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function getArtist(token) {
  return api(token, `/artists/${ARTIST_ID}`);
}

async function getAlbums(token) {
  const all = [];
  let url = `/artists/${ARTIST_ID}/albums?include_groups=album,single,appears_on&market=${MARKET}&limit=50`;
  while (url) {
    const data = await api(token, url);
    all.push(...data.items);
    url = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  // Dedup por nombre lowercased (Spotify devuelve duplicados por market a veces)
  const seen = new Set();
  return all.filter((a) => {
    const key = a.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getTopTracks(token) {
  const data = await api(token, `/artists/${ARTIST_ID}/top-tracks?market=${MARKET}`);
  return data.tracks || [];
}

// ---------- Transform ----------

function pickImage(images) {
  if (!images?.length) return null;
  return images.find((i) => i.height >= 300)?.url || images[0].url;
}

function normalizeAlbum(a) {
  return {
    id: a.id,
    title: a.name,
    type: a.album_type,
    release_date: a.release_date,
    artwork: pickImage(a.images),
    spotify_url: a.external_urls?.spotify || null,
    total_tracks: a.total_tracks,
  };
}

function normalizeTrack(t) {
  return {
    id: t.id,
    title: t.name,
    artwork: pickImage(t.album?.images),
    album: t.album?.name,
    release_date: t.album?.release_date,
    popularity: t.popularity, // 0–100
    duration_ms: t.duration_ms,
    spotify_url: t.external_urls?.spotify || null,
  };
}

// ---------- YouTube (RSS, sin API key) ----------

// Resuelve el channelId (UC...) desde el handle scrapeando la página del canal.
async function resolveChannelId() {
  if (YT_CHANNEL_ID) return YT_CHANNEL_ID;
  const handle = YT_HANDLE.startsWith("@") ? YT_HANDLE : `@${YT_HANDLE}`;
  const res = await fetch(`https://www.youtube.com/${handle}`, {
    headers: { "Accept-Language": "es", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`YouTube channel page → ${res.status}`);
  const html = await res.text();
  const m = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/channel\/(UC[\w-]+)/);
  if (!m) throw new Error("No pude resolver el channelId desde el handle");
  return m[1];
}

function parseYouTubeFeed(xml) {
  const entries = xml.split("<entry>").slice(1);
  return entries.map((entry) => {
    const id = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || "";
    const title = (entry.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    const description =
      (entry.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || "";
    const views = Number((entry.match(/<media:statistics[^>]*views="(\d+)"/) || [])[1] || 0);
    return {
      id,
      title: decodeEntities(title),
      published,
      views,
      description: decodeEntities(description).slice(0, 220),
      embed_url: id ? `https://www.youtube.com/embed/${id}` : "",
      watch_url: id ? `https://www.youtube.com/watch?v=${id}` : "",
    };
  }).filter((v) => v.id);
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function syncYouTube() {
  const channelId = await resolveChannelId();
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!res.ok) throw new Error(`YouTube RSS → ${res.status}`);
  const xml = await res.text();

  const allVideos = parseYouTubeFeed(xml);
  // total_views: suma de vistas de los videos que expone el RSS (últimos ~15).
  // Nota: es el total de esos videos, no el histórico completo del canal
  // (YouTube no expone el total del canal sin la Data API).
  const totalViews = allVideos.reduce((s, v) => s + (v.views || 0), 0);
  const videos = allVideos.slice(0, YT_MAX);

  const payload = {
    updated_at: new Date().toISOString(),
    channel_id: channelId,
    handle: YT_HANDLE,
    total_views: totalViews,
    videos,
  };

  await mkdir(dirname(YT_OUTPUT_PATH), { recursive: true });
  await writeFile(YT_OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`✓ wrote ${YT_OUTPUT_PATH} (${videos.length} videos · ${totalViews} views · channel ${channelId})`);
}

// ---------- Main ----------

async function main() {
  console.log("→ getting access token");
  const token = await getAccessToken();

  console.log("→ fetching artist, albums, top tracks");
  const [artist, albums, topTracks] = await Promise.all([
    getArtist(token),
    getAlbums(token),
    getTopTracks(token),
  ]);

  const releases = albums
    .map(normalizeAlbum)
    .sort((a, b) => b.release_date.localeCompare(a.release_date));

  const tracks = topTracks.map(normalizeTrack);

  const popularityAvg = tracks.length
    ? Math.round(tracks.reduce((s, t) => s + (t.popularity || 0), 0) / tracks.length)
    : 0;

  const payload = {
    updated_at: new Date().toISOString(),
    artist: {
      id: artist.id,
      name: artist.name,
      followers: artist.followers?.total || 0,
      popularity: artist.popularity || 0,
      genres: artist.genres || [],
      image: pickImage(artist.images),
      spotify_url: artist.external_urls?.spotify || null,
    },
    stats: {
      total_releases: releases.length,
      top_tracks_popularity_avg: popularityAvg,
    },
    releases,
    top_tracks: tracks,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`✓ wrote ${OUTPUT_PATH}`);
  console.log(`  releases: ${releases.length} · followers: ${payload.artist.followers} · popularity: ${payload.artist.popularity}`);

  // YouTube es best-effort: si falla, no rompemos el sync de música.
  try {
    await syncYouTube();
  } catch (err) {
    console.warn("youtube sync failed (continuo igual):", err.message);
  }
}

main().catch((err) => {
  console.error("sync-music failed:", err);
  process.exit(1);
});
