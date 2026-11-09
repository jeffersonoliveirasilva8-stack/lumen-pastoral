-- Migration 191 — FASE 6C P7: FK escala_id ON DELETE RESTRICT + admin_deletar_paroquia adaptada
--
-- PROBLEMA (P7): historico_participacoes.escala_id era ON DELETE CASCADE, permitindo
-- que qualquer DELETE direto em escalas (via service role, SQL ou migration) apagasse
-- silenciosamente o histórico de presença. O único guard era frontend.
--
-- SOLUÇÃO:
--   1. Trocar ON DELETE CASCADE → ON DELETE RESTRICT na FK escala_id.
--      Qualquer tentativa de deletar escala com histórico falhará com SQLSTATE 23001
--      (restrict_violation) no banco, independente da interface de acesso.
--   2. Adaptar admin_deletar_paroquia para excluir explicitamente os registros de
--      historico_participacoes vinculados às escalas da paróquia ANTES de deletar
--      a paróquia — necessário porque a FK RESTRICT impede que o CASCADE de paroquias
--      processe historico via escala_id, e a ordem de processamento de FKs de um mesmo
--      DELETE não é garantida pelo PostgreSQL.
--
-- Preservado:
--   - Nulabilidade de escala_id (criada em migration 038)
--   - Registros com escala_id IS NULL (eventos de agenda) não são afetados por RESTRICT
--   - Demais FKs de historico_participacoes (paroquia_id, membro_id, ministerio_id)
--   - Assinatura, tipo de retorno, autorização e todos os privilégios de admin_deletar_paroquia
--   - Mecanismo GUC app.force_delete_cascade para o trigger de publicadas/arquivadas

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. FK escala_id: CASCADE → RESTRICT (preservando nulabilidade)
-- ══════════════════════════════════════════════════════════════════════════════
-- O nome padrão gerado pelo PostgreSQL para a FK definida inline em migration 002 é
-- historico_participacoes_escala_id_fkey. A migration 038 tornou a coluna nullable
-- mas não recriou a constraint. O nome permanece o mesmo.

ALTER TABLE public.historico_participacoes
  DROP CONSTRAINT IF EXISTS historico_participacoes_escala_id_fkey;

ALTER TABLE public.historico_participacoes
  ADD CONSTRAINT historico_participacoes_escala_id_fkey
    FOREIGN KEY (escala_id)
    REFERENCES public.escalas(id)
    ON DELETE RESTRICT;

-- Nota: escala_id permanece nullable (DROP NOT NULL foi aplicado em migration 038).
-- RESTRICT em coluna nullable: NULL não viola a FK, portanto eventos com escala_id=NULL
-- continuam válidos e não são afetados por esta constraint.

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. admin_deletar_paroquia — recriada com limpeza explícita de histórico
-- ══════════════════════════════════════════════════════════════════════════════
-- Limpeza do histórico vinculado a escalas da paróquia deve ocorrer ANTES do
-- DELETE FROM paroquias, pois a FK RESTRICT impede que o cascade de paróquia
-- (via escalas.paroquia_id CASCADE) processe historico_participacoes.escala_id.
-- Toda a operação é transacional: qualquer falha reverte automaticamente.
--
-- DROP necessário: produção tem RETURNS void; esta versão retorna JSONB.
-- PostgreSQL não aceita CREATE OR REPLACE com mudança de tipo de retorno.
DROP FUNCTION IF EXISTS public.admin_deletar_paroquia(UUID);

CREATE OR REPLACE FUNCTION public.admin_deletar_paroquia(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id        UUID    := auth.uid();
  v_is_super_admin BOOLEAN;
  v_is_admin_par   BOOLEAN;
BEGIN
  -- Autorização via user_roles (profiles não possui coluna role)
  SELECT
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_auth_id AND role = 'super_admin'),
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_auth_id AND role = 'admin_paroquial')
  INTO v_is_super_admin, v_is_admin_par;

  IF NOT (v_is_super_admin OR v_is_admin_par) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Garante que somente a paróquia do próprio admin seja afetada (exceto super_admin)
  IF v_is_admin_par AND NOT v_is_super_admin THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_auth_id AND paroquia_id = p_paroquia_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
    END IF;
  END IF;

  -- Remove histórico vinculado a escalas desta paróquia antes de deletá-las.
  -- Necessário porque escala_id agora é RESTRICT: o cascade de paroquias→escalas
  -- seria bloqueado se historico ainda referenciar escalas via escala_id.
  DELETE FROM public.historico_participacoes
  WHERE escala_id IN (
    SELECT id FROM public.escalas WHERE paroquia_id = p_paroquia_id
  );

  -- Habilita bypass do trigger trg_prevent_delete_published_escala para esta transação
  PERFORM set_config('app.force_delete_cascade', 'true', true);

  -- Exclui a paróquia — CASCADE remove escalas, membros, etc.
  DELETE FROM public.paroquias WHERE id = p_paroquia_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_deletar_paroquia(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deletar_paroquia(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_deletar_paroquia(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
