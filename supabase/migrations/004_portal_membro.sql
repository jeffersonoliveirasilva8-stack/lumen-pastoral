-- 004_portal_membro.sql
-- Member portal: token access + RPC functions + escala_membros justificativa

-- ── membros: personal access token ──────────────────────────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS token_acesso UUID DEFAULT gen_random_uuid() UNIQUE;

-- backfill existing rows
UPDATE membros SET token_acesso = gen_random_uuid() WHERE token_acesso IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS membros_token_acesso_idx ON membros (token_acesso);

-- ── escala_membros: add justificativa + adjust status default ────────────────
ALTER TABLE escala_membros
  ADD COLUMN IF NOT EXISTS justificativa TEXT;

-- status values: 'pendente' | 'confirmado' | 'recusado' | 'ausente'
ALTER TABLE escala_membros
  ALTER COLUMN status SET DEFAULT 'pendente';

-- ── paroquias: regras_escala JSONB for configurable engine rules ─────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS regras_escala JSONB NOT NULL DEFAULT '{
    "limite_semanal": null,
    "limite_mensal": null,
    "impedir_repeticao_consecutiva": false,
    "prioridade_score": true,
    "permitir_duplicidade": false,
    "peso_solene": 2,
    "peso_normal": 1
  }'::jsonb;

-- ── Portal RPC functions (SECURITY DEFINER — bypass RLS, token-validated) ────

-- Get member profile by token
CREATE OR REPLACE FUNCTION portal_get_membro(p_token UUID)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(t) FROM (
    SELECT
      m.id,
      m.nome,
      m.email,
      m.telefone,
      m.score,
      m.data_ingresso,
      m.forcar_escalacao_solene,
      m.paroquia_id,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object('id', mn.id, 'nome', mn.nome, 'cor', mn.cor)
        ) FILTER (WHERE mn.id IS NOT NULL),
        '[]'::json
      ) AS ministerios
    FROM membros m
    LEFT JOIN membro_ministerios mm ON mm.membro_id = m.id
    LEFT JOIN ministerios         mn ON mn.id = mm.ministerio_id
    WHERE m.token_acesso = p_token
    GROUP BY m.id
  ) t;
$$;

-- Get upcoming escalas for member
CREATE OR REPLACE FUNCTION portal_get_escalas_membro(p_token UUID)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT
      em.id             AS escala_membro_id,
      em.status,
      em.justificativa,
      em.ministerio_id,
      e.id              AS escala_id,
      e.titulo,
      e.data,
      e.hora_inicio,
      e.hora_fim,
      e.local,
      e.tipo,
      e.solene,
      e.tem_adoracao,
      e.tem_bispo,
      e.observacoes,
      mn.nome           AS ministerio_nome,
      mn.cor            AS ministerio_cor
    FROM escala_membros em
    JOIN escalas        e  ON e.id  = em.escala_id
    JOIN ministerios    mn ON mn.id = em.ministerio_id
    JOIN membros        m  ON m.id  = em.membro_id
    WHERE m.token_acesso = p_token
      AND e.data >= CURRENT_DATE
      AND e.status <> 'cancelada'
    ORDER BY e.data
    LIMIT 20
  ) t;
$$;

-- Get past participation history
CREATE OR REPLACE FUNCTION portal_get_historico_membro(p_token UUID)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data DESC), '[]'::json) FROM (
    SELECT
      em.id    AS escala_membro_id,
      em.status,
      e.titulo,
      e.data,
      e.tipo,
      e.solene,
      mn.nome  AS ministerio_nome,
      mn.cor   AS ministerio_cor,
      hp.presenca,
      hp.pontos
    FROM escala_membros em
    JOIN escalas        e  ON e.id  = em.escala_id
    JOIN ministerios    mn ON mn.id = em.ministerio_id
    JOIN membros        m  ON m.id  = em.membro_id
    LEFT JOIN historico_participacoes hp
           ON hp.escala_id = e.id AND hp.membro_id = m.id
    WHERE m.token_acesso = p_token
      AND e.data < CURRENT_DATE
    ORDER BY e.data DESC
    LIMIT 30
  ) t;
$$;

-- Get future unavailability dates
CREATE OR REPLACE FUNCTION portal_get_indisponibilidades_membro(p_token UUID)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT
      i.id,
      i.data::text AS data,
      i.motivo
    FROM indisponibilidades i
    JOIN membros m ON m.id = i.membro_id
    WHERE m.token_acesso = p_token
      AND i.data >= CURRENT_DATE
    ORDER BY i.data
  ) t;
$$;

-- Confirm or refuse an escala assignment
CREATE OR REPLACE FUNCTION portal_responder_escala(
  p_token             UUID,
  p_escala_membro_id  UUID,
  p_status            TEXT,
  p_justificativa     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id UUID;
BEGIN
  SELECT id INTO v_membro_id FROM membros WHERE token_acesso = p_token;
  IF v_membro_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;

  UPDATE escala_membros
  SET    status         = p_status,
         justificativa  = p_justificativa
  WHERE  id = p_escala_membro_id
    AND  membro_id = v_membro_id;
END;
$$;

-- Add an unavailability date
CREATE OR REPLACE FUNCTION portal_add_indisponibilidade(
  p_token  UUID,
  p_data   DATE,
  p_motivo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro    RECORD;
  v_id        UUID;
BEGIN
  SELECT id, paroquia_id INTO v_membro FROM membros WHERE token_acesso = p_token;
  IF v_membro.id IS NULL THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;

  INSERT INTO indisponibilidades (paroquia_id, membro_id, data, motivo)
  VALUES (v_membro.paroquia_id, v_membro.id, p_data, p_motivo)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Remove an unavailability date
CREATE OR REPLACE FUNCTION portal_remove_indisponibilidade(
  p_token      UUID,
  p_indisp_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id UUID;
BEGIN
  SELECT id INTO v_membro_id FROM membros WHERE token_acesso = p_token;
  IF v_membro_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;

  DELETE FROM indisponibilidades
  WHERE  id = p_indisp_id
    AND  membro_id = v_membro_id;
END;
$$;
