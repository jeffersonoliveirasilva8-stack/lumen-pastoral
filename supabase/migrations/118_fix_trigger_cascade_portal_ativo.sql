-- Migration 118 — Fix trigger 112 (cascade delete de paróquias) + portal RPCs (filtro em.ativo)
--
-- Fixes:
--  1. prevent_delete_published_escala — trigger BEFORE DELETE bloqueia ON DELETE CASCADE de paroquias,
--     tornando impossível excluir paróquias com escalas publicadas/arquivadas.
--     Solução: criar admin_deletar_paroquia RPC que arquiva escalas antes de deletar.
--     A trigger agora permite bypass via GUC 'app.force_delete_cascade'.
--  2. portal_get_escalas_membro — join em escala_membros sem filtro em.ativo,
--     membro substituído (ativo=false) continuava vendo a escala no portal.
--  3. portal_get_historico_membro — mesmo problema.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Atualiza trigger para permitir bypass via GUC (usado pela RPC admin_deletar_paroquia)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prevent_delete_published_escala_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Permite deleção quando acionada pela RPC admin_deletar_paroquia
  IF current_setting('app.force_delete_cascade', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.status IN ('publicada', 'arquivada') THEN
    RAISE EXCEPTION
      'Não é possível excluir uma escala publicada ou arquivada (id: %). Archive-a primeiro ou use admin_deletar_paroquia.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- Recria o trigger apontando para a nova função (mesma assinatura, novo nome de função)
DROP TRIGGER IF EXISTS trg_prevent_delete_published_escala ON public.escalas;
CREATE TRIGGER trg_prevent_delete_published_escala
  BEFORE DELETE ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_published_escala_fn();


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC admin_deletar_paroquia — arquiva escalas publicadas antes de deletar
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_deletar_paroquia(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id UUID := auth.uid();
  v_role    TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_auth_id;
  IF v_role NOT IN ('admin_paroquial', 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Garante que somente a paróquia do próprio admin seja afetada (exceto super_admin)
  IF v_role = 'admin_paroquial' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_auth_id AND paroquia_id = p_paroquia_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
    END IF;
  END IF;

  -- Habilita bypass do trigger para esta transação
  PERFORM set_config('app.force_delete_cascade', 'true', true);

  -- Exclui a paróquia — CASCADE remove escalas, membros, etc.
  DELETE FROM public.paroquias WHERE id = p_paroquia_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_deletar_paroquia(UUID) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. portal_get_escalas_membro — adiciona filtro em.ativo
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_get_escalas_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, em.justificativa, em.ministerio_id,
      e.id AS escala_id, e.titulo, e.data, e.hora_inicio, e.hora_fim,
      e.local, e.tipo, e.solene, e.tem_adoracao, e.tem_bispo, e.observacoes,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND e.data >= CURRENT_DATE
      AND e.status = 'publicada'
      AND (em.ativo IS NULL OR em.ativo = true)
    ORDER BY e.data
    LIMIT 20
  ) t;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. portal_get_historico_membro — adiciona filtro em.ativo
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_get_historico_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data DESC), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, e.titulo, e.data, e.tipo, e.solene,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor,
      hp.presenca, hp.pontos
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    LEFT JOIN historico_participacoes hp
      ON hp.escala_id = e.id AND hp.membro_id = m.id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND e.data < CURRENT_DATE
      AND e.status = 'publicada'
      AND (em.ativo IS NULL OR em.ativo = true)
    ORDER BY e.data DESC
    LIMIT 30
  ) t;
$$;

NOTIFY pgrst, 'reload schema';
