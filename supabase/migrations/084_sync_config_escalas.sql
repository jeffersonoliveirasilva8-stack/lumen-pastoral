-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 084 — Sincronizar JSONB legado → paroquia_config_escalas
--
-- PROBLEMA: paroquias.regras_escala (JSONB) contém confirmacao_escala_ativa
-- que foi migrado para paroquia_config_escalas.confirmacao_ativa (migration 022).
-- Paróquias existentes podem ter o valor no JSONB mas não na tabela nova,
-- ou a tabela nova pode estar desatualizada em relação ao JSONB.
--
-- FIX: Para cada paróquia que ainda não tem registro em paroquia_config_escalas,
-- cria com o valor do JSONB. Para as que já têm registro, atualiza apenas
-- confirmacao_ativa se estiver diferente (preserva demais campos).
-- ═══════════════════════════════════════════════════════════════════════════

-- Upsert: cria ou atualiza confirmacao_ativa a partir do JSONB legado
INSERT INTO public.paroquia_config_escalas (paroquia_id, confirmacao_ativa)
SELECT
  id AS paroquia_id,
  COALESCE((regras_escala->>'confirmacao_escala_ativa')::boolean, false) AS confirmacao_ativa
FROM public.paroquias
WHERE regras_escala IS NOT NULL
ON CONFLICT (paroquia_id) DO UPDATE
  SET confirmacao_ativa = EXCLUDED.confirmacao_ativa
  WHERE public.paroquia_config_escalas.confirmacao_ativa IS DISTINCT FROM EXCLUDED.confirmacao_ativa;
