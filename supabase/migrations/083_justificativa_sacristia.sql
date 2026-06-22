-- Migration 083 — Suporte a justificativa no registro de presenças da sacristia
--
-- Permite que o coordenador informe o motivo ao marcar "justificou" em sacristia.
-- A coluna justificativa já existe em escala_membros (usada por portal_recusar_escala).
-- Esta migration atualiza salvar_presencas_escala para aceitar e persistir o campo
-- justificativa quando presente no JSONB de updates.
--
-- JSONB format: [{"id": "<uuid>", "status": "<status>", "justificativa": "<texto>"}]
-- O campo justificativa é opcional: se ausente ou null, mantém o valor atual.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migration 047 aplicada

CREATE OR REPLACE FUNCTION public.salvar_presencas_escala(
  p_escala_id UUID,
  p_updates   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id    UUID;
  v_caller_membro  UUID;
  v_item           JSONB;
  v_status         TEXT;
  v_id             UUID;
  v_justificativa  TEXT;
  STATUS_VALIDOS   CONSTANT TEXT[] := ARRAY['presente','faltou','atrasado','justificou','pendente'];
BEGIN
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas
  WHERE id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  v_caller_membro := public._portal_membro_id();

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
  ) THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores e coordenadores podem registrar presenças';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_id            := (v_item->>'id')::UUID;
    v_status        := v_item->>'status';
    v_justificativa := v_item->>'justificativa';   -- NULL quando omitido no payload

    IF v_status IS NULL OR NOT (v_status = ANY(STATUS_VALIDOS)) THEN
      RAISE EXCEPTION 'Status inválido: %', v_status;
    END IF;

    UPDATE public.escala_membros
    SET
      status        = v_status,
      justificativa = CASE
        WHEN v_justificativa IS NOT NULL THEN v_justificativa
        ELSE justificativa   -- preserva valor existente quando não enviado
      END
    WHERE id        = v_id
      AND escala_id = p_escala_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) FROM anon;

COMMENT ON FUNCTION public.salvar_presencas_escala(UUID, JSONB)
  IS 'Registra presença dos membros de uma escala. Aceita justificativa opcional para status=justificou. Requer role admin ou coordenador ativo.';

NOTIFY pgrst, 'reload schema';
