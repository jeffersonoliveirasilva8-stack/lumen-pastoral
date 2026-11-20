-- Migration 238 — Prazo mínimo para recusa de escala
--
-- 1. Adiciona recusado_em em escala_membros (timestamp preciso da recusa)
-- 2. Reescreve portal_recusar_escala:
--    - Registra recusado_em = now()
--    - Bloqueia recusa quando faltam <= substituicao_horas_antes horas para a escala
--    - Retorna horas_restantes para feedback ao usuário
-- 3. Atualiza portal_get_escalas_membro para retornar recusado_em e prazo_recusa_expirado

-- ── 1. Coluna recusado_em ─────────────────────────────────────────────────────

ALTER TABLE public.escala_membros
  ADD COLUMN IF NOT EXISTS recusado_em TIMESTAMPTZ;

-- ── 2. portal_recusar_escala (com bloqueio por prazo) ────────────────────────

DROP FUNCTION IF EXISTS public.portal_recusar_escala(UUID, TEXT);

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
        (paroquia_id, membro_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
      VALUES (
        v_paroquia_id, v_elegivel.membro_id,
        'Vaga aberta para substituição',
        format('Uma vaga abriu em "%s" (ministério %s). Você tem interesse em servir?',
               v_escala_titulo, COALESCE(v_min_nome, 'desconhecido')),
        'info', false, false,
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

-- ── 3. portal_membro_get_escalas_publicadas: adiciona recusado_em + prazo ────
-- Reescreve para incluir recusado_em, prazo_recusa_horas e prazo_recusa_expirado
-- em cada escala_membro, para que o frontend possa:
--   - Mostrar quando o membro recusou
--   - Bloquear o botão de recusa quando prazo_recusa_expirado = true

CREATE OR REPLACE FUNCTION public.portal_membro_get_escalas_publicadas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_horas_antes INTEGER;
  v_result      JSONB;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), ''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Prazo mínimo para recusa (padrão: 48h)
  SELECT COALESCE(pce.substituicao_horas_antes, 48)
  INTO v_horas_antes
  FROM public.paroquia_config_escalas pce
  WHERE pce.paroquia_id = v_paroquia_id;

  IF v_horas_antes IS NULL THEN v_horas_antes := 48; END IF;

  SELECT COALESCE(jsonb_agg(esc ORDER BY esc->>'data', esc->>'hora_inicio'), '[]'::JSONB)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',           e.id,
      'titulo',       e.titulo,
      'data',         e.data,
      'hora_inicio',  e.hora_inicio,
      'hora_fim',     e.hora_fim,
      'local',        e.local,
      'solene',       e.solene,
      'tem_adoracao', e.tem_adoracao,
      'observacoes',  e.observacoes,
      'escala_membros', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',                   em.id,
          'status',               em.status,
          'justificativa',        em.justificativa,
          'recusado_em',          em.recusado_em,
          'prazo_recusa_horas',   v_horas_antes,
          'prazo_recusa_expirado',
            (
              EXTRACT(EPOCH FROM (
                (e2.data::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
                + COALESCE(e2.hora_inicio, '00:00:00'::TIME)
                - clock_timestamp()
              )) / 3600.0
            ) <= v_horas_antes,
          'membro_id',            em.membro_id,
          'ministerio_id',        em.ministerio_id,
          'membros',              jsonb_build_object('nome', m.nome),
          'ministerios',          jsonb_build_object(
                                    'nome',      mn.nome,
                                    'cor',       mn.cor,
                                    'categoria', mn.categoria
                                  )
        ))
        FROM public.escala_membros em
        JOIN public.membros m       ON m.id  = em.membro_id
        JOIN public.ministerios mn  ON mn.id = em.ministerio_id
        JOIN public.escalas e2      ON e2.id = em.escala_id
        WHERE em.escala_id = e.id
          AND em.ativo = true
      ), '[]'::JSONB)
    ) AS esc
    FROM public.escalas e
    WHERE e.paroquia_id = v_paroquia_id
      AND e.status = 'publicada'
    ORDER BY e.data ASC, e.hora_inicio ASC NULLS FIRST
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_membro_get_escalas_publicadas() TO authenticated;

NOTIFY pgrst, 'reload schema';
