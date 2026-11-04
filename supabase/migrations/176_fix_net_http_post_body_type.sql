-- migration 176: corrige tipo do parâmetro body nas chamadas net.http_post
--
-- Problema: migrations 173 e 174 passam body := v_payload::text, mas
--   net.http_post espera body jsonb — não existe overload para body text.
--   PostgreSQL não converte implicitamente text→jsonb em parâmetros nomeados,
--   resultando em: "function net.http_post(url=>text, headers=>jsonb, body=>text)
--   does not exist" ao publicar escalas ou enviar aviso pastoral.
--
-- Correção: remover o ::text das 4 ocorrências (3 em 173, 1 em 174).
-- Todas as outras migrations já passam body como jsonb diretamente.

-- ── _trg_fn_whatsapp_escala_completa_membros ─────────────────────────────────

CREATE OR REPLACE FUNCTION _trg_fn_whatsapp_escala_completa_membros()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_escala        record;
  v_paroquia_nome text;
  v_wa_secret     text;
  v_url           text;
  v_membro        record;
  v_payload       jsonb;
  v_link          text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.ativo IS NOT TRUE OR OLD.ativo IS NOT FALSE) THEN
    IF NOT (OLD.ativo IS FALSE AND NEW.ativo IS NOT FALSE) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT e.id, e.titulo, e.data, e.hora_inicio, e.local, e.paroquia_id, e.status
  INTO   v_escala
  FROM   escalas e
  WHERE  e.id     = NEW.escala_id
    AND  e.status = 'publicada';

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NOT _escala_esta_completa(NEW.escala_id) THEN RETURN NEW; END IF;

  SELECT nome INTO v_paroquia_nome FROM paroquias WHERE id = v_escala.paroquia_id;

  SELECT val INTO v_wa_secret FROM _push_config WHERE key = 'internal_wa_secret';
  IF v_wa_secret IS NULL THEN RETURN NEW; END IF;

  v_url  := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_link := 'https://lumenpastoral.com.br/portal-membro/escalas';

  FOR v_membro IN
    SELECT
      m.id          AS membro_id,
      m.nome        AS nome_membro,
      min2.nome     AS ministerio_nome
    FROM  escala_membros em
    JOIN  membros      m    ON m.id = em.membro_id
    JOIN  ministerios  min2 ON min2.id = em.ministerio_id
    WHERE em.escala_id = NEW.escala_id
      AND em.ativo IS NOT FALSE
      AND m.whatsapp_opt_in   = true
      AND m.whatsapp_telefone IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'membro_id',    v_membro.membro_id,
      'paroquia_id',  v_escala.paroquia_id,
      'evento_tipo',  'escala_completa',
      'evento_ref_id', v_escala.id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome_membro,
        'data_escala',   to_char(v_escala.data, 'DD/MM/YYYY'),
        'hora_escala',   CASE WHEN v_escala.hora_inicio IS NOT NULL
                              THEN left(v_escala.hora_inicio::text, 5) END,
        'ministerio',    v_membro.ministerio_nome,
        'local',         v_escala.local,
        'paroquia_nome', v_paroquia_nome,
        'link_escala',   v_link
      )
    );

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || _cfg_anon_key(),
        'X-Wa-Secret',   v_wa_secret
      ),
      body    := v_payload          -- fix: era v_payload::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── _trg_fn_whatsapp_escala_completa_publicacao ───────────────────────────────

CREATE OR REPLACE FUNCTION _trg_fn_whatsapp_escala_completa_publicacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paroquia_nome text;
  v_wa_secret     text;
  v_url           text;
  v_membro        record;
  v_payload       jsonb;
  v_link          text;
BEGIN
  IF OLD.status = 'publicada' OR NEW.status != 'publicada' THEN RETURN NEW; END IF;

  IF NOT _escala_esta_completa(NEW.id) THEN RETURN NEW; END IF;

  SELECT nome INTO v_paroquia_nome FROM paroquias WHERE id = NEW.paroquia_id;

  SELECT val INTO v_wa_secret FROM _push_config WHERE key = 'internal_wa_secret';
  IF v_wa_secret IS NULL THEN RETURN NEW; END IF;

  v_url  := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_link := 'https://lumenpastoral.com.br/portal-membro/escalas';

  FOR v_membro IN
    SELECT
      m.id          AS membro_id,
      m.nome        AS nome_membro,
      min2.nome     AS ministerio_nome
    FROM  escala_membros em
    JOIN  membros      m    ON m.id = em.membro_id
    JOIN  ministerios  min2 ON min2.id = em.ministerio_id
    WHERE em.escala_id = NEW.id
      AND em.ativo IS NOT FALSE
      AND m.whatsapp_opt_in   = true
      AND m.whatsapp_telefone IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'membro_id',     v_membro.membro_id,
      'paroquia_id',   NEW.paroquia_id,
      'evento_tipo',   'escala_completa',
      'evento_ref_id', NEW.id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome_membro,
        'data_escala',   to_char(NEW.data, 'DD/MM/YYYY'),
        'hora_escala',   CASE WHEN NEW.hora_inicio IS NOT NULL
                              THEN left(NEW.hora_inicio::text, 5) END,
        'ministerio',    v_membro.ministerio_nome,
        'local',         NEW.local,
        'paroquia_nome', v_paroquia_nome,
        'link_escala',   v_link
      )
    );

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || _cfg_anon_key(),
        'X-Wa-Secret',   v_wa_secret
      ),
      body    := v_payload          -- fix: era v_payload::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── _trg_fn_whatsapp_escala_completa_funcoes ──────────────────────────────────

