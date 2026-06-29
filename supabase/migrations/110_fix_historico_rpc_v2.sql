-- Migration 110: Reescreve portal_membro_get_historico
--
-- Corrige:
--   1. Inclui status 'confirmado' (member confirmou mas secretário não fechou)
--   2. Remove filtro ativo da escala_membros (coluna pode não existir em todos os ambientes)
--   3. Retorna array mesmo se _portal_membro_id retornar NULL (evita erro silencioso)
--
-- IDEMPOTENTE: sim

DROP FUNCTION IF EXISTS public.portal_membro_get_historico();

CREATE OR REPLACE FUNCTION public.portal_membro_get_historico()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id UUID;
  v_result    JSONB;
BEGIN
  -- Resolve membro autenticado via auth.uid()
  SELECT id INTO v_membro_id
  FROM public.membros
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  -- Fallback: busca por email
  IF v_membro_id IS NULL THEN
    SELECT id INTO v_membro_id
    FROM public.membros
    WHERE lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),'')))
    LIMIT 1;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'escala_membro_id', em.id,
      'status',           em.status,
      'titulo',           e.titulo,
      'data',             e.data,
      'ministerio_nome',  COALESCE(min.nome, '—'),
      'ministerio_cor',   COALESCE(min.cor, '#6B7280'),
      'pontos',           hp.pontos
    )
    ORDER BY e.data DESC
  )
  INTO v_result
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
  LEFT JOIN public.historico_participacoes hp ON hp.escala_membro_id = em.id
  WHERE em.membro_id = v_membro_id
    AND em.status NOT IN ('recusado', 'pendente')
    AND e.status NOT IN ('rascunho', 'cancelada')
    AND e.data < CURRENT_DATE
  LIMIT 50;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_membro_get_historico() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_membro_get_historico() FROM anon;
