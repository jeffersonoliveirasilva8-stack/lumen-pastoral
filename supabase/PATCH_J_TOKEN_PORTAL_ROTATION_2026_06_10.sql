-- ============================================================
-- PATCH_J — Auditoria e rotação de paroquias.token_portal
-- Data: 2026-06-10
-- Problema: token_portal é estático e eterno.
--           Se vazado, qualquer pessoa pode listar os membros ativos
--           da paróquia indefinidamente.
-- Solução:
--   1. Adicionar created_at e last_rotated_at ao token
--   2. Função admin para rotacionar manualmente
--   3. Sem rotação automática (quebraria QR codes/links em uso)
--      — deixar para a coordenação decidir quando rodar
-- ============================================================
-- Execute no SQL Editor do Supabase (painel admin).
-- ============================================================

-- ── 1. Metadados do token ──────────────────────────────────────────────

ALTER TABLE public.paroquias
  ADD COLUMN IF NOT EXISTS token_portal_generated_at TIMESTAMPTZ DEFAULT now();

-- Backfill: registros existentes sem data assumem "criado agora"
UPDATE public.paroquias
SET token_portal_generated_at = now()
WHERE token_portal_generated_at IS NULL;

-- ── 2. Garantir índice único no token ─────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS paroquias_token_portal_unique_idx
  ON public.paroquias (token_portal)
  WHERE token_portal IS NOT NULL;

-- ── 3. Garantir que todo INSERT gere um token único ────────────────────

ALTER TABLE public.paroquias
  ALTER COLUMN token_portal SET DEFAULT gen_random_uuid();

-- ── 4. Função de rotação manual (admin da paróquia ou super_admin) ─────

CREATE OR REPLACE FUNCTION public.rotacionar_token_portal(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_paroquia UUID;
  v_caller_roles TEXT[];
  v_novo_token UUID;
BEGIN
  -- Valida quem está chamando
  SELECT current_paroquia_id() INTO v_caller_paroquia;
  SELECT array_agg(role) INTO v_caller_roles
    FROM user_roles WHERE user_id = auth.uid();

  -- Só pode rotar o próprio token (ou super_admin qualquer)
  IF p_paroquia_id <> v_caller_paroquia
     AND NOT ('super_admin' = ANY(v_caller_roles)) THEN
    RAISE EXCEPTION 'Acesso negado: você só pode rotacionar o token da sua própria paróquia.';
  END IF;

  -- Restringe a admins e coordenadores
  IF NOT (
    'admin_paroquial' = ANY(v_caller_roles) OR
    'coordenador'     = ANY(v_caller_roles) OR
    'super_admin'     = ANY(v_caller_roles)
  ) THEN
    RAISE EXCEPTION 'Permissão insuficiente: requer admin_paroquial, coordenador ou super_admin.';
  END IF;

  v_novo_token := gen_random_uuid();

  UPDATE public.paroquias
  SET token_portal           = v_novo_token,
      token_portal_generated_at = now()
  WHERE id = p_paroquia_id;

  RETURN jsonb_build_object(
    'success', true,
    'novo_token', v_novo_token,
    'aviso', 'Links e QR codes anteriores param de funcionar imediatamente. Distribua o novo link para os membros.'
  );
END;
$$;

COMMENT ON FUNCTION public.rotacionar_token_portal(UUID) IS
  'Gera novo token_portal para a paróquia. Links antigos são invalidados imediatamente.
   Usar quando: coordenador sai, link foi compartilhado além do esperado, ou por política de segurança.
   Chamar: SELECT rotacionar_token_portal(''<paroquia_id>'');';

-- Permissão para autenticados (a função valida internamente quem pode chamar)
GRANT EXECUTE ON FUNCTION public.rotacionar_token_portal(UUID) TO authenticated;

-- ── 5. Avaliação de risco atual ───────────────────────────────────────

/*
  ANÁLISE DO RISCO DE token_portal
  ─────────────────────────────────
  O que expõe:
    - Nome, cidade e diocese da paróquia (público)
    - Lista de membros ATIVOS (apenas nome + id)
    - Sem e-mail, CPF, telefone ou qualquer dado sensível

  Risco de enumeração:
    - UUID v4: 2^122 possibilidades ≈ 5×10^36
    - Força bruta: inviável (anos mesmo com hardware moderno)
    - Não há endpoint de "buscar paróquia por token" com lista pública de tokens

  Quando rotar:
    - Coordenador da paróquia é desligado e tinha acesso ao link
    - Link foi compartilhado em canal público sem intenção
    - Política de segurança da diocese exige rotação semestral
    - Incidente de segurança confirmado

  Quando NÃO rotar automaticamente:
    - Quebraria todos os QR codes impressos e links salvos
    - Membros não conseguiriam mais acessar o portal até receber novo link

  Conclusão: risco BAIXO com as informações expostas atuais.
  Monitorar se o escopo dos dados no portal.$token aumentar no futuro.
*/

-- ── 6. Verificação ─────────────────────────────────────────────────────

SELECT
  id,
  nome,
  token_portal IS NOT NULL AS tem_token,
  token_portal_generated_at
FROM public.paroquias
ORDER BY nome
LIMIT 20;
