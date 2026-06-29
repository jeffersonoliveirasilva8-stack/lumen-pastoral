-- Migration 109: Inclui status 'confirmado' no histórico de participações
--
-- A migration 108 excluía 'confirmado', mas membros que confirmaram presença
-- e o secretário nunca registrou o status final ficam invisíveis no histórico.
-- 'confirmado' deve aparecer como "aguardando confirmação do secretário".
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

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
  v_membro_id := public._portal_membro_id();

  SELECT jsonb_agg(row_order.row)
  INTO   v_result
  FROM (
    SELECT jsonb_build_object(
      'escala_membro_id', em.id,
      'status',           em.status,
      'titulo',           e.titulo,
      'data',             e.data,
      'ministerio_nome',  COALESCE(min.nome, '—'),
      'ministerio_cor',   COALESCE(min.cor, '#6B7280'),
      'pontos',           hp.pontos
    ) AS row
    FROM public.escala_membros em
    JOIN public.escalas e ON e.id = em.escala_id
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    LEFT JOIN public.historico_participacoes hp ON hp.escala_membro_id = em.id
    WHERE em.membro_id = v_membro_id
      AND (em.ativo IS NULL OR em.ativo = true)
      AND em.status NOT IN ('recusado', 'pendente')
      AND e.status NOT IN ('rascunho', 'cancelada')
      AND e.data < CURRENT_DATE
    ORDER BY e.data DESC
    LIMIT 50
  ) row_order;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_membro_get_historico() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_membro_get_historico() FROM anon;
