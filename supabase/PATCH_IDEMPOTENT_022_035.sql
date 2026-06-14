-- ============================================================
-- PATCH_IDEMPOTENT_022_035.sql
-- Data: 2026-06-14
--
-- OBJETIVO:
--   Executar o conteúdo de todas as migrations 022 a 035 em um
--   banco parcialmente configurado sem interrupções.
--
-- QUANDO USAR:
--   supabase db push falha porque o banco já possui parte dos
--   objetos criados por essas migrations (triggers, policies, etc.).
--   Execute este patch no SQL Editor do Supabase em vez de
--   supabase db push para migrations individuais.
--
-- IDEMPOTÊNCIA GARANTIDA:
--   ✓ CREATE TRIGGER     → DROP TRIGGER IF EXISTS + CREATE TRIGGER
--   ✓ CREATE POLICY      → DROP POLICY IF EXISTS + CREATE POLICY
--   ✓ CREATE INDEX       → CREATE INDEX IF NOT EXISTS
--   ✓ CREATE FUNCTION    → CREATE OR REPLACE FUNCTION
--   ✓ CREATE TABLE       → CREATE TABLE IF NOT EXISTS
--   ✓ ALTER TABLE        → ADD COLUMN IF NOT EXISTS / ALTER COLUMN SET DEFAULT
--   ✓ INSERT             → ON CONFLICT DO NOTHING / DO UPDATE
--   ✓ UPDATE/DELETE      → sempre idempotentes por natureza
--
-- CORREÇÕES APLICADAS (vs. arquivos originais):
--   022 → DROP TRIGGER IF EXISTS antes de ambos os CREATE TRIGGER
--   023 → DROP POLICY IF EXISTS "subst_admin_all" (estava faltando)
--   024–035 → já eram idempotentes; incluídos sem alteração
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 022: Schema do módulo de substituições
-- ════════════════════════════════════════════════════════════════════════

-- 1. Novo tier de notificações: apenas_coordenacao
ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS apenas_coordenacao BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notificacoes_coord
  ON public.notificacoes (paroquia_id, apenas_coordenacao)
  WHERE apenas_coordenacao = true;

-- 2. Tabela substituicoes
CREATE TABLE IF NOT EXISTS public.substituicoes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id         UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  escala_membro_id    UUID        NOT NULL REFERENCES public.escala_membros(id) ON DELETE CASCADE,
  solicitante_id      UUID        NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,
  substituto_id       UUID        REFERENCES public.membros(id) ON DELETE SET NULL,
  status              TEXT        NOT NULL DEFAULT 'solicitada'
                                  CHECK (status IN ('solicitada','com_voluntario','aprovada','rejeitada','cancelada')),
  motivo_solicitacao  TEXT,
  motivo_rejeicao     TEXT,
  aprovado_por        UUID        REFERENCES public.membros(id) ON DELETE SET NULL,
  aprovado_em         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.substituicoes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_substituicoes_paroquia
  ON public.substituicoes (paroquia_id, status);
CREATE INDEX IF NOT EXISTS idx_substituicoes_solicitante
  ON public.substituicoes (solicitante_id);
CREATE INDEX IF NOT EXISTS idx_substituicoes_substituto
  ON public.substituicoes (substituto_id);
CREATE INDEX IF NOT EXISTS idx_substituicoes_escala_membro
  ON public.substituicoes (escala_membro_id);

DROP TRIGGER IF EXISTS substituicoes_updated_at ON public.substituicoes;
CREATE TRIGGER substituicoes_updated_at
  BEFORE UPDATE ON public.substituicoes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Tabela historico_substituicoes
CREATE TABLE IF NOT EXISTS public.historico_substituicoes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  substituicao_id  UUID        NOT NULL REFERENCES public.substituicoes(id) ON DELETE CASCADE,
  acao             TEXT        NOT NULL,
  actor_id         UUID        REFERENCES public.membros(id) ON DELETE SET NULL,
  detalhes         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.historico_substituicoes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_hist_subst_substituicao
  ON public.historico_substituicoes (substituicao_id, created_at DESC);

-- 4. Tabela paroquia_config_escalas
CREATE TABLE IF NOT EXISTS public.paroquia_config_escalas (
  paroquia_id              UUID    PRIMARY KEY REFERENCES public.paroquias(id) ON DELETE CASCADE,
  confirmacao_ativa        BOOLEAN NOT NULL DEFAULT false,
  confirmacao_horas_antes  INTEGER NOT NULL DEFAULT 72,
  substituicao_ativa       BOOLEAN NOT NULL DEFAULT false,
  substituicao_horas_antes INTEGER NOT NULL DEFAULT 48,
  auto_pontuar             BOOLEAN NOT NULL DEFAULT false,
  pontuacao_presenca       INTEGER NOT NULL DEFAULT 1,
  pontuacao_falta          INTEGER NOT NULL DEFAULT -2,
  pontuacao_atraso         INTEGER NOT NULL DEFAULT -1,
  pontuacao_justificou     INTEGER NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.paroquia_config_escalas ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS paroquia_config_escalas_updated_at ON public.paroquia_config_escalas;
CREATE TRIGGER paroquia_config_escalas_updated_at
  BEFORE UPDATE ON public.paroquia_config_escalas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Backfill: config para paróquias existentes
INSERT INTO public.paroquia_config_escalas (
  paroquia_id,
  confirmacao_ativa
)
SELECT
  p.id,
  COALESCE((p.regras_escala->>'confirmacao_escala_ativa')::boolean, false)
FROM public.paroquias p
ON CONFLICT (paroquia_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 023: RLS + helper is_coordenador + tier coordenador notif
-- ════════════════════════════════════════════════════════════════════════

-- 1. Helper is_coordenador_da_paroquia
CREATE OR REPLACE FUNCTION public.is_coordenador_da_paroquia(p_paroquia_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membros m
    WHERE (
        m.auth_user_id = auth.uid()
        OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
      )
      AND m.ativo = true
      AND m.paroquia_id = p_paroquia_id
      AND (
        m.tipo_acesso IN ('auxiliar','coordenador','administrador')
        OR EXISTS (
          SELECT 1 FROM public.coordenadores c
          WHERE c.membro_id = m.id
            AND c.paroquia_id = p_paroquia_id
            AND c.ativo = true
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_coordenador_da_paroquia(UUID) TO authenticated;

-- 2. Atualiza notif_membro_read (apenas_coordenacao ciente)
DROP POLICY IF EXISTS "notif_membro_read" ON public.notificacoes;

CREATE POLICY "notif_membro_read" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM public.membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (
        apenas_coordenacao = false
        OR public.is_coordenador_da_paroquia(paroquia_id)
      )
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
          UNION
          SELECT id FROM public.membros
          WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
            AND ativo = true
        )
      )
    )
  );

-- 3. Atualiza notif_membro_mark_read
DROP POLICY IF EXISTS "notif_membro_mark_read" ON public.notificacoes;

CREATE POLICY "notif_membro_mark_read" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM public.membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (
        apenas_coordenacao = false
        OR public.is_coordenador_da_paroquia(paroquia_id)
      )
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
          UNION
          SELECT id FROM public.membros
          WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
            AND ativo = true
        )
      )
    )
  )
  WITH CHECK (true);

