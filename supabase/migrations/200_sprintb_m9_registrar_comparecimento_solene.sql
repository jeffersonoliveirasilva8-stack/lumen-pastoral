-- Migration 200 — Sprint B M9
-- RPC registrar_comparecimento_solene(p_escala_id, p_registros)
--
-- Registra presença e paramentação para membros de Missas Solenes com
-- convocação geral. Atualiza atomicamente escala_convocacoes e escala_membros
-- (para membros que possuem função específica), garantindo consistência
-- entre as duas tabelas.
--
-- p_registros: [{ membro_id, status, paramentado? }]
--   status: 'presente' | 'ausente' | 'justificou'
--   paramentado: boolean | null (apenas para status='presente')
--
-- O trigger on_escala_convocacao_status_final (M6) alimenta o histórico
-- automaticamente após cada UPDATE em escala_convocacoes.

CREATE OR REPLACE FUNCTION public.registrar_comparecimento_solene(
  p_escala_id UUID,
  p_registros JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id       UUID := auth.uid();
  v_caller_membro UUID;
  v_paroquia_id   UUID;
  v_solene        BOOLEAN;
  v_conv_geral    BOOLEAN;
  v_status_escala TEXT;
  v_item          JSONB;
  v_membro_id     UUID;
  v_status        TEXT;
  v_paramentado   BOOLEAN;
  v_status_valido CONSTANT TEXT[] := ARRAY['presente','ausente','justificou'];
BEGIN
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT e.paroquia_id, e.solene, e.tem_convocacao_geral, e.status
  INTO   v_paroquia_id, v_solene, v_conv_geral, v_status_escala
  FROM   public.escalas e
  WHERE  e.id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  IF NOT v_solene OR NOT v_conv_geral THEN
    RAISE EXCEPTION 'Apenas escalas solenes com convocação geral usam esta RPC';
  END IF;

  IF v_status_escala != 'publicada' THEN
    RAISE EXCEPTION 'Escala não está publicada (status: %)', v_status_escala
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
    OR EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = p_escala_id
        AND em.membro_id = v_caller_membro
        AND (em.ativo IS NULL OR em.ativo = true)
    )
  ) THEN
    RAISE EXCEPTION 'Permissão negada: apenas coordenadores e secretários autorizados podem registrar presenças em convocações gerais';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_registros)
  LOOP
    v_membro_id   := (v_item->>'membro_id')::UUID;
    v_status      := v_item->>'status';
    v_paramentado := CASE
      WHEN v_item ? 'paramentado' AND v_item->>'paramentado' IS NOT NULL
      THEN (v_item->>'paramentado')::BOOLEAN
      ELSE NULL
    END;

    IF v_status IS NULL OR NOT (v_status = ANY(v_status_valido)) THEN
      RAISE EXCEPTION 'Status inválido: % (membro %)', v_status, v_membro_id;
    END IF;

    -- Atualiza convocação geral
    UPDATE public.escala_convocacoes
    SET status                  = v_status,
        paramentado             = v_paramentado,
        presenca_registrada_por = v_auth_id,
        presenca_registrada_em  = now()
    WHERE escala_id = p_escala_id
      AND membro_id = v_membro_id;

    -- Espelha paramentado em escala_membros para membros com função
    IF v_paramentado IS NOT NULL THEN
      UPDATE public.escala_membros
      SET paramentado = v_paramentado
      WHERE escala_id = p_escala_id
        AND membro_id = v_membro_id
        AND (ativo IS NULL OR ativo = true);
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) FROM anon;
