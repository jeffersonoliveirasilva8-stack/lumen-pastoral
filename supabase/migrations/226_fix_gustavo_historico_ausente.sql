-- Migration 226 — Correção pontual: historico_participacoes ausente para Gustavo Calado 23/10
--
-- Causa raiz identificada: o status do registro em escala_membros foi definido como
-- 'presente' diretamente via INSERT (não via UPDATE). O trigger on_escala_membro_status_final
-- é AFTER UPDATE OF status — não dispara em INSERTs. Por isso nenhum historico foi gerado.
--
-- Critério de segurança:
--   - Aplica apenas ao em_id específico confirmado pela auditoria.
--   - Idempotente: ON CONFLICT DO UPDATE restaura registro anulado se existir; não duplica.
--   - Não altera escala_membros — apenas insere/restaura o historico faltante.
--   - Verifica em_status = 'presente' e ativo = true antes de agir.
--   - Calcula pontos via _get_pontos_status quando auto_pontuar=true (espelha trigger 214).

DO $$
DECLARE
  v_em_id        CONSTANT UUID := 'c91d5fd1-f2bc-418c-8894-2bd118f4e44f';
  v_membro_id    UUID;
  v_escala_id    UUID;
  v_ministerio_id UUID;
  v_paroquia_id  UUID;
  v_data         DATE;
  v_em_status    TEXT;
  v_ativo        BOOLEAN;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_tipo_evento  TEXT;
  v_hp_count     INT;
  v_auto_pontuar BOOLEAN;
  v_pontos       INTEGER;
BEGIN
  -- Carrega o registro de escala_membros
  SELECT em.membro_id, em.escala_id, em.ministerio_id, em.status, em.ativo,
         e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_membro_id, v_escala_id, v_ministerio_id, v_em_status, v_ativo,
         v_paroquia_id, v_data, v_solene, v_tem_bispo
  FROM   public.escala_membros em
  JOIN   public.escalas e ON e.id = em.escala_id
  WHERE  em.id = v_em_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'Migration 226: escala_membros % não encontrado — nenhuma ação.', v_em_id;
    RETURN;
  END IF;

  -- Guarda apenas se status=presente e ativo=true
  IF v_em_status <> 'presente' OR NOT v_ativo THEN
    RAISE NOTICE 'Migration 226: registro % tem status=% ativo=% — condição não atendida, nenhuma ação.',
      v_em_id, v_em_status, v_ativo;
    RETURN;
  END IF;

  -- Verifica se já existe historico não-anulado (nenhuma ação necessária)
  SELECT COUNT(*) INTO v_hp_count
  FROM   public.historico_participacoes
  WHERE  membro_id     = v_membro_id
    AND  escala_id     = v_escala_id
    AND  ministerio_id = v_ministerio_id
    AND  (anulada IS NULL OR anulada = false);

  IF v_hp_count > 0 THEN
    RAISE NOTICE 'Migration 226: historico ativo já existe para membro % escala % — nenhuma ação.', v_membro_id, v_escala_id;
    RETURN;
  END IF;

  -- Calcula pontos espelhando o trigger _trigger_pontuar_participacao (migration 214)
  SELECT COALESCE(pce.auto_pontuar, false)
  INTO   v_auto_pontuar
  FROM   public.paroquia_config_escalas pce
  WHERE  pce.paroquia_id = v_paroquia_id;

  IF v_auto_pontuar THEN
    v_pontos := public._get_pontos_status(v_paroquia_id, 'presente', v_solene, v_tem_bispo);
  ELSE
    v_pontos := 0;
  END IF;

  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  -- ON CONFLICT DO UPDATE: restaura registro anulado se existir, ou insere novo.
  -- Espelha o comportamento do trigger (migration 214:63-75).
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, v_membro_id, v_escala_id, v_ministerio_id,
     v_tipo_evento, 'escala', 'presente', v_data, v_pontos)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala','solene','bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE
    SET presenca    = EXCLUDED.presenca,
        tipo_evento = EXCLUDED.tipo_evento,
        pontos      = EXCLUDED.pontos,
        anulada     = false;

  RAISE NOTICE 'Migration 226: historico inserido/restaurado para Gustavo Calado — membro % escala % data % pontos %.', v_membro_id, v_escala_id, v_data, v_pontos;
END;
$$;