CREATE OR REPLACE FUNCTION _trg_fn_whatsapp_escala_completa_funcoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_escala        record;
  v_paroquia_nome text;
  v_wa_secret     text;
  v_url           text;
  v_membro        record;
  v_payload       jsonb;
  v_link          text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quantidade >= OLD.quantidade THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

  SELECT e.id, e.titulo, e.data, e.hora_inicio, e.local, e.paroquia_id, e.status
  INTO   v_escala
  FROM   escalas e
  WHERE  e.id     = NEW.escala_id
    AND  e.status = 'publicada';

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NOT _escala_esta_completa(NEW.escala_id) THEN RETURN NEW; END IF;

  SELECT nome INTO v_paroquia_nome FROM paroquias WHERE id = v_escala.paroquia_id;

  SELECT val INTO v_wa_secret FROM _push_config WHERE key = 'internal_wa_secret';
  IF v_wa_secret IS NULL THEN RETURN NEW; END IF;

  v_url  := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_link := 'https://lumenpastoral.com.br/portal-membro/escalas';

  FOR v_membro IN
    SELECT
      m.id          AS membro_id,
      m.nome        AS nome_membro,
      min2.nome     AS ministerio_nome
    FROM  escala_membros em
    JOIN  membros      m    ON m.id = em.membro_id
    JOIN  ministerios  min2 ON min2.id = em.ministerio_id
    WHERE em.escala_id = NEW.escala_id
      AND em.ativo IS NOT FALSE
      AND m.whatsapp_opt_in   = true
      AND m.whatsapp_telefone IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'membro_id',     v_membro.membro_id,
      'paroquia_id',   v_escala.paroquia_id,
      'evento_tipo',   'escala_completa',
      'evento_ref_id', v_escala.id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome_membro,
        'data_escala',   to_char(v_escala.data, 'DD/MM/YYYY'),
        'hora_escala',   CASE WHEN v_escala.hora_inicio IS NOT NULL
                              THEN left(v_escala.hora_inicio::text, 5) END,
        'ministerio',    v_membro.ministerio_nome,
        'local',         v_escala.local,
        'paroquia_nome', v_paroquia_nome,
        'link_escala',   v_link
      )
    );

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || _cfg_anon_key(),
        'X-Wa-Secret',   v_wa_secret
      ),
      body    := v_payload          -- fix: era v_payload::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── coord_enviar_aviso_pastoral (migration 174) ───────────────────────────────

