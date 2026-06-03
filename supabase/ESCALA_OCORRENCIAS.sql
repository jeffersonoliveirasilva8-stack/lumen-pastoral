-- ============================================================
-- ESCALA_OCORRENCIAS — Execute INTEIRO no SQL Editor
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASSO 1 — Criar a tabela
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.escala_ocorrencias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id       uuid NOT NULL REFERENCES public.escalas(id) ON DELETE CASCADE,
  membro_id       uuid REFERENCES public.membros(id) ON DELETE SET NULL,   -- membro sobre quem é a ocorrência (opcional)
  registrado_por  uuid NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,  -- coordenador que registrou
  tipo            text NOT NULL,        -- atraso | ausencia | comportamento | troca_funcao | problema_liturgico | observacao_pastoral
  descricao       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS escala_ocorrencias_escala_id_idx   ON public.escala_ocorrencias (escala_id);
CREATE INDEX IF NOT EXISTS escala_ocorrencias_membro_id_idx   ON public.escala_ocorrencias (membro_id);
CREATE INDEX IF NOT EXISTS escala_ocorrencias_registrado_idx  ON public.escala_ocorrencias (registrado_por);

-- ════════════════════════════════════════════════════════════
-- PASSO 2 — Grants (após criar a tabela)
-- ════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.escala_ocorrencias TO authenticated;
GRANT ALL ON public.escala_ocorrencias TO service_role;

-- ════════════════════════════════════════════════════════════
-- PASSO 3 — Habilitar RLS
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.escala_ocorrencias ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════
-- PASSO 4 — Políticas RLS
-- (usa as funções SECURITY DEFINER já existentes)
-- ════════════════════════════════════════════════════════════

-- Admins da paróquia lêem todas as ocorrências de suas escalas
DROP POLICY IF EXISTS "ocorrencia_admin_read"   ON public.escala_ocorrencias;
CREATE POLICY "ocorrencia_admin_read" ON public.escala_ocorrencias
  FOR SELECT TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- Admins da paróquia podem inserir/editar/remover
DROP POLICY IF EXISTS "ocorrencia_admin_write"  ON public.escala_ocorrencias;
CREATE POLICY "ocorrencia_admin_write" ON public.escala_ocorrencias
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- Coordenadores podem inserir ocorrências nas escalas onde estão escalados
-- (registrado_por deve ser o próprio membro logado)
DROP POLICY IF EXISTS "ocorrencia_coord_insert" ON public.escala_ocorrencias;
CREATE POLICY "ocorrencia_coord_insert" ON public.escala_ocorrencias
  FOR INSERT TO authenticated
  WITH CHECK (
    registrado_por = _portal_membro_id()
    AND _portal_is_coord(_portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = escala_ocorrencias.escala_id
        AND em.membro_id = _portal_membro_id()
    )
  );

-- Coordenadores lêem ocorrências das escalas em que estão escalados
DROP POLICY IF EXISTS "ocorrencia_coord_read"   ON public.escala_ocorrencias;
CREATE POLICY "ocorrencia_coord_read" ON public.escala_ocorrencias
  FOR SELECT TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = escala_ocorrencias.escala_id
        AND em.membro_id = _portal_membro_id()
    )
  );

-- ════════════════════════════════════════════════════════════
-- PASSO 5 — Recarregar schema
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- PASSO 6 — Validação
-- ════════════════════════════════════════════════════════════

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'escala_ocorrencias'
ORDER BY ordinal_position;