-- 4. RPCs de notificação cientes de apenas_coordenacao
CREATE OR REPLACE FUNCTION public.portal_count_notif_nao_lidas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_is_coord    BOOLEAN;
  v_count       INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN RETURN 0; END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN 0; END IF;

  v_is_coord := public.is_coordenador_da_paroquia(v_paroquia_id);

  SELECT COUNT(*) INTO v_count FROM notificacoes n
  WHERE  n.paroquia_id    = v_paroquia_id
    AND  n.apenas_admin   = false
    AND  (v_is_coord OR n.apenas_coordenacao = false)
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
    AND  NOT EXISTS (
           SELECT 1 FROM notificacoes_leituras nl
           WHERE  nl.notificacao_id = n.id AND nl.membro_id = v_membro_id
         );

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_marcar_todas_notificacoes_lidas()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_is_coord    BOOLEAN;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  v_is_coord := public.is_coordenador_da_paroquia(v_paroquia_id);

  INSERT INTO notificacoes_leituras (notificacao_id, membro_id)
  SELECT n.id, v_membro_id FROM notificacoes n
  WHERE  n.paroquia_id    = v_paroquia_id
    AND  n.apenas_admin   = false
    AND  (v_is_coord OR n.apenas_coordenacao = false)
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
  ON CONFLICT (notificacao_id, membro_id) DO NOTHING;

  UPDATE notificacoes SET lida = true
  WHERE  paroquia_id    = v_paroquia_id
    AND  apenas_admin   = false
    AND  (v_is_coord OR apenas_coordenacao = false)
    AND  (destinatario_id IS NULL OR destinatario_id = v_membro_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5. _notify_coordenacao: usa apenas_coordenacao=true
CREATE OR REPLACE FUNCTION public._notify_coordenacao(
  p_paroquia_id uuid,
  p_titulo      text,
  p_mensagem    text,
  p_tipo        text DEFAULT 'alerta',
  p_link        text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, link_referencia)
  VALUES
    (p_paroquia_id, p_titulo, p_mensagem, p_tipo, false, false, true, p_link);
END;
$$;

-- 6. RLS: substituicoes
DROP POLICY IF EXISTS "subst_membro_read"   ON public.substituicoes;
DROP POLICY IF EXISTS "subst_coord_read"    ON public.substituicoes;
DROP POLICY IF EXISTS "subst_membro_insert" ON public.substituicoes;
DROP POLICY IF EXISTS "subst_rpc_all"       ON public.substituicoes;
DROP POLICY IF EXISTS "subst_admin_all"     ON public.substituicoes;

CREATE POLICY "subst_membro_read" ON public.substituicoes
  FOR SELECT TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
    AND (
      solicitante_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
      OR substituto_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
      OR public.is_coordenador_da_paroquia(paroquia_id)
    )
  );

CREATE POLICY "subst_admin_all" ON public.substituicoes
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- 7. RLS: historico_substituicoes
DROP POLICY IF EXISTS "hist_subst_read"  ON public.historico_substituicoes;
DROP POLICY IF EXISTS "hist_subst_admin" ON public.historico_substituicoes;

CREATE POLICY "hist_subst_read" ON public.historico_substituicoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.substituicoes s
      WHERE s.id = substituicao_id
        AND (
          s.solicitante_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
          OR s.substituto_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
          OR public.is_coordenador_da_paroquia(s.paroquia_id)
        )
    )
  );

-- 8. RLS: paroquia_config_escalas
DROP POLICY IF EXISTS "config_escalas_read"  ON public.paroquia_config_escalas;
DROP POLICY IF EXISTS "config_escalas_admin" ON public.paroquia_config_escalas;

CREATE POLICY "config_escalas_read" ON public.paroquia_config_escalas
  FOR SELECT TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
  );

