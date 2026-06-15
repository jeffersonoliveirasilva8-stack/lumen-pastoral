-- ============================================================
-- Migration 036: Sprint de Estabilização — Prontidão para Produção
-- Data: 2026-06-14
--
-- CORRIGE:
--   [P0] historico_score_trigger (002) corrompe scores ao sobrescrever
--        o cálculo correto da migration 026 com soma parcial
--        (WHERE presenca='confirmado' ignora faltou/atrasado/justificou)
--   [P1] Índices ausentes em colunas críticas de hot-path
--   [P1] ministerios_leitura_publica expõe ministérios de todas as
--        paróquias a requests anônimos (sem filtro de paroquia_id)
--
-- IDEMPOTENTE: sim (DROP IF EXISTS / CREATE INDEX IF NOT EXISTS)
-- REQUER: migrations 001–035 aplicadas
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BLOCO 1 — P0: Remover historico_score_trigger
-- ════════════════════════════════════════════════════════════
-- MOTIVO: historico_score_trigger (002) dispara em QUALQUER INSERT/UPDATE/DELETE
-- em historico_participacoes, inclusive aqueles causados por on_escala_membro_status_final
-- (026). A função recalcular_score_membro() usa WHERE presenca='confirmado', o que
-- ignora pontos negativos (faltou=-2, atrasado=-1) e sobrescreve o score correto
-- calculado pela migration 026 com um valor parcial errado.
--
-- on_escala_membro_status_final (026) já faz UPDATE de membros.score corretamente
-- após cada INSERT/UPDATE em historico_participacoes. O trigger de 002 é duplicata
-- com lógica errada.

DROP TRIGGER IF EXISTS historico_score_trigger ON public.historico_participacoes;

-- Atualiza a função para o caso de uso direto (sem trigger), corrigindo a soma
CREATE OR REPLACE FUNCTION public.recalcular_score_membro()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.membros
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = COALESCE(NEW.membro_id, OLD.membro_id)
  )
  WHERE id = COALESCE(NEW.membro_id, OLD.membro_id);
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- BLOCO 2 — P0: Recalcular todos os scores
-- Scores existentes podem estar errados (só contavam 'confirmado').
-- A migration 026 conta TODOS os pontos (positivos e negativos).
-- ════════════════════════════════════════════════════════════

UPDATE public.membros m
SET score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM public.historico_participacoes hp
  WHERE hp.membro_id = m.id
)
WHERE m.ativo = true;

-- ════════════════════════════════════════════════════════════
-- BLOCO 3 — P1: Índices ausentes em colunas críticas
-- ════════════════════════════════════════════════════════════

-- Hot path de TODAS as políticas RLS do portal do membro
CREATE INDEX IF NOT EXISTS idx_membros_auth_user_id
  ON public.membros (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Filtragem primária em todos os RPCs admin
CREATE INDEX IF NOT EXISTS idx_membros_paroquia_id
  ON public.membros (paroquia_id, ativo);

-- JOINs em portal_get_escalas_membro, sacristia, escalas view, RLS policies
CREATE INDEX IF NOT EXISTS idx_escala_membros_membro_id
  ON public.escala_membros (membro_id);

-- Lookup de membros de uma escala (Sacristia, admin, substituições)
CREATE INDEX IF NOT EXISTS idx_escala_membros_escala_id
  ON public.escala_membros (escala_id);

-- recalcular_score_membro e SUM(pontos) por membro — fired every status change
CREATE INDEX IF NOT EXISTS idx_historico_participacoes_membro_id
  ON public.historico_participacoes (membro_id);

-- Filtro por paróquia em relatórios de pontuação
CREATE INDEX IF NOT EXISTS idx_historico_participacoes_paroquia_id
  ON public.historico_participacoes (paroquia_id);

-- Notificações: lookup por destinatário (inbox do membro)
CREATE INDEX IF NOT EXISTS idx_notificacoes_destinatario_id
  ON public.notificacoes (destinatario_id)
  WHERE destinatario_id IS NOT NULL;

-- Notificações: broadcast por paróquia (feeds de coordenação)
CREATE INDEX IF NOT EXISTS idx_notificacoes_paroquia_id
  ON public.notificacoes (paroquia_id, created_at DESC);

-- Indisponibilidades: lookup por membro+data no motor de escalas
CREATE INDEX IF NOT EXISTS idx_indisponibilidades_membro_data
  ON public.indisponibilidades (membro_id, data);

-- ════════════════════════════════════════════════════════════
-- BLOCO 4 — P1: Corrigir ministerios_leitura_publica
-- A policy original (002) expõe ministérios ATIVOS de TODAS as
-- paróquias a requests anônimos. O portal público só precisa ver
-- os ministérios da paróquia do evento que está sendo consultado.
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "ministerios_leitura_publica" ON public.ministerios;

-- Substitui por: anônimo só vê ministérios de escalas publicadas
-- (restringe via JOIN a escalas → escala_funcoes → ministerios)
CREATE POLICY "ministerios_leitura_publica" ON public.ministerios
  FOR SELECT
  USING (
    ativo = true
    AND (
      -- Usuário autenticado com paróquia própria vê seus ministérios
      paroquia_id = current_paroquia_id()
      OR
      -- Anônimo só vê ministérios de escalas publicadas (acesso via token)
      EXISTS (
        SELECT 1
        FROM public.escala_funcoes ef
        JOIN public.escalas e ON e.id = ef.escala_id
        WHERE ef.ministerio_id = ministerios.id
          AND e.status = 'publicada'
      )
    )
  );

-- ════════════════════════════════════════════════════════════
-- BLOCO 5 — Verificação pós-aplicação
-- ════════════════════════════════════════════════════════════

-- 5a. Triggers em escala_membros (deve restar on_escala_membro_status_final)
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'escala_membros'
ORDER BY trigger_name;

-- 5b. Triggers em historico_participacoes (historico_score_trigger NÃO deve aparecer)
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'historico_participacoes'
ORDER BY trigger_name;

-- 5c. Índices criados
SELECT
  indexname,
  tablename,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- 5d. Integridade de scores pós-recalculo
SELECT
  m.nome,
  m.score                        AS score_atual,
  COALESCE(SUM(hp.pontos), 0)   AS soma_historico,
  CASE
    WHEN COALESCE(SUM(hp.pontos), 0) = m.score THEN 'OK'
    ELSE 'DIVERGENCIA'
  END                            AS sync
FROM public.membros m
LEFT JOIN public.historico_participacoes hp ON hp.membro_id = m.id
WHERE m.ativo = true
GROUP BY m.id, m.nome, m.score
ORDER BY m.score DESC, m.nome;

-- ════════════════════════════════════════════════════════════
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ BLOCO 5a: apenas on_escala_membro_status_final visível
--   ✓ BLOCO 5b: historico_score_trigger NÃO aparece
--   ✓ BLOCO 5c: 9 novos índices idx_* listados
--   ✓ BLOCO 5d: sync = 'OK' para todos os membros ativos
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
