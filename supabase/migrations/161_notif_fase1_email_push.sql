-- Migration 161 — Fase 1: e-mail + push para escalas e substituições
--
-- Extends existing triggers to add e-mail and push alongside in-app notifications.
-- No existing behavior is removed. All e-mail/push calls are fire-and-forget
-- inside isolated EXCEPTION blocks — failures never revert the main operation.
--
-- Scope:
--   A. _notify_escala_membro      — INSERT on escala_membros → + e-mail + push
--   B. _trigger_escala_publicada_membros — status→publicada  → + e-mail + push
--   C. _trigger_escala_alterada   — data/hora/local changed  → + e-mail + push
--   D. _trigger_substituicao_insert — new request            → + push to coord
--   E. _trigger_substituicao_update — approved/rejected      → + push to solicitante
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

-- ─── Helper: lê o internal_push_secret em runtime ────────────────────────────
-- (mesmo padrão da migration 159; sem expor o valor em código)

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
  v_push_secret text;
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
    SELECT m.auth_user_id, min2.nome, p.nome
    INTO   v_auth_uid, v_min_nome, v_paroquia_nm
    FROM   public.membros m
    LEFT JOIN public.ministerios min2 ON min2.id = NEW.ministerio_id
    LEFT JOIN public.paroquias    p   ON p.id    = v_paroquia
    WHERE  m.id = NEW.membro_id AND m.ativo = true;

    IF v_auth_uid IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
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
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_notify_escala_membro: e-mail falhou para membro %: %', NEW.membro_id, SQLERRM;
  END;

  -- Push (fire-and-forget)
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
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec           RECORD;
  v_data_fmt    TEXT;
  v_hora_fmt    TEXT;
  v_paroquia_nm TEXT;
  v_push_secret TEXT;
  v_user_ids    UUID[];
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
    IF rec.email IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
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
    END IF;

    -- Coleta auth_user_ids para push em lote
    IF rec.auth_user_id IS NOT NULL THEN
      v_user_ids := array_append(v_user_ids, rec.auth_user_id);
    END IF;
  END LOOP;

  -- Push em lote (um único net.http_post para todos)
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
  rec           RECORD;
  v_mudancas    TEXT := '';
  v_paroquia_nm TEXT;
  v_push_secret TEXT;
  v_user_ids    UUID[];
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
    IF rec.email IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
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
    END IF;

    IF rec.auth_user_id IS NOT NULL THEN
      v_user_ids := array_append(v_user_ids, rec.auth_user_id);
    END IF;
  END LOOP;

  -- Push em lote
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

-- ═══════════════════════════════════════════════════════════════════════════
-- D. _trigger_substituicao_insert — nova solicitação → in-app (fiel ao original) + push coord
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_substituicao_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_solicitante_nome TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
  v_escala_id        UUID;
  v_push_secret      TEXT;
  v_coord_uids       UUID[];
