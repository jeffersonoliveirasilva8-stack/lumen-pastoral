-- ============================================================
-- LUMEN PASTORAL — PATCH P: Notificações e Privacidade Total
-- Data: 2026-06-10
--
-- PROBLEMAS CORRIGIDOS:
--   1. Membros viam notificações de outros membros e notificações
--      administrativas (falta de destinatario_id + apenas_admin).
--   2. RLS de ocorrencias_membros não tinha policy de membro —
--      isolamento dependia só de filtro client-side.
--   3. Notificações urgentes no layout do portal-membro não
--      filtravam por destinatario_id nem apenas_admin.
--   4. Trigger de escala não distinguia se o membro já era
--      destinatário ou se era notificação global.
--   5. Sem limpar histórico legado de notificações de teste.
--
-- NOVA POLÍTICA:
--   • Membro vê APENAS notificações com:
--       apenas_admin = false
--       AND (destinatario_id IS NULL OR destinatario_id = próprio id)
--       AND paroquia_id = própria paróquia
--   • Admin vê TODAS da própria paróquia (inclusive apenas_admin=true)
--   • Ocorrência: membro vê APENAS as suas; admin vê todas da paróquia
--   • Escala: notificação somente para quem foi escalado
--
-- IDEMPOTENTE: sim
-- ORDEM: após PATCH_O
-- ============================================================

-- ══════════════════════════════════════════════════════════════════
-- 0. LIMPEZA — remove todas as notificações legadas/de teste
-- ══════════════════════════════════════════════════════════════════
-- Mantém apenas notificações dos últimos 0 dias (limpa tudo)
-- Se qu1iser conservar as recentes, ajuste o intervalo:
--   DELETE FROM public.notificacoes WHERE created_at < NOW() - INTERVAL '7 days';
-- Para limpeza total:
TRUNCATE public.notificacoes RESTART IDENTITY;

-- ══════════════════════════════════════════════════════════════════
-- 1. NOTIFICAÇÕES — reconstruir todas as policies
-- ══════════════════════════════════════════════════════════════════

-- Remove todas as policies existentes (consolidação limpa)
DROP POLICY IF EXISTS "notificacoes_select"     ON public.notificacoes;
DROP POLICY IF EXISTS "notificacoes_all"        ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_read"       ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_mark_read"  ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_delete"     ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_manage"      ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_all"         ON public.notificacoes;
DROP POLICY IF EXISTS "notif_read_paroquia"     ON public.notificacoes;
DROP POLICY IF EXISTS "notificacoes_paroquia"   ON public.notificacoes;

-- ── MEMBRO: leitura ──────────────────────────────────────────────
-- Vê apenas notificações não-admin, da sua paróquia,
-- sem destinatário (broadcast) OU endereçadas especificamente a ele.
CREATE POLICY "notif_membro_read" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    -- Admins veem tudo (inclusive apenas_admin=true)
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM public.membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
          UNION
          SELECT id FROM public.membros
          WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
            AND ativo = true
        )
      )
    )
  );

-- ── MEMBRO: marcar como lida ─────────────────────────────────────
CREATE POLICY "notif_membro_mark_read" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM public.membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
          UNION
          SELECT id FROM public.membros
          WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
            AND ativo = true
        )
      )
    )
  )
  WITH CHECK (true);

-- ── MEMBRO: excluir notificação própria ──────────────────────────
CREATE POLICY "notif_membro_delete" ON public.notificacoes
  FOR DELETE TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
      )
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
        )
      )
    )
  );

-- ── ADMIN: gerenciar todas (criar comunicados, excluir, etc.) ────
CREATE POLICY "notif_admin_manage" ON public.notificacoes
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 2. OCORRÊNCIAS — RLS com isolamento total por membro
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.ocorrencias_membros ENABLE ROW LEVEL SECURITY;

-- Remove todas as policies existentes
DROP POLICY IF EXISTS "ocorrencia_admin_read"   ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_update" ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_read"  ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_insert" ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_delete" ON public.ocorrencias_membros;

