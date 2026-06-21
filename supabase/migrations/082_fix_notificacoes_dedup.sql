-- Migration 082 — Correções de dedup e ruído no sistema de notificações
--
-- Problemas corrigidos:
--   1. Dupla notificação de coordenação ao recusar escala:
--      portal_recusar_escala enviava notif inline (apenas_admin=true)
--      e o trigger on_substituicao_insert enviava outra (apenas_coordenacao=true)
--      para o mesmo evento.  Fix: remove a notif inline; trigger cuida de tudo.
--
--   2. enviar_alerta_confirmacao sem dedup:
--      coordenador podia clicar várias vezes e criar múltiplos alertas
--      urgentes para o mesmo membro/escala.
--      Fix: verifica notif existente nas últimas 24 h antes de inserir.
--
--   3. on_indisponibilidade trigger sem dedup:
--      submissão duplicada (reenvio de formulário) gerava 2 notif para
--      o coordenador pelo mesmo membro no mesmo dia.
--      Fix: verifica notif existente nas últimas 12 h antes de inserir.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 041, 064, 067 aplicadas

-- ══════════════════════════════════════════════════════════════
-- 1. portal_recusar_escala — remove duplicata da notif de coord
--    A notif de coord já é criada pelo trigger on_substituicao_insert.
--    Mantém APENAS as notificações aos membros elegíveis (loop).
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_membro_id     UUID;
  v_paroquia_id   UUID;
  v_escala_id     UUID;
  v_escala_data   DATE;
  v_subst_id      UUID;
  v_escala_titulo TEXT;
  v_membro_nome   TEXT;
  v_ministerio_id UUID;
  v_min_nome      TEXT;
  v_elegivel      RECORD;
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

  SELECT em.escala_id, e.paroquia_id, e.data, e.titulo, em.ministerio_id
    INTO v_escala_id, v_paroquia_id, v_escala_data, v_escala_titulo, v_ministerio_id
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

  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = trim(p_motivo)
  WHERE id = p_escala_membro_id;

  -- Cria substituição (trigger on_substituicao_insert cuida da notif de coord)
  IF NOT EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    INSERT INTO public.substituicoes
      (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
    VALUES
      (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id,
       COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'), 'solicitada')
    RETURNING id INTO v_subst_id;
  END IF;

  -- REMOVIDO: notificação inline de coord (duplicava o trigger on_substituicao_insert)
  -- O trigger já envia: "Substituição solicitada — DD/MM" com apenas_coordenacao=true

  SELECT nome INTO v_min_nome FROM public.ministerios WHERE id = v_ministerio_id;

  -- Notifica in-app membros elegíveis para se voluntariar
  IF v_subst_id IS NOT NULL AND v_ministerio_id IS NOT NULL THEN
    FOR v_elegivel IN
      SELECT mm.membro_id
      FROM public.membro_ministerios mm
      JOIN public.membros m ON m.id = mm.membro_id
      WHERE mm.ministerio_id = v_ministerio_id
        AND m.paroquia_id    = v_paroquia_id
        AND m.ativo          = true
        AND mm.membro_id    <> v_membro_id
        AND NOT EXISTS (
          SELECT 1 FROM public.escala_membros em2
          WHERE em2.escala_id     = v_escala_id
            AND em2.membro_id     = mm.membro_id
            AND em2.ministerio_id = v_ministerio_id
            AND em2.status NOT IN ('recusado', 'faltou')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.escala_membros em3
          JOIN public.escalas e2 ON e2.id = em3.escala_id
          WHERE em3.membro_id  = mm.membro_id
            AND e2.data        = v_escala_data
            AND e2.paroquia_id = v_paroquia_id
            AND em3.status IN ('pendente', 'confirmado', 'presente')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.indisponibilidades i
          WHERE i.membro_id = mm.membro_id
            AND i.data      = v_escala_data
            AND i.cancelada = false
        )
    LOOP
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
      VALUES (
        v_paroquia_id,
        'Vaga disponível: ' || coalesce(v_min_nome, 'Ministério'),
        format('Uma vaga em %s ficou disponível na escala "%s". Candidate-se no portal!',
          coalesce(v_min_nome, 'Ministério'), v_escala_titulo),
        'escala', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
      );
    END LOOP;

    BEGIN
      PERFORM net.http_post(
        url     := current_setting('app.supabase_url', true) || '/functions/v1/notificar-substituicao',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key', true)
        ),
        body    := jsonb_build_object('substituicao_id', v_subst_id)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. enviar_alerta_confirmacao — dedup 24 h
--    Antes de inserir, verifica se já existe notificação urgente
--    para este membro nesta escala nas últimas 24 horas.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enviar_alerta_confirmacao(
  p_escala_membro_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id         UUID := auth.uid();
  v_paroquia_id     UUID;
  v_membro_id       UUID;
  v_membro_nome     TEXT;
  v_membro_email    TEXT;
  v_escala_id       UUID;
  v_escala_titulo   TEXT;
  v_escala_data     DATE;
  v_ministerio_nome TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT
    e.paroquia_id, em.membro_id, m.nome, m.email,
    em.escala_id, e.titulo, e.data, min.nome
  INTO v_paroquia_id, v_membro_id, v_membro_nome, v_membro_email,
       v_escala_id, v_escala_titulo, v_escala_data, v_ministerio_nome
  FROM public.escala_membros em
  JOIN public.escalas     e   ON e.id   = em.escala_id
  JOIN public.membros     m   ON m.id   = em.membro_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.id = p_escala_membro_id AND em.status = 'pendente';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_auth_id AND paroquia_id = v_paroquia_id
        AND role IN ('super_admin', 'admin_paroquial', 'coordenador', 'lider')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  -- Dedup: não envia se já foi enviado alerta para este membro/escala nas últimas 24 h
  IF EXISTS (
    SELECT 1 FROM public.notificacoes
    WHERE destinatario_id = v_membro_id
      AND tipo            = 'urgente'
      AND titulo          ILIKE 'Confirmação pendente%'
      AND link_referencia = '/portal-membro/escalas'
      AND created_at      > now() - INTERVAL '24 hours'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'alerta_ja_enviado_recentemente');
  END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES (
    v_paroquia_id, v_membro_id,
    'Confirmação pendente — escala se aproxima',
    format('Você ainda não confirmou sua participação na escala "%s" de %s como %s. Por favor, confirme ou recuse o mais breve possível.',
      v_escala_titulo,
      to_char(v_escala_data, 'DD/MM/YYYY'),
      v_ministerio_nome),
    'urgente', false, false, '/portal-membro/escalas'
  );

  RETURN jsonb_build_object(
    'success', true,
    'membro_id', v_membro_id,
    'membro_email', v_membro_email,
    'escala_titulo', v_escala_titulo,
    'escala_data', v_escala_data,
    'ministerio_nome', v_ministerio_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enviar_alerta_confirmacao(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. _trigger_indisponibilidade — dedup 12 h
--    Evita notificação duplicada se o mesmo membro registrar
--    indisponibilidade para a mesma data mais de uma vez em 12 h.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_indisponibilidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_membro_nome text;
  v_periodo     text;
  v_data_label  text;
BEGIN
  SELECT nome INTO v_membro_nome FROM public.membros WHERE id = NEW.membro_id;

  -- Dedup: pula se já foi notificado para este membro/data nas últimas 12 h
  IF EXISTS (
    SELECT 1 FROM public.notificacoes
    WHERE paroquia_id        = NEW.paroquia_id
      AND titulo             ILIKE 'Indisponibilidade: ' || COALESCE(v_membro_nome, '%')
      AND apenas_coordenacao = true
      AND created_at         > now() - INTERVAL '12 hours'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo = 'periodo' AND NEW.hora_inicio IS NOT NULL THEN
    v_periodo := format(
      ' das %s às %s',
      to_char(NEW.hora_inicio, 'HH24:MI'),
      COALESCE(to_char(NEW.hora_fim, 'HH24:MI'), '?')
    );
  ELSE
    v_periodo := '';
  END IF;

  IF NEW.tipo = 'intervalo' AND NEW.data_fim IS NOT NULL THEN
    v_data_label := format(
      '%s a %s',
      to_char(NEW.data::date, 'DD/MM/YYYY'),
      to_char(NEW.data_fim, 'DD/MM/YYYY')
    );
  ELSE
    v_data_label := to_char(NEW.data::date, 'DD/MM/YYYY');
  END IF;

  PERFORM public._notify_coordenacao(
    NEW.paroquia_id,
    'Indisponibilidade: ' || COALESCE(v_membro_nome, 'Membro'),
    format(
      '%s registrou indisponibilidade para %s%s. Motivo: %s',
      COALESCE(v_membro_nome, 'Membro'),
      v_data_label,
      v_periodo,
      COALESCE(NEW.motivo, 'não informado')
    ),
    'alerta',
    NULL
  );

  RETURN NEW;
END;
$$;

-- Trigger já existe (migration 041) — DROP + CREATE garante versão limpa
DROP TRIGGER IF EXISTS on_indisponibilidade ON public.indisponibilidades;
CREATE TRIGGER on_indisponibilidade
  AFTER INSERT ON public.indisponibilidades
  FOR EACH ROW EXECUTE FUNCTION public._trigger_indisponibilidade();

-- ══════════════════════════════════════════════════════════════
-- 4. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
