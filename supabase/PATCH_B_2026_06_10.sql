-- ============================================================
-- LUMEN PASTORAL — PATCH B (2026-06-10)
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
-- APÓS o PRODUCTION_DEPLOY.sql
--
-- Resolve:
--   1. Membros não veem escalas publicadas (falta policy em `escalas`)
--   2. Notificações retornam vazio (falta coluna destinatario_id)
--   3. Notificações de escala enviadas à paróquia toda (deve ir só ao escalado)
--   4. Ocorrências não aparecem no painel admin (policy + link_referencia)
-- ============================================================

-- ── 1. COLUNA destinatario_id em notificacoes ──────────────────────────
-- Permite enviar notificações para um membro específico (não toda a paróquia)
ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS destinatario_id uuid
    REFERENCES public.membros(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notificacoes_destinatario_idx
  ON public.notificacoes(destinatario_id);

-- ── 2. RLS notificacoes — atualiza policies para incluir destinatario_id ─
DROP POLICY IF EXISTS "notif_membro_read"      ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_mark_read" ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_manage"     ON public.notificacoes;
DROP POLICY IF EXISTS "notificacoes_paroquia"  ON public.notificacoes;
DROP POLICY IF EXISTS "notif_read_paroquia"    ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_all"        ON public.notificacoes;

-- Membro lê: notificações da paróquia sem destinatário OU destinadas a ele
CREATE POLICY "notif_membro_read" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    (
      paroquia_id = _portal_membro_paroquia(_portal_membro_id())
      AND (destinatario_id IS NULL OR destinatario_id = _portal_membro_id())
    )
    OR _portal_is_admin(paroquia_id)
  );

-- Membro pode marcar como lida (idem)
CREATE POLICY "notif_membro_mark_read" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    (
      paroquia_id = _portal_membro_paroquia(_portal_membro_id())
      AND (destinatario_id IS NULL OR destinatario_id = _portal_membro_id())
    )
    OR _portal_is_admin(paroquia_id)
  )
  WITH CHECK (
    (
      paroquia_id = _portal_membro_paroquia(_portal_membro_id())
      AND (destinatario_id IS NULL OR destinatario_id = _portal_membro_id())
    )
    OR _portal_is_admin(paroquia_id)
  );

-- Admin gerencia todas
CREATE POLICY "notif_admin_manage" ON public.notificacoes
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;

-- ── 3. RLS escalas — membros podem ler escalas publicadas da sua paróquia ─
-- (sem essa policy, a listagem de escalas no portal membro retorna vazio)
DROP POLICY IF EXISTS "escalas_membro_read_publicadas" ON public.escalas;
DROP POLICY IF EXISTS "escalas_admin_all"              ON public.escalas;

CREATE POLICY "escalas_membro_read_publicadas" ON public.escalas
  FOR SELECT TO authenticated
  USING (
    (
      status = 'publicada'
      AND paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    )
    OR _portal_is_admin(paroquia_id)
    OR _portal_is_coord(_portal_membro_id())
  );

CREATE POLICY "escalas_admin_all" ON public.escalas
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT ON public.escalas TO authenticated;

-- ── 4. Trigger de notificação de escala — só ao membro escalado ──────────
-- Cada vez que um membro é adicionado a escala_membros, notifica apenas ele
CREATE OR REPLACE FUNCTION public._notify_escala_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_titulo    text;
  v_data      date;
  v_paroquia  uuid;
BEGIN
  SELECT e.titulo, e.data, e.paroquia_id
  INTO   v_titulo, v_data, v_paroquia
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia)
  VALUES (
    v_paroquia,
    NEW.membro_id,
    'Você foi escalado(a): ' || v_titulo,
    'Data: ' || to_char(v_data, 'DD/MM/YYYY') || '. Confirme ou recuse sua participação no portal.',
    'aviso',
    '/portal-membro/escalas'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_escala_membro ON public.escala_membros;
CREATE TRIGGER notify_escala_membro
  AFTER INSERT ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_escala_membro();

-- ── 5. Trigger ocorrências — adiciona link_referencia ──────────────────
-- Admins recebem notificação com link direto para /ocorrencias
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_membro_nome text;
  v_tipo_label  text;
BEGIN
  SELECT nome INTO v_membro_nome FROM public.membros WHERE id = NEW.membro_id;

  v_tipo_label := CASE NEW.tipo
    WHEN 'problema_pastoral'      THEN 'Problema pastoral'
    WHEN 'dificuldade_pessoal'    THEN 'Dificuldade pessoal'
    WHEN 'ausencia_futura'        THEN 'Ausência futura'
    WHEN 'situacao_urgente'       THEN 'Situação urgente'
    WHEN 'observacao_coordenacao' THEN 'Observação para coordenação'
    ELSE NEW.tipo
  END;

  -- Notificação sem destinatario_id = visível para todos os admins da paróquia
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, link_referencia)
  VALUES (
    NEW.paroquia_id,
    v_tipo_label || ' — ' || NEW.titulo,
    'Registrado por ' || COALESCE(v_membro_nome, 'membro') || ': ' || left(NEW.descricao, 200),
    CASE WHEN NEW.tipo = 'situacao_urgente' THEN 'urgente' ELSE 'alerta' END,
    '/ocorrencias'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_membro ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_membro
  AFTER INSERT ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_membro();

-- ── 6. Notificar membro quando ocorrência recebe resposta ───────────────
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_respondida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Só notifica quando há mudança real de resposta ou status
  IF (OLD.resposta IS NOT DISTINCT FROM NEW.resposta AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.resposta IS NOT NULL AND (OLD.resposta IS NULL OR OLD.resposta <> NEW.resposta) THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Sua ocorrência recebeu uma resposta',
      left(NEW.resposta, 200),
      'alerta',
      '/portal-membro/ocorrencias'
    );
  ELSIF OLD.status <> NEW.status THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Status da ocorrência atualizado: ' || NEW.status,
      'Sua ocorrência "' || left(NEW.titulo, 80) || '" foi atualizada.',
      'sistema',
      '/portal-membro/ocorrencias'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_respondida ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_respondida
  AFTER UPDATE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_respondida();

-- ── 7. Recarregar schema ────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Validação rápida ────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'notificacoes' AND column_name = 'destinatario_id';
-- → deve retornar 1 linha
--
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'escalas' AND policyname = 'escalas_membro_read_publicadas';
-- → deve retornar 1 linha
--
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table IN ('escala_membros', 'ocorrencias_membros')
-- ORDER BY trigger_name;
-- → deve listar: notify_escala_membro, notify_ocorrencia_membro, notify_ocorrencia_respondida
