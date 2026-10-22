-- Migration 164 — Attach _trigger_escala_alterada ao trigger AFTER UPDATE ON escalas
--
-- A função _trigger_escala_alterada() foi definida na migration 161 mas nunca
-- foi associada a nenhum trigger. Esta migration cria o trigger.
--
-- IDEMPOTENTE: DROP IF EXISTS antes de CREATE

DROP TRIGGER IF EXISTS on_escala_alterada ON public.escalas;

CREATE TRIGGER on_escala_alterada
  AFTER UPDATE ON public.escalas
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_escala_alterada();

NOTIFY pgrst, 'reload schema';
