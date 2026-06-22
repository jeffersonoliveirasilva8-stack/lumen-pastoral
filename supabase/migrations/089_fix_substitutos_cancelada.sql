-- Migration 089 — Fix admin_buscar_substitutos: filtrar indisponibilidades canceladas
--
-- Problema: a coluna tem_indisp em admin_buscar_substitutos (migration 024) não filtra
-- indisponibilidades com cancelada=true. Membros que cancelaram suas indisponibilidades
-- aparecem marcados como "indisponível" e ficam no fundo da lista, excluindo candidatos
-- elegíveis incorretamente.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.admin_buscar_substitutos(
  p_escala_id     UUID,
  p_ministerio_id UUID
)
RETURNS TABLE(
  membro_id   UUID,
  nome        TEXT,
  score       INT,
  tem_indisp  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_escala_data DATE;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT e.paroquia_id, e.data INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = p_escala_id;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT public.is_coordenador_da_paroquia(v_paroquia_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    m.id          AS membro_id,
    m.nome        AS nome,
    COALESCE(m.score, 0) AS score,
    EXISTS (
      SELECT 1 FROM public.indisponibilidades i
      WHERE i.membro_id = m.id
        AND i.data      = v_escala_data
        AND i.cancelada = false   -- ignora indisponibilidades canceladas
    ) AS tem_indisp
  FROM public.membros m
  JOIN public.membro_ministerios mm ON mm.membro_id = m.id AND mm.ministerio_id = p_ministerio_id
  WHERE m.paroquia_id = v_paroquia_id
    AND m.ativo = true
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = p_escala_id
        AND em.membro_id = m.id
        AND em.ativo     = true   -- ignora linhas soft-deleted
    )
  ORDER BY
    tem_indisp ASC,
    m.score DESC,
    m.nome ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_buscar_substitutos(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