CREATE OR REPLACE FUNCTION coord_enviar_aviso_pastoral(
  p_paroquia_id                uuid,
  p_mensagem                   text,
  p_destinatario_membro_id     uuid DEFAULT NULL,
  p_destinatario_ministerio_id uuid DEFAULT NULL,
  p_destinatario_escala_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_remetente_id   uuid;
  v_remetente_nome text;
  v_paroquia_nome  text;
  v_mensagem_id    uuid;
  v_wa_secret      text;
  v_url            text;
  v_membro         record;
  v_payload        jsonb;
  v_total          int := 0;
  v_disparos_hora  int;
  v_link           text := 'https://lumenpastoral.com.br/portal-membro/home';
  c_max_dest       constant int := 200;
  c_max_hora       constant int := 3;
BEGIN
  SELECT m.id, m.nome INTO v_remetente_id, v_remetente_nome
  FROM   membros m
  WHERE  m.auth_user_id = auth.uid()
    AND  m.paroquia_id  = p_paroquia_id
    AND  m.tipo_acesso  IN ('auxiliar','vice','coordenador','administrador')
    AND  m.ativo        = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para enviar avisos pastorais');
  END IF;

  DELETE FROM comunicacao_pastoral_rate_limit
  WHERE  remetente_id = v_remetente_id
    AND  paroquia_id  = p_paroquia_id
    AND  criado_em    < now() - interval '1 hour';

  SELECT COUNT(*) INTO v_disparos_hora
  FROM   comunicacao_pastoral_rate_limit
  WHERE  remetente_id = v_remetente_id
    AND  paroquia_id  = p_paroquia_id;

  IF v_disparos_hora >= c_max_hora THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format('Limite de %s disparos por hora atingido. Aguarde antes de enviar novamente.', c_max_hora)
    );
  END IF;

  SELECT nome INTO v_paroquia_nome FROM paroquias WHERE id = p_paroquia_id;

  SELECT val INTO v_wa_secret FROM _push_config WHERE key = 'internal_wa_secret';
  IF v_wa_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WhatsApp não configurado');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM   membros m
  WHERE  m.paroquia_id       = p_paroquia_id
    AND  m.ativo             = true
    AND  m.conta_ativada     = true
    AND  m.whatsapp_opt_in   = true
    AND  m.whatsapp_telefone IS NOT NULL
    AND CASE
      WHEN p_destinatario_membro_id IS NOT NULL     THEN m.id = p_destinatario_membro_id
      WHEN p_destinatario_ministerio_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_ministerios mm
        WHERE  mm.membro_id     = m.id
          AND  mm.ministerio_id = p_destinatario_ministerio_id
          AND  mm.ativo         = true
      )
      WHEN p_destinatario_escala_id IS NOT NULL     THEN EXISTS (
        SELECT 1 FROM escala_membros em2
        WHERE  em2.membro_id = m.id
          AND  em2.escala_id = p_destinatario_escala_id
          AND  em2.ativo IS NOT FALSE
      )
      ELSE true
    END;

  IF v_total > c_max_dest THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format('O disparo atingiria %s destinatários, acima do limite de %s. Use segmentação por ministério ou escala.', v_total, c_max_dest)
    );
  END IF;

  INSERT INTO comunicacao_pastoral_rate_limit (remetente_id, paroquia_id)
  VALUES (v_remetente_id, p_paroquia_id);

  INSERT INTO comunicacao_pastoral_mensagens (
    paroquia_id, remetente_id, mensagem,
    destinatario_membro_id, destinatario_ministerio_id, destinatario_escala_id
  ) VALUES (
    p_paroquia_id, v_remetente_id, p_mensagem,
    p_destinatario_membro_id, p_destinatario_ministerio_id, p_destinatario_escala_id
  )
  RETURNING id INTO v_mensagem_id;

  v_url   := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_total := 0;

  FOR v_membro IN
    SELECT m.id, m.nome
    FROM   membros m
    WHERE  m.paroquia_id       = p_paroquia_id
      AND  m.ativo             = true
      AND  m.conta_ativada     = true
      AND  m.whatsapp_opt_in   = true
      AND  m.whatsapp_telefone IS NOT NULL
      AND CASE
        WHEN p_destinatario_membro_id IS NOT NULL     THEN m.id = p_destinatario_membro_id
        WHEN p_destinatario_ministerio_id IS NOT NULL THEN EXISTS (
          SELECT 1 FROM membro_ministerios mm
          WHERE  mm.membro_id     = m.id
            AND  mm.ministerio_id = p_destinatario_ministerio_id
            AND  mm.ativo         = true
        )
        WHEN p_destinatario_escala_id IS NOT NULL     THEN EXISTS (
          SELECT 1 FROM escala_membros em2
          WHERE  em2.membro_id = m.id
            AND  em2.escala_id = p_destinatario_escala_id
            AND  em2.ativo IS NOT FALSE
        )
        ELSE true
      END
  LOOP
    INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro.id)
    ON CONFLICT (mensagem_id, membro_id) DO NOTHING;

    v_payload := jsonb_build_object(
      'membro_id',     v_membro.id,
      'paroquia_id',   p_paroquia_id,
      'evento_tipo',   'aviso_pastoral',
      'evento_ref_id', v_mensagem_id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome,
        'paroquia_nome', v_paroquia_nome,
        'mensagem',      p_mensagem,
        'remetente',     v_remetente_nome
      )
    );

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || _cfg_anon_key(),
        'X-Wa-Secret',   v_wa_secret
      ),
      body    := v_payload          -- fix: era v_payload::text
    );

    v_total := v_total + 1;
  END LOOP;

  UPDATE comunicacao_pastoral_mensagens
  SET    total_destinatarios = v_total
  WHERE  id = v_mensagem_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'mensagem_id', v_mensagem_id,
    'total',       v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid) TO authenticated;
