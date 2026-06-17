-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 046 — Corrige índice único de escalas (inclui hora_inicio)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Causa raiz da falha da 045:
--   O erro "42P01: relation supabase_migrations does not exist" vem do CLI
--   do Supabase tentando registrar a execução — NÃO do conteúdo SQL da 045.
--   O SQL em si está correto, mas o projeto não possui a tabela de tracking
--   do CLI. Solução: executar sempre pelo SQL Editor do Dashboard.
--
-- Falha de design da 045:
--   O UNIQUE em (paroquia_id, data, titulo) é insuficiente.
--   Uma paróquia tipicamente tem múltiplas celebrações com o mesmo nome
--   ("Missa") no mesmo dia — diferenciadas apenas pelo hora_inicio.
--   Exemplo: "Missa" às 07:00, "Missa" às 10:00 e "Missa" às 19:00 no Domingo.
--   O índice antigo bloquearia erroneamente a segunda e a terceira.
--
--   Além disso, hora_inicio é nullable. No PostgreSQL, dois NULLs em uma
--   coluna de índice UNIQUE são tratados como DISTINTOS — escalas sem
--   hora_inicio não conflitariam entre si, deixando passar duplicatas.
--   Solução: COALESCE(hora_inicio, '00:00'::time) no índice funcional.
--
-- Chave única adotada:
--   (paroquia_id, data, titulo, COALESCE(hora_inicio, '00:00'::time))
--
-- Alinhamento frontend necessário (não aplicado aqui — ver nota abaixo):
--   O check SELECT em assistente-geracao.tsx (linha ~654) filtra apenas por
--   paroquia_id + data + titulo, ignorando hora_inicio. Após esta migration,
--   esse check também precisa incluir .eq("hora_inicio", cel.hora_inicio)
--   para evitar que a segunda missa do dia seja ignorada indevidamente.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Descartar o índice incompleto da migration 045 (se chegou a ser criado)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.escalas_paroquia_data_titulo_unique;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Remover duplicatas usando a chave AMPLIADA (paroquia_id, data, titulo,
--    hora_inicio). COALESCE garante que NULLs sejam agrupados corretamente,
--    espelhando exatamente o comportamento do índice criado no passo 3.
--    Mantém o registro mais antigo (menor created_at, depois menor id).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.escalas
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          paroquia_id,
          data,
          titulo,
          COALESCE(hora_inicio, '00:00'::time)
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.escalas
  ) sub
  WHERE rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índice único funcional — previne duplicatas futuras
--
--    Por que funcional (com COALESCE) em vez de coluna simples?
--    PostgreSQL trata NULL como DISTINTO em índices UNIQUE. Sem COALESCE,
--    duas escalas com hora_inicio = NULL e mesmo título/data/paróquia
--    passariam pelo índice sem conflitar — exatamente o caso de escalas
--    criadas pelo Assistente V2 sem horário definido.
--
--    IF NOT EXISTS torna o passo seguro para re-execução acidental.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS escalas_unique_celebration
  ON public.escalas (paroquia_id, data, titulo, COALESCE(hora_inicio, '00:00'::time));

COMMENT ON INDEX public.escalas_unique_celebration IS
  'Impede duplicação de escalas geradas pelo Assistente V2 (e inserções manuais). '
  'Chave: paroquia_id + data + titulo + hora_inicio (NULL → 00:00). '
  'O frontend deve detectar violação 23505 e tratar como registro já existente.';