CREATE POLICY "config_escalas_admin" ON public.paroquia_config_escalas
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 024: RPCs do módulo de substituições
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_solicitar_substituicao(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id      UUID := auth.uid();
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_escala_id    UUID;
  v_subst_id     UUID;
  v_config       public.paroquia_config_escalas%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT e.data, em.escala_id INTO v_escala_data, v_escala_id
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id
    AND em.membro_id = v_membro_id
    AND e.paroquia_id = v_paroquia_id;

  IF v_escala_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  IF v_escala_data <= CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_passada');
  END IF;

  SELECT * INTO v_config FROM public.paroquia_config_escalas WHERE paroquia_id = v_paroquia_id;

  IF FOUND AND v_config.substituicao_ativa AND v_config.substituicao_horas_antes > 0 THEN
    IF (v_escala_data::timestamptz - now()) < (v_config.substituicao_horas_antes || ' hours')::interval THEN
      RETURN jsonb_build_object('success', false, 'error', 'prazo_expirado',
        'horas_minimas', v_config.substituicao_horas_antes);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_ja_ativa');
  END IF;

  INSERT INTO public.substituicoes
    (paroquia_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
  VALUES
    (v_paroquia_id, p_escala_membro_id, v_membro_id, p_motivo, 'solicitada')
  RETURNING id INTO v_subst_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (v_subst_id, 'solicitada', v_membro_id,
    jsonb_build_object('motivo', p_motivo, 'escala_membro_id', p_escala_membro_id));

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_voluntariar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_subst       public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes
  WHERE id = p_substituicao_id AND paroquia_id = v_paroquia_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF v_subst.status <> 'solicitada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_nao_disponivel', 'status', v_subst.status);
  END IF;

  IF v_subst.solicitante_id = v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'proprio_solicitante');
  END IF;

  UPDATE public.substituicoes
  SET status = 'com_voluntario', substituto_id = v_membro_id
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'voluntario_registrado', v_membro_id,
    jsonb_build_object('substituto_id', v_membro_id));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_voluntariar_substituicao(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_cancelar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
  v_subst     public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_membro_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes
  WHERE id = p_substituicao_id AND solicitante_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_cancelavel', 'status', v_subst.status);
  END IF;

  UPDATE public.substituicoes SET status = 'cancelada' WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'cancelada', v_membro_id, '{}'::jsonb);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_cancelar_substituicao(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.coord_aprovar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_coord_id  UUID;
  v_subst     public.substituicoes%ROWTYPE;
  v_em        public.escala_membros%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_coord_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_subst.paroquia_id)
    OR public._portal_is_admin(v_subst.paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status <> 'com_voluntario' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_sem_voluntario', 'status', v_subst.status);
  END IF;

  IF v_subst.substituto_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_substituto');
  END IF;

  SELECT * INTO v_em FROM public.escala_membros WHERE id = v_subst.escala_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  UPDATE public.escala_membros
  SET membro_id = v_subst.substituto_id, status = 'confirmado'
  WHERE id = v_subst.escala_membro_id;

  UPDATE public.substituicoes
  SET status = 'aprovada', aprovado_por = v_coord_id, aprovado_em = now()
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'aprovada', v_coord_id,
    jsonb_build_object(
      'membro_original', v_em.membro_id,
      'substituto', v_subst.substituto_id,
      'escala_membro_id', v_subst.escala_membro_id
    ));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_aprovar_substituicao(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.coord_rejeitar_substituicao(
  p_substituicao_id UUID,
  p_motivo          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id  UUID := auth.uid();
  v_coord_id UUID;
  v_subst    public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_coord_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_subst.paroquia_id)
    OR public._portal_is_admin(v_subst.paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_rejeitavel', 'status', v_subst.status);
  END IF;

  UPDATE public.substituicoes
  SET status = 'rejeitada', motivo_rejeicao = p_motivo
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'rejeitada', v_coord_id,
    jsonb_build_object('motivo', p_motivo));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_rejeitar_substituicao(UUID, TEXT) TO authenticated;

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

  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    m.id          AS membro_id,
    m.nome        AS nome,
    COALESCE(m.score, 0) AS score,
    EXISTS (
      SELECT 1 FROM public.indisponibilidades i
      WHERE i.membro_id = m.id AND i.data = v_escala_data
    ) AS tem_indisp
  FROM public.membros m
  JOIN public.membro_ministerios mm ON mm.membro_id = m.id AND mm.ministerio_id = p_ministerio_id
  WHERE m.paroquia_id = v_paroquia_id
    AND m.ativo = true
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = p_escala_id AND em.membro_id = m.id
    )
  ORDER BY
    tem_indisp ASC,
    m.score DESC,
    m.nome ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_buscar_substitutos(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_get_substituicoes_membro()
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  motivo_rejeicao    TEXT,
  created_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ,
  tipo               TEXT,
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT,
  substituto_nome    TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.id INTO v_membro_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.created_at,
    s.updated_at,
    CASE WHEN s.solicitante_id = v_membro_id THEN 'solicitante' ELSE 'voluntario' END AS tipo,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome,
    mv.nome    AS substituto_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em ON em.id = s.escala_membro_id
  JOIN public.escalas         e  ON e.id  = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  WHERE (s.solicitante_id = v_membro_id OR s.substituto_id = v_membro_id)
  ORDER BY s.created_at DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_substituicoes_membro() TO authenticated;

-- coord_get_substituicoes: versão final (inclui escala_id + ministerio_id, permite _portal_is_admin)
CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  motivo_rejeicao    TEXT,
  aprovado_em        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ,
  escala_id          UUID,
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_id      UUID,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT,
  substituto_nome    TEXT,
  aprovador_nome     TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.aprovado_em,
    s.created_at,
    em.escala_id      AS escala_id,
    e.titulo          AS escala_titulo,
    e.data            AS escala_data,
    em.ministerio_id  AS ministerio_id,
    min.nome          AS ministerio_nome,
    min.cor           AS ministerio_cor,
    ms.nome           AS solicitante_nome,
    mv.nome           AS substituto_nome,
    ma.nome           AS aprovador_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em  ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  LEFT JOIN public.membros    ma  ON ma.id  = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY
    CASE s.status
      WHEN 'com_voluntario' THEN 1
      WHEN 'solicitada'     THEN 2
      WHEN 'aprovada'       THEN 3
      WHEN 'rejeitada'      THEN 4
      WHEN 'cancelada'      THEN 5
    END,
    e.data ASC,
    s.created_at DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_get_substituicoes(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 025: Triggers de notificação para o módulo de substituições
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_substituicao_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_solicitante_nome TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
BEGIN
  SELECT m.nome INTO v_solicitante_nome
  FROM public.membros m WHERE m.id = NEW.solicitante_id;

  SELECT e.titulo, e.data, min.nome
  INTO v_escala_titulo, v_escala_data, v_ministerio_nome
  FROM public.escala_membros em
  JOIN public.escalas     e   ON e.id   = em.escala_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.id = NEW.escala_membro_id;

  PERFORM public._notify_coordenacao(
    NEW.paroquia_id,
    'Substituição solicitada — ' || to_char(v_escala_data, 'DD/MM'),
    format(
      '%s solicitou substituição em "%s" (%s) para %s. Aguardando aprovação.',
      COALESCE(v_solicitante_nome, 'Membro'),
      COALESCE(v_escala_titulo, '—'),
      COALESCE(v_ministerio_nome, '—'),
      to_char(v_escala_data, 'DD/MM/YYYY')
    ),
    'alerta',
    '/substituicoes'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_substituicao_insert ON public.substituicoes;
CREATE TRIGGER on_substituicao_insert
  AFTER INSERT ON public.substituicoes
  FOR EACH ROW EXECUTE FUNCTION public._trigger_substituicao_insert();

CREATE OR REPLACE FUNCTION public._trigger_substituicao_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_solicitante_nome TEXT;
  v_substituto_nome  TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  SELECT m.nome INTO v_solicitante_nome
  FROM public.membros m WHERE m.id = NEW.solicitante_id;

  SELECT mv.nome INTO v_substituto_nome
  FROM public.membros mv WHERE mv.id = NEW.substituto_id;

  SELECT e.titulo, e.data, min.nome
  INTO v_escala_titulo, v_escala_data, v_ministerio_nome
  FROM public.escala_membros em
  JOIN public.escalas     e   ON e.id   = em.escala_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.id = NEW.escala_membro_id;

  IF NEW.status = 'com_voluntario' THEN
    PERFORM public._notify_coordenacao(
      NEW.paroquia_id,
      'Voluntário disponível — ' || to_char(v_escala_data, 'DD/MM'),
      format(
        '%s se voluntariou para substituir %s em "%s" (%s). Aguarda aprovação.',
        COALESCE(v_substituto_nome, 'Membro'),
        COALESCE(v_solicitante_nome, '—'),
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY')
      ),
      'urgente',
      '/substituicoes'
    );
  END IF;

  IF NEW.status = 'aprovada' THEN
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Substituição aprovada ✓',
      format(
        'Sua substituição em "%s" (%s) foi aprovada. %s irá no seu lugar.',
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY'),
        COALESCE(v_substituto_nome, 'O voluntário')
      ),
      'aviso', false, false, false,
      NEW.solicitante_id,
      '/portal-membro/substituicoes'
    );

    IF NEW.substituto_id IS NOT NULL THEN
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
      VALUES (
        NEW.paroquia_id,
        'Você foi confirmado como substituto',
        format(
          'Você substituirá %s em "%s" (%s). Confirme sua presença na escala.',
          COALESCE(v_solicitante_nome, '—'),
          COALESCE(v_escala_titulo, '—'),
          to_char(v_escala_data, 'DD/MM/YYYY')
        ),
        'aviso', false, false, false,
        NEW.substituto_id,
        '/portal-membro/escalas'
      );
    END IF;
  END IF;

  IF NEW.status = 'rejeitada' THEN
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Substituição não aprovada',
      format(
        'Sua solicitação de substituição em "%s" (%s) não foi aprovada.%s',
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY'),
        CASE WHEN NEW.motivo_rejeicao IS NOT NULL THEN ' Motivo: ' || NEW.motivo_rejeicao ELSE '' END
      ),
      'alerta', false, false, false,
      NEW.solicitante_id,
      '/portal-membro/substituicoes'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_substituicao_update ON public.substituicoes;
CREATE TRIGGER on_substituicao_update
  AFTER UPDATE ON public.substituicoes
  FOR EACH ROW EXECUTE FUNCTION public._trigger_substituicao_update();

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 026: Sistema de pontuação automática
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._get_pontos_status(
  p_paroquia_id UUID,
  p_status      TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'presente'   THEN COALESCE((SELECT pontuacao_presenca   FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
    WHEN 'confirmado' THEN COALESCE((SELECT pontuacao_presenca   FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
    WHEN 'faltou'     THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'ausente'    THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'atrasado'   THEN COALESCE((SELECT pontuacao_atraso     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -1)
    WHEN 'justificou' THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    WHEN 'recusado'   THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id    UUID;
  v_escala_data    DATE;
  v_config         public.paroquia_config_escalas%ROWTYPE;
  v_pontos         INTEGER;
  v_status_final   CONSTANT TEXT[] := ARRAY['presente','confirmado','faltou','ausente','atrasado','justificou','recusado'];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_config
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status);

  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id, presenca, data, pontos)
  VALUES (
    v_paroquia_id,
    NEW.membro_id,
    NEW.escala_id,
    NEW.ministerio_id,
    NEW.status,
    v_escala_data,
    v_pontos
  )
  ON CONFLICT (membro_id, escala_id, ministerio_id) DO UPDATE
    SET presenca = EXCLUDED.presenca,
        pontos   = EXCLUDED.pontos;

  UPDATE public.membros
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = NEW.membro_id
  )
  WHERE id = NEW.membro_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;
CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._trigger_pontuar_participacao();

CREATE OR REPLACE FUNCTION public.admin_recalcular_scores_paroquia(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id UUID := auth.uid();
  v_count   INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public._portal_is_admin(p_paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  UPDATE public.membros m
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = m.id
  )
  WHERE m.paroquia_id = p_paroquia_id AND m.ativo = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'membros_atualizados', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recalcular_scores_paroquia(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 027: Go-Live — Limpeza de Dados de Homologação
-- (DELETE é idempotente: remove o que existir, no-op se já limpo)
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_padroes TEXT[] := ARRAY[
    '%teste%', '%test%', '%homolog%', '%demo%',
    '%fictici%', '%fictíci%',
    '%validac%', '%validaç%',
    '%simulad%', '%exemplo%', '%temp%'
  ];
  c_membros_score INTEGER;
BEGIN
  DELETE FROM public.notificacoes;

  DELETE FROM public.escalas
  WHERE titulo ILIKE ANY(v_padroes);

  DELETE FROM public.formacoes_eventos
  WHERE titulo ILIKE ANY(v_padroes);

  DELETE FROM public.indisponibilidades
  WHERE motivo ILIKE ANY(v_padroes)
     OR motivo IS NULL;

  UPDATE public.membros m
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = m.id
  )
  WHERE m.ativo = true;

  GET DIAGNOSTICS c_membros_score = ROW_COUNT;
  RAISE NOTICE 'Go-Live cleanup: scores recalculados para % membros ativos.', c_membros_score;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 028: Correções pós-go-live
-- ════════════════════════════════════════════════════════════════════════

-- Fix set_updated_at() para suportar comunidades.atualizado_em
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('comunidades', 'coordenadores') THEN
    NEW.atualizado_em = NOW();
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- portal_recusar_escala: SEMPRE cria substituição na recusa
CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_id    UUID;
  v_subst_id     UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_membro_id
  FROM public.membros
  WHERE (auth_user_id = auth.uid()
         OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  SELECT escala_id INTO v_escala_id
  FROM public.escala_membros
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = v_escala_id;

  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = trim(p_motivo)
  WHERE id = p_escala_membro_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    INSERT INTO public.substituicoes
      (paroquia_id, escala_membro_id, solicitante_id, motivo_solicitacao)
    VALUES
      (v_paroquia_id, p_escala_membro_id, v_membro_id,
       COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'))
    RETURNING id INTO v_subst_id;

    INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
    VALUES (v_subst_id, 'solicitada', v_membro_id,
      jsonb_build_object('origem', 'recusa', 'motivo', p_motivo));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'substituicao_criada', v_subst_id IS NOT NULL,
    'substituicao_id', v_subst_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 029: Backfill substituicao_ativa + fix admins em coord funcs
-- ════════════════════════════════════════════════════════════════════════

UPDATE public.paroquia_config_escalas
SET substituicao_ativa = true
WHERE substituicao_ativa = false;

INSERT INTO public.paroquia_config_escalas
  (paroquia_id, confirmacao_ativa, substituicao_ativa, auto_pontuar,
   pontuacao_presenca, pontuacao_falta, pontuacao_atraso, pontuacao_justificou)
SELECT
  p.id, true, true, true, 1, -2, -1, 0
FROM public.paroquias p
WHERE NOT EXISTS (
  SELECT 1 FROM public.paroquia_config_escalas c WHERE c.paroquia_id = p.id
)
ON CONFLICT (paroquia_id) DO NOTHING;

ALTER TABLE public.paroquia_config_escalas
  ALTER COLUMN substituicao_ativa SET DEFAULT true;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 030: Substituições abertas para voluntariar + portal_get_substituicoes_abertas
-- (coord_get_substituicoes já foi incluído acima na versão final)
-- ════════════════════════════════════════════════════════════════════════

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
  WHERE s.paroquia_id  = v_paroquia_id
    AND s.status       = 'solicitada'
    AND s.solicitante_id <> v_membro_id
    AND e.data         >= CURRENT_DATE
    AND EXISTS (
      SELECT 1 FROM public.membro_ministerios mm
      WHERE mm.membro_id = v_membro_id AND mm.ministerio_id = em.ministerio_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em2
      WHERE em2.escala_id = em.escala_id AND em2.membro_id = v_membro_id
    )
  ORDER BY e.data ASC, s.created_at ASC
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_substituicoes_abertas() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 031: Painel de auditoria e recuperação de ativação
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_get_ativacao_stats()
RETURNS TABLE(
  total_membros          BIGINT,
  pendentes_ativacao     BIGINT,
  convite_enviado        BIGINT,
  nunca_convidados       BIGINT,
  conta_ativada          BIGINT,
  sem_email              BIGINT,
  sem_auth_user          BIGINT,
  sem_profile            BIGINT,
  sem_role               BIGINT,
  logins_realizados      BIGINT,
  sem_login_pos_ativacao BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.conta_ativada = false),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.conta_ativada = false AND m.ativacao_enviada_em IS NOT NULL),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.conta_ativada = false AND m.email IS NOT NULL
       AND m.ativacao_enviada_em IS NULL),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.conta_ativada = true),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.email IS NULL),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.auth_user_id IS NULL),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.auth_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.auth_user_id)),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.auth_user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = m.auth_user_id
           AND ur.role IN ('membro','servidor','auxiliar','coordenador')
       )),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     JOIN auth.users au ON au.id = m.auth_user_id
     WHERE m.paroquia_id = v_paroquia_id
       AND m.conta_ativada = true
       AND au.last_sign_in_at IS NOT NULL),
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     LEFT JOIN auth.users au ON au.id = m.auth_user_id
     WHERE m.paroquia_id = v_paroquia_id
       AND m.conta_ativada = true
       AND (au.id IS NULL OR au.last_sign_in_at IS NULL));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_ativacao_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_membros_inconsistentes()
