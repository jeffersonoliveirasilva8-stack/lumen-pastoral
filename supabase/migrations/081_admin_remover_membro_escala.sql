-- Migration 081 — Função admin para remover membro de escala publicada
--
-- Permite ao coordenador/admin:
--   - Abrir uma vaga de substituição (cria substituicoes com status='solicitada')
--   - Aplicar penalidade de pontos (atualiza escala_membros.status → trigger de pontuação)
--   - Remover definitivamente (deleta a linha)
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 022–026 aplicadas

-- ══════════════════════════════════════════════════════════════
-- 1. RPC principal
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
  -- Busca dados da atribuição
  SELECT em.membro_id, e.paroquia_id
  INTO   v_membro_id, v_paroquia_id
  FROM   public.escala_membros em
  JOIN   public.escalas e ON e.id = em.escala_id
  WHERE  em.id = p_escala_membro_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atribuição não encontrada';
  END IF;

  -- Verificação de acesso (mesmo contexto de paróquia do chamador)
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
    -- ── Modo: abrir vaga ──────────────────────────────────────
    -- Mantém o row de escala_membros; cria substituição solicitada

    -- Verifica se já existe substituição ativa
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
    -- ── Modo: remover definitivamente ─────────────────────────
    -- O status já foi atualizado acima (penalidade), então o trigger
    -- de pontuação disparou e o historico_participacoes foi registrado.
    -- Deletar o row não remove historico (FK é para escalas.id, não escala_membros.id).
    DELETE FROM public.escala_membros WHERE id = p_escala_membro_id;

    RETURN jsonb_build_object('acao', 'removido');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_remover_membro_escala(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
