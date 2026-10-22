-- Migration 166 — Autenticação real para send-email via x-email-secret
--
-- Contexto:
--   send-email tinha verify_jwt = true (padrão Supabase). O JWT hardcoded nas
--   funções de trigger não passava pela validação de assinatura do gateway
--   (send-push já era verify_jwt = false e usava x-push-secret; send-email não).
--
-- Esta migration atualiza as funções A (_notify_escala_membro), B
-- (_trigger_escala_publicada_membros) e C (_trigger_escala_alterada) para:
--   1. Ler internal_email_secret de _push_config (SECURITY DEFINER já presente).
--   2. Enviar o secret no header x-email-secret em vez de depender do JWT.
--   3. Não enviar o e-mail (RAISE WARNING) se o secret não estiver provisionado.
--
-- Funções D e E (substituições) não enviam e-mail — não são alteradas.
-- Push e notificações in-app: inalterados.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- DEPENDÊNCIA: internal_email_secret deve existir em _push_config e
--              INTERNAL_EMAIL_SECRET deve ser configurado nos Supabase Secrets
--              ANTES do deploy de send-email — ver etapas de provisionamento.

-- ═══════════════════════════════════════════════════════════════════════════
-- A. _notify_escala_membro — membro adicionado a escala publicada
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_escala_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_titulo      text;
  v_data        date;
  v_hora        text;
  v_paroquia    uuid;
  v_paroquia_nm text;
  v_status      text;
  v_min_nome    text;
  v_auth_uid    uuid;
  v_push_secret  text;
  v_email_secret text;