RETURNS TABLE(
  membro_id          UUID,
  nome               TEXT,
  email              TEXT,
  tipo_problema      TEXT,
  detalhe            TEXT,
  ativacao_enviada_em TIMESTAMPTZ,
  auth_user_id       UUID,
  token_acesso       UUID,
  ultimo_login       TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    m.id, m.nome, m.email,
    'nunca_convidado'::TEXT,
    'Membro ativo com e-mail cadastrado mas nunca recebeu convite de acesso.'::TEXT,
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at, m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.conta_ativada = false
    AND m.email IS NOT NULL
    AND m.ativacao_enviada_em IS NULL

  UNION ALL

  SELECT
    m.id, m.nome, m.email,
    'aguardando_ativacao'::TEXT,
    'Convite enviado em ' || TO_CHAR(m.ativacao_enviada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' — membro ainda não criou a senha.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at, m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.conta_ativada = false
    AND m.ativacao_enviada_em IS NOT NULL

  UNION ALL

  SELECT
    m.id, m.nome, m.email,
    'sem_profile'::TEXT,
    'auth_user_id vinculado (' || m.auth_user_id::TEXT || ') mas sem registro na tabela profiles.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at, m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.auth_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.auth_user_id)

  UNION ALL

  SELECT
    m.id, m.nome, m.email,
    'sem_role'::TEXT,
    'auth_user_id vinculado mas sem role atribuído em user_roles. O membro não consegue acessar o portal.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at, m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.auth_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = m.auth_user_id
        AND ur.role IN ('membro','servidor','auxiliar','coordenador')
    )

  UNION ALL

  SELECT
    m.id, m.nome, m.email,
    'sem_email'::TEXT,
    'Membro ativo sem e-mail cadastrado — impossível enviar convite por e-mail.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at, m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.email IS NULL
    AND m.conta_ativada = false

  ORDER BY
    CASE tipo_problema
      WHEN 'sem_profile'         THEN 1
      WHEN 'sem_role'            THEN 2
      WHEN 'nunca_convidado'     THEN 3
      WHEN 'aguardando_ativacao' THEN 4
      WHEN 'sem_email'           THEN 5
    END,
    nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_membros_inconsistentes() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reprocessar_pendentes()
RETURNS TABLE(
  membro_id UUID,
  nome      TEXT,
  email     TEXT,
  acao      TEXT,
  resultado TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  m             RECORD;
  v_au_id       UUID;
  v_acao        TEXT;
  v_resultado   TEXT;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  FOR m IN
    SELECT mem.id, mem.nome, mem.email, mem.auth_user_id, mem.token_acesso
    FROM public.membros mem
    WHERE mem.paroquia_id = v_paroquia_id
      AND mem.ativo        = true
      AND mem.conta_ativada = false
    ORDER BY mem.nome
  LOOP
    v_au_id    := m.auth_user_id;
    v_acao     := '';
    v_resultado:= '';

    IF v_au_id IS NULL AND m.email IS NOT NULL THEN
      SELECT au.id INTO v_au_id
      FROM auth.users au
      WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(m.email))
      LIMIT 1;

      IF v_au_id IS NOT NULL THEN
        UPDATE public.membros SET auth_user_id = v_au_id WHERE id = m.id;
        v_acao := 'auth_vinculado';
      END IF;
    END IF;

    IF v_au_id IS NULL THEN
      membro_id := m.id;
      nome      := m.nome;
      email     := m.email;
      acao      := 'sem_auth';
      resultado := 'Usuário auth não encontrado. Envie o convite para que o membro crie a senha.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    INSERT INTO public.profiles (id, nome_completo, email, paroquia_id)
    VALUES (v_au_id, m.nome, m.email, v_paroquia_id)
    ON CONFLICT (id) DO UPDATE
      SET paroquia_id = EXCLUDED.paroquia_id
      WHERE profiles.paroquia_id IS NULL;

    INSERT INTO public.user_roles (user_id, role, paroquia_id)
    VALUES (v_au_id, 'membro', v_paroquia_id)
    ON CONFLICT DO NOTHING;

    UPDATE public.membros SET conta_ativada = true WHERE id = m.id;

    v_resultado := CASE
      WHEN v_acao = 'auth_vinculado' THEN 'auth vinculado + profile + role + conta ativada'
      ELSE 'profile + role criados + conta ativada'
    END;

    membro_id := m.id;
    nome      := m.nome;
    email     := m.email;
    acao      := COALESCE(NULLIF(v_acao,''),'ativado');
    resultado := v_resultado;
    RETURN NEXT;
  END LOOP;

  FOR m IN
    SELECT m2.id, m2.nome, m2.email, m2.auth_user_id
    FROM public.membros m2
    WHERE m2.paroquia_id   = v_paroquia_id
      AND m2.ativo          = true
      AND m2.conta_ativada  = true
      AND m2.auth_user_id  IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m2.auth_user_id)
        OR NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = m2.auth_user_id
            AND ur.role IN ('membro','servidor','auxiliar','coordenador')
        )
      )
    ORDER BY m2.nome
  LOOP
    INSERT INTO public.profiles (id, nome_completo, email, paroquia_id)
    VALUES (m.auth_user_id, m.nome, m.email, v_paroquia_id)
    ON CONFLICT (id) DO UPDATE
      SET paroquia_id = EXCLUDED.paroquia_id
      WHERE profiles.paroquia_id IS NULL;

    INSERT INTO public.user_roles (user_id, role, paroquia_id)
    VALUES (m.auth_user_id, 'membro', v_paroquia_id)
    ON CONFLICT DO NOTHING;

    membro_id := m.id;
    nome      := m.nome;
    email     := m.email;
    acao      := 'correcao_pos_ativacao';
    resultado := 'Profile e/ou role recriados para membro já ativado.';
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reprocessar_pendentes() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_email_logs_stats()
RETURNS TABLE(
  total_enviados    BIGINT,
  entregues         BIGINT,
  com_erro          BIGINT,
  via_fallback      BIGINT,
  ultimo_envio      TIMESTAMPTZ,
  ativacoes_novas   BIGINT,
  reenvios          BIGINT,
  resets_senha      BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_paroquia_nome TEXT;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT pr.paroquia_id, pa.nome
  INTO v_paroquia_id, v_paroquia_nome
  FROM public.profiles pr
  JOIN public.paroquias pa ON pa.id = pr.paroquia_id
  WHERE pr.id = v_auth_id;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE el.status = 'enviado')::BIGINT,
    COUNT(*) FILTER (WHERE el.status = 'erro')::BIGINT,
    COUNT(*) FILTER (WHERE el.status = 'fallback')::BIGINT,
    MAX(el.created_at),
    COUNT(*) FILTER (WHERE el.tipo = 'ativacao_conta')::BIGINT,
    COUNT(*) FILTER (WHERE el.tipo IN ('reenvio_ativacao','ativacao_por_token'))::BIGINT,
    COUNT(*) FILTER (WHERE el.tipo = 'reset_senha')::BIGINT
  FROM public.email_logs el
  WHERE el.paroquia = v_paroquia_nome OR el.paroquia IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_email_logs_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_email_logs_recentes(p_limit INT DEFAULT 50)
