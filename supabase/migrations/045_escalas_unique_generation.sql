-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 045 — Idempotência na geração de escalas
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Problema: o Assistente de Geração V2 não verificava existência antes de
-- inserir, permitindo duplicatas ao abrir duas abas simultaneamente.
--
-- Solução:
--   1. Remove duplicatas existentes (mantém a mais antiga — menor id)
--   2. Adiciona UNIQUE INDEX em (paroquia_id, data, titulo)
--      Permite que o INSERT do frontend falhe silenciosamente se a escala
--      já existir (ON CONFLICT DO NOTHING na camada de aplicação).
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remover duplicatas — manter o registro mais antigo (menor created_at/id)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.escalas
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY paroquia_id, data, titulo
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.escalas
  ) sub
  WHERE rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UNIQUE INDEX — garante unicidade no banco independente do front-end
--    Usa CONCURRENTLY para não bloquear a tabela em produção.
--    Nota: CONCURRENTLY não pode rodar dentro de uma transação; migrações
--    Supabase são executadas fora de bloco BEGIN/COMMIT por padrão.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS escalas_paroquia_data_titulo_unique
  ON public.escalas (paroquia_id, data, titulo);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Comentário descritivo para documentação do schema
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON INDEX public.escalas_paroquia_data_titulo_unique IS
  'Impede duplicação de escalas geradas pelo Assistente V2. '
  'A mesma celebração (mesmo título + data + paróquia) só pode existir uma vez.';
