-- ============================================================
-- Migration 022: Schema do módulo de substituições
-- Data: 2026-06-13
--
-- OBJETIVO:
--   Estrutura completa para o módulo de substituições de escala:
--   1. Adiciona apenas_coordenacao em notificacoes (novo tier)
--   2. Tabela substituicoes (solicitações de troca)
--   3. Tabela historico_substituicoes (audit log imutável)
--   4. Tabela paroquia_config_escalas (config de confirmação e pontuação)
--   5. Backfill de config para paróquias existentes
--
-- IDEMPOTENTE: sim (IF NOT EXISTS + ALTER ... IF NOT EXISTS)
-- REQUER: migrations 001–021 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. NOVO TIER DE NOTIFICAÇÕES — apenas_coordenacao
-- ══════════════════════════════════════════════════════════════
-- Hierarquia de visibilidade:
--   apenas_admin=true                           → só admins
--   apenas_admin=false, apenas_coordenacao=true → coord + admins
--   apenas_admin=false, apenas_coordenacao=false → todos membros (broadcast ou destinatário)

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS apenas_coordenacao BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notificacoes_coord
  ON public.notificacoes (paroquia_id, apenas_coordenacao)
  WHERE apenas_coordenacao = true;

-- ══════════════════════════════════════════════════════════════
-- 2. TABELA substituicoes
-- ══════════════════════════════════════════════════════════════
-- Ciclo de vida do status:
--   solicitada → com_voluntario → aprovada | rejeitada
--            └──────────────────────────────→ cancelada (pelo solicitante)

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

-- ══════════════════════════════════════════════════════════════
-- 3. TABELA historico_substituicoes — audit log imutável
-- ══════════════════════════════════════════════════════════════
-- Registra cada transição de estado com o actor e detalhes.
-- Linhas NUNCA são atualizadas — apenas INSERT (via trigger ou RPC).

CREATE TABLE IF NOT EXISTS public.historico_substituicoes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  substituicao_id  UUID        NOT NULL REFERENCES public.substituicoes(id) ON DELETE CASCADE,
  acao             TEXT        NOT NULL,  -- 'solicitada'|'voluntario_registrado'|'aprovada'|'rejeitada'|'cancelada'
  actor_id         UUID        REFERENCES public.membros(id) ON DELETE SET NULL,
  detalhes         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.historico_substituicoes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_hist_subst_substituicao
  ON public.historico_substituicoes (substituicao_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 4. TABELA paroquia_config_escalas — configuração por paróquia
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.paroquia_config_escalas (
  paroquia_id              UUID    PRIMARY KEY REFERENCES public.paroquias(id) ON DELETE CASCADE,

  -- Confirmação de presença
  confirmacao_ativa        BOOLEAN NOT NULL DEFAULT false,
  confirmacao_horas_antes  INTEGER NOT NULL DEFAULT 72,   -- horas antes da missa para confirmar

  -- Módulo de substituições
  substituicao_ativa       BOOLEAN NOT NULL DEFAULT false,
  substituicao_horas_antes INTEGER NOT NULL DEFAULT 48,   -- horas antes que permite solicitar troca

  -- Pontuação automática (se auto_pontuar=true, trigger atualiza score do membro)
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

-- ══════════════════════════════════════════════════════════════
-- 5. BACKFILL — cria config para paróquias existentes
-- ══════════════════════════════════════════════════════════════
-- Migra confirmacao_ativa do campo JSONB legado (regras_escala)

INSERT INTO public.paroquia_config_escalas (
  paroquia_id,
  confirmacao_ativa
)
SELECT
  p.id,
  COALESCE((p.regras_escala->>'confirmacao_escala_ativa')::boolean, false)
FROM public.paroquias p
ON CONFLICT (paroquia_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 6. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- NOVAS ESTRUTURAS CRIADAS:
--   notificacoes.apenas_coordenacao BOOLEAN DEFAULT false
--   tabela substituicoes (+ trigger updated_at + índices)
--   tabela historico_substituicoes (+ índice)
--   tabela paroquia_config_escalas (+ trigger updated_at)
--   backfill confirmacao_ativa de paroquias.regras_escala
-- ─────────────────────────────────────────────────────────────
