-- ============================================================
-- Archivos subidos a Notion (ejecutables, zips, PDFs, audios…)
-- Su URL firmada vence en 1 h, así que la web guarda el id del bloque y la
-- Edge Function notion-file pide un link fresco al abrirlo.
-- Esta función decide si ese archivo se puede entregar: tiene que estar en la
-- página o en las sesiones del alumno (p_student_id) — o de cualquiera si es admin (null).
-- ============================================================
create or replace function public.notion_file_allowed(p_block_id text, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_block_id ~ '^[0-9a-f-]{32,36}$' and (
    exists (
      select 1 from public.student_dashboards d
      where (p_student_id is null or d.student_id = p_student_id)
        and jsonb_path_exists(
          d.content,
          '$.rows[*].cols[*][*].items[*] ? (@.t == "file" && @.id == $k)',
          jsonb_build_object('k', p_block_id))
    )
    or exists (
      select 1 from public.sessions s
      where (p_student_id is null or s.student_id = p_student_id)
        and s.in_notion
        and s.links @> jsonb_build_array(jsonb_build_object('url', 'notion-file:' || p_block_id))
    )
  );
$$;
revoke all on function public.notion_file_allowed(text, uuid) from public, anon, authenticated;
grant execute on function public.notion_file_allowed(text, uuid) to service_role;
