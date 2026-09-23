// supabase/functions/notion-sync/index.ts
// Copia el panel de Notion a la base (students + sessions). Corre cada hora
// con pg_cron y también desde el botón "Sincronizar" del panel admin.
//
// Estructura esperada en Notion:
//   PANEL DE CLINICAS - Frequency Lab            (página madre)
//     └─ [Nombre del alumno]                      (subpágina = 1 alumno)
//          └─ SESION N - FREQUENCY LAB [Nombre]  (subpágina o toggle = 1 sesión)
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

function sessionTitle(b: Block): string | null {
  if (b.type === "child_page") return b.child_page?.title?.trim() || null;
  const toggleable =
    b.type === "toggle" ||
    (/^heading_[123]$/.test(b.type) && b[b.type]?.is_toggleable);
  return toggleable ? blockText(b) || null : null;
}

const isContainer = (b: Block) =>
  b.has_children && ["column_list", "column", "synced_block", "toggle", "callout"].includes(b.type);

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

type Parsed = {
  notes: string[];
  tasks: { text: string; done: boolean }[];
  links: { url: string; label: string }[];
  date: string | null;
};

async function parseContent(
  notion: ReturnType<typeof notionClient>,
  id: string,
  out: Parsed,
  depth = 0,
): Promise<void> {
  const blocks = await notion.children(id);
  const seen = new Set(out.links.map((l) => l.url));
  const addLink = (u: unknown, label: string) => {
    const url = safeUrl(u);
    if (!url || seen.has(url)) return;
    // Los archivos subidos a Notion tienen URLs firmadas que vencen en 1h: no sirven
    if (/secure\.notion-static\.com|prod-files-secure|amazonaws\.com.*X-Amz/i.test(url)) return;
    seen.add(url);
    out.links.push({ url, label: (label || url).slice(0, 200) });
  };

  for (const b of blocks) {
    if (b.type === "child_database" || b.type === "child_page") continue;
    const v = b[b.type] || {};
    const text = blockText(b);

    // Fecha: primera mención de fecha de Notion o dd/mm/aaaa en el texto
    if (!out.date) {
      const mention = (v.rich_text || []).find((t: any) => t.type === "mention" && t.mention?.type === "date");
      out.date = toIsoDate(mention?.mention?.date?.start) || (text ? parseDmy(text) : null);
    }
    for (const t of v.rich_text || []) if (t.href) addLink(t.href, t.plain_text);

    switch (b.type) {
      case "to_do":
        if (text) out.tasks.push({ text: text.slice(0, 500), done: Boolean(v.checked) });
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
        if (text) out.notes.push(text);
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
        break;
    }

    if (b.has_children && depth < 3) await parseContent(notion, b.id, out, depth + 1);
  }
}

// Busca sesiones dentro de la página del alumno (también dentro de columnas/toggles)
async function findSessions(
  notion: ReturnType<typeof notionClient>,
  id: string,
  depth = 0,
): Promise<{ block: Block; title: string; number: number }[]> {
  const found: { block: Block; title: string; number: number }[] = [];
  for (const b of await notion.children(id)) {
    if (b.type === "child_database") continue; // p.ej. "Historial de Grabaciones 2.0"
    const title = sessionTitle(b);
    const m = title?.match(SESSION_RE);
    if (title && m) {
      found.push({ block: b, title, number: Number(m[1]) });
      continue;
    }
    if (isContainer(b) && depth < 2) found.push(...(await findSessions(notion, b.id, depth + 1)));
  }
  return found;
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

      const sessions = await findSessions(notion, page.id);
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

        const parsed: Parsed = { notes: [], tasks: [], links: [], date: null };
        await parseContent(notion, s.block.id, parsed);

        const { error } = await db.from("sessions").upsert(
          {
            student_id: student.id,
            notion_page_id: s.block.id,
            number: s.number,
            title: s.title.slice(0, 300),
            session_date: parsed.date || parseDmy(s.title) || toIsoDate(s.block.created_time),
            notes: parsed.notes.join("\n").trim().slice(0, MAX_NOTES) || null,
            tasks: parsed.tasks.slice(0, 100),
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
