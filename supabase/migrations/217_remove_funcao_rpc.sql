-- Migration 217 — RPC remove_funcao: remoção transacional de função de escala
--
-- Atomicamente:
-- 1. Valida autenticação e permissão do usuário
-- 2. Identifica escala e ministério pela função
-- 3. Soft-delete em escala_membros (ativo=false, removido_em=now())
-- 4. DELETE em escala_funcoes
-- Preserva: histórico de participação, pontuação, convocação geral,
--           outras funções do mesmo membro, vínculos de outras escalas.

CREATE OR REPLACE FUNCTION public.remove_funcao(p_funcao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_escala_id   UUID;
  v_ministerio  UUID;
  v_paroquia_id UUID;
  v_escala_status TEXT;
  v_rows_updated  INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Captura escala e ministério da função
  SELECT ef.escala_id, ef.ministerio_id, e.paroquia_id, e.status
  INTO   v_escala_id, v_ministerio, v_paroquia_id, v_escala_status
  FROM   public.escala_funcoes ef
  JOIN   public.escalas e ON e.id = ef.escala_id
  WHERE  ef.id = p_funcao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'funcao_nao_encontrada');
  END IF;

  -- Verifica permissão: admin da paróquia ou coordenador/auxiliar
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.paroquia_id = v_paroquia_id
        AND (m.auth_user_id = v_auth_id
             OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
        AND m.ativo = true
        AND m.tipo_acesso IN ('auxiliar','coordenador','administrador','vice')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Soft-delete dos membros vinculados a esta função nesta escala
  -- Escopo preciso: escala_id + ministerio_id + ativo — não toca outras escalas
  UPDATE public.escala_membros
  SET    ativo       = false,
         removido_em = now()
  WHERE  escala_id     = v_escala_id
    AND  ministerio_id = v_ministerio
    AND  (ativo IS NULL OR ativo = true);

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Remove a definição de função (ON DELETE CASCADE em escala_membros não existe,
  -- soft-delete foi feito manualmente acima)
  DELETE FROM public.escala_funcoes WHERE id = p_funcao_id;

  RETURN jsonb_build_object(
    'success',         true,
    'membros_removidos', v_rows_updated
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_funcao(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_funcao(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.remove_funcao(UUID) TO authenticated;
