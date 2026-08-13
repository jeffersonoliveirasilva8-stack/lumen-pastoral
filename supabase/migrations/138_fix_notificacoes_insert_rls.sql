-- Migration 138 — Adiciona INSERT policy em notificacoes
--
-- Causa raiz: a tabela notificacoes tinha policies de SELECT, UPDATE e DELETE,
-- mas nenhuma política de INSERT. Qualquer tentativa de inserir uma notificação
-- diretamente do cliente (ex: notificar vaga aberta) resultava em:
--   "new row violates row-level security policy for table notificacoes" (42501)
--
-- Fix: permite INSERT para coordenadores/admins da paróquia correspondente.
-- IDEMPOTENTE: sim (DROP POLICY IF EXISTS + CREATE POLICY)

DROP POLICY IF EXISTS "notif_coord_insert" ON public.notificacoes;

CREATE POLICY "notif_coord_insert" ON public.notificacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    public._portal_is_admin(paroquia_id)
    OR public.is_coordenador_da_paroquia(paroquia_id)
  );

NOTIFY pgrst, 'reload schema';
