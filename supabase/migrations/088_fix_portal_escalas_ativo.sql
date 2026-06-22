-- Migration 088 — Fix portal_membro_get_escalas_publicadas: filtrar ativo=true
--
-- Problema: migration 081b criou a RPC sem filtrar escala_membros.ativo=true.
-- Com o soft-delete (migration 086/087), membros removidos (ativo=false) ainda
-- aparecem na listagem do portal do membro.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.portal_membro_get_escalas_publicadas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_result      JSONB;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), ''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT COALESCE(jsonb_agg(esc ORDER BY esc->>'data', esc->>'hora_inicio'), '[]'::JSONB)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',           e.id,
      'titulo',       e.titulo,
      'data',         e.data,
      'hora_inicio',  e.hora_inicio,
      'hora_fim',     e.hora_fim,
      'local',        e.local,
      'solene',       e.solene,
      'tem_adoracao', e.tem_adoracao,
      'observacoes',  e.observacoes,
      'escala_membros', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',             em.id,
          'status',         em.status,
          'justificativa',  em.justificativa,
          'membro_id',      em.membro_id,
          'ministerio_id',  em.ministerio_id,
          'membros',        jsonb_build_object('nome', m.nome),
          'ministerios',    jsonb_build_object(
                              'nome',      mn.nome,
                              'cor',       mn.cor,
                              'categoria', mn.categoria
                            )
        ))
        FROM public.escala_membros em
        JOIN public.membros m      ON m.id  = em.membro_id
        JOIN public.ministerios mn ON mn.id = em.ministerio_id
        WHERE em.escala_id = e.id
          AND em.ativo = true   -- exclui membros removidos via soft-delete
      ), '[]'::JSONB)
    ) AS esc
    FROM public.escalas e
    WHERE e.paroquia_id = v_paroquia_id
      AND e.status = 'publicada'
    ORDER BY e.data ASC, e.hora_inicio ASC NULLS FIRST
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_membro_get_escalas_publicadas() TO authenticated;

NOTIFY pgrst, 'reload schema';
