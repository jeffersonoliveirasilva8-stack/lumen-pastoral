-- Migration 199 — Sprint B M8
-- RPC convocar_pastoral_solene(p_escala_id, p_ministerio_ids)
--
-- Insere todos os membros ativos dos ministérios selecionados em
-- escala_convocacoes. Inclui membros com função específica (D5 confirmado).
-- Usa pg_advisory_xact_lock para serializar execuções concorrentes.
-- Seta escalas.tem_convocacao_geral = true na primeira execução.

CREATE OR REPLACE FUNCTION public.convocar_pastoral_solene(
  p_escala_id      UUID,
  p_ministerio_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id       UUID := auth.uid();
  v_caller_membro UUID;
  v_paroquia_id   UUID;
  v_solene        BOOLEAN;
  v_status_escala TEXT;
  v_inseridos     INTEGER := 0;
  v_ignorados     INTEGER := 0;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Serializa execuções concorrentes para a mesma escala
  PERFORM pg_advisory_xact_lock(hashtext(p_escala_id::text || '_convocar'));

  SELECT e.paroquia_id, e.solene, e.status
  INTO   v_paroquia_id, v_solene, v_status_escala
  FROM   public.escalas e
  WHERE  e.id = p_escala_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_nao_encontrada');
  END IF;

  IF NOT v_solene THEN
    RETURN jsonb_build_object('success', false, 'error', 'apenas_missas_solenes');
  END IF;

  IF v_status_escala NOT IN ('rascunho','publicada') THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_nao_editavel',
                              'status', v_status_escala);
  END IF;

  -- Verifica permissão: admin, coordenador ou secretário autorizado da paróquia
  v_caller_membro := public._portal_membro_id();

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
    OR EXISTS (
      SELECT 1 FROM public.membros
      WHERE id          = v_caller_membro
        AND paroquia_id = v_paroquia_id
        AND ativo       = true
        AND tipo_acesso IN ('vice','coordenador','administrador')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Insere todos os membros ativos dos ministérios selecionados
  WITH membros_a_convocar AS (
    SELECT DISTINCT m.id AS membro_id
    FROM   public.membros m
    JOIN   public.membro_ministerios mm ON mm.membro_id = m.id
    WHERE  m.paroquia_id    = v_paroquia_id
      AND  m.ativo          = true
      AND  mm.ministerio_id = ANY(p_ministerio_ids)
      AND  mm.ativo         = true
  ),
  resultado AS (
    INSERT INTO public.escala_convocacoes
      (escala_id, membro_id, paroquia_id, convocado_por)
    SELECT p_escala_id, mac.membro_id, v_paroquia_id, v_auth_id
    FROM   membros_a_convocar mac
    ON CONFLICT (escala_id, membro_id) DO NOTHING
    RETURNING membro_id
  )
  SELECT COUNT(*) INTO v_inseridos FROM resultado;

  -- Conta membros que já estavam (ignorados pelo ON CONFLICT)
  SELECT COUNT(DISTINCT mm.membro_id) - v_inseridos INTO v_ignorados
  FROM   public.membro_ministerios mm
  JOIN   public.membros m ON m.id = mm.membro_id
  WHERE  mm.ministerio_id = ANY(p_ministerio_ids)
    AND  mm.ativo         = true
    AND  m.paroquia_id    = v_paroquia_id
    AND  m.ativo          = true;

  IF v_ignorados < 0 THEN v_ignorados := 0; END IF;

  -- Marca a escala como tendo convocação geral ativa
  UPDATE public.escalas
  SET tem_convocacao_geral = true
  WHERE id = p_escala_id;

  RETURN jsonb_build_object(
    'success',    true,
    'inseridos',  v_inseridos,
    'ignorados',  v_ignorados,
    'total',      v_inseridos + v_ignorados
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) FROM anon;
