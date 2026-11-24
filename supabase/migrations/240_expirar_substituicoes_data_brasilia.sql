-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 240 — expirar_substituicoes_vencidas: usar data de Brasília
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Bug: a função comparava e.data < CURRENT_DATE. O banco roda em UTC, então a
-- partir das 21h (horário de Brasília) CURRENT_DATE já é o dia seguinte e as
-- escalas DO PRÓPRIO DIA eram marcadas como 'faltou' assim que alguém abria a
-- Sacristia (caso real: Missa Diária 06h de 23/11/2026, marcada às 22:58 BRT).
--
-- Correção: a data de referência passa a ser a data atual em America/Sao_Paulo.
-- Corpo idêntico à migration 137, exceto pela variável v_hoje.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expirar_substituicoes_vencidas(
  p_paroquia_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_paroquia   UUID;
  v_role       TEXT;
  v_expiradas  INT := 0;
  v_faltas     INT := 0;
  v_hoje       DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT ur.role::TEXT, ur.paroquia_id INTO v_role, v_paroquia
  FROM public.user_roles ur
  WHERE ur.user_id = v_auth_id
    AND ur.role::TEXT IN ('coordenador','admin_paroquial','super_admin','lider')
  ORDER BY ur.paroquia_id NULLS LAST
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- p_paroquia_id tem precedência (super_admin passa a paróquia alvo)
  IF p_paroquia_id IS NOT NULL THEN
    v_paroquia := p_paroquia_id;
  END IF;

  IF v_paroquia IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_id_required');
  END IF;

  UPDATE public.substituicoes s
     SET status = 'cancelada'
    FROM public.escalas e
   WHERE s.escala_id = e.id
     AND s.paroquia_id = v_paroquia
     AND s.status IN ('solicitada', 'com_voluntario')
     AND e.data < v_hoje;

  GET DIAGNOSTICS v_expiradas = ROW_COUNT;

  UPDATE public.escala_membros em
     SET status = 'faltou'
    FROM public.escalas e
   WHERE em.escala_id = e.id
     AND e.paroquia_id = v_paroquia
     AND e.data < v_hoje
     AND e.status = 'publicada'
     AND em.status NOT IN ('presente', 'faltou', 'atrasado', 'justificou', 'ausente', 'confirmado')
     AND (em.ativo IS NULL OR em.ativo = true);

  GET DIAGNOSTICS v_faltas = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',    true,
    'expiradas',  v_expiradas,
    'faltas',     v_faltas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.expirar_substituicoes_vencidas(UUID) TO authenticated;


NOTIFY pgrst, 'reload schema';
