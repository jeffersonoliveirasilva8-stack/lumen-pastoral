-- ============================================================
-- LUMEN PASTORAL — PATCH U: Audit Triggers Estendidos
-- Data: 2026-06-11
--
-- O patch 009_audit_log.sql já cobre:
--   membros, escalas, escala_membros, historico_participacoes,
--   ocorrencias_membros, user_roles, paroquias
--
-- Este patch adiciona triggers nas tabelas ainda não cobertas:
--   comunidades, ministerios, atuacoes_pastorais, missas_padrao,
--   indisponibilidades, solicitacoes_membros, notificacoes
--
-- Usa a mesma fn_audit_trigger() já instalada por 009_audit_log.sql.
-- IDEMPOTENTE: DROP TRIGGER IF EXISTS antes de cada CREATE.
-- DEPENDÊNCIA: 009_audit_log.sql deve estar aplicado.
-- ============================================================

-- ── comunidades ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_comunidades ON public.comunidades;
CREATE TRIGGER trg_audit_comunidades
  AFTER INSERT OR UPDATE OR DELETE ON public.comunidades
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── ministerios ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_ministerios ON public.ministerios;
CREATE TRIGGER trg_audit_ministerios
  AFTER INSERT OR UPDATE OR DELETE ON public.ministerios
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── atuacoes_pastorais ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_atuacoes_pastorais ON public.atuacoes_pastorais;
CREATE TRIGGER trg_audit_atuacoes_pastorais
  AFTER INSERT OR UPDATE OR DELETE ON public.atuacoes_pastorais
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── missas_padrao ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_missas_padrao ON public.missas_padrao;
CREATE TRIGGER trg_audit_missas_padrao
  AFTER INSERT OR UPDATE OR DELETE ON public.missas_padrao
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── indisponibilidades ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_indisponibilidades ON public.indisponibilidades;
CREATE TRIGGER trg_audit_indisponibilidades
  AFTER INSERT OR UPDATE OR DELETE ON public.indisponibilidades
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── solicitacoes_membros ──────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_solicitacoes_membros ON public.solicitacoes_membros;
CREATE TRIGGER trg_audit_solicitacoes_membros
  AFTER INSERT OR UPDATE OR DELETE ON public.solicitacoes_membros
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── notificacoes ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_notificacoes ON public.notificacoes;
CREATE TRIGGER trg_audit_notificacoes
  AFTER INSERT OR UPDATE OR DELETE ON public.notificacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── Verificação ───────────────────────────────────────────────────────────────
--
-- SELECT trigger_name, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND trigger_name LIKE 'trg_audit_%'
-- ORDER BY event_object_table;
--
-- CRITÉRIO DE APROVAÇÃO:
--   14 linhas esperadas (7 tabelas × 2 triggers INSERT+UPDATE+DELETE consolidado,
--   mas PostgreSQL reporta por evento, então pode variar).
--   As 7 tabelas novas devem aparecer: comunidades, ministerios,
--   atuacoes_pastorais, missas_padrao, indisponibilidades,
--   solicitacoes_membros, notificacoes.
-- ─────────────────────────────────────────────────────────────────────────────
