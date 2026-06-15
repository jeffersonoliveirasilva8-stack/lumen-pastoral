-- ============================================================
-- Migration 037: Colunas faltantes + Segurança de produção
-- Data: 2026-06-14
--
-- OBJETIVO:
--   Documentar e garantir a existência de TODAS as colunas e
--   tabelas que foram adicionadas via patches manuais históricos
--   (fora das migrations 001-036). Após esta migration, um banco
--   vazio pode ser reconstruído do zero aplicando apenas 001-037.
--
-- COBRE TAMBÉM:
--   [S1] membro_self_link — adiciona paroquia_id ao USING para
--        bloquear sequestro de conta cross-paróquia por email
--   [S2] profiles — habilita RLS e cria policy if not exists
--   [S3] coordenadores — habilita RLS se ausente
--
-- IDEMPOTENTE: sim (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- REQUER: migrations 001–036 aplicadas
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BLOCO A — TABELAS AUSENTES DAS MIGRATIONS
-- Criadas originalmente em patches manuais; necessárias para
-- reconstrução a partir do zero.
-- ════════════════════════════════════════════════════════════

-- ── A1. tipos_prioridade ─────────────────────────────────────
-- Referenciada em membros.prioridade_id; criada em PATCH_EVOLUCAO_V2.sql

CREATE TABLE IF NOT EXISTS public.tipos_prioridade (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id      UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  nome             TEXT        NOT NULL,
  descricao        TEXT,
  peso_escala      INTEGER     NOT NULL DEFAULT 1,
  frequencia_min   INTEGER,
  frequencia_max   INTEGER,
  priorizar_solenes BOOLEAN    NOT NULL DEFAULT false,
  cor              TEXT        NOT NULL DEFAULT '#6366f1',
  ordem            SMALLINT    NOT NULL DEFAULT 0,
  ativo            BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tipos_prioridade ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tipos_prioridade_read"  ON public.tipos_prioridade;
DROP POLICY IF EXISTS "tipos_prioridade_write" ON public.tipos_prioridade;

CREATE POLICY "tipos_prioridade_read" ON public.tipos_prioridade
  FOR SELECT USING (paroquia_id = current_paroquia_id());

CREATE POLICY "tipos_prioridade_write" ON public.tipos_prioridade
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── A2. comunidades ─────────────────────────────────────────
-- Referenciada em membros.comunidade_id; criada em APLICAR_NO_SUPABASE.sql

CREATE TABLE IF NOT EXISTS public.comunidades (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  tipo          TEXT        NOT NULL DEFAULT 'comunidade'
                            CHECK (tipo IN ('matriz','capela','comunidade','santuario')),
  endereco      TEXT,
  responsavel   TEXT,
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.comunidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comunidades_paroquia" ON public.comunidades;

CREATE POLICY "comunidades_paroquia" ON public.comunidades
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── A3. coordenadores ────────────────────────────────────────
-- Referenciada em _portal_is_coord(); criada em APLICAR_NO_SUPABASE.sql

CREATE TABLE IF NOT EXISTS public.coordenadores (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id     UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  membro_id       UUID        REFERENCES public.membros(id) ON DELETE SET NULL,
  nome            TEXT        NOT NULL,
  funcao_pastoral TEXT,
  atua_como       TEXT,
  comunidade      TEXT,
  email           TEXT,
  telefone        TEXT,
  observacoes     TEXT,
  ativo           BOOLEAN     NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coordenadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coordenadores_paroquia" ON public.coordenadores;

CREATE POLICY "coordenadores_paroquia" ON public.coordenadores
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── A4. atuacoes_pastorais ────────────────────────────────────
-- Criada em MELHORIAS_005.sql

CREATE TABLE IF NOT EXISTS public.atuacoes_pastorais (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  nome        TEXT        NOT NULL,
  descricao   TEXT,
  cor         TEXT        NOT NULL DEFAULT '#6366f1',
  icone       TEXT,
  ativo       BOOLEAN     NOT NULL DEFAULT true,
  ordem       SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.atuacoes_pastorais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atuacoes_pastorais_paroquia" ON public.atuacoes_pastorais;

CREATE POLICY "atuacoes_pastorais_paroquia" ON public.atuacoes_pastorais
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE INDEX IF NOT EXISTS atuacoes_pastorais_paroquia_idx
  ON public.atuacoes_pastorais (paroquia_id, ordem);

-- ── A5. membro_atuacoes ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.membro_atuacoes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id  UUID        NOT NULL REFERENCES public.membros(id)           ON DELETE CASCADE,
  atuacao_id UUID        NOT NULL REFERENCES public.atuacoes_pastorais(id) ON DELETE CASCADE,
  UNIQUE (membro_id, atuacao_id)
);

ALTER TABLE public.membro_atuacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membro_atuacoes_paroquia" ON public.membro_atuacoes;

CREATE POLICY "membro_atuacoes_paroquia" ON public.membro_atuacoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  );

-- ── A6. membro_funcao_restricoes ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.membro_funcao_restricoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id     UUID NOT NULL REFERENCES public.membros(id)    ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES public.ministerios(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'pode'
                CHECK (tipo IN ('pode', 'nao_pode')),
  UNIQUE (membro_id, ministerio_id, tipo)
);

ALTER TABLE public.membro_funcao_restricoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membro_funcao_restricoes_paroquia" ON public.membro_funcao_restricoes;

CREATE POLICY "membro_funcao_restricoes_paroquia" ON public.membro_funcao_restricoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  );

-- ════════════════════════════════════════════════════════════
-- BLOCO B — COLUNAS FALTANTES EM membros
-- Origem: patches manuais (vide comentários por campo)
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.membros
  -- ── Portal / auth (PATCH_MEMBRO_PORTAL_V2, PATCH_PORTAL_AUTH) ──
  ADD COLUMN IF NOT EXISTS auth_user_id           UUID         REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ── Sexo (ADD_SEXO_MEMBROS.sql) ──────────────────────────────
  ADD COLUMN IF NOT EXISTS sexo                   TEXT         CHECK (sexo IN ('M', 'F')),

  -- ── Tipo de acesso ao portal (PATCH_EVOLUCAO_V2, PATCH_MEMBROS_EXPANDIDO) ──
  ADD COLUMN IF NOT EXISTS tipo_acesso            TEXT         NOT NULL DEFAULT 'membro'
                                                  CHECK (tipo_acesso IN ('membro','auxiliar','coordenador','administrador')),

  -- ── Prioridade de tipo (PATCH_EVOLUCAO_V2, PATCH_MEMBROS_EXPANDIDO) ──
  ADD COLUMN IF NOT EXISTS prioridade_id          UUID         REFERENCES public.tipos_prioridade(id) ON DELETE SET NULL,

  -- ── Missas em que NÃO pode servir (PATCH_RESTRICOES) ─────────
  ADD COLUMN IF NOT EXISTS missas_nao_pode_ids    UUID[]       NOT NULL DEFAULT '{}',

  -- ── Restrições de dia da semana (PATCH_RESTRICOES_DIA_SEMANA) ──
  ADD COLUMN IF NOT EXISTS restricoes_dia_semana  SMALLINT[]   NOT NULL DEFAULT '{}',

  -- ── Foto de perfil (PATCH_PORTAL_AUTH, PATCH_STORAGE_MEMBROS) ──
  ADD COLUMN IF NOT EXISTS foto_url               TEXT,

  -- ── Vínculo de comunidade (PATCH_MEMBROS_EXPANDIDO) ─────────
  ADD COLUMN IF NOT EXISTS comunidade_id          UUID         REFERENCES public.comunidades(id) ON DELETE SET NULL,

  -- ── Dados pessoais extras (PATCH_PORTAL_AUTH) ────────────────
  ADD COLUMN IF NOT EXISTS cpf                    TEXT,
  ADD COLUMN IF NOT EXISTS rg                     TEXT,
  ADD COLUMN IF NOT EXISTS endereco               TEXT,
  ADD COLUMN IF NOT EXISTS cidade                 TEXT,
  ADD COLUMN IF NOT EXISTS cep                    TEXT,
  ADD COLUMN IF NOT EXISTS nome_emergencia        TEXT,
  ADD COLUMN IF NOT EXISTS telefone_emergencia    TEXT,

  -- ── Dados familiares (PATCH_MEMBROS_EXPANDIDO) ────────────────
  ADD COLUMN IF NOT EXISTS nome_pais              TEXT,
  ADD COLUMN IF NOT EXISTS contato_pais           TEXT,

  -- ── Disponibilidade (PATCH_MEMBROS_EXPANDIDO, PATCH_O) ───────
  ADD COLUMN IF NOT EXISTS restricoes_horario     TEXT,
  ADD COLUMN IF NOT EXISTS motivo_disponibilidade TEXT,
  ADD COLUMN IF NOT EXISTS deslocamento           TEXT,

  -- ── Dados operacionais (PATCH_MEMBROS_EXPANDIDO) ─────────────
  ADD COLUMN IF NOT EXISTS planilha_url           TEXT,

  -- ── CPF criptografado (PATCH_K_CPF_ENCRYPT) ──────────────────
  ADD COLUMN IF NOT EXISTS cpf_hash               TEXT,
  ADD COLUMN IF NOT EXISTS cpf_enc                BYTEA;

-- Índice crítico de auth (hot path RLS)
CREATE UNIQUE INDEX IF NOT EXISTS idx_membros_auth_user_id_unique
  ON public.membros (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- BLOCO C — COLUNAS FALTANTES EM ministerios
-- Criadas em MELHORIAS_005.sql e APLICAR_NO_SUPABASE.sql
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.ministerios
  ADD COLUMN IF NOT EXISTS icone               TEXT,
  ADD COLUMN IF NOT EXISTS categoria           TEXT,
  ADD COLUMN IF NOT EXISTS pontuacao_minima    INT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exigir_experiencia  BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mostrar_no_portal   BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclusiva_solene    BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusiva_bispo     BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantidade_padrao   SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_adicionar      BOOLEAN  NOT NULL DEFAULT false;

-- ════════════════════════════════════════════════════════════
-- BLOCO D — COLUNAS FALTANTES EM paroquias
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.paroquias
  ADD COLUMN IF NOT EXISTS padroeiro       TEXT,
  ADD COLUMN IF NOT EXISTS usa_turibulo   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usa_naveta     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usa_baculifero BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usa_mitrifero  BOOLEAN NOT NULL DEFAULT true;

-- ════════════════════════════════════════════════════════════
-- BLOCO E — COLUNAS FALTANTES EM coordenadores
-- Criadas em MELHORIAS_005.sql
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.coordenadores
  ADD COLUMN IF NOT EXISTS atua_como   TEXT,
  ADD COLUMN IF NOT EXISTS comunidade  TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT;

-- ════════════════════════════════════════════════════════════
-- BLOCO F — SEGURANÇA: profiles RLS
-- profiles é criada pelo Supabase CLI no schema inicial.
-- Habilitar RLS e garantir policy de isolamento.
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_rls"  ON public.profiles;

-- Cada usuário acessa somente o próprio perfil
CREATE POLICY "profiles_own" ON public.profiles
  FOR ALL
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ════════════════════════════════════════════════════════════
-- BLOCO G — SEGURANÇA: membro_self_link corrigido
-- Bug: policy anterior permitia vincular auth_user_id a membro
-- de qualquer paróquia apenas por coincidência de e-mail.
-- Fix: exige mesma paróquia quando profile já tem paroquia_id,
-- e impede reutilizar um registro já vinculado a outro usuário.
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "membro_self_link" ON public.membros;

CREATE POLICY "membro_self_link" ON public.membros
  FOR UPDATE TO authenticated
  USING (
    -- Email do membro deve coincidir com o email da sessão autenticada
    LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
    -- Impede "sequestro": membro já vinculado a outro usuário é intocável
    AND (auth_user_id IS NULL OR auth_user_id = auth.uid())
    -- Impede cross-paróquia quando o profile já tem paróquia definida
    AND (
      (SELECT p.paroquia_id FROM public.profiles p WHERE p.id = auth.uid()) IS NULL
      OR paroquia_id = (SELECT p.paroquia_id FROM public.profiles p WHERE p.id = auth.uid())
    )
  )
  WITH CHECK (
    -- Na linha resultante, auth_user_id deve ser o próprio usuário
    auth_user_id = auth.uid()
  );

-- ════════════════════════════════════════════════════════════
-- BLOCO H — VERIFICAÇÃO FINAL
-- ════════════════════════════════════════════════════════════

-- H1. Colunas adicionadas em membros (deve listar todas as 23 colunas)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'membros'
  AND column_name  IN (
    'auth_user_id', 'sexo', 'tipo_acesso', 'prioridade_id',
    'missas_nao_pode_ids', 'restricoes_dia_semana', 'foto_url',
    'comunidade_id', 'cpf', 'rg', 'endereco', 'cidade', 'cep',
    'nome_emergencia', 'telefone_emergencia', 'nome_pais',
    'contato_pais', 'restricoes_horario', 'motivo_disponibilidade',
    'deslocamento', 'planilha_url', 'cpf_hash', 'cpf_enc',
    -- migrations anteriores (deve já existir)
    'conta_ativada', 'perfil_completo', 'ativacao_enviada_em',
    'score', 'forcar_escalacao_solene', 'prioridade_escala', 'token_acesso'
  )
ORDER BY column_name;

-- H2. Tabelas criadas (deve listar as 6 novas)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'tipos_prioridade', 'comunidades', 'coordenadores',
    'atuacoes_pastorais', 'membro_atuacoes', 'membro_funcao_restricoes'
  )
ORDER BY table_name;

-- H3. RLS habilitado em profiles
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'profiles';

-- H4. Policy profiles_own ativa
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'profiles';

-- H5. membro_self_link atualizada (deve ter paroquia_id na cláusula qual)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'membros'
  AND policyname = 'membro_self_link';

-- ════════════════════════════════════════════════════════════
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ H1: 30 colunas listadas (23 novas + 7 de migrations anteriores)
--   ✓ H2: 6 tabelas listadas
--   ✓ H3: rowsecurity = true para profiles
--   ✓ H4: profiles_own policy presente
--   ✓ H5: membro_self_link com paroquia_id na cláusula
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
