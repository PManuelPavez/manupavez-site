-- ============================================================
-- FREQUENCY LAB — get_my_portal(): todo el espacio del alumno en UN pedido.
-- Cada pedido a Supabase cuesta ~0,6 s de red; el portal hacía 2 tandas.
-- SECURITY INVOKER: corre con los permisos del alumno, así que las mismas
-- reglas RLS de cada tabla siguen decidiendo qué ve (revocado → vacío).
-- ============================================================

create or replace function public.get_my_portal()
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  s record;
begin
  select st.id, st.full_name, st.status, m.status as m_status, m.current_period_end
  into s
  from public.students st
  left join public.memberships m on m.student_id = st.id
  where st.user_id = (select auth.uid())
  limit 1;

  return json_build_object(
    'is_admin', public.is_admin(),
    'student', case when s.id is null then null else json_build_object(
      'id', s.id,
      'full_name', s.full_name,
      'status', s.status,
      'membership', json_build_object('status', s.m_status, 'current_period_end', s.current_period_end)
    ) end,
    'sessions', coalesce((
      select json_agg(x order by x.number desc nulls last)
      from (select id, number, title, session_date, notes, tasks, links
            from public.sessions where student_id = s.id and in_notion) x), '[]'::json),
    'dashboard', (select content from public.student_dashboards where student_id = s.id),
    'tracks', coalesce((
      select json_agg(t order by t.created_at desc)
      from (select id, title, url, created_at from public.student_tracks where student_id = s.id) t), '[]'::json),
    'checks', coalesce((
      select json_object_agg(task_key, done) from public.student_task_checks where student_id = s.id), '{}'::json),
    'material', coalesce((
      select json_agg(mm order by mm.orden)
      from (select titulo, descripcion, tipo_contenido, url_contenido, contenido_texto, orden
            from public.material_alumnos where visible) mm), '[]'::json)
  );
end;
$$;

revoke all on function public.get_my_portal() from public, anon;
grant execute on function public.get_my_portal() to authenticated;
