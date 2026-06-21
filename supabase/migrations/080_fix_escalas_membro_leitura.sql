-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 080 — Corrigir policy escalas_membro_leitura
--
-- CAUSA RAIZ: escalas_membro_leitura usava current_paroquia_id() que lê
-- de profiles.paroquia_id. Se o perfil não existe ou paroquia_id é null
-- (ex: member sem profile, profile não populado), a policy retorna false
-- silenciosamente e o membro não vê NENHUMA escala publicada.
--
-- FIX: usar _portal_membro_paroquia(_portal_membro_id()) que lê de membros
-- com fallback por email — consistente com membro_read_escala_paroquia_full
-- e demais policies do portal.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "escalas_membro_leitura" ON public.escalas;

CREATE POLICY "escalas_membro_leitura" ON public.escalas
  FOR SELECT TO authenticated
  USING (
    paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
    AND status = 'publicada'
  );

-- Verifica que _portal_is_admin e _portal_is_coord já cobrem
-- admins e coords com acesso a rascunhos (via escalas_admin / escalas_coord).
-- Este fix só afeta membros comuns — eles passam a usar a mesma cadeia
-- de resolução de paróquia que o restante do sistema de portal.
