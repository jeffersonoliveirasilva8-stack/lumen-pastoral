-- Migration 154 — Corrige GUC no trigger de cancelamento de escala
--
-- Problema: _on_escala_cancelada_cascade (migration 153) usava
-- app.service_role_key (não configurado) e URL hardcoded para chamar
-- send-email. Resultado: e-mails nunca enviados, RAISE WARNING nos logs.
--
-- Solução: usa app.supabase_anon_key + app.supabase_url — os mesmos GUCs
-- que as migrations 052 e 065 já usam para chamar Edge Functions.
-- A Edge Function send-email aceita qualquer Bearer token válido.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE, não recria o trigger)
-- NÃO ALTERA: trigger, coluna motivo_cancelamento, histórico, notificações

CREATE OR REPLACE FUNCTION public._on_escala_cancelada_cascade()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_subst          RECORD;
  v_membro         RECORD;
  v_paroquia_nome  TEXT;
  v_hora_fmt       TEXT;
  v_actor_id       UUID;
  v_anon_key       TEXT;
  v_svc_url        TEXT;
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
  v_hora_fmt  := COALESCE(LEFT(NEW.hora_inicio::TEXT, 5), '');
  v_anon_key  := current_setting('app.supabase_anon_key', true);
  v_svc_url   := current_setting('app.supabase_url', true);

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
      IF v_anon_key IS NULL OR v_svc_url IS NULL THEN
        RAISE WARNING '_on_escala_cancelada_cascade: app.supabase_anon_key ou app.supabase_url não configurados — e-mail não enviado para membro %', v_membro.membro_id;
      ELSE
        BEGIN
          PERFORM net.http_post(
            url     := v_svc_url || '/functions/v1/send-email',
            headers := jsonb_build_object(
              'Content-Type',  'application/json',
              'Authorization', 'Bearer ' || v_anon_key
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
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
