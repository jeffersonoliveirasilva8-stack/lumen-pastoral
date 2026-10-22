-- Migration 165 — Fix: _trigger_escala_publicada_membros sem SECURITY DEFINER
--
-- A função foi definida na migration 161 sem SECURITY DEFINER. A tabela
-- _push_config tem RLS habilitada sem policy SELECT (migration 159), portanto
-- só funções SECURITY DEFINER (executando como postgres) conseguem ler o secret.
-- Sem SECURITY DEFINER, v_push_secret ficava NULL e o push não era enviado.
--
-- Corpo idêntico ao da migration 161 — única alteração: adição de
-- SECURITY DEFINER SET search_path = public na assinatura.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

NOTIFY pgrst, 'reload schema';
