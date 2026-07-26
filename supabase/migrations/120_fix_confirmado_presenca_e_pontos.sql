-- Migration 120 — Corrige status 'confirmado' na sacristia
--
-- Problemas:
--  1. salvar_presencas_escala rejeitava 'confirmado' como status inválido,
--     causando falha silenciosa do batch inteiro quando qualquer membro
--     havia confirmado presença pelo portal.
--  2. 30 membros em escalas passadas ficaram com status='confirmado' sem
--     registro em historico_participacoes e sem pontos.
--
-- Correções:
--  A. RPC salvar_presencas_escala: aceita 'confirmado', converte para
--     'presente' na escrita (confirmação = presença física confirmada).
--  B. Retroativo: 30 linhas com status='confirmado' em escalas passadas →
--     atualiza para 'presente', cria historico_participacoes e recalcula
--     o score de cada membro afetado.


-- ══════════════════════════════════════════════════════════════════════
-- A. Corrige RPC salvar_presencas_escala
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.salvar_presencas_escala(
  p_escala_id UUID,
  p_updates   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_paroquia_id   UUID;
  v_caller_membro UUID;
  v_item          JSONB;
  v_status        TEXT;
  v_id            UUID;
  -- 'confirmado' é aceito e convertido internamente para 'presente'
  STATUS_VALIDOS CONSTANT TEXT[] :=
    ARRAY['presente','faltou','atrasado','justificou','ausente','pendente','confirmado'];
BEGIN
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  v_caller_membro := public._portal_membro_id();

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

    -- 'confirmado' enviado pelo front (membro confirmou mas secretário não alterou)
    -- é tratado como presença física confirmada
    IF v_status = 'confirmado' THEN
      v_status := 'presente';
    END IF;

    UPDATE public.escala_membros
    SET    status                  = v_status,
           presenca_registrada_por = v_caller_membro,
           presenca_registrada_em  = NOW()
    WHERE  id        = v_id
      AND  escala_id = p_escala_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- B. Retroativo: converte 'confirmado' → 'presente' em escalas passadas
--    e cria historico_participacoes + atualiza scores
-- ══════════════════════════════════════════════════════════════════════

-- B1. Atualiza status de 'confirmado' para 'presente' nas linhas elegíveis.
--     O trigger on_escala_membro_status_final disparará para cada linha
--     e criará automaticamente o registro em historico_participacoes.
UPDATE public.escala_membros em
SET    status                  = 'presente',
       presenca_registrada_em  = NOW()
FROM   public.escalas e
WHERE  em.escala_id   = e.id
  AND  em.status      = 'confirmado'
  AND  e.data         < CURRENT_DATE
  AND  e.status       IN ('publicada', 'arquivada')
  AND  (em.ativo IS NULL OR em.ativo = true)
  AND  NOT EXISTS (
         SELECT 1
         FROM   public.historico_participacoes hp
         WHERE  hp.membro_id    = em.membro_id
           AND  hp.escala_id    = em.escala_id
           AND  hp.ministerio_id = em.ministerio_id
       );

-- B2. Garante que historico_participacoes existe para todos os 'presente'
--     que possam ter ficado sem registro (por qualquer motivo histórico).
INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos)
SELECT
  e.paroquia_id,
  em.membro_id,
  em.escala_id,
  em.ministerio_id,
  CASE WHEN COALESCE(e.tem_bispo,false) THEN 'bispo'
       WHEN COALESCE(e.solene,   false) THEN 'solene'
       ELSE 'escala'
  END,
  'escala',
  em.status,
  e.data,
  public._get_pontos_status(
    e.paroquia_id,
    em.status,
    COALESCE(e.solene,   false),
    COALESCE(e.tem_bispo,false)
  )
FROM public.escala_membros em
JOIN public.escalas e ON e.id = em.escala_id
WHERE em.status IN ('presente','faltou','atrasado','justificou','ausente')
  AND e.data    <  CURRENT_DATE
  AND e.status  IN ('publicada','arquivada')
  AND (em.ativo IS NULL OR em.ativo = true)
ON CONFLICT (membro_id, escala_id, ministerio_id)
  WHERE tipo_evento IN ('escala','solene','bispo')
    AND escala_id    IS NOT NULL
    AND ministerio_id IS NOT NULL
DO NOTHING;

-- B3. Recalcula score de todos os membros que possam ter sido afetados.
UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true
  AND  EXISTS (
         SELECT 1
         FROM   public.historico_participacoes hp
         JOIN   public.escalas e ON e.id = hp.escala_id
         WHERE  hp.membro_id = m.id
           AND  e.data       < CURRENT_DATE
       );

NOTIFY pgrst, 'reload schema';
