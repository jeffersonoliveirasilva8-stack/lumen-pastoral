-- =============================================================
-- seed-test-users.sql
-- Cria contas de teste para homologação de responsividade mobile
-- IDEMPOTENTE: ON CONFLICT / DO NOTHING em todas as inserções
-- =============================================================
-- Executar com:  supabase db query --file scripts/seed-test-users.sql
-- =============================================================

-- IDs fixos para facilitar limpeza
-- Paróquia de teste: f0000000-0000-0000-0000-000000000001
-- Admin teste:       f0000000-0000-0000-0000-000000000002
-- Membro teste:      f0000000-0000-0000-0000-000000000003

DO $$
DECLARE
  v_paroquia_id  UUID := 'f0000000-0000-0000-0000-000000000001';
  v_admin_uid    UUID := 'f0000000-0000-0000-0000-000000000002';
  v_membro_uid   UUID := 'f0000000-0000-0000-0000-000000000003';
  v_instance_id  UUID := '00000000-0000-0000-0000-000000000000';
  v_admin_email  TEXT := 'admin.teste@lumenpastoral.com.br';
  v_membro_email TEXT := 'membro.teste@lumenpastoral.com.br';
  v_password     TEXT := 'Lumen2026@!';
  v_hash         TEXT;
BEGIN

  -- ── 1. Paróquia de teste ─────────────────────────────────────
  INSERT INTO public.paroquias (
    id, nome, slug, cidade, diocese, created_at, updated_at
  ) VALUES (
    v_paroquia_id,
    'Paróquia Teste — Homologação',
    'paroquia-teste-homologacao',
    'São Paulo',
    'Diocese Teste',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ── 2. Usuário admin em auth.users ───────────────────────────
  v_hash := crypt(v_password, gen_salt('bf', 10));

  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_sso_user, created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    v_admin_uid, v_instance_id, 'authenticated', 'authenticated',
    v_admin_email, v_hash, NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nome', 'Admin Teste'),
    false, NOW(), NOW(),
    '', '', '', ''
  ) ON CONFLICT (id) DO UPDATE
    SET encrypted_password = EXCLUDED.encrypted_password,
        email_confirmed_at  = COALESCE(auth.users.email_confirmed_at, NOW()),
        updated_at          = NOW();

  -- ── 3. Profile do admin ──────────────────────────────────────
  INSERT INTO public.profiles (
    id, paroquia_id, nome_completo, email, created_at, updated_at
  ) VALUES (
    v_admin_uid, v_paroquia_id, 'Admin Teste', v_admin_email, NOW(), NOW()
  ) ON CONFLICT (id) DO UPDATE
    SET paroquia_id  = EXCLUDED.paroquia_id,
        nome_completo = EXCLUDED.nome_completo,
        updated_at   = NOW();

  -- ── 4. Role do admin ─────────────────────────────────────────
  INSERT INTO public.user_roles (user_id, paroquia_id, role, created_at)
  VALUES (v_admin_uid, v_paroquia_id, 'admin_paroquial', NOW())
  ON CONFLICT DO NOTHING;

  -- ── 5. Usuário membro em auth.users ─────────────────────────
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_sso_user, created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    v_membro_uid, v_instance_id, 'authenticated', 'authenticated',
    v_membro_email, v_hash, NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nome', 'Membro Teste'),
    false, NOW(), NOW(),
    '', '', '', ''
  ) ON CONFLICT (id) DO UPDATE
    SET encrypted_password = EXCLUDED.encrypted_password,
        email_confirmed_at  = COALESCE(auth.users.email_confirmed_at, NOW()),
        updated_at          = NOW();

  -- ── 6. Membro na tabela membros ──────────────────────────────
  INSERT INTO public.membros (
    id, paroquia_id, auth_user_id, nome, email,
    ativo, conta_ativada, perfil_completo,
    tipo_acesso, created_at, updated_at
  ) VALUES (
    v_membro_uid, v_paroquia_id, v_membro_uid,
    'Membro Teste', v_membro_email,
    true, true, true,
    'membro', NOW(), NOW()
  ) ON CONFLICT (id) DO UPDATE
    SET auth_user_id  = EXCLUDED.auth_user_id,
        conta_ativada = true,
        perfil_completo = true,
        updated_at    = NOW();

  -- Garante que o membro também tem user_role
  INSERT INTO public.user_roles (user_id, paroquia_id, role, created_at)
  VALUES (v_membro_uid, v_paroquia_id, 'servidor', NOW())
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '✅ Usuários de teste criados com sucesso.';
  RAISE NOTICE '   Admin:  % / %', v_admin_email, v_password;
  RAISE NOTICE '   Membro: % / %', v_membro_email, v_password;
END $$;
