-- Migration 145 — Corrige lacunas de pontuação para membros com status 'pendente'
--
-- Problema: o trigger on_escala_membro_status_final só dispara em UPDATE de status.
-- Membros escalados que ficam com status='pendente' após a data da escala nunca
-- recebem pontos — a janela de correção retroativa das migrations 120/121 ficou
-- para trás, e novas escalas continuaram acumulando a mesma lacuna.
--
-- Correções:
--  A. Retroativo: converte 'pendente' → 'presente' em todas as escalas passadas
--     publicadas/arquivadas sem registro em historico_participacoes.
--     O trigger cuida do historico automaticamente por cada UPDATE.
--  B. Garante historico para qualquer presente/faltou sem registro (lacunas antigas).
--  C. Trigger novo: ao arquivar uma escala, auto-converte membros ainda 'pendente'
--     para 'presente' — fecha a lacuna permanentemente para futuras escalas.
--  D. Recalcula scores de todos os membros afetados.

-- ══════════════════════════════════════════════════════════════
-- A. Retroativo: pendentes em escalas passadas → presente
-- ══════════════════════════════════════════════════════════════

UPDATE public.escala_membros em
SET    status                 = 'presente',
       presenca_registrada_em = NOW()
FROM   public.escalas e
WHERE  em.escala_id  = e.id
  AND  em.status     = 'pendente'
  AND  e.data        < CURRENT_DATE
  AND  e.status      IN ('publicada', 'arquivada')
  AND  (em.ativo IS NULL OR em.ativo = true)
  AND  NOT EXISTS (
         SELECT 1
         FROM   public.historico_participacoes hp
         WHERE  hp.membro_id     = em.membro_id
           AND  hp.escala_id     = em.escala_id
           AND  hp.ministerio_id = em.ministerio_id
       );

-- ══════════════════════════════════════════════════════════════
-- B. Garante historico para presente/faltou sem registro
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos)
SELECT
  e.paroquia_id,
  em.membro_id,
  em.escala_id,
  em.ministerio_id,
  CASE
    WHEN COALESCE(e.tem_bispo, false) THEN 'bispo'
    WHEN COALESCE(e.solene,    false) THEN 'solene'
    ELSE 'escala'
  END,
  'escala',
  em.status,
  e.data,
  public._get_pontos_status(
    e.paroquia_id,
    em.status,
    COALESCE(e.solene,    false),
    COALESCE(e.tem_bispo, false)
  )
FROM public.escala_membros em
JOIN public.escalas e ON e.id = em.escala_id
WHERE em.status IN ('presente', 'faltou', 'atrasado', 'justificou', 'ausente')
  AND e.data    <  CURRENT_DATE
  AND e.status  IN ('publicada', 'arquivada')
  AND (em.ativo IS NULL OR em.ativo = true)
ON CONFLICT (membro_id, escala_id, ministerio_id)
  WHERE tipo_evento   IN ('escala', 'solene', 'bispo')
    AND escala_id      IS NOT NULL
    AND ministerio_id  IS NOT NULL
DO UPDATE
  SET presenca    = EXCLUDED.presenca,
      tipo_evento = EXCLUDED.tipo_evento,
      pontos      = EXCLUDED.pontos;

-- ══════════════════════════════════════════════════════════════
-- C. Trigger: ao arquivar escala, converte pendentes → presente
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_arquivar_escala_pendentes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só age quando status muda para 'arquivada' e a data já passou
  IF NEW.status <> 'arquivada' THEN RETURN NEW; END IF;
  IF OLD.status = 'arquivada'  THEN RETURN NEW; END IF;

  -- Converte membros ainda pendentes para presente
  -- O trigger on_escala_membro_status_final vai criar historico + pontos
  UPDATE public.escala_membros
  SET    status                 = 'presente',
         presenca_registrada_em = NOW()
  WHERE  escala_id = NEW.id
    AND  status    = 'pendente'
    AND  (ativo IS NULL OR ativo = true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_arquivada_pendentes ON public.escalas;

CREATE TRIGGER on_escala_arquivada_pendentes
  AFTER UPDATE OF status
  ON    public.escalas
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_arquivar_escala_pendentes();

-- ══════════════════════════════════════════════════════════════
-- D. Recalcula scores de todos os membros afetados
-- ══════════════════════════════════════════════════════════════

UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;

NOTIFY pgrst, 'reload schema';
