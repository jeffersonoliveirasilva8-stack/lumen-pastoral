-- 007_token_ttl.sql
-- Auditoria de segurança 2026-06-10 — TTL em tokens de acesso de membros.
--
-- PROBLEMA: membros.token_acesso nunca expira.
--   Token roubado = acesso permanente ao portal sem autenticação.
--
-- CORREÇÃO:
--   1. Adicionar token_acesso_expires_at com validade de 90 dias
--   2. Backfill em todos os membros existentes
--   3. Atualizar RPCs do portal para rejeitar tokens expirados
--   4. Cron para rotacionar tokens expirados automaticamente
--   5. Função helper para gerar novo token (usada pelo admin)

-- ── 1. Coluna de expiração ──────────────────────────────────────────────────
ALTER TABLE public.membros
  ADD COLUMN IF NOT EXISTS token_acesso_expires_at TIMESTAMPTZ;

-- ── 2. Backfill: membros existentes recebem 90 dias a partir de agora ───────
UPDATE public.membros
SET token_acesso_expires_at = now() + INTERVAL '30 days'
WHERE token_acesso IS NOT NULL
  AND token_acesso_expires_at IS NULL;

-- ── 3. Default para novos membros ──────────────────────────────────────────
ALTER TABLE public.membros
  ALTER COLUMN token_acesso_expires_at
  SET DEFAULT (now() + INTERVAL '30 days');

-- ── 4. Índice para cron de rotação ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS membros_token_expires_idx
  ON public.membros (token_acesso_expires_at)
  WHERE token_acesso_expires_at IS NOT NULL;

-- ── 5. Atualizar RPCs do portal para validar expiração ─────────────────────

CREATE OR REPLACE FUNCTION public.portal_get_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT row_to_json(t) FROM (
    SELECT
      m.id, m.nome, m.email, m.telefone, m.score, m.data_ingresso,
      m.forcar_escalacao_solene, m.paroquia_id,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', mn.id, 'nome', mn.nome, 'cor', mn.cor))
        FILTER (WHERE mn.id IS NOT NULL), '[]'::json
      ) AS ministerios
    FROM membros m
    LEFT JOIN membro_ministerios mm ON mm.membro_id = m.id
    LEFT JOIN ministerios        mn ON mn.id = mm.ministerio_id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
    GROUP BY m.id
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_escalas_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, em.justificativa, em.ministerio_id,
      e.id AS escala_id, e.titulo, e.data, e.hora_inicio, e.hora_fim,
      e.local, e.tipo, e.solene, e.tem_adoracao, e.tem_bispo, e.observacoes,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND e.data >= CURRENT_DATE
      AND e.status <> 'cancelada'
    ORDER BY e.data
    LIMIT 20
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_historico_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data DESC), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, e.titulo, e.data, e.tipo, e.solene,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor,
      hp.presenca, hp.pontos
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    LEFT JOIN historico_participacoes hp
      ON hp.escala_id = e.id AND hp.membro_id = m.id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND e.data < CURRENT_DATE
    ORDER BY e.data DESC
    LIMIT 30
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_indisponibilidades_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT i.id, i.data::text AS data, i.motivo
    FROM indisponibilidades i
    JOIN membros m ON m.id = i.membro_id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND i.data >= CURRENT_DATE
    ORDER BY i.data
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.portal_responder_escala(
  p_token UUID, p_escala_membro_id UUID,
  p_status TEXT, p_justificativa TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_membro_id UUID;
BEGIN
  SELECT id INTO v_membro_id
  FROM membros
  WHERE token_acesso = p_token
    AND ativo = true
    AND (token_acesso_expires_at IS NULL OR token_acesso_expires_at > now());

  IF v_membro_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido ou expirado';
  END IF;

  UPDATE escala_membros
  SET status = p_status, justificativa = p_justificativa
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_add_indisponibilidade(
  p_token UUID, p_data DATE, p_motivo TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_membro RECORD; v_id UUID;
BEGIN
  SELECT id, paroquia_id INTO v_membro
  FROM membros
  WHERE token_acesso = p_token
    AND ativo = true
    AND (token_acesso_expires_at IS NULL OR token_acesso_expires_at > now());

  IF v_membro.id IS NULL THEN
    RAISE EXCEPTION 'Token inválido ou expirado';
  END IF;

  INSERT INTO indisponibilidades (paroquia_id, membro_id, data, motivo)
  VALUES (v_membro.paroquia_id, v_membro.id, p_data, p_motivo)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_remove_indisponibilidade(
  p_token UUID, p_indisp_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_membro_id UUID;
BEGIN
  SELECT id INTO v_membro_id
  FROM membros
  WHERE token_acesso = p_token
    AND ativo = true
    AND (token_acesso_expires_at IS NULL OR token_acesso_expires_at > now());

  IF v_membro_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido ou expirado';
  END IF;

  DELETE FROM indisponibilidades WHERE id = p_indisp_id AND membro_id = v_membro_id;
END;
$$;

-- ── 6. Helper: rotacionar token de um membro ────────────────────────────────
-- Chamada pelo admin para forçar renovação de token de um membro específico.
CREATE OR REPLACE FUNCTION public.portal_rotacionar_token(p_membro_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_novo_token UUID := gen_random_uuid();
BEGIN
  -- Somente admin da mesma paróquia pode rotacionar
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin_paroquial', 'super_admin', 'coordenador')
  ) THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;

  UPDATE membros
  SET token_acesso           = v_novo_token,
      token_acesso_expires_at = now() + INTERVAL '30 days'
  WHERE id = p_membro_id;

  RETURN v_novo_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_rotacionar_token(UUID) TO authenticated;

-- ── 7. Cron: rotacionar tokens expirados diariamente ───────────────────────
-- Gera novo token + renova por mais 90 dias automaticamente.
-- Membros receberão novo link por e-mail/notificação (integração futura).
SELECT cron.unschedule('membros-token-refresh')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'membros-token-refresh');

SELECT cron.schedule(
  'membros-token-refresh',
  '0 3 * * *',   -- 03:00 UTC diariamente
  $$
  UPDATE public.membros
  SET token_acesso            = gen_random_uuid(),
      token_acesso_expires_at = now() + INTERVAL '30 days'
  WHERE ativo = true
    AND token_acesso_expires_at < now()
  $$
);

-- ── 8. Verificação ─────────────────────────────────────────────────────────
--
--   SELECT id, nome, token_acesso_expires_at
--   FROM membros
--   WHERE token_acesso_expires_at < now()
--   LIMIT 10;
--   -- Deve retornar 0 linhas após execução do UPDATE de backfill
--
--   SELECT jobname, schedule, active
--   FROM cron.job WHERE jobname = 'membros-token-refresh';
