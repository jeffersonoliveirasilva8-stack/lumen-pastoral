-- Migration 190 — salvar_presencas_escala: validar status da escala
--
-- PROBLEMA (P6): a RPC não verificava se a escala estava publicada antes de registrar
-- presenças. Um chamador com permissão poderia registrar presenças em rascunhos ou
-- escalas canceladas via API direta, contornando o filtro da interface (sacristia).
--
-- SOLUÇÃO: adicionar validação `escalas.status = 'publicada'` logo após a verificação
-- de existência da escala, antes de qualquer escrita em escala_membros.
-- Preserva todas as permissões e o isolamento por paróquia existentes.
--
-- Outros caminhos investigados:
--   - marcar_presenca_evento (migration 038): escreve em presencas_eventos/historico
--     para eventos de agenda, não escala_membros — fora do escopo.
--   - Triggers de pontuação: disparam em UPDATE de escala_membros.status, não escrevem
--     status finais diretamente — sem gap.
--   Conclusão: salvar_presencas_escala é o único ponto de entrada para status finais
--   em escala_membros; a correção aqui fecha o gap completamente.

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
  v_paroquia_id    UUID;
  v_escala_status  TEXT;
  v_caller_membro  UUID;
  v_item           JSONB;
  v_status         TEXT;
  v_id             UUID;
  STATUS_VALIDOS CONSTANT TEXT[] :=
    ARRAY['presente','faltou','atrasado','justificou','ausente','pendente'];
BEGIN
  SELECT paroquia_id, status INTO v_paroquia_id, v_escala_status
  FROM public.escalas WHERE id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  -- Apenas escalas publicadas aceitam registro de presença
  IF v_escala_status != 'publicada' THEN
    RAISE EXCEPTION
      'Escala não está publicada (status: %). Apenas escalas publicadas aceitam registro de presença.',
      v_escala_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_caller_membro := public._portal_membro_id();

  -- Permite: admin, coordenador ativo (tabela coordenadores),
  -- vice/coord/admin via tipo_acesso em membros, OU membro escalado nesta escala
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
    OR EXISTS (
      SELECT 1 FROM public.membros
      WHERE id          = v_caller_membro
        AND paroquia_id = v_paroquia_id
        AND ativo       = true
        AND tipo_acesso IN ('vice', 'coordenador', 'administrador')
    )
    OR EXISTS (
      SELECT 1 FROM public.escala_membros
      WHERE escala_id = p_escala_id
        AND membro_id = v_caller_membro
        AND (ativo IS NULL OR ativo = true)
    )
  ) THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores, coordenadores e membros escalados podem registrar presenças . (P0001)';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_id     := (v_item->>'id')::UUID;
    v_status := v_item->>'status';

    IF v_status IS NULL OR NOT (v_status = ANY(STATUS_VALIDOS)) THEN
      RAISE EXCEPTION 'Status inválido: %', v_status;
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
GRANT EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) FROM anon;

NOTIFY pgrst, 'reload schema';
