-- Migration 150 — presencas_eventos: adiciona confirmado_pelo_membro
--
-- PROBLEMA: presente=null é usado tanto para "adicionado automaticamente sem resposta"
-- quanto para "membro clicou em confirmar". O coordenador não consegue distinguir
-- quem de fato confirmou presença de quem foi apenas auto-adicionado.
--
-- FIX: nova coluna confirmado_pelo_membro BOOLEAN DEFAULT false
--   false → adicionado automaticamente, sem resposta do membro
--   true  → membro clicou explicitamente em confirmar no portal

ALTER TABLE public.presencas_eventos
  ADD COLUMN IF NOT EXISTS confirmado_pelo_membro BOOLEAN NOT NULL DEFAULT false;

-- Retroativo: registros com presente=false foram criados por ação do membro (declinar)
-- confirmado_pelo_membro continua false nesses casos (não confirmou, recusou)
-- Não há como distinguir retroativamente quem confirmou vs auto-adicionado,
-- então mantemos false para todos os existentes — apenas novos confirmes serão true.

NOTIFY pgrst, 'reload schema';
