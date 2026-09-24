// lab.js — Datos del portal de alumnos y del panel admin.
// Toda la seguridad vive en RLS (Supabase): estas consultas solo devuelven
// lo que el usuario logueado tiene permitido ver.
import { supabase, hasSupabase } from "./supabaseClient.js";

function ensure() {
  if (!hasSupabase() || !supabase) throw new Error("Supabase no configurado");
  return supabase;
}

export async function isAdmin() {
  const { data, error } = await ensure().rpc("is_admin");
  if (error) return false;
  return data === true;
}

// ── Alumno ──────────────────────────────────────────────
// Todo el espacio del alumno en UN pedido (RPC security invoker: RLS decide).
export async function getMyPortal() {
  const { data, error } = await ensure().rpc("get_my_portal");
  if (error) throw error;
  return {
    isAdmin: data?.is_admin === true,
    student: data?.student || null,
    sessions: data?.sessions || [],
    dashboard: data?.dashboard?.rows?.length ? data.dashboard : null,
    tracks: data?.tracks || [],
    checks: new Map(Object.entries(data?.checks || {})),
    material: data?.material || [],
  };
}

export function membershipIsActive(m) {
  if (!m || m.status !== "active") return false;
  return !m.current_period_end || new Date(m.current_period_end) > new Date();
}

// Tracks del alumno ("Work in progress"). RLS: solo los propios y con acceso vigente.
const TRACK_ERRORS = {
  track_limit: "Llegaste al máximo de 30 tracks. Borrá alguno viejo para sumar otro.",
  track_rate: "Cargaste muchos tracks seguidos. Probá de nuevo en un rato.",
};

export async function addTrack({ title, url }) {
  const { data, error } = await ensure()
    .from("student_tracks")
    .insert({ title, url })
    .select("id, title, url, created_at")
    .single();
  if (error) {
    const known = Object.keys(TRACK_ERRORS).find((k) => error.message?.includes(k));
    throw new Error(known ? TRACK_ERRORS[known] : "No se pudo guardar el track. Revisá el link y probá de nuevo.");
  }
  return data;
}

export async function deleteTrack(id) {
  // RLS no tira error si no deja borrar: devuelve 0 filas. Por eso se confirma con select.
  const { data, error } = await ensure().from("student_tracks").delete().eq("id", id).select("id");
  if (error || !data?.length) throw new Error("No se pudo borrar el track.");
}

// Misión marcada/desmarcada por el alumno (la base valida que sea suya)
export async function setTaskCheck(taskKey, done) {
  const { error } = await ensure()
    .from("student_task_checks")
    .upsert({ task_key: taskKey, done }, { onConflict: "student_id,task_key" });
  if (error) throw new Error("No se pudo guardar. Probá de nuevo.");
}

// ── Admin ───────────────────────────────────────────────
export async function adminListStudents() {
  const sb = ensure();
  const [{ data: students, error }, { data: sessions, error: sErr }, { data: tracks }, { data: dashes }, { data: checks }] = await Promise.all([
    sb.from("students")
      .select("id, full_name, email, user_id, status, memberships(status, current_period_end)")
      .order("full_name"),
    sb.from("sessions").select("student_id, number, session_date").eq("in_notion", true),
    sb.from("student_tracks").select("student_id, title, url, created_at").order("created_at", { ascending: false }),
    sb.from("student_dashboards").select("student_id, content"),
    sb.from("student_task_checks").select("student_id, task_key, done"),
  ]);

  // Misiones: total en su página de Notion y cuántas están hechas (Notion o web)
  const missions = new Map();
  for (const d of dashes || []) {
    const tasks = (d.content?.rows || []).flatMap((r) => r.cols.flat()).flatMap((sec) => sec.items || []).filter((i) => i.t === "task");
    const webDone = new Set((checks || []).filter((c) => c.student_id === d.student_id && c.done).map((c) => c.task_key));
    missions.set(d.student_id, { total: tasks.length, done: tasks.filter((t) => t.done || webDone.has(t.id)).length });
  }
  if (error) throw error;
  if (sErr) throw sErr;

  const byStudent = new Map();
  for (const s of sessions || []) {
    const cur = byStudent.get(s.student_id) || { count: 0, last: null };
    cur.count++;
    if (!cur.last || (s.number ?? 0) > (cur.last.number ?? 0)) cur.last = s;
    byStudent.set(s.student_id, cur);
  }

  return (students || []).map((st) => {
    const m = Array.isArray(st.memberships) ? st.memberships[0] : st.memberships;
    return {
      ...st,
      membership: m || null,
      sessions: byStudent.get(st.id) || { count: 0, last: null },
      tracks: (tracks || []).filter((t) => t.student_id === st.id),
      missions: missions.get(st.id) || { total: 0, done: 0 },
    };
  });
}

