-- Migration 111: Corrige escalas arquivadas incorretamente (eram canceladas)
--
-- O archive automático antigo arquivava escalas 'cancelada' → 'arquivada'.
-- Escalas arquivadas onde TODOS os membros ainda estão 'pendente'
-- nunca tiveram presença registrada: são missas que não ocorreram.
-- Restauramos para 'cancelada' para que desapareçam da sacristia.
--
-- CRITÉRIO SEGURO: só altera se 100% dos membros estão 'pendente'
-- (garante que escalas reais com pelo menos 1 presença ficam intactas).

UPDATE public.escalas e
SET    status = 'cancelada'
WHERE  e.status = 'arquivada'
  AND  e.data < CURRENT_DATE
  AND  EXISTS (
    SELECT 1 FROM public.escala_membros em
    WHERE em.escala_id = e.id
  )
  AND  NOT EXISTS (
    SELECT 1 FROM public.escala_membros em
    WHERE em.escala_id = e.id
      AND em.status NOT IN ('pendente', 'ausente', 'confirmado')
  );
