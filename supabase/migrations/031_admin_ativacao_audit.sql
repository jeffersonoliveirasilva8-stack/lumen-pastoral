-- ============================================================
-- Migration 031: Painel de auditoria e recuperação de ativação
-- Data: 2026-06-13
--
-- FUNÇÕES:
--   1. admin_get_ativacao_stats()
--      → KPIs de ativação (total, pendentes, ativados, logins, etc.)
--
--   2. admin_get_membros_inconsistentes()
--      → lista membros com problemas (uma linha por problema por membro)
--
--   3. admin_reprocessar_pendentes()
--      → vincula auth_user, cria profile/role e ativa contas em lote
--
--   4. admin_get_email_logs_stats()
--      → estatísticas de entregabilidade a partir de email_logs
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 001–030 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- Helper: verifica se o usuário atual é admin/coordenador da paróquia
-- (reutiliza _portal_is_admin + is_coordenador_da_paroquia já existentes)
-- ══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- 1. admin_get_ativacao_stats
-- ══════════════════════════════════════════════════════════════

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
    -- 1. Total membros ativos
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true),

    -- 2. Pendentes de ativação (ativos mas conta não ativada)
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.conta_ativada = false),

    -- 3. Convite enviado mas não ativou ainda
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.conta_ativada = false AND m.ativacao_enviada_em IS NOT NULL),

    -- 4. Nunca receberam convite (tem e-mail, mas nunca enviamos)
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.conta_ativada = false AND m.email IS NOT NULL
       AND m.ativacao_enviada_em IS NULL),

    -- 5. Conta ativada
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.conta_ativada = true),

    -- 6. Sem e-mail cadastrado (impossível enviar convite)
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.email IS NULL),

    -- 7. Sem auth_user_id vinculado
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true AND m.auth_user_id IS NULL),

    -- 8. Tem auth_user_id mas sem perfil (profile ausente)
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.auth_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.auth_user_id)),

    -- 9. Tem auth_user_id mas sem role de membro/servidor/auxiliar/coordenador
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
       AND m.auth_user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = m.auth_user_id
           AND ur.role IN ('membro','servidor','auxiliar','coordenador')
       )),

    -- 10. Logaram ao menos uma vez (conta ativada + last_sign_in no auth.users)
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     JOIN auth.users au ON au.id = m.auth_user_id
     WHERE m.paroquia_id = v_paroquia_id
       AND m.conta_ativada = true
       AND au.last_sign_in_at IS NOT NULL),

    -- 11. Conta ativada mas nunca logou de volta (criou senha mas não voltou)
    (SELECT COUNT(*)::BIGINT FROM public.membros m
     LEFT JOIN auth.users au ON au.id = m.auth_user_id
     WHERE m.paroquia_id = v_paroquia_id
       AND m.conta_ativada = true
       AND (au.id IS NULL OR au.last_sign_in_at IS NULL));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_ativacao_stats() TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 2. admin_get_membros_inconsistentes
--    Retorna uma linha por problema por membro.
--    Um membro pode aparecer várias vezes com problemas distintos.
-- ══════════════════════════════════════════════════════════════

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

  -- ── A. Nunca convidados (ativo, tem e-mail, jamais enviamos convite)
  SELECT
    m.id, m.nome, m.email,
    'nunca_convidado'::TEXT,
    'Membro ativo com e-mail cadastrado mas nunca recebeu convite de acesso.'::TEXT,
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at,
    m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.conta_ativada = false
    AND m.email IS NOT NULL
    AND m.ativacao_enviada_em IS NULL

  UNION ALL

  -- ── B. Convite enviado mas aguardando ativação
  SELECT
    m.id, m.nome, m.email,
    'aguardando_ativacao'::TEXT,
    'Convite enviado em ' || TO_CHAR(m.ativacao_enviada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' — membro ainda não criou a senha.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at,
    m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.conta_ativada = false
    AND m.ativacao_enviada_em IS NOT NULL

  UNION ALL

  -- ── C. Tem auth_user_id mas sem profile
  SELECT
    m.id, m.nome, m.email,
    'sem_profile'::TEXT,
    'auth_user_id vinculado (' || m.auth_user_id::TEXT || ') mas sem registro na tabela profiles.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at,
    m.created_at
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id = v_paroquia_id AND m.ativo = true
    AND m.auth_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.auth_user_id)

  UNION ALL

  -- ── D. Tem auth_user_id mas sem role de membro/servidor/etc.
  SELECT
    m.id, m.nome, m.email,
    'sem_role'::TEXT,
    'auth_user_id vinculado mas sem role atribuído em user_roles. O membro não consegue acessar o portal.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at,
    m.created_at
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

  -- ── E. Sem e-mail (impossível enviar convite)
  SELECT
    m.id, m.nome, m.email,
    'sem_email'::TEXT,
    'Membro ativo sem e-mail cadastrado — impossível enviar convite por e-mail.',
    m.ativacao_enviada_em, m.auth_user_id, m.token_acesso,
    au.last_sign_in_at,
    m.created_at
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


