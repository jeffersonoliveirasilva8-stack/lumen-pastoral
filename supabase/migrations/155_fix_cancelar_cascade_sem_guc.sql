-- Migration 155 — Remove dependência de GUC no trigger de cancelamento
--
-- Migration 154 usava current_setting('app.supabase_anon_key'/'app.supabase_url')
-- mas ALTER DATABASE para setar esses GUCs exige superuser — indisponível no
-- SQL Editor do Supabase.
--
-- Solução: hardcode da anon_key e URL do projeto. Ambos são valores públicos
-- (anon_key é enviada pelo browser em toda requisição; URL é pública).
-- Nenhuma delas concede acesso privilegiado ao banco.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- NÃO ALTERA: trigger, coluna motivo_cancelamento, histórico, notificações

CREATE OR REPLACE FUNCTION public._on_escala_cancelada_cascade()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_subst          RECORD;
  v_membro         RECORD;
  v_paroquia_nome  TEXT;
  v_hora_fmt       TEXT;
  v_actor_id       UUID;
BEGIN
  SELECT id INTO v_actor_id
  FROM   public.membros
  WHERE  auth_user_id = auth.uid() AND ativo = true
  LIMIT  1;

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
        RAISE WARNING '_on_escala_cancelada_cascade: net.http_post falhou para membro %: %',
          v_membro.membro_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