-- ── MEMBRO: vê APENAS as suas próprias ──────────────────────────
CREATE POLICY "ocorrencia_membro_read" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (
    membro_id IN (
      SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
      UNION
      SELECT id FROM public.membros
      WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
        AND ativo = true
    )
  );

-- ── MEMBRO: cria apenas com seu próprio membro_id ───────────────
CREATE POLICY "ocorrencia_membro_insert" ON public.ocorrencias_membros
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id IN (
      SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
    )
    AND paroquia_id IN (
      SELECT paroquia_id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
    )
  );

-- ── MEMBRO: pode cancelar (excluir) apenas se status = 'aberta' ─
CREATE POLICY "ocorrencia_membro_delete" ON public.ocorrencias_membros
  FOR DELETE TO authenticated
  USING (
    status = 'aberta'
    AND membro_id IN (
      SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
    )
  );

-- ── ADMIN: vê e edita todas da própria paróquia ─────────────────
-- SELECT: já tratado via RPC SECURITY DEFINER (get_ocorrencias_paroquia)
-- Mas adicionamos policy para acesso direto também:
CREATE POLICY "ocorrencia_admin_read" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (_portal_is_admin(paroquia_id));

CREATE POLICY "ocorrencia_admin_update" ON public.ocorrencias_membros
  FOR UPDATE TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

CREATE POLICY "ocorrencia_admin_delete" ON public.ocorrencias_membros
  FOR DELETE TO authenticated
  USING (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocorrencias_membros TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. TRIGGERS — reconstruir com regras precisas de destinatário
-- ══════════════════════════════════════════════════════════════════

-- ── 3a. Ocorrência nova → notifica SOMENTE coordenação ──────────
-- apenas_admin = true: membros NUNCA veem esta notificação.
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_nome       text;
  v_tipo_label text;
BEGIN
  SELECT nome INTO v_nome FROM public.membros WHERE id = NEW.membro_id;

  v_tipo_label := CASE NEW.tipo
    WHEN 'problema_pastoral'      THEN 'Problema pastoral'
    WHEN 'dificuldade_pessoal'    THEN 'Dificuldade pessoal'
    WHEN 'ausencia_futura'        THEN 'Ausência futura'
    WHEN 'situacao_urgente'       THEN 'Situação urgente'
    WHEN 'observacao_coordenacao' THEN 'Observação'
    ELSE NEW.tipo
  END;

  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, link_referencia, apenas_admin, destinatario_id)
  VALUES (
    NEW.paroquia_id,
    v_tipo_label || ': ' || left(NEW.titulo, 60),
    'De: ' || COALESCE(v_nome, 'membro') || ' — ' || left(NEW.descricao, 150),
    CASE WHEN NEW.tipo = 'situacao_urgente' THEN 'urgente' ELSE 'alerta' END,
    '/ocorrencias',
    true,   -- ← visível APENAS para coordenação
    NULL    -- ← sem destinatário individual: todos os admins da paróquia veem
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_membro ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_membro
  AFTER INSERT ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_membro();

-- ── 3b. Ocorrência respondida/atualizada → notifica O MEMBRO ────
-- apenas_admin = false + destinatario_id = membro_id:
-- somente o membro que abriu recebe.
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_respondida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Sem mudanças relevantes → sai sem notificar
  IF (
    OLD.resposta IS NOT DISTINCT FROM NEW.resposta
    AND OLD.status IS NOT DISTINCT FROM NEW.status
  ) THEN
    RETURN NEW;
  END IF;

  -- Nova resposta da coordenação
  IF NEW.resposta IS NOT NULL AND (OLD.resposta IS NULL OR OLD.resposta <> NEW.resposta) THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Sua ocorrência recebeu resposta',
      left(NEW.resposta, 200),
      'aviso',
      '/portal-membro/ocorrencias',
      false   -- ← membro pode ver
    );
    RETURN NEW;
  END IF;

  -- Mudança de status
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      CASE NEW.status
        WHEN 'em_analise' THEN 'Sua ocorrência está em análise'
        WHEN 'resolvida'  THEN 'Sua ocorrência foi resolvida'
        WHEN 'arquivada'  THEN 'Sua ocorrência foi arquivada'
        ELSE 'Ocorrência atualizada: ' || NEW.status
      END,
      '"' || left(NEW.titulo, 80) || '"',
      'sistema',
      '/portal-membro/ocorrencias',
      false   -- ← membro pode ver
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_respondida ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_respondida
  AFTER UPDATE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_respondida();

