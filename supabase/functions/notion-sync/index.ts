// supabase/functions/notion-sync/index.ts
// Copia el panel de Notion a la base (students + sessions). Corre cada hora
// con pg_cron y también desde el botón "Sincronizar" del panel admin.
//
// Estructura esperada en Notion:
//   PANEL DE CLINICAS - Frequency Lab            (página madre)
//     └─ [Nombre del alumno]                      (subpágina = 1 alumno)
//          └─ SESION N - FREQUENCY LAB [Nombre]  (subpágina o toggle = 1 sesión)
// Además de las sesiones, se copia la página del alumno tal como está armada
// (filas, columnas y secciones por título) para el portal.
// Las bases de datos anidadas (ej. "Historial de Grabaciones 2.0") se ignoran.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   NOTION_TOKEN            token de la integración (obligatorio)
//   NOTION_PANEL_PAGE_ID    opcional; si falta, se busca la página por título
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solo.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const PANEL_TITLE = "PANEL DE CLINICAS - Frequency Lab";
const SESSION_RE = /SESI[OÓ]N\s*(\d+)/i;
const TIME_BUDGET_MS = 110_000;   // el runtime corta a ~150s: dejamos margen
const MIN_GAP_MS = 350;           // Notion permite ~3 req/s
const MAX_NOTES = 20_000;

