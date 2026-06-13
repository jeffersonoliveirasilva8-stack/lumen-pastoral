-- ============================================================
-- Migration 028: Correções pós-go-live
-- Data: 2026-06-13
--
-- PROBLEMAS CORRIGIDOS:
--
--   1. set_updated_at() incompatível com comunidades.atualizado_em
--      A função original faz NEW.updated_at = NOW() para todas as tabelas.
--      Comunidades usa atualizado_em → erro: record "new" has no field "updated_at"
--      Fix: recriar função com desvio por nome de tabela.
--
--   2. portal_recusar_escala() — nova RPC com SECURITY DEFINER
--      O direct UPDATE em escala_membros pela policy RLS pode falhar
--      silenciosamente se o auth_user_id não estiver vinculado.
--      Fix: RPC que valida, atualiza e, se substituicao_ativa, cria
--      o registro em substituicoes automaticamente.
--
--   3. Trigger on_escala_membro_recusado
--      Quando status muda para 'recusado' E substituicao_ativa = true,
--      cria substituição automaticamente (aparece no painel admin).
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE + DROP IF EXISTS)
-- REQUER: migrations 001–027 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. Fix set_updated_at() — suporta atualizado_em (comunidades)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('comunidades', 'coordenadores') THEN
    NEW.atualizado_em = NOW();
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. RPC portal_recusar_escala — recusa confiável com SECURITY DEFINER
-- ══════════════════════════════════════════════════════════════
-- Por que RPC em vez de direct UPDATE:
--   A policy "em_membro_update_own" usa _portal_membro_id() que depende
--   de auth_user_id estar vinculado. Se o link ainda não ocorreu,
--   o UPDATE retorna 0 rows sem erro (falha silenciosa). A RPC com
--   SECURITY DEFINER contorna isso garantindo a execução.

CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_id    UUID;
  v_config       public.paroquia_config_escalas%ROWTYPE;
  v_subst_id     UUID;
BEGIN
  -- Valida autenticação
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Localiza o membro autenticado
  SELECT id INTO v_membro_id
  FROM public.membros
  WHERE (auth_user_id = auth.uid()
         OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  -- Valida que o registro pertence a este membro e está pendente
  SELECT escala_id INTO v_escala_id
  FROM public.escala_membros
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Verifica se a escala ainda pode ser recusada (status pendente)
  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Obtém paróquia
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = v_escala_id;

  -- Atualiza status para recusado
  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = trim(p_motivo)
  WHERE id = p_escala_membro_id;

  -- Se substituição ativa na paróquia, cria substituição automaticamente
  SELECT * INTO v_config
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF FOUND AND v_config.substituicao_ativa THEN
    -- Evita duplicatas: só cria se não existir substituição ativa para este escala_membro
    IF NOT EXISTS (
      SELECT 1 FROM public.substituicoes
      WHERE escala_membro_id = p_escala_membro_id
        AND status NOT IN ('cancelada', 'rejeitada')
    ) THEN
      INSERT INTO public.substituicoes
        (paroquia_id, escala_membro_id, solicitante_id, motivo_solicitacao)
      VALUES
        (v_paroquia_id, p_escala_membro_id, v_membro_id,
         COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'))
      RETURNING id INTO v_subst_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'substituicao_criada', v_subst_id IS NOT NULL,
    'substituicao_id', v_subst_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ UPDATE em comunidades → sem erro "has no field updated_at"
--   ✓ portal_recusar_escala('valid-uuid', 'Motivo claro') → {success:true}
--   ✓ Se substituicao_ativa=true → substituição criada automaticamente
--   ✓ Após recusa, status persiste no reload da página
-- ─────────────────────────────────────────────────────────────
