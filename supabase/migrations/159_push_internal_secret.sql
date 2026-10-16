-- Migration 159 — Autenticação interna send-push via x-push-secret
--
-- Cria a tabela _push_config para armazenar o segredo compartilhado entre
-- o trigger e a Edge Function send-push. Nenhuma policy SELECT é criada —
-- apenas service_role (triggers SECURITY DEFINER) pode ler.
--
-- Após aplicar esta migration:
--   1. SELECT val FROM public._push_config WHERE key = 'internal_push_secret';
--   2. supabase secrets set INTERNAL_PUSH_SECRET=<valor_do_passo_1>
--   3. supabase functions deploy send-push
--   4. Aplicar migration 157 (trigger de cancelamento)
--
-- IDEMPOTENTE: sim

-- Tabela de configuração interna — inacessível por clientes externos (sem SELECT policy)
CREATE TABLE IF NOT EXISTS public._push_config (
  key TEXT PRIMARY KEY,
  val TEXT NOT NULL
);
ALTER TABLE public._push_config ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy = acesso somente via service_role (triggers SECURITY DEFINER)

-- Gera um UUID aleatório como segredo inicial (idempotente — não sobrescreve se já existir)
INSERT INTO public._push_config (key, val)
VALUES ('internal_push_secret', gen_random_uuid()::TEXT)
ON CONFLICT (key) DO NOTHING;

-- Atualiza _on_escala_cancelada_cascade para incluir x-push-secret
-- (lê o segredo de _push_config em tempo de execução)
CREATE OR REPLACE FUNCTION public._on_escala_cancelada_cascade()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_subst          RECORD;
  v_membro         RECORD;
  v_paroquia_nome  TEXT;
  v_hora_fmt       TEXT;
  v_actor_id       UUID;
  v_user_ids       UUID[];
  v_push_title     TEXT;
  v_push_body      TEXT;
  v_push_secret    TEXT;
BEGIN
  SELECT id INTO v_actor_id
  FROM   public.membros
  WHERE  auth_user_id = auth.uid() AND ativo = true
  LIMIT  1;

  -- Cancela substituições pendentes
  FOR v_subst IN
    SELECT s.id
    FROM   public.substituicoes s
    JOIN   public.escala_membros em ON em.id = s.escala_membro_id
    WHERE  em.escala_id = NEW.id
      AND  s.status IN ('solicitada', 'com_voluntario')
  LOOP
    UPDATE public.substituicoes
       SET status = 'cancelada', updated_at = now()
     WHERE id = v_subst.id;

    INSERT INTO public.historico_substituicoes
      (substituicao_id, acao, actor_id, detalhes)
    VALUES
      (v_subst.id, 'cancelada_escala_cancelada', v_actor_id,
       jsonb_build_object('escala_id', NEW.id, 'motivo', NEW.motivo_cancelamento));
  END LOOP;

  SELECT p.nome INTO v_paroquia_nome FROM public.paroquias p WHERE p.id = NEW.paroquia_id;
  v_hora_fmt := COALESCE(LEFT(NEW.hora_inicio::TEXT, 5), '');

  -- Coleta auth_user_ids para push
  SELECT array_agg(DISTINCT m.auth_user_id)
  INTO   v_user_ids
  FROM   public.escala_membros em
  JOIN   public.membros         m  ON m.id  = em.membro_id
  WHERE  em.escala_id = NEW.id
    AND  (em.ativo IS NULL OR em.ativo = true)
    AND  m.ativo = true
    AND  m.auth_user_id IS NOT NULL;

  v_push_title := 'Escala cancelada: ' || NEW.titulo;
  v_push_body  := 'Escala do dia ' || NEW.data::TEXT ||
    CASE WHEN NEW.motivo_cancelamento IS NOT NULL
         THEN ' — ' || LEFT(NEW.motivo_cancelamento, 80) ELSE '' END;

  FOR v_membro IN
    SELECT DISTINCT ON (em.membro_id)
           m.id AS membro_id, m.nome, m.email, mn.nome AS ministerio_nome
    FROM   public.escala_membros em
    JOIN   public.membros         m  ON m.id  = em.membro_id
    JOIN   public.ministerios     mn ON mn.id = em.ministerio_id
    WHERE  em.escala_id = NEW.id
      AND  (em.ativo IS NULL OR em.ativo = true)
      AND  m.ativo = true
    ORDER BY em.membro_id, em.created_at
  LOOP
    -- Notificação in-app
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES
      (NEW.paroquia_id,
       'Escala cancelada: ' || NEW.titulo,
       'A escala "' || NEW.titulo || '" do dia ' || NEW.data::TEXT ||
         ' foi cancelada pela coordenação.' ||
         CASE WHEN NEW.motivo_cancelamento IS NOT NULL
              THEN ' Motivo: ' || NEW.motivo_cancelamento ELSE '' END,
       'aviso', false, false,
       v_membro.membro_id,
       '/portal-membro/escalas');

    -- E-mail
    IF v_membro.email IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
          ),
          body    := jsonb_build_object(
            'template',       'escala_cancelada',
            'to',             v_membro.email,
            'nome',           v_membro.nome,
            'paroquia',       COALESCE(v_paroquia_nome, ''),
            'escalaTitulo',   NEW.titulo,
            'escalaData',     NEW.data::TEXT,
            'escalaHora',     v_hora_fmt,
            'ministerioNome', v_membro.ministerio_nome
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_on_escala_cancelada_cascade: email falhou para membro %: %',
          v_membro.membro_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  -- Web Push com x-push-secret para autenticação interna
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    BEGIN
      -- Lê segredo em tempo de execução (não exposto em código-fonte)
      SELECT val INTO v_push_secret
      FROM   public._push_config
      WHERE  key = 'internal_push_secret';

      IF v_push_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',   'application/json',
            'Authorization',  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
            'x-push-secret',  v_push_secret
          ),
          body    := jsonb_build_object(
            'user_ids', to_jsonb(v_user_ids),
            'title',    v_push_title,
            'body',     v_push_body,
            'url',      '/portal-membro/escalas'
          )
        );
      ELSE
        RAISE WARNING '_on_escala_cancelada_cascade: _push_config.internal_push_secret não encontrado — push não enviado';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Falha no push nunca reverte o cancelamento
      RAISE WARNING '_on_escala_cancelada_cascade: send-push falhou: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
