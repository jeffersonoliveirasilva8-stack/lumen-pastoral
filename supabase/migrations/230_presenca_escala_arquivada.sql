-- Migration 230 — Permitir registro de presença em escalas arquivadas
--
-- PROBLEMA: salvar_presencas_escala e registrar_comparecimento_solene bloqueiam
-- qualquer escala com status != 'publicada'. Escalas arquivadas (data passada,
-- processo de arquivamento concluído) também precisam aceitar registro retroativo
-- de presenças — o secretário pode não ter conseguido registrar a tempo.
--
-- SOLUÇÃO: ampliar a guarda de status para aceitar 'publicada' OU 'arquivada'.
-- Escalas 'rascunho', 'cancelada' e demais continuam bloqueadas.
-- Nenhuma outra validação é alterada (autorização, integridade, pontuação).
--
-- RPCs afetadas:
--   1. salvar_presencas_escala          (migration 190)
--   2. registrar_comparecimento_solene  (migration 205)
--
-- Impacto no banco: nenhum (sem ALTER TABLE, sem novos dados).
-- Escalas arquivadas permanecem arquivadas — a RPC não altera o status da escala.

-- ── 1. salvar_presencas_escala ────────────────────────────────────────────────

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

  -- Aceita 'publicada' (fluxo normal) e 'arquivada' (registro retroativo).
  -- Rascunho, cancelada e outros status continuam bloqueados.
  IF v_escala_status NOT IN ('publicada', 'arquivada') THEN
    RAISE EXCEPTION
      'Escala não pode receber registro de presença (status: %). Apenas escalas publicadas ou arquivadas são aceitas.',
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

-- ── 2. registrar_comparecimento_solene ────────────────────────────────────────
-- Mesma regra: aceita 'publicada' e 'arquivada'.
-- Toda a lógica de validação JSON, deduplicação, autorização e loop permanece
-- idêntica à migration 205 — única linha alterada é a guarda de status (linha ~106).

CREATE OR REPLACE FUNCTION public.registrar_comparecimento_solene(
  p_escala_id UUID,
  p_registros JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id        UUID := auth.uid();
  v_caller_membro  UUID;
  v_paroquia_id    UUID;
  v_solene         BOOLEAN;
  v_conv_geral     BOOLEAN;
  v_status_escala  TEXT;
  v_item           JSONB;
  v_item_check     JSONB;
  v_membro_id      UUID;
  v_uuid_check     UUID;
  v_status         TEXT;
  v_par_check      TEXT;
  v_paramentado    BOOLEAN;
  v_status_valido  CONSTANT TEXT[] := ARRAY['presente','ausente','justificou'];
BEGIN
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_registros IS NULL THEN
    RAISE EXCEPTION 'p_registros não pode ser nulo' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_registros) != 'array' THEN
    RAISE EXCEPTION 'p_registros deve ser um array JSON' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_registros) = 0 THEN
    RAISE EXCEPTION 'p_registros não pode ser vazio' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_item_check IN SELECT * FROM jsonb_array_elements(p_registros)
  LOOP
    IF NOT (v_item_check ? 'membro_id') OR (v_item_check->>'membro_id') IS NULL THEN
      RAISE EXCEPTION 'Item sem membro_id: %', v_item_check
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    BEGIN
      v_uuid_check := (v_item_check->>'membro_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'membro_id inválido (não é UUID): %', v_item_check->>'membro_id'
        USING ERRCODE = 'invalid_parameter_value';
    END;
    IF (v_item_check->>'status') IS NULL
       OR NOT ((v_item_check->>'status') = ANY(v_status_valido)) THEN
      RAISE EXCEPTION 'Status inválido ou ausente: % (membro %)',
        v_item_check->>'status', v_item_check->>'membro_id'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_item_check ? 'paramentado' AND (v_item_check->>'paramentado') IS NOT NULL THEN
      v_par_check := lower(v_item_check->>'paramentado');
      IF v_par_check NOT IN ('true','false') THEN
        RAISE EXCEPTION 'paramentado deve ser boolean (true/false): % (membro %)',
          v_item_check->>'paramentado', v_item_check->>'membro_id'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;
  END LOOP;

  IF (SELECT count(*) != count(DISTINCT (item->>'membro_id')::UUID)
      FROM jsonb_array_elements(p_registros) AS item) THEN
    RAISE EXCEPTION 'p_registros contém membro_id duplicado'
      USING ERRCODE = 'invalid_parameter_value';
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

  -- Aceita 'publicada' (fluxo normal) e 'arquivada' (registro retroativo).
  IF v_status_escala NOT IN ('publicada', 'arquivada') THEN
    RAISE EXCEPTION 'Escala não pode receber registro de presença (status: %)', v_status_escala
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
        AND tipo_acesso IN ('auxiliar','vice','coordenador')
    )
    OR EXISTS (
      SELECT 1 FROM public.membros m
      JOIN   public.escala_membros em ON em.membro_id = m.id
      WHERE  m.id          = v_caller_membro
        AND  m.paroquia_id = v_paroquia_id
        AND  m.ativo       = true
        AND  m.tipo_acesso = 'administrador'
        AND  em.escala_id  = p_escala_id
        AND  (em.ativo IS NULL OR em.ativo = true)
    )
  ) THEN
    RAISE EXCEPTION 'Permissão negada (P0001)';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_registros)
  LOOP
    v_membro_id   := (v_item->>'membro_id')::UUID;
    v_status      := v_item->>'status';
    v_paramentado := CASE
      WHEN v_status IN ('ausente','justificou') THEN NULL
      WHEN (v_item->>'paramentado') IS NOT NULL THEN (v_item->>'paramentado')::BOOLEAN
      ELSE NULL
    END;

    UPDATE public.escala_membros em
    SET    status                  = v_status,
           paramentado             = v_paramentado,
           presenca_registrada_por = v_caller_membro,
           presenca_registrada_em  = NOW()
    WHERE  em.escala_id  = p_escala_id
      AND  em.membro_id  = v_membro_id
      AND  (em.ativo IS NULL OR em.ativo = true);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membro % não está convocado nesta escala', v_membro_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) FROM anon;

NOTIFY pgrst, 'reload schema';
