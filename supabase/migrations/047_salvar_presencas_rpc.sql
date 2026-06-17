-- migration 047 — RPC salvar_presencas_escala
-- Problema: o direct UPDATE em escala_membros falha silenciosamente para
-- escalas arquivadas (policy escala_membros_membro_update exige status='publicada')
-- e para auxiliares tentando atualizar presença de outros membros.
-- Solução: RPC SECURITY DEFINER que permite admin/coord salvar presença
-- em escalas de qualquer status, com verificação explícita de permissão.

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
  STATUS_VALIDOS CONSTANT TEXT[] := ARRAY['presente','faltou','atrasado','justificou','pendente'];
BEGIN
  -- 1. Verifica que a escala existe e pertence a uma paróquia
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas
  WHERE id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  -- 2. Verifica permissão: admin da paróquia OU coordenador ativo
  v_caller_membro := public._portal_membro_id();

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
  ) THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores e coordenadores podem registrar presenças';
  END IF;

  -- 3. Aplica cada atualização
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_id     := (v_item->>'id')::UUID;
    v_status := v_item->>'status';

    -- Valida o status para evitar injection de valores inválidos
    IF v_status IS NULL OR NOT (v_status = ANY(STATUS_VALIDOS)) THEN
      RAISE EXCEPTION 'Status inválido: %', v_status;
    END IF;

    UPDATE public.escala_membros
    SET    status = v_status
    WHERE  id        = v_id
      AND  escala_id = p_escala_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) FROM anon;

COMMENT ON FUNCTION public.salvar_presencas_escala(UUID, JSONB)
  IS 'Registra presença dos membros de uma escala. Requer role admin ou coordenador ativo.';
