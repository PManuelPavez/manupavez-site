-- ============================================================
-- FREQUENCY LAB — Setup de tablas para clinicas.html
-- Ejecutar en el SQL Editor de Supabase (en orden)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABLA: planes
-- Formatos disponibles (mentorías, packs, acceso continuo…)
-- Lectura pública, escritura solo desde el dashboard.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo      TEXT        NOT NULL,
  descripcion TEXT,
  lead        TEXT,                          -- frase corta debajo del título
  badge       TEXT,                          -- etiqueta tipo "Mentoría 1:1"
  precio      TEXT,                          -- "$40 USD" (texto libre para flexibilidad)
  periodo     TEXT,                          -- "/ mes", "/ sesión", etc.
  features    JSONB       DEFAULT '[]',      -- array de strings: ["Sesión semanal…", "Notion…"]
  cupos_totales  INT      DEFAULT 0,
  cupos_activos  INT      DEFAULT 0,
  status      TEXT        NOT NULL DEFAULT 'disponible'
                          CHECK (status IN ('disponible', 'proximamente', 'cerrado')),
  cta_texto   TEXT        DEFAULT 'Aplicar al Lab →',
  cta_link    TEXT        DEFAULT '#reservar',
  is_featured BOOLEAN     DEFAULT FALSE,     -- tarjeta destacada (más grande)
  orden       INT         DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  planes IS 'Planes / formatos del Frequency Lab (lectura pública)';
COMMENT ON COLUMN planes.features IS 'Array JSON de strings, ej: ["Sesión semanal de 1h", "Espacio en Notion"]';
COMMENT ON COLUMN planes.status IS 'disponible | proximamente | cerrado';

-- ────────────────────────────────────────────────────────────
-- 2. TABLA: material_alumnos
-- Contenido exclusivo para alumnos logueados.
-- Solo lectura para usuarios autenticados.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS material_alumnos (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo           TEXT        NOT NULL,
  descripcion      TEXT,
  tipo_contenido   TEXT        NOT NULL DEFAULT 'link'
                               CHECK (tipo_contenido IN ('video', 'link', 'texto', 'pdf', 'audio')),
  url_contenido    TEXT,                -- URL del recurso (video embed, link externo, etc.)
  contenido_texto  TEXT,                -- para tipo_contenido = 'texto' (contenido inline)
  fecha_publicacion DATE       DEFAULT CURRENT_DATE,
  orden            INT         DEFAULT 0,
  visible          BOOLEAN     DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  material_alumnos IS 'Material exclusivo del Lab — solo usuarios autenticados';
COMMENT ON COLUMN material_alumnos.tipo_contenido IS 'video | link | texto | pdf | audio';

-- ────────────────────────────────────────────────────────────
-- 3. RLS — Row Level Security
-- ────────────────────────────────────────────────────────────

-- Activar RLS en ambas tablas
ALTER TABLE planes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_alumnos ENABLE ROW LEVEL SECURITY;

-- planes: SELECT público (anon + authenticated)
CREATE POLICY "planes_select_public"
  ON planes
  FOR SELECT
  USING (true);

-- material_alumnos: SELECT solo para usuarios autenticados
CREATE POLICY "material_select_authenticated"
  ON material_alumnos
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 4. DATOS INICIALES
-- El 1:1 Mensual es estático en el HTML; su fila solo controla el precio.
-- "Acceso continuo" es dinámico: cambiá status a 'cerrado' para apagarlo.
-- ────────────────────────────────────────────────────────────

INSERT INTO planes (titulo, descripcion, lead, badge, precio, periodo, features, cupos_totales, cupos_activos, status, cta_texto, cta_link, is_featured, orden)
VALUES
(
  '1:1 Mensual',
  NULL,
  NULL,
  NULL,
  '$40 USD',
  '/ mes',
  '[]',
  0, 0,
  'disponible',
  NULL, NULL,
  FALSE,
  0
),
(
  'Acceso continuo',
  'Guías, packs y un formato de acceso continuo para quienes quieren probar la metodología antes del 1:1. Si querés ser el primero en saber, completá el formulario.',
  NULL,
  'Próximamente',
  NULL,
  NULL,
  '[]',
  0, 0,
  'proximamente',
  'Avisarme',
  '#reservar',
  FALSE,
  2
);

INSERT INTO material_alumnos (titulo, descripcion, tipo_contenido, url_contenido, orden)
VALUES
(
  'Sesión 1 — Criterio vs. Gusto',
  'Primera sesión del lab: qué es tomar una decisión con criterio y por qué no es lo mismo que "lo que te gusta".',
  'video',
  'https://www.youtube.com/embed/dQw4w9WgXcQ',
  1
),
(
  'Guía: Estructura de un track desde cero',
  'Documento con el framework que usamos en el lab para arrancar un proyecto sin quedarte trabado.',
  'link',
  'https://notion.so/ejemplo-guia',
  2
);
