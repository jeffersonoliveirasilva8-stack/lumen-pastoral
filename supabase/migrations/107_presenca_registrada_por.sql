-- Migration 107: Rastreio de quem registrou presenças + limpeza de escalas canceladas
--
-- MUDANÇAS:
--   1. Colunas presenca_registrada_por / presenca_registrada_em em escala_membros
--   2. salvar_presencas_escala: seta as colunas acima; permite secretários (lider)
--      que estejam escalados na escala; adiciona 'ausente' como status válido
--   3. DELETE em historico_participacoes para escalas canceladas
--   4. Recalcula scores
--
-- IDEMPOTENTE: sim

-- ── 1. Colunas de rastreio ────────────────────────────────────────────────

ALTER TABLE public.escala_membros
  ADD COLUMN IF NOT EXISTS presenca_registrada_por UUID REFERENCES public.membros(id),
  ADD COLUMN IF NOT EXISTS presenca_registrada_em  TIMESTAMPTZ;

-- ── 2. RPC salvar_presencas_escala atualizada ─────────────────────────────

CREATE OR REPLACE FUNCTION public.salvar_presencas_escala(
  p_escala_id UUID,
  p_updates   JSONB   -- [{"id": "<escala_membro_id>", "status": "<status>"}]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id UUID;
  v_caller_membro UUID;
  v_item JSONB;
  v_status TEXT;
  v_id UUID;
  STATUS_VALIDOS CONSTANT TEXT[] :=
    ARRAY['presente','faltou','atrasado','justificou','ausente','pendente'];
BEGIN
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  v_caller_membro := public._portal_membro_id();

  -- Permite: admin da paróquia, coordenador ativo, OU membro secretário (lider)
  -- que esteja escalado nesta escala
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
    OR EXISTS (
      SELECT 1 FROM public.escala_membros
      WHERE escala_id = p_escala_id
        AND membro_id = v_caller_membro
        AND (ativo IS NULL OR ativo = true)
    )
  ) THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores, coordenadores e membros escalados podem registrar presenças';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_id     := (v_item->>'id')::UUID;
    v_status := v_item->>'status';

    IF v_status IS NULL OR NOT (v_status = ANY(STATUS_VALIDOS)) THEN
      RAISE EXCEPTION 'Status inválido: %', v_status;
    END IF;

    UPDATE public.escala_membros
    SET    status                 = v_status,
           presenca_registrada_por = v_caller_membro,
           presenca_registrada_em  = NOW()
    WHERE  id        = v_id
      AND  escala_id = p_escala_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) FROM anon;

-- ── 3. Limpeza: historico_participacoes de escalas canceladas ─────────────
-- Escalas canceladas não devem ter pontos registrados

DELETE FROM public.historico_participacoes hp
WHERE EXISTS (
  SELECT 1 FROM public.escalas e
  WHERE  e.id     = hp.escala_id
    AND  e.status = 'cancelada'
);

-- ── 4. Recalcula scores ───────────────────────────────────────────────────

UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;

NOTIFY pgrst, 'reload schema';
