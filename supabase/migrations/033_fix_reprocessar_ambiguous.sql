-- ============================================================
-- Migration 033: Corrige ambiguidade de coluna em admin_reprocessar_pendentes
-- Data: 2026-06-13
--
-- PROBLEMA:
--   "column reference 'nome' is ambiguous"
--
--   admin_reprocessar_pendentes() declara RETURNS TABLE(nome TEXT, email TEXT, ...).
--   Em PL/pgSQL, as colunas do RETURNS TABLE viram variáveis de saída no escopo
--   da função. Na FASE 1, o FOR loop faz:
--
--     SELECT id, nome, email, auth_user_id, token_acesso
--     FROM public.membros
--     WHERE paroquia_id = v_paroquia_id
--     ORDER BY nome
--
--   Sem alias de tabela, PostgreSQL não consegue distinguir se `nome` e `email`
--   são a coluna de membros ou as variáveis de saída → erro de ambiguidade.
--   (A FASE 2 já usa o alias `m2.` corretamente e não tem esse problema.)
--
-- CORREÇÃO:
--   Adiciona alias `mem` à tabela membros na FASE 1 e qualifica todas as
--   referências de coluna com `mem.`.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migration 031 aplicada
-- ============================================================

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
  -- Alias `mem` qualifica todas as colunas para evitar ambiguidade com as
  -- variáveis de saída `nome` e `email` do RETURNS TABLE.
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
      membro_id := m.id;
      nome      := m.nome;
      email     := m.email;
      acao      := 'sem_auth';
      resultado := 'Usuário auth não encontrado. Envie o convite para que o membro crie a senha.';
      RETURN NEXT;
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

    membro_id := m.id;
    nome      := m.nome;
    email     := m.email;
    acao      := COALESCE(NULLIF(v_acao,''),'ativado');
    resultado := v_resultado;
    RETURN NEXT;
  END LOOP;

  -- ── FASE 2: Membros ativados mas com profile/role ausente ─────────────
  -- (m2 já estava qualificado na versão original — sem alteração)
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

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   SELECT * FROM public.admin_reprocessar_pendentes();
--   → deve executar sem erro "column reference is ambiguous"
-- ─────────────────────────────────────────────────────────────