BEGIN
  -- Carrega dados para mensagem (igual ao original 025)
  SELECT m.nome INTO v_solicitante_nome
  FROM public.membros m WHERE m.id = NEW.solicitante_id;

  SELECT e.titulo, e.data, min.nome, em.escala_id
  INTO   v_escala_titulo, v_escala_data, v_ministerio_nome, v_escala_id
  FROM   public.escala_membros em
  JOIN   public.escalas     e   ON e.id   = em.escala_id
  JOIN   public.ministerios min ON min.id = em.ministerio_id
  WHERE  em.id = NEW.escala_membro_id;

  -- In-app para coordenação (fiel ao original 025: tipo='alerta', link='/substituicoes')
  PERFORM public._notify_coordenacao(
    NEW.paroquia_id,
    'Substituição solicitada — ' || to_char(v_escala_data, 'DD/MM'),
    format(
      '%s solicitou substituição em "%s" (%s) para %s. Aguardando aprovação.',
      COALESCE(v_solicitante_nome, 'Membro'),
      COALESCE(v_escala_titulo, '—'),
      COALESCE(v_ministerio_nome, '—'),
      to_char(v_escala_data, 'DD/MM/YYYY')
    ),
    'alerta',
    '/substituicoes'
  );

  -- Push para coordenação (novo — fire-and-forget)
  BEGIN
    SELECT array_agg(DISTINCT m.auth_user_id)
    INTO   v_coord_uids
    FROM   public.membros m
    WHERE  m.paroquia_id  = NEW.paroquia_id
      AND  m.tipo_acesso  IN ('coordenador', 'administrador', 'vice')
      AND  m.ativo        = true
      AND  m.auth_user_id IS NOT NULL;

    SELECT val INTO v_push_secret FROM public._push_config WHERE key = 'internal_push_secret';

    IF v_push_secret IS NOT NULL AND v_coord_uids IS NOT NULL
       AND array_length(v_coord_uids, 1) > 0 THEN
      PERFORM net.http_post(
        url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
          'x-push-secret', v_push_secret
        ),
        body    := jsonb_build_object(
          'user_ids', to_jsonb(v_coord_uids),
          'title',    'Substituição solicitada — ' || to_char(v_escala_data, 'DD/MM'),
          'body',     COALESCE(v_solicitante_nome, 'Membro') || ' · ' ||
                      COALESCE(v_escala_titulo, '—'),
          'url',      '/substituicoes'
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trigger_substituicao_insert: push coord falhou: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E. _trigger_substituicao_update — fiel ao original 025 + push para solicitante/substituto
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_substituicao_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_solicitante_nome TEXT;
  v_substituto_nome  TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
  v_escala_id        UUID;
  v_push_secret      TEXT;
  v_sol_auth_uid     UUID;
  v_sub_auth_uid     UUID;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Carrega dados comuns (igual ao original 025)
  SELECT m.nome INTO v_solicitante_nome
  FROM public.membros m WHERE m.id = NEW.solicitante_id;

  SELECT mv.nome INTO v_substituto_nome
  FROM public.membros mv WHERE mv.id = NEW.substituto_id;

  SELECT e.titulo, e.data, min.nome, em.escala_id
  INTO   v_escala_titulo, v_escala_data, v_ministerio_nome, v_escala_id
  FROM   public.escala_membros em
  JOIN   public.escalas     e   ON e.id   = em.escala_id
  JOIN   public.ministerios min ON min.id = em.ministerio_id
  WHERE  em.id = NEW.escala_membro_id;

  -- com_voluntario: notifica coordenação (fiel ao original 025: tipo='urgente')
  IF NEW.status = 'com_voluntario' THEN
    PERFORM public._notify_coordenacao(
      NEW.paroquia_id,
      'Voluntário disponível — ' || to_char(v_escala_data, 'DD/MM'),
      format(
        '%s se voluntariou para substituir %s em "%s" (%s). Aguarda aprovação.',
        COALESCE(v_substituto_nome, 'Membro'),
        COALESCE(v_solicitante_nome, '—'),
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY')
      ),
      'urgente',
      '/substituicoes'
    );
  END IF;

  -- aprovada: notifica solicitante E substituto (fiel ao original 025)
  IF NEW.status = 'aprovada' THEN
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Substituição aprovada ✓',
      format(
        'Sua substituição em "%s" (%s) foi aprovada. %s irá no seu lugar.',
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY'),
        COALESCE(v_substituto_nome, 'O voluntário')
      ),
      'aviso', false, false, false,
      NEW.solicitante_id,
      '/portal-membro/substituicoes'
    );

    IF NEW.substituto_id IS NOT NULL THEN
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
      VALUES (
        NEW.paroquia_id,
        'Você foi confirmado como substituto',
        format(
          'Você substituirá %s em "%s" (%s). Confirme sua presença na escala.',
          COALESCE(v_solicitante_nome, '—'),
          COALESCE(v_escala_titulo, '—'),
          to_char(v_escala_data, 'DD/MM/YYYY')
        ),
        'aviso', false, false, false,
        NEW.substituto_id,
        '/portal-membro/escalas'
      );
    END IF;
  END IF;

  -- rejeitada: notifica solicitante com motivo_rejeicao (fiel ao original 025)
  IF NEW.status = 'rejeitada' THEN
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Substituição não aprovada',
      format(
        'Sua solicitação de substituição em "%s" (%s) não foi aprovada.%s',
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY'),
        CASE WHEN NEW.motivo_rejeicao IS NOT NULL THEN ' Motivo: ' || NEW.motivo_rejeicao ELSE '' END
      ),
      'alerta', false, false, false,
      NEW.solicitante_id,
      '/portal-membro/substituicoes'
    );
  END IF;

  -- Push para solicitante (aprovada/rejeitada) e substituto (aprovada) — fire-and-forget
  IF NEW.status IN ('aprovada', 'rejeitada') THEN
    BEGIN
      SELECT val INTO v_push_secret FROM public._push_config WHERE key = 'internal_push_secret';

      SELECT m.auth_user_id INTO v_sol_auth_uid
      FROM   public.membros m WHERE m.id = NEW.solicitante_id LIMIT 1;

      IF NEW.status = 'aprovada' AND NEW.substituto_id IS NOT NULL THEN
        SELECT m.auth_user_id INTO v_sub_auth_uid
        FROM   public.membros m WHERE m.id = NEW.substituto_id LIMIT 1;
      END IF;

      IF v_push_secret IS NOT NULL AND v_sol_auth_uid IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
            'x-push-secret', v_push_secret
          ),
          body    := jsonb_build_object(
            'user_ids', jsonb_build_array(v_sol_auth_uid::text),
            'title',    CASE NEW.status WHEN 'aprovada' THEN 'Substituição aprovada ✓'
                        ELSE 'Substituição não aprovada' END,
            'body',     COALESCE(v_escala_titulo, 'Escala') || ' — ' ||
                        to_char(v_escala_data, 'DD/MM/YYYY'),
            'url',      '/portal-membro/substituicoes'
          )
        );
      END IF;

      -- Push separado para substituto confirmado
      IF NEW.status = 'aprovada' AND v_push_secret IS NOT NULL AND v_sub_auth_uid IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
            'x-push-secret', v_push_secret
          ),
          body    := jsonb_build_object(
            'user_ids', jsonb_build_array(v_sub_auth_uid::text),
            'title',    'Você foi confirmado como substituto',
            'body',     COALESCE(v_escala_titulo, 'Escala') || ' — ' ||
                        to_char(v_escala_data, 'DD/MM/YYYY'),
            'url',      '/portal-membro/escalas'
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_trigger_substituicao_update: push falhou: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
