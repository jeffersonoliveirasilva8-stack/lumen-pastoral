-- Migration 153 — Cascade automático ao cancelar escala
--
-- Problema confirmado: ao mudar escalas.status = 'cancelada', substituições
-- abertas (status IN ('solicitada','com_voluntario')) ficavam orphaned.
-- Notificações e e-mails dependiam do front-end (onSuccess), que falha
-- silenciosamente se o utilizador fechar o browser.
--
-- Solução:
--   1. Coluna motivo_cancelamento TEXT em escalas
--   2. Trigger _on_escala_cancelada_cascade — dispara AFTER UPDATE em escalas
--      quando status muda para 'cancelada', atomicamente:
--        a. Fecha substituições abertas → cancelada + historico_substituicoes
--        b. Cria notificações in-app para todos os membros atribuídos
--        c. Dispara net.http_post (fire-and-forget) com template escala_cancelada
--           para cada membro com e-mail — substituindo o envio front-end
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS)
-- NÃO DUPLICA: trigger verifica NEW.status = 'cancelada' AND OLD.status <> 'cancelada'

-- ── 1. Coluna motivo_cancelamento ─────────────────────────────────────────────
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

-- ── 2. Função do trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._on_escala_cancelada_cascade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subst          RECORD;
  v_membro         RECORD;
  v_paroquia_nome  TEXT;
  v_hora_fmt       TEXT;
  v_min_nome       TEXT;
BEGIN
  -- ── a. Fecha substituições abertas ────────────────────────────────────────
  FOR v_subst IN
    SELECT s.id, s.solicitante_id
    FROM   public.substituicoes s
    JOIN   public.escala_membros em ON em.id = s.escala_membro_id
    WHERE  em.escala_id = NEW.id
      AND  s.status IN ('solicitada', 'com_voluntario')
  LOOP
    UPDATE public.substituicoes
       SET status     = 'cancelada',
           updated_at = now()
     WHERE id = v_subst.id;

    INSERT INTO public.historico_substituicoes
      (substituicao_id, acao, actor_id, detalhes)
    VALUES
      (v_subst.id, 'cancelada_escala_cancelada', v_subst.solicitante_id,
       jsonb_build_object(
         'escala_id',    NEW.id,
         'motivo',       NEW.motivo_cancelamento
       ));
  END LOOP;

  -- ── b+c. Notificações in-app + e-mails para membros atribuídos ───────────
  SELECT p.nome INTO v_paroquia_nome
  FROM   public.paroquias p
  WHERE  p.id = NEW.paroquia_id;

  v_hora_fmt := COALESCE(LEFT(NEW.hora_inicio::TEXT, 5), '');

  FOR v_membro IN
    SELECT DISTINCT ON (em.membro_id)
           m.id       AS membro_id,
           m.nome,
           m.email,
           mn.nome    AS ministerio_nome
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
      (paroquia_id, membro_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
    VALUES
      (NEW.paroquia_id,
       v_membro.membro_id,
       'Escala cancelada: ' || NEW.titulo,
       'A escala "' || NEW.titulo || '" do dia ' || NEW.data::TEXT ||
         ' foi cancelada pela coordenação.' ||
         CASE WHEN NEW.motivo_cancelamento IS NOT NULL
              THEN ' Motivo: ' || NEW.motivo_cancelamento
              ELSE ''
         END,
       'aviso', false, false, '/portal-membro/escalas');

    -- E-mail (fire-and-forget via pg_net)
    IF v_membro.email IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
          ),
          body    := jsonb_build_object(
            'template',      'escala_cancelada',
            'to',            v_membro.email,
            'nome',          v_membro.nome,
            'paroquia',      COALESCE(v_paroquia_nome, ''),
            'escalaTitulo',  NEW.titulo,
            'escalaData',    NEW.data::TEXT,
            'escalaHora',    v_hora_fmt,
            'ministerioNome', v_membro.ministerio_nome
          )
        );
      EXCEPTION WHEN OTHERS THEN
        NULL; -- falha no e-mail não bloqueia o cancelamento
      END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── 3. Trigger ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_escala_cancelada_cascade ON public.escalas;

CREATE TRIGGER on_escala_cancelada_cascade
  AFTER UPDATE ON public.escalas
  FOR EACH ROW
  WHEN (NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada')
  EXECUTE FUNCTION public._on_escala_cancelada_cascade();

NOTIFY pgrst, 'reload schema';