RETURNS TABLE(
  id          UUID,
  tipo        TEXT,
  destinatario TEXT,
  status      TEXT,
  provider    TEXT,
  erro        TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_paroquia_nome TEXT;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT pr.paroquia_id, pa.nome
  INTO v_paroquia_id, v_paroquia_nome
  FROM public.profiles pr
  JOIN public.paroquias pa ON pa.id = pr.paroquia_id
  WHERE pr.id = v_auth_id;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT el.id, el.tipo, el.destinatario, el.status, el.provider, el.erro, el.created_at
  FROM public.email_logs el
  WHERE el.paroquia = v_paroquia_nome OR el.paroquia IS NULL
  ORDER BY el.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_email_logs_recentes(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 032: Fix RLS INSERT em indisponibilidades para admins
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "indisp_membro_insert" ON public.indisponibilidades;

CREATE POLICY "indisp_membro_insert" ON public.indisponibilidades
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      membro_id  = public._portal_membro_id()
      AND paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
    )
    OR public._portal_is_admin(paroquia_id)
  );

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 033: Corrige ambiguidade de coluna em admin_reprocessar_pendentes
-- (já incluído acima na versão final com alias `mem`)
-- ════════════════════════════════════════════════════════════════════════
-- Nota: admin_reprocessar_pendentes acima já usa o alias `mem` correto.

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 034: Promove PATCH_T (MFA admin) e PATCH_X (rate limit email)
-- ════════════════════════════════════════════════════════════════════════

