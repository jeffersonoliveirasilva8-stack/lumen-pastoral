-- Migration 198 — Sprint B M7
-- Trigger: anula historico_participacoes ao deletar uma convocação geral
--
-- Espelha o comportamento do trigger on_escala_membro_delete (migration 189)
-- que anula o histórico ao deletar um escala_membro.
--
-- Quando escalas é deletada (ON DELETE CASCADE), os registros em
-- escala_convocacoes são deletados, disparando este trigger que seta
-- anulada=true nos registros correspondentes do histórico.

CREATE OR REPLACE FUNCTION public._trigger_anular_hist_convocacao_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE public.historico_participacoes
  SET anulada        = true,
      anulada_motivo = 'convocacao_cancelada',
      anulada_por    = auth.uid(),
      anulada_em     = now()
  WHERE membro_id   = OLD.membro_id
    AND escala_id   = OLD.escala_id
    AND tipo_evento = 'convocacao_solene'
    AND anulada     = false;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_convocacao_delete ON public.escala_convocacoes;

CREATE TRIGGER on_escala_convocacao_delete
  AFTER DELETE ON public.escala_convocacoes
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_anular_hist_convocacao_delete();
