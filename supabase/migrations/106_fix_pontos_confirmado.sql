-- Migration 106: Remove pontuação indevida para status 'confirmado'
--
-- PROBLEMA:
--   Migration 038 incluiu 'confirmado' em v_status_final do trigger e
--   atribuiu pontos iguais a 'presente'. Isso fazia a auto-confirmação
--   do membro (antes da missa) gerar pontos no ranking.
--
-- REGRA DE NEGÓCIO (confirmada):
--   Pontos SÓ são gerados quando o secretário registra presença real
--   (presente, faltou, ausente, atrasado, justificou).
--   Auto-confirmação do membro (status='confirmado') NÃO gera pontos.
--
-- Migration 061 já corrigiu o trigger para excluir 'confirmado'.
-- Esta migration remove os registros legados que foram criados
-- com presenca='confirmado' antes da correção.
--
-- IDEMPOTENTE: sim

-- ── 1. Remove registros com presença = 'confirmado' ──────────────────────
DELETE FROM public.historico_participacoes
WHERE presenca = 'confirmado';

-- ── 2. Garante que o trigger atual exclui 'confirmado' ───────────────────
-- (CREATE OR REPLACE é idempotente — garante versão correta mesmo
--  se migration 061 não foi aplicada em produção)

DROP FUNCTION IF EXISTS public._get_pontos_status(UUID, TEXT);
DROP FUNCTION IF EXISTS public._get_pontos_status(UUID, TEXT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public._get_pontos_status(
  p_paroquia_id UUID,
  p_status      TEXT,
  p_solene      BOOLEAN DEFAULT false,
  p_tem_bispo   BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'presente' THEN
      CASE
        WHEN p_tem_bispo THEN COALESCE((SELECT pontuacao_presenca_bispo  FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 5)
        WHEN p_solene    THEN COALESCE((SELECT pontuacao_presenca_solene FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 3)
        ELSE                  COALESCE((SELECT pontuacao_presenca        FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
      END
    WHEN 'faltou'     THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'ausente'    THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'atrasado'   THEN COALESCE((SELECT pontuacao_atraso     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -1)
    WHEN 'justificou' THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    -- 'confirmado' e 'recusado' NÃO geram pontos
    ELSE 0
  END;
$$;

GRANT EXECUTE ON FUNCTION public._get_pontos_status(UUID, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── 3. Garante trigger correto ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_config       public.paroquia_config_escalas%ROWTYPE;
  v_pontos       INTEGER;
  v_tipo_evento  TEXT;
  -- Somente statuses registrados pelo secretário/coordenação
  -- 'confirmado' (auto-confirmação do membro) NÃO gera pontos
  v_status_final CONSTANT TEXT[] := ARRAY[
    'presente','faltou','ausente','atrasado','justificou'
  ];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status, v_solene, v_tem_bispo);

  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, NEW.membro_id, NEW.escala_id, NEW.ministerio_id,
     v_tipo_evento, 'escala', NEW.status, v_escala_data, v_pontos)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala', 'solene', 'bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE
    SET presenca    = EXCLUDED.presenca,
        tipo_evento = EXCLUDED.tipo_evento,
        pontos      = EXCLUDED.pontos;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;

CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status
  ON    public.escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_participacao();

-- ── 4. Recalcula todos os scores ──────────────────────────────────────────

UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;

NOTIFY pgrst, 'reload schema';
