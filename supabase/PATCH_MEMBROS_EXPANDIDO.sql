-- ============================================================
-- PATCH_MEMBROS_EXPANDIDO.sql
-- 1. Corrige recursão infinita em auth_member_paroquia_id()
-- 2. Adiciona colunas: família, logística, disponibilidade
-- 3. Bucket de fotos no Supabase Storage
-- Execute no SQL Editor: https://supabase.com/dashboard/project/hbbkdebuhueqjyrdeyyc/sql/new
-- ============================================================

-- ── 1. FIX: auth_member_paroquia_id() sem recursão ───────────────────
-- DROP + CREATE (não CREATE OR REPLACE) para garantir substituição,
-- pois alguns projetos Supabase bloqueiam REPLACE mas permitem drop+create.
-- A versão anterior consultava membros dentro de uma policy de membros,
-- causando "infinite recursion detected in policy for relation membros"
-- em qualquer SELECT/INSERT-RETURNING. Agora usa profiles, que é populado
-- por portal_link_auth_user() e não tem policy recursiva.
DROP FUNCTION IF EXISTS auth_member_paroquia_id();

CREATE FUNCTION auth_member_paroquia_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT paroquia_id FROM profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION auth_member_paroquia_id TO authenticated;

-- Recria a policy que causava recursão, usando subquery direta em vez da função
-- (evita qualquer problema residual se a função ainda não estiver registrada)
DROP POLICY IF EXISTS "member_portal_select_parish_membros" ON membros;
CREATE POLICY "member_portal_select_parish_membros" ON membros
  FOR SELECT
  USING (
    paroquia_id = (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

-- ── 2. Novos campos em membros ────────────────────────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS nome_pais           TEXT,
  ADD COLUMN IF NOT EXISTS contato_pais        TEXT,
  ADD COLUMN IF NOT EXISTS restricoes_horario  TEXT,
  ADD COLUMN IF NOT EXISTS deslocamento        TEXT,
  ADD COLUMN IF NOT EXISTS comunidade_id       UUID REFERENCES comunidades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prioridade_id       UUID,
  ADD COLUMN IF NOT EXISTS tipo_acesso         TEXT NOT NULL DEFAULT 'membro',
  ADD COLUMN IF NOT EXISTS planilha_url        TEXT;

-- ── 3. Storage: bucket de fotos dos membros ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'membros',
  'membros',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage
DROP POLICY IF EXISTS "membros_fotos_insert" ON storage.objects;
CREATE POLICY "membros_fotos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'membros'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "membros_fotos_select" ON storage.objects;
CREATE POLICY "membros_fotos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'membros');

DROP POLICY IF EXISTS "membros_fotos_update" ON storage.objects;
CREATE POLICY "membros_fotos_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'membros'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "membros_fotos_delete" ON storage.objects;
CREATE POLICY "membros_fotos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'membros'
    AND auth.role() = 'authenticated'
  );

-- ── 5. FIX recursão membros_leitura_publica ──────────────────────────
-- Chain: membros_leitura_publica → EXISTS em escala_membros
--        → member_portal_select_escala_membros → IN (SELECT FROM membros)
-- Fix: adiciona guard auth.uid() IS NULL para curto-circuitar em usuários autenticados
DROP POLICY IF EXISTS "membros_leitura_publica" ON membros;
CREATE POLICY "membros_leitura_publica" ON membros
  FOR SELECT USING (
    auth.uid() IS NULL
    AND ativo = true
    AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

-- ── Validação ─────────────────────────────────────────────────────────
SELECT 'OK — função auth_member_paroquia_id reescrita sem recursão' AS status
UNION ALL
SELECT 'OK — coluna ' || column_name || ' adicionada em membros' FROM information_schema.columns
WHERE table_name = 'membros'
  AND column_name IN ('nome_pais','contato_pais','restricoes_horario','deslocamento','comunidade_id','planilha_url')
UNION ALL
SELECT 'OK — bucket membros criado' FROM storage.buckets WHERE id = 'membros';