const ALLOWED_ORIGINS = new Set([
  "https://manupavez.com",
  "https://www.manupavez.com",
  "http://localhost:5173",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://manupavez.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });

// ───────────────────────── Notion client ─────────────────────────
type Block = Record<string, any>;

function notionClient(token: string) {
  let last = 0;
  let calls = 0;

  async function call(path: string, init: RequestInit = {}, attempt = 0): Promise<any> {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    calls++;

    const res = await fetch(`${NOTION_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    });

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retry = Number(res.headers.get("retry-after")) || 1 + attempt;
      await new Promise((r) => setTimeout(r, retry * 1000));
      return call(path, init, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`notion ${res.status} ${path}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async function children(id: string): Promise<Block[]> {
    const out: Block[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: "100" });
      if (cursor) qs.set("start_cursor", cursor);
      const data = await call(`/blocks/${id}/children?${qs}`);
      out.push(...(data.results || []));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return out;
  }

  async function findPanel(): Promise<string | null> {
    const data = await call("/search", {
      method: "POST",
      body: JSON.stringify({ query: PANEL_TITLE, filter: { property: "object", value: "page" } }),
    });
    const norm = (s: string) => s.trim().toLowerCase();
    const hit = (data.results || []).find((p: any) => {
      const titleProp = Object.values(p.properties || {}).find((v: any) => v?.type === "title") as any;
      const t = (titleProp?.title || []).map((x: any) => x.plain_text).join("");
      return norm(t) === norm(PANEL_TITLE);
    });
    return hit?.id ?? null;
  }

  return { children, findPanel, calls: () => calls };
}

// ───────────────────────── Parsing ─────────────────────────
const plain = (rt: any[] = []) => rt.map((t) => t?.plain_text ?? "").join("").trim();

function blockText(b: Block): string {
  const v = b[b.type];
  if (!v) return "";
  if (Array.isArray(v.rich_text)) return plain(v.rich_text);
  return "";
}

// Texto con sus links (lo que en Notion es una palabra/URL con hipervínculo).
// Se guardan tramos { text, href } para que la web los muestre clickeables.
type Part = { text: string; href?: string };
function richParts(rt: any[] = []): Part[] {
  const parts: Part[] = [];
  for (const t of rt) {
    const text = t?.plain_text ?? "";
    if (!text) continue;
    const href = t?.href ? safeUrl(t.href) || undefined : undefined;
    const last = parts[parts.length - 1];
    if (last && last.href === href) last.text += text;
    else parts.push(href ? { text, href } : { text });
  }
  return parts;
}
const withLinks = (b: Block): Part[] | undefined => {
  const parts = richParts(b[b.type]?.rich_text);
  return parts.some((p) => p.href) ? parts.slice(0, 60) : undefined;
};
// Archivos subidos a Notion: su URL firmada vence en 1 h, así que se guarda el
// id del bloque y la web pide un link fresco al abrirlo (Edge Function notion-file).
const isNotionHosted = (v: any) => v?.type === "file";
const fileLabel = (b: Block) => {
  const v = b[b.type] || {};
  return (plain(v.caption) || v.name || decodeURIComponent(String(v.file?.url || "").split("?")[0].split("/").pop() || "") || "Archivo").slice(0, 160);
};

function sessionTitle(b: Block): string | null {
  if (b.type === "child_page") return b.child_page?.title?.trim() || null;
  const toggleable =
    b.type === "toggle" ||
    (/^heading_[123]$/.test(b.type) && b[b.type]?.is_toggleable);
  return toggleable ? blockText(b) || null : null;
}

function toIsoDate(d: string | undefined | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// dd/mm/yyyy o dd-mm-yy dentro de un texto
function parseDmy(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (!m) return null;
  const [_, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  const dd = d.padStart(2, "0"), mm = mo.padStart(2, "0");
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
  return `${year}-${mm}-${dd}`;
}

function safeUrl(u: unknown): string | null {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// Todos los links de Fathom de una sesión (uno por minuto/punto del resumen)
// se consolidan en uno solo por grabación: /calls/<id> o /share/<id>, sin query.
function normalizeLink(raw: string, label: string): { url: string; label: string } {
  try {
    const u = new URL(raw);
    if (/(^|\.)fathom\.video$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/(calls|share)\/([^/?#]+)/);
      if (m) return { url: `https://fathom.video/${m[1]}/${m[2]}`, label: "Ver grabación" };
    }
  } catch { /* se valida antes */ }
  return { url: raw, label };
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[:\s]+$/, "").trim();
const isNextStepsTitle = (s: string) => fold(s) === "proximos pasos";
const isUrlOnly = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

type Task = { text: string; done: boolean; depth: number; group: boolean };

// En "Próximos pasos" Fathom agrupa por persona ("Facundo:", "Manuel:").
// El alumno solo ve lo suyo: se descarta el grupo del mentor y todo lo que cuelga de él.
const MENTOR_GROUP = /^manu(el)?(\s+pavez)?\s*:$/i;
function dropMentorTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  let skipDepth: number | null = null;
  for (const t of tasks) {
    if (skipDepth !== null) {
      const endsSkip = t.depth < skipDepth || (t.depth === skipDepth && t.group);
      if (!endsSkip) continue;
      skipDepth = null;
    }
    if (t.group && MENTOR_GROUP.test(t.text.trim())) { skipDepth = t.depth; continue; }
    out.push(t);
  }
  return out;
}

type Parsed = {
  notes: string[];
  tasks: Task[];
  links: { url: string; label: string }[];
  date: string | null;
  inNextSteps: boolean;   // estamos dentro de la sección "Próximos pasos"
  sectionDepth: number;   // profundidad donde arrancó esa sección
};

async function parseContent(
  notion: ReturnType<typeof notionClient>,
  id: string,
  out: Parsed,
  depth = 0,
): Promise<void> {
  const blocks = await notion.children(id);
  const addLink = (u: unknown, label: string) => {
    const safe = safeUrl(u);
    if (!safe) return;
    // Los archivos subidos a Notion tienen URLs firmadas que vencen en 1h: no sirven
    if (/secure\.notion-static\.com|prod-files-secure|amazonaws\.com.*X-Amz/i.test(safe)) return;
    const link = normalizeLink(safe, (label || safe).slice(0, 200));
    if (out.links.some((l) => l.url === link.url)) return;
    out.links.push(link);
  };

  for (const b of blocks) {
    if (b.type === "child_database" || b.type === "child_page") continue;
    const v = b[b.type] || {};
    const text = blockText(b);
    const isHeading = /^heading_[123]$/.test(b.type);

    // Fecha (dato secundario): mención de fecha de Notion o dd/mm/aaaa en el texto
    if (!out.date) {
      const mention = (v.rich_text || []).find((t: any) => t.type === "mention" && t.mention?.type === "date");
      out.date = toIsoDate(mention?.mention?.date?.start) || (text ? parseDmy(text) : null);
    }
    for (const t of v.rich_text || []) if (t.href) addLink(t.href, t.plain_text);

    // Resumen pegado como UN bloque con saltos de línea: se procesa línea por línea
    if (["paragraph", "quote", "callout"].includes(b.type) && text.includes("\n")) {
      for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
        if (isNextStepsTitle(line)) { out.inNextSteps = true; out.sectionDepth = depth; continue; }
        if (out.inNextSteps) {
          out.tasks.push({ text: line.slice(0, 500), done: false, depth: 0, group: line.endsWith(":") });
        } else if (isUrlOnly(line)) {
          addLink(line, "");
        } else {
          out.notes.push(line);
        }
      }
      if (b.has_children && depth < 3) await parseContent(notion, b.id, out, depth + 1);
      continue;
    }

    // Sección "Próximos pasos": empieza en ese título (heading o bloque de texto suelto)
    // y termina en el próximo heading del mismo nivel o superior.
    const isTextBlock = isHeading || ["paragraph", "quote", "callout", "toggle"].includes(b.type);
    if (text && isNextStepsTitle(text) && isTextBlock) {
      out.inNextSteps = true;
      out.sectionDepth = depth;
      // Título desplegable con los pasos adentro: la sección son sus hijos
      if (b.has_children && depth < 3) {
        out.sectionDepth = depth + 1;
        await parseContent(notion, b.id, out, depth + 1);
        out.inNextSteps = false;
      }
      continue;
    }
    if (out.inNextSteps && isHeading && depth <= out.sectionDepth) out.inNextSteps = false;

    if (out.inNextSteps && text && !isHeading) {
      out.tasks.push({
        text: text.slice(0, 500),
        done: b.type === "to_do" ? Boolean(v.checked) : false,
        depth: Math.min(3, depth - out.sectionDepth),
        group: text.endsWith(":"),
      });
      if (b.has_children && depth < 3) await parseContent(notion, b.id, out, depth + 1);
      continue;
    }

    switch (b.type) {
      case "to_do":
        if (text) out.tasks.push({ text: text.slice(0, 500), done: Boolean(v.checked), depth: 0, group: false });
        break;
      case "heading_1":
      case "heading_2":
      case "heading_3":
        if (text) out.notes.push(`\n${text.toUpperCase()}`);
        break;
      case "bulleted_list_item":
      case "numbered_list_item":
        if (text) out.notes.push(`${"  ".repeat(depth)}• ${text}`);
        break;
      case "paragraph":
      case "quote":
      case "callout":
      case "toggle":
        // Un párrafo que es solo un link ya queda en "Ver grabación"
        if (text && !isUrlOnly(text)) out.notes.push(text);
        else if (text) addLink(text.trim(), "");
        break;
      case "bookmark":
      case "embed":
      case "link_preview":
        addLink(v.url, plain(v.caption) || v.url);
        break;
      case "video":
      case "audio":
      case "file":
      case "pdf":
        if (v.type === "external") addLink(v.external?.url, plain(v.caption) || v.name || b.type);
        else if (isNotionHosted(v) && !out.links.some((l) => l.url === `notion-file:${b.id}`)) {
          out.links.push({ url: `notion-file:${b.id}`, label: fileLabel(b) });
        }
        break;
    }

    if (b.has_children && depth < 3) await parseContent(notion, b.id, out, depth + 1);
  }
}

// ───────────────────────── Página del alumno ─────────────────────────
// Un solo recorrido de la página: encuentra las sesiones y, a la vez, arma el
// "espejo" de la página (filas → columnas → secciones por título) para el portal.
type DashItem =
  | { t: "label" | "text"; text: string; parts?: Part[] }
  | { t: "bullet"; text: string; depth: number; parts?: Part[] }
  | { t: "task"; id: string; text: string; done: boolean; depth: number; parts?: Part[] }
  | { t: "link"; url: string; label: string; kind: "recording" | "link" }
  | { t: "file"; id: string; label: string }
  | { t: "sessions" };
type DashSection = { title: string; color: string | null; items: DashItem[] };
type DashRow = { cols: DashSection[][] };
type FoundSession = { block: Block; title: string; number: number };

const stripEmoji = (s: string) =>
  s.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/u, "").trim();
const isRecordingUrl = (u: string) => /^https:\/\/([a-z0-9-]+\.)?fathom\.video\//i.test(u);

async function parseStudentPage(notion: ReturnType<typeof notionClient>, pageId: string) {
  const sessions: FoundSession[] = [];
  const rows: DashRow[] = [];

  const newSection = (list: DashSection[], title = "", color: string | null = null) => {
    const s: DashSection = { title, color, items: [] };
    list.push(s);
    return s;
  };
  const current = (list: DashSection[]) => list[list.length - 1] || newSection(list);

  const pushLink = (list: DashSection[], raw: unknown, caption: string) => {
    const url = safeUrl(raw);
    if (!url || /secure\.notion-static\.com|prod-files-secure|amazonaws\.com.*X-Amz/i.test(url)) return;
    const sec = current(list);
    if (sec.items.some((i) => i.t === "link" && i.url === url)) return;
    sec.items.push({ t: "link", url, label: caption.slice(0, 160), kind: isRecordingUrl(url) ? "recording" : "link" });
  };

  async function consume(b: Block, list: DashSection[], depth: number): Promise<void> {
    if (b.type === "child_database") return; // p.ej. "Historial de Grabaciones 2.0" (Mateo)
    const title = sessionTitle(b);
    const m = title?.match(SESSION_RE);
    if (title && m) {
      sessions.push({ block: b, title, number: Number(m[1]) });
      const sec = current(list);
      if (!sec.items.some((i) => i.t === "sessions")) sec.items.push({ t: "sessions" });
      return;
    }
    if (b.type === "child_page" || depth > 4) return;

    const v = b[b.type] || {};
    const text = blockText(b);
    const kids = async (d: number) => {
      if (b.has_children) for (const c of await notion.children(b.id)) await consume(c, list, d);
    };

    switch (b.type) {
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        if (!text) return;
        const color = String(v.color || "default").replace(/_background$/, "");
        newSection(list, stripEmoji(text).slice(0, 120), color === "default" ? null : color);
        await kids(depth); // título desplegable: su contenido es la sección
        return;
      }
      case "column_list":
      case "column":
      case "synced_block":
        await kids(depth);
        return;
      case "to_do":
        // id = bloque de Notion: clave estable para que el alumno la marque desde la web
        if (text) current(list).items.push({ t: "task", id: b.id, text: text.slice(0, 500), done: Boolean(v.checked), depth: Math.min(depth, 3), parts: withLinks(b) });
        await kids(depth + 1);
        return;
      case "bulleted_list_item":
      case "numbered_list_item":
        if (text) current(list).items.push({ t: "bullet", text: text.slice(0, 1000), depth: Math.min(depth, 3), parts: withLinks(b) });
        await kids(depth + 1);
        return;
      case "paragraph":
      case "quote":
      case "callout":
      case "toggle": {
        // Con links adentro ("CHESTER: https://…", "QSYY: <link>"): un solo ítem con sus tramos
        const parts = withLinks(b);
        if (parts && !isUrlOnly(text)) {
          current(list).items.push({ t: "text", text: text.slice(0, 2000), parts });
          await kids(depth + 1);
          return;
        }
        for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
          if (isUrlOnly(line)) pushLink(list, line, "");
          else if (line.length <= 60 && line.endsWith(":")) current(list).items.push({ t: "label", text: line.slice(0, -1) });
          else current(list).items.push({ t: "text", text: line.slice(0, 2000) });
        }
        await kids(depth + 1);
        return;
      }
      case "bookmark":
      case "embed":
      case "link_preview":
        pushLink(list, v.url, plain(v.caption));
        return;
      case "video":
      case "audio":
      case "file":
      case "pdf":
        if (v.type === "external") pushLink(list, v.external?.url, plain(v.caption) || v.name || "");
        else if (isNotionHosted(v)) current(list).items.push({ t: "file", id: b.id, label: fileLabel(b) });
        return;
    }
  }

  let full: DashSection[] | null = null;
  for (const b of await notion.children(pageId)) {
    if (b.type === "column_list") {
      const cols: DashSection[][] = [];
      for (const col of await notion.children(b.id)) {
        const list: DashSection[] = [];
        if (col.has_children) for (const c of await notion.children(col.id)) await consume(c, list, 0);
        cols.push(list);
      }
      rows.push({ cols });
      full = null;
      continue;
    }
    if (!full) {
      full = [];
      rows.push({ cols: [full] });
    }
    await consume(b, full, 0);
  }

  // Fuera secciones vacías (p.ej. un título cuya base de datos se ignoró)
  const clean = rows
    .map((r) => ({ cols: r.cols.map((c) => c.filter((s) => s.items.length > 0)) }))
    .filter((r) => r.cols.some((c) => c.length > 0));
  return { sessions, rows: clean };
}

// Títulos de bookmarks: la API de Notion no los da. Se leen una vez de la página
// enlazada (og:title) y quedan en caché en link_titles.
const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function fetchTitle(url: string): Promise<string | null> {
  if (!url.startsWith("https://")) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; manupavez-lab-sync)", Accept: "text/html" },
    });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, 300_000);
    const m =
      html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = m ? decodeEntities(m[1]).trim().slice(0, 160) : "";
    // Títulos genéricos del sitio no aportan nada
    return title && !/^(fathom|youtube|soundcloud)( video)?$/i.test(title) ? title : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLinkLabels(db: any, rows: DashRow[], budget: { left: number }) {
  const links = rows.flatMap((r) => r.cols.flat().flatMap((s) => s.items)).filter((i): i is Extract<DashItem, { t: "link" }> => i.t === "link");
  const pending = [...new Set(links.filter((l) => !l.label).map((l) => l.url))];
  if (!pending.length) return;

  const { data: cached } = await db.from("link_titles").select("url, title").in("url", pending);
  const titles = new Map<string, string | null>((cached || []).map((c: any) => [c.url, c.title]));

  for (const url of pending) {
    if (titles.has(url) || budget.left <= 0) continue;
    budget.left--;
    const title = await fetchTitle(url);
    titles.set(url, title);
    await db.from("link_titles").upsert({ url, title, fetched_at: new Date().toISOString() });
  }

  for (const l of links) {
    if (l.label) continue;
    const t = titles.get(l.url);
    if (t) l.label = t;
    else l.label = l.kind === "recording" ? "Grabación" : new URL(l.url).hostname.replace(/^www\./, "");
  }
}

