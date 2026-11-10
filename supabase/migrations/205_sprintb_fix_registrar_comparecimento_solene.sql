-- Migration 205 — Sprint B Fix: registrar_comparecimento_solene
--
-- Correções aplicadas:
-- 1. Autorização corrigida:
--    - auxiliar (Secretário) autorizado a registrar presença/paramentação
--    - administrador somente se escalado na celebração (escala_membros)
--    - removida cláusula que permitia qualquer membro escalado registrar
-- 2. Validação completa do JSON antes do loop:
--    - não-nulo, array, não-vazio
--    - cada item: membro_id presente, UUID válido, status válido, paramentado booleano
--    - sem membro_id duplicado
-- 3. Loop atômico:
--    - paramentado=NULL forçado para ausente/justificou
--    - rejeita membro não convocado (IF NOT FOUND → RAISE EXCEPTION)
--    - sincroniza escala_membros.status + presenca_registrada_por/em
--    - toda a transação é revertida se qualquer registro falhar

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

  -- Validação do JSON
  IF p_registros IS NULL THEN
    RAISE EXCEPTION 'p_registros não pode ser nulo' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_registros) != 'array' THEN
    RAISE EXCEPTION 'p_registros deve ser um array JSON' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_registros) = 0 THEN
    RAISE EXCEPTION 'p_registros não pode ser vazio' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Valida cada item (pré-loop)
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

  -- Verifica duplicatas no JSON
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

  IF v_status_escala != 'publicada' THEN
    RAISE EXCEPTION 'Escala não está publicada (status: %)', v_status_escala
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_caller_membro := public._portal_membro_id();

  -- Autorização: coord/admin/vice/auxiliar; administrador somente se escalado
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
    RAISE EXCEPTION 'Permissão negada: apenas coordenadores, secretários e administradores escalados podem registrar presenças em convocações gerais';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_registros)
  LOOP
    v_membro_id := (v_item->>'membro_id')::UUID;
    v_status    := v_item->>'status';

    -- paramentado=NULL para ausentes e justificativas
    v_paramentado := CASE
      WHEN v_status = 'presente'
           AND v_item ? 'paramentado'
           AND (v_item->>'paramentado') IS NOT NULL
      THEN (v_item->>'paramentado')::BOOLEAN
      ELSE NULL
    END;

    -- Atualiza convocação geral
    UPDATE public.escala_convocacoes
    SET status                  = v_status,
        paramentado             = v_paramentado,
        presenca_registrada_por = v_auth_id,
        presenca_registrada_em  = now()
    WHERE escala_id = p_escala_id
      AND membro_id = v_membro_id;

    -- Rejeita membro não convocado (reverte toda a transação)
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membro % não convocado para esta celebração', v_membro_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- Sincroniza escala_membros para membros com função
    -- (0 rows é aceitável: membro pode ser apenas convocado, sem função)
    UPDATE public.escala_membros
    SET status                  = CASE v_status
                                    WHEN 'ausente'    THEN 'ausente'
                                    WHEN 'justificou' THEN 'justificou'
                                    ELSE 'presente'
                                  END,
        paramentado              = v_paramentado,
        presenca_registrada_por  = v_caller_membro,
        presenca_registrada_em   = now()
    WHERE escala_id = p_escala_id
      AND membro_id = v_membro_id
      AND (ativo IS NULL OR ativo = true);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) TO authenticated;
