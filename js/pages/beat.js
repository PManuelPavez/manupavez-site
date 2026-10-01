// beat.js — Frequency Beat: secuenciador educativo (página pública, sin login).
// Géneros, samples y textos se leen de /beat (ver beat/LEEME.md): se editan sin tocar código.
// No guarda nada: al recargar, la grilla vuelve a empezar vacía.
import { audioContext, loadVoice, trigger, createSequencer } from "../features/beatEngine.js";

const ROOT = "beat/";
const STEPS = 16;
const BPM_MIN = 80;
const BPM_MAX = 160;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { pattern: new Map(), voices: new Map(), bpm: 124 };
const genres = [];          // [{ id, nombre, bpm, filas }]
const textCache = new Map(); // ruta .md → { corta, html } | null
let genre = null;
let rows = [];
let texts = new Map();       // fila → { corta, html }
let stepEls = [];            // paso → [botones]
let nowStep = -1;
let sheetRow = null;
let captionRow = null;

const seq = createSequencer(state, paintStep);

// ── Datos ───────────────────────────────────────────────
async function getJson(path) {
  const res = await fetch(ROOT + path);
  if (!res.ok) throw new Error(path);
  return res.json();
}

// Markdown mínimo: frontmatter "corta:", párrafos, *cursiva*, **negrita**.
function parseMd(src) {
  let body = src.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const meta = {};
  const fm = body.match(/^\s*---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    body = body.slice(fm[0].length);
  }
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
  const html = body.trim().split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${inline(p.trim())}</p>`).join("");
  return { corta: meta.corta || "", html };
}

async function getText(path) {
  if (!textCache.has(path)) {
    const p = fetch(ROOT + "textos/" + path)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => (t == null ? null : parseMd(t)))
      .catch(() => null);
    textCache.set(path, p);
  }
  return textCache.get(path);
}

// Texto propio del género (textos/<genero>/<fila>.md) o, si no hay, el general.
async function loadTexts(g) {
  const pairs = await Promise.all(g.filas.map(async (f) =>
    [f.id, (await getText(`${g.id}/${f.id}.md`)) || (await getText(`${f.id}.md`)) || { corta: "", html: "" }]));
  return new Map(pairs);
}

// ── Bienvenida ──────────────────────────────────────────
async function initIntro() {
  getText("_bienvenida.md").then((t) => { if (t?.html) $("[data-welcome]").innerHTML = t.html.replace(/^<p>|<\/p>$/g, ""); });

  const list = $("[data-genre-list]");
  try {
    const { generos } = await getJson("generos.json");
    const loaded = await Promise.all(generos.map((id) => getJson(`generos/${id}.json`).then((g) => ({ ...g, id })).catch(() => null)));
    genres.push(...loaded.filter((g) => g?.filas?.length));
  } catch { /* se muestra el aviso de abajo */ }

  if (!genres.length) {
    list.innerHTML = `<p class="beat-muted">No se pudo cargar Frequency Beat. Probá recargar la página.</p>`;
    return;
  }
  list.innerHTML = genres.map((g) => `
    <button type="button" class="beat-genre" data-genre="${esc(g.id)}">
      <span class="beat-genre__name">${esc(g.nombre)}</span>
      <span class="beat-genre__bpm">${Number(g.bpm) || 124} BPM</span>
    </button>`).join("");
  $("[data-genre-chips]").innerHTML = genres.map((g) =>
    `<button type="button" class="beat-chip" data-genre="${esc(g.id)}" aria-pressed="false">${esc(g.nombre)}</button>`).join("");
}

// ── Género ──────────────────────────────────────────────
async function selectGenre(id, btn) {
  const g = genres.find((x) => x.id === id);
  if (!g || g === genre || btn?.getAttribute("aria-busy") === "true") return;
  audioContext(); // dentro del toque: habilita el audio en iOS
  btn?.setAttribute("aria-busy", "true");

  const [voices, txt] = await Promise.all([
    Promise.all(g.filas.map((f) => loadVoice(`${ROOT}samples/${g.id}/${f.sample || f.id + ".mp3"}`, f.id)
      .then((v) => [f.id, { ...v, gain: Number.isFinite(f.volumen) ? f.volumen : 1 }]))),
    loadTexts(g),
  ]);
  btn?.removeAttribute("aria-busy");

  genre = g;
  texts = txt;
  state.voices = new Map(voices);
  // La grilla se conserva al cambiar de género: el mismo patrón, con otros sonidos.
  const prev = state.pattern;
  state.pattern = new Map(g.filas.map((f) => [f.id, prev.get(f.id) || Array(STEPS).fill(false)]));
  const sameRows = rows.length && rows.map((r) => r.id).join() === g.filas.map((f) => f.id).join();
  rows = g.filas;
  if (!sameRows) renderGrid();
  setBpm(Number(g.bpm) || 124);

  document.querySelectorAll("[data-genre-chips] [data-genre]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.genre === id)));
  if (!$("[data-intro]").hidden) {
    $("[data-intro]").hidden = true;
    $("[data-seq]").hidden = false;
    window.scrollTo(0, 0);
  }
  const chip = $(`[data-genre-chips] [aria-pressed="true"]`);
  chip?.parentElement.scrollTo({ left: chip.offsetLeft - 16, behavior: "smooth" });
  if (captionRow) showCaption(captionRow);
}

// ── Grilla: dos bloques de 8 pasos (tiempos 1-2 y 3-4). En pantalla ancha van uno al lado del otro. ──
function renderGrid() {
  stepEls = Array.from({ length: STEPS }, () => []);
  const grid = $("[data-grid]");
  grid.innerHTML = [0, 1].map((half) => `
    <div class="beat-block" data-half="${half}">
      <div class="beat-row beat-row--ruler" aria-hidden="true">
        <span class="beat-label beat-label--ruler"></span>
        <div class="beat-steps">${Array.from({ length: 8 }, (_, i) => {
          const s = half * 8 + i;
          return `<span class="beat-tick${s % 4 === 0 ? " is-beat" : ""}">${s % 4 === 0 ? s / 4 + 1 : "·"}</span>`;
        }).join("")}</div>
      </div>
      ${rows.map((r) => `
        <div class="beat-row" data-row="${esc(r.id)}">
          <button type="button" class="beat-label" data-info="${esc(r.id)}" aria-label="${esc(r.label)}: por qué va donde va">
            <span>${esc(r.label)}</span><span class="beat-label__i" aria-hidden="true">i</span>
          </button>
          <div class="beat-steps">${Array.from({ length: 8 }, (_, i) => {
            const s = half * 8 + i;
            return `<button type="button" class="beat-step${s % 4 === 0 ? " is-beat" : ""}" data-row="${esc(r.id)}" data-step="${s}" aria-pressed="false" aria-label="${esc(r.label)}, paso ${s + 1}"></button>`;
          }).join("")}</div>
        </div>`).join("")}
    </div>`).join("");

  grid.querySelectorAll(".beat-step").forEach((el) => stepEls[Number(el.dataset.step)].push(el));
  grid.querySelectorAll(".beat-block").forEach((block, half) =>
    block.querySelectorAll(".beat-tick").forEach((t, i) => stepEls[half * 8 + i].push(t)));
  paintPattern();
}

function paintPattern() {
  document.querySelectorAll(".beat-step").forEach((b) => {
    const on = state.pattern.get(b.dataset.row)?.[b.dataset.step] === true;
    b.setAttribute("aria-pressed", String(on));
  });
}

function paintStep(i) {
  if (nowStep >= 0) stepEls[nowStep]?.forEach((el) => el.classList.remove("is-now"));
  nowStep = i;
  if (i >= 0) stepEls[i]?.forEach((el) => el.classList.add("is-now"));
}

// ── Capa educativa ─────────────────────────────────────
function showCaption(rowId) {
  const r = rows.find((x) => x.id === rowId);
  const t = texts.get(rowId);
  if (!r || !t?.corta) return;
  captionRow = rowId;
  $("[data-caption-text]").innerHTML = `<strong>${esc(r.label)}</strong> ${esc(t.corta)}`;
  $("[data-caption-more]").hidden = !t.html;
  $("[data-caption-more]").dataset.info = rowId;
}

function openSheet(rowId) {
  const r = rows.find((x) => x.id === rowId);
  if (!r) return;
  const t = texts.get(rowId) || {};
  sheetRow = rowId;
  $("[data-sheet-genre]").textContent = genre?.nombre || "";
  $("[data-sheet-title]").textContent = r.label;
  $("[data-sheet-short]").textContent = t.corta || "";
  $("[data-sheet-short]").hidden = !t.corta;
  $("[data-sheet-body]").innerHTML = t.html || "";
  $("[data-sheet-pattern]").hidden = !/x/i.test(r.patron || "");
  const dlg = $("[data-sheet]");
  if (!dlg.open) dlg.showModal();
}

function loadRowPattern(rowId) {
  const r = rows.find((x) => x.id === rowId);
  if (!r) return;
  const p = String(r.patron || "").padEnd(STEPS, ".");
  state.pattern.set(rowId, Array.from({ length: STEPS }, (_, i) => p[i].toLowerCase() === "x"));
  paintPattern();
}

// ── Transporte ─────────────────────────────────────────
function setBpm(v) {
  state.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v) || 124));
  $("[data-bpm-value]").textContent = state.bpm;
  $("[data-bpm-range]").value = state.bpm;
}

function setPlaying(on) {
  if (on) seq.start(); else seq.stop();
  const btn = $("[data-play]");
  btn.setAttribute("aria-pressed", String(on));
  $("[data-play-label]").textContent = on ? "STOP" : "PLAY";
}

// ── Eventos ────────────────────────────────────────────
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-genre]");
  if (g) return selectGenre(g.dataset.genre, g);

  const step = e.target.closest(".beat-step");
  if (step) {
    const row = state.pattern.get(step.dataset.row);
    const s = Number(step.dataset.step);
    row[s] = !row[s];
    step.setAttribute("aria-pressed", String(row[s]));
    if (row[s] && !seq.playing) trigger(state.voices.get(step.dataset.row));
    showCaption(step.dataset.row);
    return;
  }

  const info = e.target.closest("[data-info]");
  if (info) return openSheet(info.dataset.info);

  if (e.target.closest("[data-play]")) return setPlaying(!seq.playing);
  if (e.target.closest("[data-clear]")) {
    for (const r of state.pattern.values()) r.fill(false);
    return paintPattern();
  }
  const bpmBtn = e.target.closest("[data-bpm-step]");
  if (bpmBtn) return setBpm(state.bpm + Number(bpmBtn.dataset.bpmStep));

  const dlg = $("[data-sheet]");
  if (e.target === dlg || e.target.closest("[data-sheet-close]")) return dlg.close();
  if (e.target.closest("[data-sheet-listen]")) return trigger(state.voices.get(sheetRow));
  if (e.target.closest("[data-sheet-pattern]")) {
    loadRowPattern(sheetRow);
    showCaption(sheetRow);
    return dlg.close();
  }
});

$("[data-bpm-range]").addEventListener("input", (e) => setBpm(Number(e.target.value)));

// En segundo plano el navegador frena los timers: mejor parar que sonar a los tumbos.
document.addEventListener("visibilitychange", () => { if (document.hidden) setPlaying(false); });

initIntro();
