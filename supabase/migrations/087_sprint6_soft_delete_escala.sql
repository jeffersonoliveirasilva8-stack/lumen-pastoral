-- Migration 087 — Sprint 6: soft-delete em escala_membros
--
-- 1. Adiciona coluna removido_em para registrar data/hora da remoção
-- 2. Atualiza admin_remover_membro_escala para usar ativo=false em vez de DELETE
--
-- IDEMPOTENTE: sim

ALTER TABLE public.escala_membros
  ADD COLUMN IF NOT EXISTS removido_em TIMESTAMPTZ;

-- ══════════════════════════════════════════════════════════════
-- RPC atualizada: soft-delete em vez de hard DELETE
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_remover_membro_escala(
  p_escala_membro_id  UUID,
  p_motivo            TEXT    DEFAULT NULL,
  p_abrir_vaga        BOOLEAN DEFAULT FALSE,
  p_penalidade        TEXT    DEFAULT 'nenhuma'  -- 'nenhuma' | 'justificou' | 'faltou'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id UUID;
  v_membro_id   UUID;
  v_sub_id      UUID;
BEGIN
  -- Busca dados da atribuição (somente linhas ainda ativas)
  SELECT em.membro_id, e.paroquia_id
  INTO   v_membro_id, v_paroquia_id
  FROM   public.escala_membros em
  JOIN   public.escalas e ON e.id = em.escala_id
  WHERE  em.id = p_escala_membro_id
    AND  em.ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atribuição não encontrada ou já removida';
  END IF;

  -- Verificação de acesso
  IF v_paroquia_id <> public.current_paroquia_id() THEN
    RAISE EXCEPTION 'Acesso não autorizado';
  END IF;

  -- Aplica penalidade (muda status → dispara trigger de pontuação automática)
  IF p_penalidade IN ('justificou', 'faltou') THEN
    UPDATE public.escala_membros
    SET    status = p_penalidade
    WHERE  id = p_escala_membro_id;
  END IF;

  IF p_abrir_vaga THEN
    -- Mantém o row; cria substituição solicitada
    SELECT id INTO v_sub_id
    FROM   public.substituicoes
    WHERE  escala_membro_id = p_escala_membro_id
      AND  status NOT IN ('cancelada', 'rejeitada')
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.substituicoes
        (paroquia_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
      VALUES
        (v_paroquia_id, p_escala_membro_id, v_membro_id, p_motivo, 'solicitada')
      RETURNING id INTO v_sub_id;
    END IF;

    RETURN jsonb_build_object('acao', 'vaga_aberta', 'substituicao_id', v_sub_id);
  ELSE
    -- Soft-delete: ativo=false + registro de quando foi removido
    UPDATE public.escala_membros
    SET    ativo = false,
           removido_em = now()
    WHERE  id = p_escala_membro_id;

    RETURN jsonb_build_object('acao', 'removido');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_remover_membro_escala(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
