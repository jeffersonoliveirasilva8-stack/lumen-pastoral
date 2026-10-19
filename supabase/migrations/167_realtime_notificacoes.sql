-- ============================================================
-- Migration 167: Habilita Realtime para tabela notificacoes
-- Data: 2026-10-19
--
-- PROBLEMA:
--   O badge de notificações (sininho) no portal-membro não atualiza
--   em tempo real porque a tabela `notificacoes` não estava incluída
--   na publicação `supabase_realtime`.
--
--   O frontend (portal-membro.tsx) mantém um canal
--     supabase.channel(`pm-layout-notif-rt-${paroquia_id}`)
--     .on("postgres_changes", { table: "notificacoes", filter: "paroquia_id=eq.X" })
--   que nunca dispara eventos enquanto a tabela não está na publicação.
--
-- SOLUÇÃO:
--   Adicionar apenas `notificacoes` à publicação `supabase_realtime`.
--   NÃO adicionar `notificacoes_leituras`: o frontend não tem subscription
--   nessa tabela; leitura de contagem é feita via RPC SECURITY DEFINER.
--
-- SEGURANÇA:
--   - RLS já está ativa em `notificacoes` (migrations 001 + 023).
--   - O Supabase Realtime respeita RLS: cada cliente recebe apenas os
--     eventos das linhas que sua política permite ler.
--   - Filtro de paroquia_id no subscription reduz ainda mais o escopo.
--
-- IDEMPOTENTE: sim (verifica pg_publication_tables antes de alterar)
-- REQUER: migrations 001, 015, 023 já aplicadas
-- ============================================================

DO $$
BEGIN
  -- Adiciona notificacoes à publicação apenas se ainda não estiver incluída
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_publication_tables
    WHERE  pubname   = 'supabase_realtime'
      AND  schemaname = 'public'
      AND  tablename  = 'notificacoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;
  END IF;
END;
$$;