-- ── 3c. Escala → notifica SOMENTE o membro escalado ─────────────
-- destinatario_id = membro escalado; apenas_admin = false.
-- Nenhum outro membro recebe esta notificação.
CREATE OR REPLACE FUNCTION public._notify_escala_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_titulo   text;
  v_data     date;
  v_paroquia uuid;
BEGIN
  SELECT e.titulo, e.data, e.paroquia_id
  INTO   v_titulo, v_data, v_paroquia
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
  VALUES (
    v_paroquia,
    NEW.membro_id,   -- ← APENAS o membro escalado
    'Você foi escalado(a): ' || COALESCE(v_titulo, 'nova escala'),
    'Data: ' || to_char(COALESCE(v_data, CURRENT_DATE), 'DD/MM/YYYY') ||
      '. Acesse o portal para confirmar sua participação.',
    'aviso',
    '/portal-membro/escalas',
    false            -- ← membro pode ver
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_escala_membro ON public.escala_membros;
CREATE TRIGGER notify_escala_membro
  AFTER INSERT ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_escala_membro();

-- ── 3d. Garante que NÃO existe trigger de "escala publicada global"
-- (notificação broadcast quando status muda para 'publicada').
-- Se existir qualquer versão desse trigger, removemos aqui.
DROP TRIGGER IF EXISTS notify_escala_publicada    ON public.escalas;
DROP TRIGGER IF EXISTS notify_escala_status       ON public.escalas;
DROP TRIGGER IF EXISTS trg_notify_escala_publish  ON public.escalas;
DROP FUNCTION IF EXISTS public._notify_escala_publicada() CASCADE;
DROP FUNCTION IF EXISTS public._notify_escala_status()    CASCADE;

-- ══════════════════════════════════════════════════════════════════
-- 4. ÍNDICES de performance para as novas queries filtradas
-- ══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS notificacoes_destinatario_apenas_admin_idx
  ON public.notificacoes(destinatario_id, apenas_admin, lida);

CREATE INDEX IF NOT EXISTS notificacoes_paroquia_apenas_admin_idx
  ON public.notificacoes(paroquia_id, apenas_admin, lida);

CREATE INDEX IF NOT EXISTS ocorrencias_membro_paroquia_idx
  ON public.ocorrencias_membros(membro_id, paroquia_id, status);

-- ══════════════════════════════════════════════════════════════════
-- 5. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO:
--
-- Políticas de notificacoes:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notificacoes';
-- → notif_membro_read, notif_membro_mark_read, notif_membro_delete, notif_admin_manage
--
-- Políticas de ocorrencias_membros:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ocorrencias_membros';
-- → ocorrencia_membro_read, ocorrencia_membro_insert, ocorrencia_membro_delete,
--   ocorrencia_admin_read, ocorrencia_admin_update, ocorrencia_admin_delete
--
-- Triggers ativos:
-- SELECT trigger_name, event_object_table FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
-- AND trigger_name LIKE 'notify_%'
-- ORDER BY event_object_table, trigger_name;
-- → notify_escala_membro (escala_membros)
-- → notify_ocorrencia_membro, notify_ocorrencia_respondida (ocorrencias_membros)
-- (NÃO deve existir nenhum notify_*escala_publicada* em escalas)
--
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ TRUNCATE limpou todas as notificações legadas
--   ✓ Membro A não vê notificações do Membro B
--   ✓ Membro não vê ocorrências de outros membros
--   ✓ Ocorrência nova → SOMENTE admin recebe notificação
--   ✓ Resposta da coord → SOMENTE o membro que abriu recebe
--   ✓ Escala → SOMENTE o membro escalado recebe
--   ✓ Publicar escala → NÃO gera notificação para membros não escalados
-- ─────────────────────────────────────────────────────────────────