export async function adminUpdateStudent(id, patch) {
  const allowed = {};
  if ("email" in patch) allowed.email = patch.email;
  if ("status" in patch) allowed.status = patch.status;
  const { error } = await ensure().from("students").update(allowed).eq("id", id);
  if (error) throw error;
}

export async function adminSetMembership(studentId, { status, current_period_end }) {
  const { error } = await ensure()
    .from("memberships")
    .update({ status, current_period_end })
    .eq("student_id", studentId);
  if (error) throw error;
}

// PINs: se escriben por RPC (la base los guarda cifrados); nunca se leen de vuelta
const PIN_ERRORS = {
  pin_format: "El PIN tiene que tener 6 números.",
  pin_weak: "PIN demasiado obvio (repetido o consecutivo). Elegí otro.",
  pin_in_use: "Ese PIN ya lo tiene otra persona. Elegí otro.",
  student_needs_email: "Primero cargá el email del alumno.",
  forbidden: "Tu cuenta no tiene permisos de admin.",
};
async function pinRpc(fn, args) {
  const { error } = await ensure().rpc(fn, args);
  if (error) throw new Error(PIN_ERRORS[error.message] || error.message);
}
export const adminSetStudentPin = (studentId, pin) =>
  pinRpc("admin_set_student_pin", { p_student_id: studentId, p_pin: pin });
export const adminClearStudentPin = (studentId) =>
  pinRpc("admin_clear_student_pin", { p_student_id: studentId });
export const adminSetMyPin = (pin) => pinRpc("admin_set_my_pin", { p_pin: pin });

export async function adminPinOverview() {
  const { data, error } = await ensure().rpc("admin_pin_overview");
  if (error) throw error;
  return data;
}

export async function adminLastSync() {
  const { data } = await ensure()
    .from("sync_runs")
    .select("started_at, finished_at, ok, stats, error, trigger")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function adminRunSync({ force = false } = {}) {
  const sb = ensure();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("no_session");
  const url = `${window.MP_SUPABASE.url}/functions/v1/notion-sync`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.skipped || `http_${res.status}`);
  return body;
}

// ── Vista previa: la página de un alumno tal como la ve él ──
export async function adminStudentPortal(studentId) {
  const { data, error } = await ensure().rpc("admin_student_portal", { p_student_id: studentId });
  if (error) throw error;
  return {
    isAdmin: true,
    student: data?.student || null,
    sessions: data?.sessions || [],
    dashboard: data?.dashboard?.rows?.length ? data.dashboard : null,
    tracks: data?.tracks || [],
    checks: new Map(Object.entries(data?.checks || {})),
    material: data?.material || [],
  };
}

// ── Shop (admin) ─────────────────────────────────────────
export async function adminListProducts() {
  const { data, error } = await ensure()
    .from("products")
    .select("id, slug, name, kind, price_usd, unit, max_qty, active, sort")
    .order("sort");
  if (error) throw error;
  return data || [];
}

export async function adminUpdateProduct(id, { price_usd, active }) {
  const { error } = await ensure()
    .from("products")
    .update({ price_usd, active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("No se pudo guardar el producto.");
}

export async function adminListOrders() {
  const { data, error } = await ensure()
    .from("orders")
    .select("id, product_name, kind, buyer_name, buyer_email, source, price_usd, fx_mep, amount_ars, status, init_point, created_at, paid_at, expires_at, note")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

// Link de pago con precio especial (lo crea el servidor; el precio público no cambia)
const CHECKOUT_ERRORS = {
  payments_not_configured: "MercadoPago todavía no está conectado (falta MP_ACCESS_TOKEN en Supabase).",
  student_needs_email: "Ese alumno no tiene email cargado.",
  invalid_price: "Revisá el precio.",
  invalid_quantity: "Revisá la cantidad.",
  fx_unavailable: "No pude obtener el dólar MEP ahora. Probá en un minuto.",
  mp_failed: "MercadoPago rechazó la creación del link. Revisá las credenciales.",
  unauthorized: "Tu sesión no tiene permisos de admin.",
};
export async function adminCreatePaymentLink({ product_id, student_id, price_usd, quantity = 1, note, name, email }) {
  const { data: { session } } = await ensure().auth.getSession();
  if (!session) throw new Error("Iniciá sesión de nuevo.");
  const res = await fetch(`${window.MP_SUPABASE.url}/functions/v1/mp-checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "admin_link", product_id, student_id: student_id || null, price_usd, quantity, note, name, email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(CHECKOUT_ERRORS[body.error] || "No se pudo generar el link.");
  return body;
}