-- PATCH_X: coluna requester_user_id em email_logs
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_dest_time
  ON public.email_logs (destinatario, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_time
  ON public.email_logs (requester_user_id, created_at DESC)
  WHERE requester_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_tipo_dest_time
  ON public.email_logs (tipo, destinatario, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_email_rate_limit(
  p_destinatario    TEXT,
  p_tipo            TEXT,
  p_requester_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_dest_1m   INT;
  v_count_dest_1h   INT;
  v_count_user_1m   INT;
  v_count_user_1h   INT;
  v_count_mfa_10m   INT;
  c_dest_per_min    INT := 5;
  c_dest_per_hour   INT := 20;
  c_user_per_min    INT := 10;
  c_user_per_hour   INT := 50;
  c_mfa_per_10min   INT := 3;
BEGIN
  SELECT COUNT(*) INTO v_count_dest_1m
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 minute';

  IF v_count_dest_1m >= c_dest_per_min THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_min || ' e-mails por minuto para este destinatário');
  END IF;

  SELECT COUNT(*) INTO v_count_dest_1h
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count_dest_1h >= c_dest_per_hour THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_hour || ' e-mails por hora para este destinatário');
  END IF;

  IF p_tipo = 'mfa_admin_code' THEN
    SELECT COUNT(*) INTO v_count_mfa_10m
    FROM public.email_logs
    WHERE tipo = 'mfa_admin_code'
      AND destinatario = lower(trim(p_destinatario))
      AND status = 'enviado'
      AND created_at > now() - INTERVAL '10 minutes';

    IF v_count_mfa_10m >= c_mfa_per_10min THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_mfa_per_10min || ' códigos MFA por 10 minutos');
    END IF;
  END IF;

  IF p_requester_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_user_1m
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 minute';

    IF v_count_user_1m >= c_user_per_min THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_min || ' e-mails por minuto por conta');
    END IF;

    SELECT COUNT(*) INTO v_count_user_1h
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 hour';

    IF v_count_user_1h >= c_user_per_hour THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_hour || ' e-mails por hora por conta');
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', null);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[rate_limit] Erro ao verificar rate limit: %', SQLERRM;
  RETURN jsonb_build_object('allowed', true, 'reason', null);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) FROM authenticated, anon;

