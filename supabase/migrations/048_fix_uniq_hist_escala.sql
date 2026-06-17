-- migration 048 — Corrige predicado do índice uniq_hist_escala
--
-- Bug: ON CONFLICT em _trigger_pontuar_participacao usa
--   WHERE tipo_evento IN ('escala','solene','bispo') AND ...
-- mas o índice criado em 038 tem
--   WHERE tipo_evento = 'escala' AND ...
-- PostgreSQL exige predicados idênticos → erro 42P10 ao registrar presença
-- em escalas solenes ou com bispo.
--
-- Fix: recriar o índice com o predicado que casa com o ON CONFLICT.

DROP INDEX IF EXISTS public.uniq_hist_escala;

CREATE UNIQUE INDEX uniq_hist_escala
  ON public.historico_participacoes(membro_id, escala_id, ministerio_id)
  WHERE tipo_evento IN ('escala', 'solene', 'bispo')
    AND escala_id     IS NOT NULL
    AND ministerio_id IS NOT NULL;
