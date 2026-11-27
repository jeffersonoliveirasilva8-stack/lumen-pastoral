-- Migration 243 — Corrige tipo inválido na notificação de vaga de substituição
--
-- Erro: new row for relation "notificacoes" violates check constraint
--       "notificacoes_tipo_check"
-- Causa: a migration 238 reescreveu portal_recusar_escala e, ao avisar os
--   membros elegíveis sobre a vaga aberta (recusa de missa comum), inseria
--   notificacoes com tipo = 'info'. A constraint (PATCH_EVOLUCAO_V2.sql) só
--   aceita 'aviso', 'alerta', 'urgente' ou 'sistema', então a recusa inteira
--   falhava.
-- Segundo erro (achado ao testar em produção): o mesmo INSERT usava a coluna
--   membro_id, que não existe em notificacoes. A coluna do destinatário é
--   destinatario_id (FK membros.id), como em coord_liberar_vaga_substituicao.
-- Correção: mesma função da 238, trocando 'info' por 'aviso' e membro_id por
--   destinatario_id no aviso de vaga aos membros elegíveis.
-- Idempotente (CREATE OR REPLACE, mesma assinatura).

CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_membro_id          UUID;
  v_paroquia_id        UUID;
  v_escala_id          UUID;
  v_escala_data        DATE;
  v_escala_hora        TIME;
  v_subst_id           UUID;
  v_escala_titulo      TEXT;
  v_membro_nome        TEXT;
  v_ministerio_id      UUID;
  v_min_nome           TEXT;
  v_solene             BOOLEAN;
  v_elegivel           RECORD;
  v_token              UUID;
  v_horas_antes        INTEGER;
  v_escala_datetime    TIMESTAMPTZ;
  v_horas_restantes    NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  SELECT m.id, m.nome INTO v_membro_id, v_membro_nome
  FROM public.membros m
  WHERE (m.auth_user_id = auth.uid()
         OR lower(trim(coalesce(m.email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  SELECT em.escala_id, e.paroquia_id, e.data, e.hora_inicio, e.titulo, em.ministerio_id,
         COALESCE(e.solene, false)
    INTO v_escala_id, v_paroquia_id, v_escala_data, v_escala_hora,
         v_escala_titulo, v_ministerio_id, v_solene
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id AND em.membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_escala_data < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_passada');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- ── Verificar prazo mínimo ───────────────────────────────────────────────
  -- Busca configuração da paróquia (padrão: 48h)
  SELECT COALESCE(pce.substituicao_horas_antes, 48)
  INTO v_horas_antes
  FROM public.paroquia_config_escalas pce
  WHERE pce.paroquia_id = v_paroquia_id;

  IF v_horas_antes IS NULL THEN
    v_horas_antes := 48;
  END IF;

  -- Calcula datetime da escala (usa hora se disponível, senão meia-noite)
  v_escala_datetime := (v_escala_data::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
                       + COALESCE(v_escala_hora, '00:00:00'::TIME);

  v_horas_restantes := EXTRACT(EPOCH FROM (v_escala_datetime - clock_timestamp())) / 3600.0;

  IF v_horas_restantes <= v_horas_antes THEN
    RETURN jsonb_build_object(
      'success',          false,
      'error',            'prazo_recusa_expirado',
      'horas_antes',      v_horas_antes,
      'horas_restantes',  ROUND(v_horas_restantes::NUMERIC, 1)
    );
  END IF;

  -- ── Registrar recusa ─────────────────────────────────────────────────────
  UPDATE public.escala_membros
  SET status      = 'recusado',
      justificativa = trim(p_motivo),
      recusado_em = clock_timestamp()
  WHERE id = p_escala_membro_id;

  -- Abre substituição (se ainda não existe)
  IF NOT EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    INSERT INTO public.substituicoes
      (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status, aberta_para_membros)
    VALUES
      (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id,
       COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'),
       'solicitada',
       NOT v_solene)
    RETURNING id INTO v_subst_id;
  ELSE
    SELECT id INTO v_subst_id
    FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
    LIMIT 1;
  END IF;

  -- Notificação in-app para coordenação
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES (
    v_paroquia_id,
    CASE WHEN v_solene
      THEN 'Recusa em solenidade — substituição aguardando coordenação'
      ELSE 'Recusa de escala — substituição aberta'
    END,
    format('%s recusou a escala "%s". Motivo: %s.%s',
      v_membro_nome, v_escala_titulo, trim(p_motivo),
      CASE WHEN v_solene
        THEN ' Esta é uma solenidade — a vaga aguarda liberação pela coordenação.'
        ELSE ' Uma vaga foi aberta para substituição.'
      END),
    'alerta', false, true, '/substituicoes'
  );

  SELECT nome INTO v_min_nome FROM public.ministerios WHERE id = v_ministerio_id;

  -- Para missas COMUNS: notifica membros elegíveis imediatamente
  -- Para SOLENIDADES: coordenação decide quando liberar
  IF NOT v_solene AND v_subst_id IS NOT NULL AND v_ministerio_id IS NOT NULL THEN
    FOR v_elegivel IN
      SELECT mm.membro_id
      FROM public.membro_ministerios mm
      JOIN public.membros m ON m.id = mm.membro_id
      WHERE mm.ministerio_id = v_ministerio_id
        AND m.paroquia_id    = v_paroquia_id
        AND m.ativo          = true
        AND m.id             != v_membro_id
    LOOP
      -- Gera token único por membro elegível
      v_token := gen_random_uuid();

      -- Notificação in-app
      INSERT INTO public.notificacoes
        (paroquia_id, destinatario_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
      VALUES (
        v_paroquia_id, v_elegivel.membro_id,
        'Vaga aberta para substituição',
        format('Uma vaga abriu em "%s" (ministério %s). Você tem interesse em servir?',
               v_escala_titulo, COALESCE(v_min_nome, 'desconhecido')),
        'aviso', false, false,
        format('/substituicoes/%s?token=%s', v_subst_id, v_token)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'substituicao_id', v_subst_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;
