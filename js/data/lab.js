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
export async function getMyStudent(userId) {
  const { data, error } = await ensure()
    .from("students")
    .select("id, full_name, status, memberships(status, current_period_end)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const m = Array.isArray(data.memberships) ? data.memberships[0] : data.memberships;
  return { ...data, membership: m || null };
}

export function membershipIsActive(m) {
  if (!m || m.status !== "active") return false;
  return !m.current_period_end || new Date(m.current_period_end) > new Date();
}

export async function getMySessions(studentId) {
  const { data, error } = await ensure()
    .from("sessions")
    .select("id, number, title, session_date, notes, tasks, links")
    .eq("student_id", studentId)
    .eq("in_notion", true)
    .order("number", { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Admin ───────────────────────────────────────────────
export async function adminListStudents() {
  const sb = ensure();
  const [{ data: students, error }, { data: sessions, error: sErr }] = await Promise.all([
    sb.from("students")
      .select("id, full_name, email, user_id, status, memberships(status, current_period_end)")
      .order("full_name"),
    sb.from("sessions").select("student_id, number, session_date").eq("in_notion", true),
  ]);
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
    return { ...st, membership: m || null, sessions: byStudent.get(st.id) || { count: 0, last: null } };
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
