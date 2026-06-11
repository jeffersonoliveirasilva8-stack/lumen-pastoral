-- ============================================================
-- LUMEN PASTORAL — PATCH W: Correção de Segurança notif_membro_mark_read
-- Data: 2026-06-11
--
-- PROBLEMA (ALTO):
--   A policy "notif_membro_mark_read" usava WITH CHECK (true), o que permitia
--   que um membro autenticado modificasse QUALQUER coluna de uma notificação
--   que ele pudesse SELECT (inclusive titulo, mensagem, tipo, apenas_admin).
--   Isso incluía notificações broadcast (destinatario_id IS NULL), que são
--   comunicados gerais da coordenação visíveis por toda a paróquia.
--
-- CORREÇÃO:
--   1. A policy de UPDATE é substituída por RPC SECURITY DEFINER
--      portal_marcar_notificacao_lida(p_notif_id) que só altera lida=true.
--   2. A policy de UPDATE via tabela é removida para authenticated.
--      Apenas admins (via notif_admin_manage que tem ALL) podem UPDATE direto.
--   3. Frontend deve usar a RPC em vez de supabase.from("notificacoes").update().
--
-- DEPENDÊNCIA: PATCH_P deve estar aplicado (policy "notif_membro_mark_read" existe).
-- IDEMPOTENTE: sim
-- ============================================================

-- ── 1. Remove a policy de UPDATE permissiva ────────────────────────────────────

DROP POLICY IF EXISTS "notif_membro_mark_read" ON public.notificacoes;

-- ── 2. Cria RPC SECURITY DEFINER para marcar como lida ────────────────────────
-- Recebe o ID da notificação, verifica se pertence ao membro autenticado,
-- e só então define lida=true. Nenhuma outra coluna pode ser alterada.

CREATE OR REPLACE FUNCTION public.portal_marcar_notificacao_lida(p_notif_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id UUID;
  v_count     INT;
BEGIN
  -- Identifica o membro autenticado
  v_membro_id := (
    SELECT id FROM public.membros
    WHERE auth_user_id = auth.uid() AND ativo = true
    LIMIT 1
  );

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membro não encontrado');
  END IF;

  -- Atualiza apenas lida=true onde o membro tem acesso legítimo
  UPDATE public.notificacoes
  SET lida = true
  WHERE id = p_notif_id
    AND apenas_admin = false
    AND paroquia_id = (SELECT paroquia_id FROM public.membros WHERE id = v_membro_id)
    AND (
      destinatario_id IS NULL
      OR destinatario_id = v_membro_id
    )
    AND lida = false;  -- evita UPDATE desnecessário se já lida

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', v_count > 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_marcar_notificacao_lida TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_marcar_notificacao_lida FROM anon;

-- ── 3. Marcar todas como lidas (bulk) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.portal_marcar_todas_notificacoes_lidas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id  UUID;
  v_paroquia   UUID;
  v_count      INT;
BEGIN
  SELECT id, paroquia_id INTO v_membro_id, v_paroquia
  FROM public.membros
  WHERE auth_user_id = auth.uid() AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membro não encontrado');
  END IF;

  UPDATE public.notificacoes
  SET lida = true
  WHERE paroquia_id = v_paroquia
    AND apenas_admin = false
    AND (destinatario_id IS NULL OR destinatario_id = v_membro_id)
    AND lida = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_marcar_todas_notificacoes_lidas TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_marcar_todas_notificacoes_lidas FROM anon;

-- ── 4. Verificação ────────────────────────────────────────────────────────────
--
-- Após aplicar, confirme que a policy "notif_membro_mark_read" não existe:
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'notificacoes' AND cmd = 'UPDATE';
-- → Deve retornar apenas "notif_admin_manage" (se ela tiver FOR ALL)
--
-- Teste de segurança (deve retornar 0 rows ou erro de permissão):
-- UPDATE public.notificacoes SET titulo = 'hacked' WHERE id = '...' RETURNING *;
-- → Nenhum membro autenticado deve conseguir executar este UPDATE diretamente.
--
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ policy "notif_membro_mark_read" não existe mais (sem UPDATE direto)
--   ✓ RPC portal_marcar_notificacao_lida executável por authenticated
--   ✓ Membro não consegue modificar titulo/mensagem/tipo/apenas_admin via UPDATE direto
-- ─────────────────────────────────────────────────────────────────────────────