-- ══════════════════════════════════════════════════════════════
-- 3. admin_reprocessar_pendentes
--    Para cada membro ativo com conta_ativada=false:
--      a) Tenta vincular auth_user_id por e-mail (se nulo)
--      b) Cria profile se ausente
--      c) Cria role 'membro' se ausente
--      d) Marca conta_ativada = true se auth_user_id foi vinculado
--
--    Para membros com conta_ativada=true mas sem profile/role:
--      → cria as peças faltantes
-- ══════════════════════════════════════════════════════════════

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

  -- ── FASE 1: Membros pendentes (conta_ativada = false) ─────────────────
  FOR m IN
    SELECT id, nome, email, auth_user_id, token_acesso
    FROM public.membros
    WHERE paroquia_id = v_paroquia_id
      AND ativo = true
      AND conta_ativada = false
    ORDER BY nome
  LOOP
    v_au_id    := m.auth_user_id;
    v_acao     := '';
    v_resultado:= '';

    -- Tenta vincular auth_user_id por e-mail se ainda nulo
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
      -- Não existe usuário auth para este e-mail → precisa de convite
      RETURN NEXT (m.id, m.nome, m.email,
        'sem_auth',
        'Usuário auth não encontrado. Envie o convite para que o membro crie a senha.');
      CONTINUE;
    END IF;

    -- Cria profile se ausente
    INSERT INTO public.profiles (id, nome_completo, email, paroquia_id)
    VALUES (v_au_id, m.nome, m.email, v_paroquia_id)
    ON CONFLICT (id) DO UPDATE
      SET paroquia_id = EXCLUDED.paroquia_id
      WHERE profiles.paroquia_id IS NULL;

    -- Cria role 'membro' se ausente
    INSERT INTO public.user_roles (user_id, role, paroquia_id)
    VALUES (v_au_id, 'membro', v_paroquia_id)
    ON CONFLICT DO NOTHING;

    -- Marca conta como ativada
    UPDATE public.membros SET conta_ativada = true WHERE id = m.id;

    v_resultado := CASE
      WHEN v_acao = 'auth_vinculado' THEN 'auth vinculado + profile + role + conta ativada'
      ELSE 'profile + role criados + conta ativada'
    END;

    RETURN NEXT (m.id, m.nome, m.email, COALESCE(NULLIF(v_acao,''),'ativado'), v_resultado);
  END LOOP;

  -- ── FASE 2: Membros ativados mas com profile/role ausente ─────────────
  FOR m IN
    SELECT m2.id, m2.nome, m2.email, m2.auth_user_id
    FROM public.membros m2
    WHERE m2.paroquia_id = v_paroquia_id
      AND m2.ativo = true
      AND m2.conta_ativada = true
      AND m2.auth_user_id IS NOT NULL
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
    v_acao := '';

    INSERT INTO public.profiles (id, nome_completo, email, paroquia_id)
    VALUES (m.auth_user_id, m.nome, m.email, v_paroquia_id)
    ON CONFLICT (id) DO UPDATE
      SET paroquia_id = EXCLUDED.paroquia_id
      WHERE profiles.paroquia_id IS NULL;

    INSERT INTO public.user_roles (user_id, role, paroquia_id)
    VALUES (m.auth_user_id, 'membro', v_paroquia_id)
    ON CONFLICT DO NOTHING;

    RETURN NEXT (m.id, m.nome, m.email,
      'correcao_pos_ativacao',
      'Profile e/ou role recriados para membro já ativado.');
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reprocessar_pendentes() TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 4. admin_get_email_logs_stats
--    Agrega estatísticas de entregabilidade a partir de email_logs.
--    Retorna contagens por status e últimas entradas por destinatário.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_get_email_logs_stats()
RETURNS TABLE(
  total_enviados    BIGINT,
  entregues         BIGINT,
  com_erro          BIGINT,
  via_fallback      BIGINT,
  ultimo_envio      TIMESTAMPTZ,
  -- Por tipo de template (ativação vs. reenvio vs. reset)
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
    COUNT(*)::BIGINT                                                    AS total_enviados,
    COUNT(*) FILTER (WHERE el.status = 'enviado')::BIGINT              AS entregues,
    COUNT(*) FILTER (WHERE el.status = 'erro')::BIGINT                 AS com_erro,
    COUNT(*) FILTER (WHERE el.status = 'fallback')::BIGINT             AS via_fallback,
    MAX(el.created_at)                                                  AS ultimo_envio,
    COUNT(*) FILTER (WHERE el.tipo = 'ativacao_conta')::BIGINT         AS ativacoes_novas,
    COUNT(*) FILTER (WHERE el.tipo IN ('reenvio_ativacao','ativacao_por_token'))::BIGINT AS reenvios,
    COUNT(*) FILTER (WHERE el.tipo = 'reset_senha')::BIGINT            AS resets_senha
  FROM public.email_logs el
  WHERE el.paroquia = v_paroquia_nome   -- email_logs salva o nome da paróquia como TEXT
     OR el.paroquia IS NULL;            -- entradas sem paróquia são incluídas por segurança
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_email_logs_stats() TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 5. admin_get_email_logs_recentes
--    Últimos N registros de email_logs para a paróquia,
--    útil para a timeline de entregabilidade.
-- ══════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════
-- Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ admin_get_ativacao_stats() retorna KPIs corretos para a paróquia
--   ✓ admin_get_membros_inconsistentes() retorna uma linha por problema
--   ✓ admin_reprocessar_pendentes() vincula auth, cria profile/role, ativa
--   ✓ admin_get_email_logs_stats() agrega status da tabela email_logs
--   ✓ Todas as funções têm verificação de permissão admin/coordenador
-- ─────────────────────────────────────────────────────────────
