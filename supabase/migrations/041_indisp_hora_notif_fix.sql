-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 041 — Indisponibilidades: fix notif overload + suporte horário
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Problemas corrigidos:
--   1. "function _notify_coordenacao is not unique" ao registrar indisponibilidade
--      Causa: migration 020 criou overload de 4 parâmetros; migration 023 criou
--             overload de 5 parâmetros. A chamada com 4 args é ambígua.
--      Fix: drop do overload de 4 parâmetros (020), manter apenas o de 5 (023).
--
--   2. Indisponibilidade não suportava período parcial (horário específico).
--      Fix: adicionar hora_inicio, hora_fim, tipo, data_fim, cancelada.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remove o overload de 4 parâmetros (criado na migration 020)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._notify_coordenacao(uuid, text, text, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Adiciona colunas de horário e controle à tabela indisponibilidades
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.indisponibilidades
  ADD COLUMN IF NOT EXISTS hora_inicio  time         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hora_fim     time         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tipo         text         NOT NULL DEFAULT 'dia'
    CHECK (tipo IN ('dia', 'periodo', 'intervalo')),
  ADD COLUMN IF NOT EXISTS data_fim     date         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancelada    boolean      NOT NULL DEFAULT false;

COMMENT ON COLUMN public.indisponibilidades.tipo IS
  'dia=dia inteiro; periodo=com hora_inicio/hora_fim; intervalo=range de datas data..data_fim';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recria o trigger com chamada explícita de 5 argumentos (sem ambiguidade)
--    e mensagem enriquecida com horário quando tipo = 'periodo'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trigger_indisponibilidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_membro_nome text;
  v_periodo     text;
  v_data_label  text;
BEGIN
  SELECT nome INTO v_membro_nome FROM public.membros WHERE id = NEW.membro_id;

  -- Formata período / horário
  IF NEW.tipo = 'periodo' AND NEW.hora_inicio IS NOT NULL THEN
    v_periodo := format(
      ' das %s às %s',
      to_char(NEW.hora_inicio, 'HH24:MI'),
      COALESCE(to_char(NEW.hora_fim, 'HH24:MI'), '?')
    );
  ELSE
    v_periodo := '';
  END IF;

  IF NEW.tipo = 'intervalo' AND NEW.data_fim IS NOT NULL THEN
    v_data_label := format(
      '%s a %s',
      to_char(NEW.data::date, 'DD/MM/YYYY'),
      to_char(NEW.data_fim, 'DD/MM/YYYY')
    );
  ELSE
    v_data_label := to_char(NEW.data::date, 'DD/MM/YYYY');
  END IF;

  -- Chama a versão de 5 parâmetros explicitamente (sem ambiguidade)
  PERFORM public._notify_coordenacao(
    NEW.paroquia_id,
    'Indisponibilidade: ' || COALESCE(v_membro_nome, 'Membro'),
    format(
      '%s registrou indisponibilidade para %s%s. Motivo: %s',
      COALESCE(v_membro_nome, 'Membro'),
      v_data_label,
      v_periodo,
      COALESCE(NEW.motivo, 'não informado')
    ),
    'alerta',   -- p_tipo
    NULL        -- p_link (5º parâmetro explícito → sem ambiguidade)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_indisponibilidade ON public.indisponibilidades;
CREATE TRIGGER on_indisponibilidade
  AFTER INSERT ON public.indisponibilidades
  FOR EACH ROW EXECUTE FUNCTION public._trigger_indisponibilidade();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Índices úteis para consultas de dashboard e engine
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_indisp_paroquia_data
  ON public.indisponibilidades (paroquia_id, data)
  WHERE cancelada = false;

CREATE INDEX IF NOT EXISTS idx_indisp_membro_data
  ON public.indisponibilidades (membro_id, data)
  WHERE cancelada = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS: membro pode cancelar apenas as próprias indisponibilidades futuras
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "membros podem cancelar propria indisp" ON public.indisponibilidades;
CREATE POLICY "membros podem cancelar propria indisp"
  ON public.indisponibilidades FOR UPDATE
  USING (
    membro_id = (
      SELECT id FROM public.membros
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
    AND data >= CURRENT_DATE
  )
  WITH CHECK (cancelada = true);
