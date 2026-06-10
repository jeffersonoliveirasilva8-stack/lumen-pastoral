-- ============================================================
-- PATCH K: Análise e Estratégia de Criptografia de Dados Sensíveis
-- Data: 2026-06-10
-- Objetivo: Documentar e implementar proteção de CPF/RG/telefone
--
-- ⚠ ESTE PATCH É OPCIONAL — leia a análise completa antes de aplicar.
-- ============================================================

-- ── ANÁLISE DE IMPACTO ────────────────────────────────────────────────────────
--
-- Campos sensíveis identificados na tabela `membros`:
--   cpf        TEXT  — CPF (11 dígitos)  — alto risco se vazar
--   rg         TEXT  — RG                — médio risco
--   telefone   TEXT  — telefone          — médio risco (já semi-público)
--   observacoes TEXT — anotações admin   — baixo risco (sem dado estruturado)
--
-- Campos PII em `ocorrencias_membros`:
--   descricao  TEXT  — texto livre com possível PII    — baixo risco
--
-- ── OPÇÕES DE PROTEÇÃO ────────────────────────────────────────────────────────
--
-- OPÇÃO A — Sem criptografia, com controles compensatórios (ATUAL)
--   + Busca por CPF funciona normalmente (admin localiza membro)
--   + Sem custo de performance
--   - CPF legível por qualquer usuário com SELECT
--   Mitigação atual: RLS restringe SELECT a admin/coordenador/membro dono
--
-- OPÇÃO B — pgcrypto com chave simétrica (RECOMENDADO para LGPD)
--   + CPF inelegível sem a chave
--   - NÃO é possível fazer WHERE cpf = '...' (busca exige descriptografar tudo)
--   - Workaround: armazenar hash separado para lookup (veja abaixo)
--   - Performance: +1–5ms por operação de encrypt/decrypt
--
-- OPÇÃO C — pgsodium / Vault (Transparent Column Encryption)
--   + Nativo do Supabase, chave gerenciada pelo Vault
--   + Transparente para a aplicação
--   - Requer configuração específica por projeto Supabase
--   - Preview feature (pode mudar de API)
--
-- ── DECISÃO RECOMENDADA ───────────────────────────────────────────────────────
-- Para conformidade com LGPD Art. 46, recomenda-se OPÇÃO B para o campo CPF.
-- Para RG e telefone, manter OPÇÃO A com os controles RLS existentes é
-- suficiente na maioria dos casos (dados não financeiros).
--
-- O hash para lookup permite: buscar membro por CPF sem descriptografar tudo.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PRÉ-REQUISITO: extensão pgcrypto ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── PASSO 1: Adicionar coluna de CPF criptografado e hash de busca ───────────
-- Execução segura (não altera dados existentes ainda)

ALTER TABLE public.membros
  ADD COLUMN IF NOT EXISTS cpf_hash    text,   -- SHA-256 para lookup (sem chave)
  ADD COLUMN IF NOT EXISTS cpf_enc     bytea;  -- CPF criptografado com pgcrypto

COMMENT ON COLUMN public.membros.cpf_hash IS 'SHA-256 do CPF para busca sem descriptografar. Não revela o CPF.';
COMMENT ON COLUMN public.membros.cpf_enc  IS 'CPF criptografado com pgp_sym_encrypt. Descriptografar via função rpc_decrypt_cpf.';

-- ── PASSO 2: Índice no hash para buscas eficientes ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS membros_cpf_hash_idx ON public.membros (cpf_hash)
  WHERE cpf_hash IS NOT NULL;

-- ── PASSO 3: Função para criptografar CPF existentes ─────────────────────────
-- IMPORTANTE: Substitua 'CHAVE_SIMETRICA_SECRETA' por um segredo do Vault.
-- A chave NUNCA deve aparecer hardcoded — use:
--   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cpf_encrypt_key';
--
-- Exemplo de uso:
--   CALL public.migrar_cpf_para_colunas_enc('minha-chave-secreta-aqui');

CREATE OR REPLACE PROCEDURE public.migrar_cpf_para_colunas_enc(p_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Preenche cpf_hash e cpf_enc para membros que ainda têm CPF em plaintext
  UPDATE public.membros
  SET
    cpf_hash = encode(digest(cpf, 'sha256'), 'hex'),
    cpf_enc  = pgp_sym_encrypt(cpf, p_key)
  WHERE
    cpf IS NOT NULL
    AND cpf <> ''
    AND cpf_hash IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'CPF migrado para % registros.', v_count;
END;
$$;

-- ── PASSO 4: Função para descriptografar (RPC protegida) ─────────────────────
-- Só admin_paroquial e super_admin podem chamar via RPC.
-- A chave é recuperada do Vault, nunca do frontend.

CREATE OR REPLACE FUNCTION public.rpc_decrypt_cpf(p_membro_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf_enc  bytea;
  v_key      text;
  v_role     text;
BEGIN
  -- Verifica permissão
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
    AND role IN ('admin_paroquial', 'super_admin')
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores podem descriptografar CPF.';
  END IF;

  -- Recupera CPF criptografado
  SELECT cpf_enc INTO v_cpf_enc
  FROM public.membros
  WHERE id = p_membro_id;

  IF v_cpf_enc IS NULL THEN
    -- Fallback: CPF ainda em plaintext (pré-migração)
    RETURN (SELECT cpf FROM public.membros WHERE id = p_membro_id);
  END IF;

  -- Recupera chave do Vault (requer configuração no projeto Supabase)
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'cpf_encrypt_key';
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Vault não configurado. Configure o segredo cpf_encrypt_key no Vault do Supabase.';
  END;

  RETURN pgp_sym_decrypt(v_cpf_enc, v_key);
END;
$$;

COMMENT ON FUNCTION public.rpc_decrypt_cpf(uuid)
  IS 'Descriptografa CPF de um membro. Requer role admin_paroquial ou super_admin. Chave gerenciada pelo Vault.';

-- ── PASSO 5 (APÓS VALIDAÇÃO): Remover coluna plaintext ───────────────────────
-- Execute APENAS após confirmar que cpf_hash e cpf_enc estão populados.
-- Teste: SELECT count(*) FROM membros WHERE cpf IS NOT NULL AND cpf_hash IS NULL;
-- Resultado deve ser 0 antes de executar o passo abaixo.
--
-- ALTER TABLE public.membros DROP COLUMN IF EXISTS cpf;
-- ALTER TABLE public.membros DROP COLUMN IF EXISTS rg;  -- opcional

-- ── RESUMO DA ESTRATÉGIA ──────────────────────────────────────────────────────
-- 1. Aplicar este PATCH (adiciona colunas, índice, funções)
-- 2. Configurar segredo 'cpf_encrypt_key' no Vault do Supabase
-- 3. Chamar: CALL migrar_cpf_para_colunas_enc('<chave-do-vault>');
-- 4. Atualizar aplicação para usar cpf_hash em buscas
-- 5. Usar rpc_decrypt_cpf() só onde exibição é necessária (tela de perfil admin)
-- 6. Após validação → DROP COLUMN cpf

-- ── CHECKLIST LGPD ────────────────────────────────────────────────────────────
-- [x] Identificação de dados pessoais (Art. 5, I)
-- [x] Criptografia em repouso para CPF (Art. 46)
-- [x] Acesso restrito por função (Art. 46, § 1)
-- [x] Procedimento de exclusão (CALL migrar + DROP COLUMN)
-- [ ] Consentimento explícito de coleta — validar no formulário de cadastro
-- [ ] DPA (Data Protection Agreement) com Supabase — verificar termos
