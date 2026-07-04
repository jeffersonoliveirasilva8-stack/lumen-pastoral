-- Migration 085 — Corrige admin_remover_membro_escala em produção
--
-- PROBLEMA: a migration 081 introduziu a função mas pode não ter sido aplicada
-- em produção; a versão em execução tem mensagem diferente e falha com
-- "Atribuição não encontrada ou já removida" para qualquer membro de
-- escala publicada.
--
-- CAUSA RAIZ: o SELECT dentro da função pode ser bloqueado por RLS quando
-- a versão em produção não possui SET row_security = off. Como a tabela
-- escala_membros tem RLS ativo, qualquer função sem esse flag pode não
-- ver a linha mesmo sendo SECURITY DEFINER com owner = postgres.
--
-- FIX: re-aplica a função com SET row_security = off garantindo que o
-- SELECT sempre encontra a linha (a verificação de paróquia garante
-- que o acesso é seguro).
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 022–026 aplicadas

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
SET row_security = off
AS $$
DECLARE
  v_paroquia_id UUID;
  v_membro_id   UUID;
  v_sub_id      UUID;
BEGIN
  -- Busca dados da atribuição (row_security=off garante visibilidade mesmo com RLS)
  SELECT em.membro_id, e.paroquia_id
  INTO   v_membro_id, v_paroquia_id
  FROM   public.escala_membros em
  JOIN   public.escalas e ON e.id = em.escala_id
  WHERE  em.id = p_escala_membro_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atribuição não encontrada';
  END IF;

  -- Verificação de acesso: apenas usuários da mesma paróquia
  IF v_paroquia_id IS DISTINCT FROM public.current_paroquia_id() THEN
    RAISE EXCEPTION 'Acesso não autorizado';
  END IF;

  -- Aplica penalidade: muda status → dispara trigger de pontuação automática
  IF p_penalidade IN ('justificou', 'faltou') THEN
    UPDATE public.escala_membros
    SET    status = p_penalidade
    WHERE  id = p_escala_membro_id;
  END IF;

  IF p_abrir_vaga THEN
    -- ── Modo: abrir vaga ──────────────────────────────────────
    -- Mantém a linha de escala_membros; cria substituição solicitada

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
    -- Penalidade (se houver) já foi aplicada acima e o trigger
    -- de pontuação já registrou o histórico_participacoes.
    DELETE FROM public.escala_membros WHERE id = p_escala_membro_id;

    RETURN jsonb_build_object('acao', 'removido');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_remover_membro_escala(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_remover_membro_escala(UUID, TEXT, BOOLEAN, TEXT) FROM anon;

COMMENT ON FUNCTION public.admin_remover_membro_escala(UUID, TEXT, BOOLEAN, TEXT)
  IS 'Remove ou abre vaga de substituição para membro em escala publicada. Requer acesso à mesma paróquia. row_security=off garante visibilidade independente de RLS.';

NOTIFY pgrst, 'reload schema';
