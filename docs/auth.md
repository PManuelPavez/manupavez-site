# Área de alumnos — Login con magic link

El login del Frequency Lab usa **Supabase Auth** con magic link (sin contraseñas).
Todo corre en el navegador; no hay servidor que mantener.

## Configuración (una sola vez, en el dashboard de Supabase)

1. **Authentication → Providers → Email**: activá **Email** y la opción
   **"Confirm email" / magic link** (login con link).
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://manupavez.com`
   - **Redirect URLs**: agregá
     `https://manupavez.com/clinicas.html`
     y para pruebas locales `http://localhost:8765/clinicas.html`.
3. **Authentication → Email Templates → Magic Link**: opcional, personalizá el texto.

Con eso el flujo ya funciona: el alumno entra a `clinicas.html`, escribe su email,
recibe el link y al abrirlo desde el mismo dispositivo queda logueado.

## Contenido privado de alumnos (cuando lo tengas)

Hoy el área logueada muestra un placeholder (`[data-alumnos-content]`).
Para servir material real, creá una tabla en Supabase y protegela con RLS, p. ej.:

```sql
create table lab_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text,
  created_at timestamptz default now()
);

alter table lab_resources enable row level security;

-- Solo usuarios autenticados pueden leer
create policy "alumnos pueden leer recursos"
  on lab_resources for select
  to authenticated
  using (true);
```

Después se renderiza desde `js/features/auth.js` (en el bloque logueado) leyendo
`supabase.from("lab_resources").select("*")`.

## Admin (fase futura)

Para un panel de leads, se puede usar el mismo login + una columna `role`/tabla
`admins` y políticas RLS que sólo dejen ver `lab_leads`/`booking_leads` a esos uid.