// ───────────────────────── Handler ─────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // ── Autorización: cron (secreto en Vault) o admin logueado ──
  let trigger = "";
  const secret = req.headers.get("x-sync-secret");
  if (secret) {
    const { data } = await db.rpc("verify_sync_secret", { p_secret: secret });
    if (data === true) trigger = "cron";
  } else {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data: u } = await db.auth.getUser(jwt);
      if (u?.user) {
        const { data: prof } = await db.from("profiles").select("is_admin").eq("user_id", u.user.id).maybeSingle();
        if (prof?.is_admin === true) trigger = "admin";
      }
    }
  }
  if (!trigger) return json(req, { error: "unauthorized" }, 401);

  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) return json(req, { error: "missing_notion_token" }, 500);

  let force = false;
  try {
    force = Boolean((await req.json())?.force);
  } catch { /* body vacío */ }

  // Evita corridas superpuestas
  const { data: running } = await db
    .from("sync_runs").select("id")
    .is("finished_at", null)
    .gt("started_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .limit(1);
  if (running?.length) return json(req, { ok: false, skipped: "already_running" }, 409);

  const { data: run } = await db.from("sync_runs").insert({ trigger }).select("id").single();
  const started = Date.now();
  const stats = { students: 0, sessions_seen: 0, sessions_updated: 0, notion_calls: 0, partial: false };
  const notion = notionClient(token);
  const titleBudget = { left: 12 }; // títulos de links nuevos a buscar por corrida

  try {
    const panelId = Deno.env.get("NOTION_PANEL_PAGE_ID") || (await notion.findPanel());
    if (!panelId) throw new Error("panel_not_found: compartí la página del panel con la integración");

    const studentPages = (await notion.children(panelId)).filter((b) => b.type === "child_page");

    for (const page of studentPages) {
      if (Date.now() - started > TIME_BUDGET_MS) { stats.partial = true; break; }

      const name = page.child_page?.title?.trim() || "Sin nombre";
      const { data: student, error: sErr } = await db
        .from("students")
        .upsert({ notion_page_id: page.id, full_name: name }, { onConflict: "notion_page_id" })
        .select("id")
        .single();
      if (sErr) throw sErr;
      stats.students++;

      const { data: existing } = await db
        .from("sessions").select("notion_page_id, notion_last_edited").eq("student_id", student.id);
      const known = new Map((existing || []).map((s) => [s.notion_page_id, s.notion_last_edited]));

      const { sessions, rows } = await parseStudentPage(notion, page.id);
      await resolveLinkLabels(db, rows, titleBudget);
      const { error: dErr } = await db.from("student_dashboards").upsert(
        { student_id: student.id, content: { rows }, notion_synced_at: new Date().toISOString() },
        { onConflict: "student_id" },
      );
      if (dErr) throw dErr;

      let completed = true;

      for (const s of sessions) {
        if (Date.now() - started > TIME_BUDGET_MS) { stats.partial = true; completed = false; break; }
        stats.sessions_seen++;

        const edited = s.block.last_edited_time as string;
        const prev = known.get(s.block.id);
        // Las subpáginas traen su última edición; los toggles no, así que se re-leen siempre
        const unchanged = s.block.type === "child_page" && prev && new Date(prev).getTime() === new Date(edited).getTime();
        if (unchanged && !force) {
          await db.from("sessions").update({ in_notion: true }).eq("notion_page_id", s.block.id);
          continue;
        }

        const parsed: Parsed = { notes: [], tasks: [], links: [], date: null, inNextSteps: false, sectionDepth: 0 };
        await parseContent(notion, s.block.id, parsed);

        const { error } = await db.from("sessions").upsert(
          {
            student_id: student.id,
            notion_page_id: s.block.id,
            number: s.number,
            title: s.title.slice(0, 300),
            // Dato secundario: el orden lo da el número del título, nunca la fecha.
            // Sin fecha en el contenido → null (la fecha de creación en Notion no es confiable).
            session_date: parsed.date || parseDmy(s.title),
            notes: parsed.notes.join("\n").trim().slice(0, MAX_NOTES) || null,
            tasks: dropMentorTasks(parsed.tasks).slice(0, 100),
            links: parsed.links.slice(0, 50),
            notion_last_edited: edited,
            in_notion: true,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "notion_page_id" },
        );
        if (error) throw error;
        stats.sessions_updated++;
      }

      // Si recorrimos al alumno completo, lo que ya no está en Notion se oculta (no se borra)
      if (completed) {
        const current = sessions.map((s) => s.block.id);
        let q = db.from("sessions").update({ in_notion: false }).eq("student_id", student.id).eq("in_notion", true);
        if (current.length) q = q.not("notion_page_id", "in", `(${current.map((id) => `"${id}"`).join(",")})`);
        await q;
      }
    }

    stats.notion_calls = notion.calls();
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, stats }).eq("id", run!.id);
    return json(req, { ok: true, stats });
  } catch (err) {
    stats.notion_calls = notion.calls();
    const message = (err as Error).message || String(err);
    await db.from("sync_runs")
      .update({ finished_at: new Date().toISOString(), ok: false, stats, error: message.slice(0, 1000) })
      .eq("id", run!.id);
    console.error("[notion-sync]", message);
    return json(req, { ok: false, error: "sync_failed" }, 500);
  }
});