BEGIN
  SELECT e.titulo, e.data, e.paroquia_id, e.status,
         LEFT(COALESCE(e.hora_inicio::text,''),5)
  INTO   v_titulo, v_data, v_paroquia, v_status, v_hora
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia IS NULL THEN RETURN NEW; END IF;
  IF v_status <> 'publicada' THEN RETURN NEW; END IF;

  -- In-app (preserva comportamento original)
  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
  VALUES (
    v_paroquia,
    NEW.membro_id,
    'Você foi escalado(a): ' || COALESCE(v_titulo, 'nova escala'),
    'Data: ' || to_char(COALESCE(v_data, CURRENT_DATE), 'DD/MM/YYYY') ||
      '. Acesse o portal para confirmar sua participação.',
    'aviso',
    '/portal-membro/escalas',
    false
  );

  -- E-mail (fire-and-forget)
  BEGIN
    SELECT val INTO v_email_secret FROM public._push_config WHERE key = 'internal_email_secret';

    SELECT m.auth_user_id, min2.nome, p.nome
    INTO   v_auth_uid, v_min_nome, v_paroquia_nm
    FROM   public.membros m
    LEFT JOIN public.ministerios min2 ON min2.id = NEW.ministerio_id
    LEFT JOIN public.paroquias    p   ON p.id    = v_paroquia
    WHERE  m.id = NEW.membro_id AND m.ativo = true;

    IF v_auth_uid IS NOT NULL AND v_email_secret IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'x-email-secret', v_email_secret
        ),
        body    := jsonb_build_object(
          'template',       'escala_atribuida',
          'to',             (SELECT email FROM auth.users WHERE id = v_auth_uid LIMIT 1),
          'nome',           (SELECT nome FROM public.membros WHERE id = NEW.membro_id LIMIT 1),
          'paroquia',       COALESCE(v_paroquia_nm, ''),
          'escalaTitulo',   COALESCE(v_titulo, ''),
          'escalaData',     COALESCE(v_data::text, ''),
          'escalaHora',     COALESCE(v_hora, ''),
          'ministerioNome', COALESCE(v_min_nome, '')
        )
      );
    ELSIF v_auth_uid IS NOT NULL THEN
      RAISE WARNING '_notify_escala_membro: e-mail não enviado — internal_email_secret não configurado';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_notify_escala_membro: e-mail falhou para membro %: %', NEW.membro_id, SQLERRM;
  END;

  -- Push (fire-and-forget) — inalterado
  BEGIN
    SELECT val INTO v_push_secret
    FROM   public._push_config WHERE key = 'internal_push_secret';

    IF v_push_secret IS NOT NULL AND v_auth_uid IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
          'x-push-secret', v_push_secret
        ),
        body    := jsonb_build_object(
          'user_ids', jsonb_build_array(v_auth_uid::text),
          'title',    'Você foi escalado(a)',
          'body',     COALESCE(v_titulo, 'nova escala') || ' — ' ||
                      to_char(COALESCE(v_data, CURRENT_DATE), 'DD/MM/YYYY'),
          'url',      '/portal-membro/escalas'
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_notify_escala_membro: push falhou para membro %: %', NEW.membro_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B. _trigger_escala_publicada_membros — escala muda status → publicada
--    (corpo idêntico ao da migration 165; única adição: x-email-secret)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec            RECORD;
  v_data_fmt     TEXT;
  v_hora_fmt     TEXT;
  v_paroquia_nm  TEXT;
  v_push_secret  TEXT;
  v_email_secret TEXT;
  v_user_ids     UUID[];
BEGIN
  IF NEW.status <> 'publicada' OR OLD.status = 'publicada' THEN
    RETURN NEW;
  END IF;

  UPDATE public.escalas
  SET publicada_at = NOW()
  WHERE id = NEW.id AND publicada_at IS NULL;

  v_data_fmt := to_char(NEW.data::date, 'DD/MM/YYYY');
  v_hora_fmt := CASE
    WHEN NEW.hora_inicio IS NOT NULL THEN ' às ' || to_char(NEW.hora_inicio, 'HH24:MI')
    ELSE '' END;

  SELECT nome INTO v_paroquia_nm FROM public.paroquias WHERE id = NEW.paroquia_id;
  SELECT val  INTO v_email_secret FROM public._push_config WHERE key = 'internal_email_secret';

  -- In-app (preserva comportamento original)
  FOR rec IN
    SELECT em.membro_id,
           COALESCE(min.nome, 'Servidor') AS ministerio_nome,
           m.auth_user_id,
           (SELECT email FROM auth.users WHERE id = m.auth_user_id LIMIT 1) AS email,
           m.nome
    FROM   public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    JOIN     public.membros       m  ON m.id  = em.membro_id AND m.ativo = true
    WHERE  em.escala_id = NEW.id
      AND  (em.ativo IS NULL OR em.ativo = true)
  LOOP
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      '📅 Nova escala publicada — ' || left(NEW.titulo, 50),
      format(
        'Você está escalado(a) como %s em "%s" no dia %s%s. Confirme sua presença no portal.',
        rec.ministerio_nome, NEW.titulo, v_data_fmt, v_hora_fmt
      ),
      'aviso', false, false, rec.membro_id, '/portal-membro/escalas'
    );

    -- E-mail (fire-and-forget por membro)
    IF rec.email IS NOT NULL AND v_email_secret IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object(
            'Content-Type',   'application/json',
            'x-email-secret', v_email_secret
          ),
          body    := jsonb_build_object(
            'template',       'escala_publicada',
            'to',             rec.email,
            'nome',           rec.nome,
            'paroquia',       COALESCE(v_paroquia_nm, ''),
            'escalaTitulo',   NEW.titulo,
            'escalaData',     NEW.data::text,
            'escalaHora',     LEFT(COALESCE(NEW.hora_inicio::text,''), 5),
            'ministerioNome', rec.ministerio_nome
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_trigger_escala_publicada: e-mail falhou membro %: %', rec.membro_id, SQLERRM;
      END;
    ELSIF rec.email IS NOT NULL THEN
      RAISE WARNING '_trigger_escala_publicada: e-mail não enviado — internal_email_secret não configurado';
    END IF;

    -- Coleta auth_user_ids para push em lote
    IF rec.auth_user_id IS NOT NULL THEN
      v_user_ids := array_append(v_user_ids, rec.auth_user_id);
    END IF;
  END LOOP;

  -- Push em lote (inalterado)
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    BEGIN
      SELECT val INTO v_push_secret FROM public._push_config WHERE key = 'internal_push_secret';
      IF v_push_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
            'x-push-secret', v_push_secret
          ),
          body    := jsonb_build_object(
            'user_ids', to_jsonb(v_user_ids),
            'title',    'Escala publicada: ' || NEW.titulo,
            'body',     'Você está escalado(a) para ' || v_data_fmt || v_hora_fmt ||
                        '. Confirme no portal.',
            'url',      '/portal-membro/escalas'
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_trigger_escala_publicada: push falhou: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C. _trigger_escala_alterada — data, hora ou local mudou em escala publicada
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_escala_alterada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  rec            RECORD;
  v_mudancas     TEXT := '';
  v_paroquia_nm  TEXT;
  v_push_secret  TEXT;
  v_email_secret TEXT;
  v_user_ids     UUID[];
BEGIN
  IF NEW.status <> 'publicada' THEN RETURN NEW; END IF;

  IF NEW.data        IS DISTINCT FROM OLD.data        THEN
    v_mudancas := v_mudancas || 'Data: ' || to_char(NEW.data::date, 'DD/MM/YYYY') || '. ';
  END IF;
  IF NEW.hora_inicio IS DISTINCT FROM OLD.hora_inicio THEN
    v_mudancas := v_mudancas || 'Horário: ' || COALESCE(left(NEW.hora_inicio::text, 5), '—') || '. ';
  END IF;
  IF NEW.local IS DISTINCT FROM OLD.local THEN
    v_mudancas := v_mudancas || 'Local: ' || COALESCE(NEW.local, '—') || '. ';
  END IF;

  IF v_mudancas = '' THEN RETURN NEW; END IF;

  SELECT nome INTO v_paroquia_nm FROM public.paroquias WHERE id = NEW.paroquia_id;
  SELECT val  INTO v_email_secret FROM public._push_config WHERE key = 'internal_email_secret';

  FOR rec IN
    SELECT em.membro_id,
           m.auth_user_id,
           (SELECT email FROM auth.users WHERE id = m.auth_user_id LIMIT 1) AS email,
           m.nome
    FROM   public.escala_membros em
    JOIN   public.membros m ON m.id = em.membro_id AND m.ativo = true
    WHERE  em.escala_id = NEW.id
      AND  (em.ativo IS NULL OR em.ativo = true)
  LOOP
    -- In-app (preserva comportamento original)
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Escala atualizada: ' || left(NEW.titulo, 60),
      format('A escala "%s" foi alterada. %sVerifique os detalhes no portal.',
             NEW.titulo, v_mudancas),
      'alerta', false, false, rec.membro_id, '/portal-membro/escalas'
    );

    -- E-mail (fire-and-forget)
    IF rec.email IS NOT NULL AND v_email_secret IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object(
            'Content-Type',   'application/json',
            'x-email-secret', v_email_secret
          ),
          body    := jsonb_build_object(
            'template',       'escala_alterada',
            'to',             rec.email,
            'nome',           rec.nome,
            'paroquia',       COALESCE(v_paroquia_nm, ''),
            'escalaTitulo',   NEW.titulo,
            'escalaData',     NEW.data::text,
            'escalaHora',     LEFT(COALESCE(NEW.hora_inicio::text,''), 5),
            'ministerioNome', ''
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_trigger_escala_alterada: e-mail falhou membro %: %', rec.membro_id, SQLERRM;
      END;
    ELSIF rec.email IS NOT NULL THEN
      RAISE WARNING '_trigger_escala_alterada: e-mail não enviado — internal_email_secret não configurado';
    END IF;

    IF rec.auth_user_id IS NOT NULL THEN
      v_user_ids := array_append(v_user_ids, rec.auth_user_id);
    END IF;
  END LOOP;

  -- Push em lote (inalterado)
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    BEGIN
      SELECT val INTO v_push_secret FROM public._push_config WHERE key = 'internal_push_secret';
      IF v_push_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
            'x-push-secret', v_push_secret
          ),
          body    := jsonb_build_object(
            'user_ids', to_jsonb(v_user_ids),
            'title',    'Escala alterada: ' || NEW.titulo,
            'body',     v_mudancas,
            'url',      '/portal-membro/escalas'
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_trigger_escala_alterada: push falhou: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