SELECT cron.unschedule('email-logs-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-logs-cleanup');

SELECT cron.schedule(
  'email-logs-cleanup',
  '0 4 * * 0',
  $$DELETE FROM public.email_logs WHERE created_at < now() - INTERVAL '90 days'$$
);

-- PATCH_T: tabela admin_mfa_codes
CREATE TABLE IF NOT EXISTS public.admin_mfa_codes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash           TEXT        NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  attempts            INT         NOT NULL DEFAULT 0,
  verified            BOOLEAN     NOT NULL DEFAULT false,
  mfa_session_token   UUID,
  session_expires_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_user_active
  ON public.admin_mfa_codes (user_id, created_at DESC)
  WHERE verified = false;

CREATE INDEX IF NOT EXISTS idx_admin_mfa_session_token
  ON public.admin_mfa_codes (mfa_session_token)
  WHERE mfa_session_token IS NOT NULL;

ALTER TABLE public.admin_mfa_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.admin_mfa_codes TO service_role;

CREATE OR REPLACE FUNCTION public.store_admin_mfa_code(
  p_user_email  TEXT,
  p_code_hash   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(p_user_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado: %', p_user_email;
  END IF;

  UPDATE public.admin_mfa_codes
  SET attempts = 99
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now();

  INSERT INTO public.admin_mfa_codes (user_id, code_hash, expires_at)
  VALUES (v_user_id, p_code_hash, now() + INTERVAL '10 minutes');
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_admin_mfa_code TO service_role;

CREATE OR REPLACE FUNCTION public.verify_admin_mfa_code(
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record     public.admin_mfa_codes%ROWTYPE;
  v_token      UUID;
  v_user_id    UUID;
  v_hash       TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não autenticado');
  END IF;

  v_hash := encode(sha256(TRIM(p_code)::bytea), 'hex');

  SELECT * INTO v_record
  FROM public.admin_mfa_codes
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now()
    AND attempts < 5
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Código expirado ou número máximo de tentativas atingido. Solicite um novo.');
  END IF;

  UPDATE public.admin_mfa_codes SET attempts = attempts + 1 WHERE id = v_record.id;

  IF v_record.code_hash <> v_hash THEN
    BEGIN
      INSERT INTO public.audit_logs (actor_user_id, entidade, entidade_id, acao, dados_novos)
      VALUES (v_user_id, 'admin_mfa_codes', v_record.id, 'MFA_FAIL',
        jsonb_build_object('attempts', v_record.attempts + 1, 'expires_at', v_record.expires_at));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('success', false, 'error', 'Código incorreto. Verifique e tente novamente.');
  END IF;

  v_token := gen_random_uuid();

  UPDATE public.admin_mfa_codes
  SET verified = true, mfa_session_token = v_token, session_expires_at = now() + INTERVAL '8 hours'
  WHERE id = v_record.id;

  BEGIN
    INSERT INTO public.audit_logs (actor_user_id, entidade, entidade_id, acao, dados_novos)
    VALUES (v_user_id, 'admin_mfa_codes', v_record.id, 'MFA_SUCCESS',
      jsonb_build_object('session_expires_at', now() + INTERVAL '8 hours'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', true, 'session_token', v_token::text);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_admin_mfa_code TO authenticated;

CREATE OR REPLACE FUNCTION public.check_admin_mfa_session(
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  IF p_session_token IS NULL OR TRIM(p_session_token) = '' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_mfa_codes
    WHERE user_id            = auth.uid()
      AND mfa_session_token  = p_session_token::UUID
      AND verified           = true
      AND session_expires_at > now()
  ) INTO v_exists;

  RETURN jsonb_build_object('valid', COALESCE(v_exists, false));

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('valid', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_mfa_session TO authenticated;

SELECT cron.unschedule('admin-mfa-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-mfa-cleanup');

SELECT cron.schedule(
  'admin-mfa-cleanup',
  '0 2 * * *',
  $$DELETE FROM public.admin_mfa_codes WHERE created_at < now() - INTERVAL '24 hours'$$
);

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 035: Diagnóstico de Ativação — RPCs cirúrgicas
-- ════════════════════════════════════════════════════════════════════════

-- Fix ativar_conta_membro: adiciona nome_completo no profile
CREATE OR REPLACE FUNCTION public.ativar_conta_membro()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
  v_nome      TEXT;
  v_paroq_id  UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  UPDATE membros
  SET conta_ativada = true
  WHERE auth_user_id = v_auth_id AND ativo = true
  RETURNING id, nome, paroquia_id INTO v_membro_id, v_nome, v_paroq_id;

  IF v_membro_id IS NULL THEN
    UPDATE membros
    SET conta_ativada = true, auth_user_id = v_auth_id
    WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
      AND ativo = true
    RETURNING id, nome, paroquia_id INTO v_membro_id, v_nome, v_paroq_id;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  BEGIN
    INSERT INTO profiles (id, email, nome_completo, paroquia_id)
    VALUES (v_auth_id, auth.email(), v_nome, v_paroq_id)
    ON CONFLICT (id) DO UPDATE
      SET nome_completo = COALESCE(profiles.nome_completo, EXCLUDED.nome_completo),
          paroquia_id   = COALESCE(profiles.paroquia_id,   EXCLUDED.paroquia_id),
          email         = EXCLUDED.email;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO user_roles (user_id, paroquia_id, role)
    VALUES (v_auth_id, v_paroq_id, 'membro')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ativar_conta_membro() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_auth_sem_membro()
RETURNS TABLE(
  auth_user_id     UUID,
  email            TEXT,
  criado_em        TIMESTAMPTZ,
  ultimo_login     TIMESTAMPTZ,
  email_confirmado BOOLEAN,
  tem_profile      BOOLEAN,
  tem_role         BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    au.id,
    au.email::TEXT,
    au.created_at,
    au.last_sign_in_at,
    (au.email_confirmed_at IS NOT NULL),
    EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = au.id),
    EXISTS(
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = au.id
        AND ur.paroquia_id = v_paroquia_id
        AND ur.role IN ('membro','servidor','auxiliar','coordenador')
    )
  FROM auth.users au
  WHERE EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.id = au.id AND p.paroquia_id = v_paroquia_id
  )
  AND NOT EXISTS(
    SELECT 1 FROM public.membros m
    WHERE m.auth_user_id = au.id
      AND m.paroquia_id  = v_paroquia_id
      AND m.ativo        = true
  )
  AND NOT EXISTS(
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = au.id
      AND ur.role IN ('admin_paroquial', 'super_admin', 'coordenador')
  )
  ORDER BY au.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_auth_sem_membro() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_vincular_auth_membro(p_membro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_membro      RECORD;
  v_au_id       UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_sem_paroquia');
  END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT m.id, m.nome, m.email, m.auth_user_id, m.paroquia_id
  INTO v_membro
  FROM public.membros m
  WHERE m.id = p_membro_id AND m.paroquia_id = v_paroquia_id;

  IF v_membro.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  IF v_membro.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'acao', 'already_linked',
      'auth_user_id', v_membro.auth_user_id
    );
  END IF;

  IF v_membro.email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_email');
  END IF;

  SELECT au.id INTO v_au_id
  FROM auth.users au
  WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(v_membro.email))
  LIMIT 1;

  IF v_au_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_user_not_found');
  END IF;

  UPDATE public.membros SET auth_user_id = v_au_id WHERE id = v_membro.id;

  INSERT INTO public.profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_au_id, v_membro.email, v_membro.nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = COALESCE(profiles.nome_completo, EXCLUDED.nome_completo),
        paroquia_id   = COALESCE(profiles.paroquia_id,   EXCLUDED.paroquia_id),
        email         = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, paroquia_id, role)
  VALUES (v_au_id, v_paroquia_id, 'membro')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success',      true,
    'acao',         'linked',
    'auth_user_id', v_au_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_vincular_auth_membro(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_recriar_profile_role(p_membro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_membro      RECORD;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_sem_paroquia');
  END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT m.id, m.nome, m.email, m.auth_user_id, m.paroquia_id
  INTO v_membro
  FROM public.membros m
  WHERE m.id = p_membro_id AND m.paroquia_id = v_paroquia_id;

  IF v_membro.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  IF v_membro.auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_auth_user_id');
  END IF;

  INSERT INTO public.profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_membro.auth_user_id, v_membro.email, v_membro.nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = COALESCE(profiles.paroquia_id, EXCLUDED.paroquia_id),
        email         = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, paroquia_id, role)
  VALUES (v_membro.auth_user_id, v_paroquia_id, 'membro')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro.id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recriar_profile_role(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_ativados_sem_login()
RETURNS TABLE(
  membro_id       UUID,
  nome            TEXT,
  email           TEXT,
  auth_user_id    UUID,
  conta_ativada   BOOLEAN,
  ultimo_login    TIMESTAMPTZ,
  ativado_em      TIMESTAMPTZ,
  token_acesso    UUID,
  token_expirado  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.nome,
    m.email,
    m.auth_user_id,
    m.conta_ativada,
    au.last_sign_in_at,
    m.updated_at,
    m.token_acesso,
    (m.token_acesso_expires_at IS NOT NULL AND m.token_acesso_expires_at < now())
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id   = v_paroquia_id
    AND m.ativo          = true
    AND m.conta_ativada  = true
    AND (au.id IS NULL OR au.last_sign_in_at IS NULL)
  ORDER BY m.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_ativados_sem_login() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIM DO PATCH_IDEMPOTENT_022_035.sql
-- Execute inteiro no SQL Editor do Supabase.
-- ============================================================
