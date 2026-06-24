-- Migration 095 — Fix portal_get_substituicoes_abertas: filtrar por ministério correto
--
-- Problema: a query excluía o membro se ele já estava na escala em QUALQUER ministério.
-- A notificação porém era enviada apenas se o membro não estava naquela função específica.
-- Resultado: membro recebia notificação mas ao abrir a página não via nada.
--
-- Exemplo do bug:
--   Membro B serve em Ministério A e Ministério B.
--   Já está na Escala X pelo Ministério A.
--   Escala X tem vaga aberta no Ministério B (membro C recusou/solicitou substituição).
--   Notificação é enviada a B (correto — não está no Ministério B da Escala X).
--   portal_get_substituicoes_abertas excluía B porque ele está na Escala X (pelo Ministério A).
--   → Page shows nothing even though a valid slot exists.
--
-- Fix: restringir o check NOT EXISTS ao mesmo ministerio_id do slot aberto.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.portal_get_substituicoes_abertas()
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  created_at         TIMESTAMPTZ,
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.id, m.paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.created_at,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em  ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  WHERE s.paroquia_id    = v_paroquia_id
    AND s.status         = 'solicitada'          -- aberta para voluntários
    AND s.solicitante_id <> v_membro_id          -- não mostra as próprias
    AND e.data           >= CURRENT_DATE         -- só escalas futuras
    -- O membro precisa atuar no ministério do slot aberto
    AND EXISTS (
      SELECT 1 FROM public.membro_ministerios mm
      WHERE mm.membro_id = v_membro_id AND mm.ministerio_id = em.ministerio_id
    )
    -- Exclui se o membro já está escalado nessa escala PARA ESTE MINISTÉRIO especificamente
    -- (era: qualquer ministério — causava falso negativo quando membro serve em vários)
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em2
      WHERE em2.escala_id     = em.escala_id
        AND em2.membro_id     = v_membro_id
        AND em2.ministerio_id = em.ministerio_id  -- mesmo ministério do slot aberto
        AND em2.ativo         = true               -- ignora soft-deleted
        AND em2.status NOT IN ('recusado', 'faltou')
    )
  ORDER BY e.data ASC, s.created_at ASC
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_substituicoes_abertas() TO authenticated;

NOTIFY pgrst, 'reload schema';
