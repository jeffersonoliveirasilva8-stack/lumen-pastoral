-- Migration 146 — Corrige eventos de solenidade + rodízio reset
--
-- Problemas corrigidos:
--  A. formacoes_eventos criados a partir de escalas NÃO publicadas — remove eventos
--     órfãos (solenidades não publicadas) e suas presencas_eventos.
--  B. Adiciona escala_id em formacoes_eventos para rastrear a origem e evitar duplicatas.
--  C. Adiciona rodizio_reset_em e rodizio_reset_por em paroquia_config_escalas para
--     controlar a data de corte do rodízio de solenidades.
--  D. Tabela de auditoria log_rodizio_resets.

-- ══════════════════════════════════════════════════════════════
-- A. Cleanup: remove eventos e presenças de escalas não publicadas
-- ══════════════════════════════════════════════════════════════

-- A1. Remove presencas_eventos vinculadas a eventos auto-gerados de escalas não publicadas
DELETE FROM public.presencas_eventos pe
WHERE pe.evento_id IN (
  SELECT fe.id
  FROM   public.formacoes_eventos fe
  WHERE  fe.observacoes IN (
           'Solenidade — registro de presença da celebração.',
           'Todos paramentados — confirmação de presença automática via escala.'
         )
    AND EXISTS (
          -- Existe escala com mesmo título/data/paróquia ainda não publicada
          SELECT 1 FROM public.escalas e
          WHERE  e.paroquia_id = fe.paroquia_id
            AND  e.titulo      = fe.titulo
            AND  e.data        = DATE(fe.data_inicio)
            AND  e.status NOT IN ('publicada', 'arquivada')
        )
    AND NOT EXISTS (
          -- NÃO existe escala com mesmo título/data/paróquia que foi publicada
          SELECT 1 FROM public.escalas e
          WHERE  e.paroquia_id = fe.paroquia_id
            AND  e.titulo      = fe.titulo
            AND  e.data        = DATE(fe.data_inicio)
            AND  e.status IN ('publicada', 'arquivada')
        )
);

-- A2. Remove os próprios eventos
DELETE FROM public.formacoes_eventos fe
WHERE  fe.observacoes IN (
         'Solenidade — registro de presença da celebração.',
         'Todos paramentados — confirmação de presença automática via escala.'
       )
  AND EXISTS (
        SELECT 1 FROM public.escalas e
        WHERE  e.paroquia_id = fe.paroquia_id
          AND  e.titulo      = fe.titulo
          AND  e.data        = DATE(fe.data_inicio)
          AND  e.status NOT IN ('publicada', 'arquivada')
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.escalas e
        WHERE  e.paroquia_id = fe.paroquia_id
          AND  e.titulo      = fe.titulo
          AND  e.data        = DATE(fe.data_inicio)
          AND  e.status IN ('publicada', 'arquivada')
      );

-- ══════════════════════════════════════════════════════════════
-- B. Adiciona escala_id em formacoes_eventos
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.formacoes_eventos
  ADD COLUMN IF NOT EXISTS escala_id UUID REFERENCES public.escalas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_formacoes_eventos_escala_id
  ON public.formacoes_eventos(escala_id)
  WHERE escala_id IS NOT NULL;

-- Vincula eventos já existentes que casam com escalas publicadas/arquivadas
UPDATE public.formacoes_eventos fe
SET    escala_id = e.id
FROM   public.escalas e
WHERE  fe.escala_id IS NULL
  AND  fe.observacoes IN (
         'Solenidade — registro de presença da celebração.',
         'Todos paramentados — confirmação de presença automática via escala.'
       )
  AND  e.paroquia_id = fe.paroquia_id
  AND  e.titulo      = fe.titulo
  AND  e.data        = DATE(fe.data_inicio)
  AND  e.status      IN ('publicada', 'arquivada');

-- ══════════════════════════════════════════════════════════════
-- C. Adiciona campos de rodízio reset em paroquia_config_escalas
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.paroquia_config_escalas
  ADD COLUMN IF NOT EXISTS rodizio_reset_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rodizio_reset_por   UUID REFERENCES public.membros(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════
-- D. Tabela de auditoria para resets de rodízio
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.log_rodizio_resets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id  UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  reset_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_por    UUID        REFERENCES public.membros(id) ON DELETE SET NULL,
  motivo       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.log_rodizio_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "log_rodizio_admin_read" ON public.log_rodizio_resets
  FOR SELECT USING (public._portal_is_admin(paroquia_id));

CREATE POLICY "log_rodizio_admin_write" ON public.log_rodizio_resets
  FOR ALL USING (public._portal_is_admin(paroquia_id));

-- ══════════════════════════════════════════════════════════════
-- E. RPC: resetar_rodizio_solene
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resetar_rodizio_solene(
  p_paroquia_id UUID,
  p_motivo      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id UUID;
BEGIN
  IF NOT public._portal_is_admin(p_paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  v_membro_id := public._portal_membro_id();

  -- Atualiza data de corte do rodízio
  UPDATE public.paroquia_config_escalas
  SET    rodizio_reset_em  = now(),
         rodizio_reset_por = v_membro_id
  WHERE  paroquia_id = p_paroquia_id;

  IF NOT FOUND THEN
    INSERT INTO public.paroquia_config_escalas (paroquia_id, rodizio_reset_em, rodizio_reset_por)
    VALUES (p_paroquia_id, now(), v_membro_id);
  END IF;

  -- Registra na auditoria
  INSERT INTO public.log_rodizio_resets (paroquia_id, reset_por, motivo)
  VALUES (p_paroquia_id, v_membro_id, p_motivo);

  RETURN jsonb_build_object(
    'success', true,
    'reset_em', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resetar_rodizio_solene(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
