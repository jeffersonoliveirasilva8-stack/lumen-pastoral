-- Migration 194 — Sprint B M3
-- Nova tabela participacao_justificativas
--
-- Registra justificativas de ausência e de paramentação para qualquer
-- membro vinculado a uma celebração, independentemente de estar em
-- escala_membros (função específica) ou escala_convocacoes (convocado geral).
--
-- Justificativa de paramentação aprovada suspende o desconto de pontuação,
-- mas NÃO altera o registro de presença física.

CREATE TABLE IF NOT EXISTS public.participacao_justificativas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id     uuid        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  escala_id       uuid        NOT NULL REFERENCES public.escalas(id)   ON DELETE CASCADE,
  membro_id       uuid        NOT NULL REFERENCES public.membros(id)   ON DELETE CASCADE,
  tipo            text        NOT NULL CHECK (tipo IN ('ausencia','paramentacao')),
  motivo          text        NOT NULL,
  solicitado_por  uuid        NOT NULL REFERENCES auth.users(id),
  solicitado_em   timestamptz NOT NULL DEFAULT now(),
  avaliacao       text        NOT NULL DEFAULT 'pendente'
                    CHECK (avaliacao IN ('pendente','aprovada','rejeitada')),
  avaliado_por    uuid        REFERENCES auth.users(id),
  avaliado_em     timestamptz
);

-- Permite histórico de tentativas; impede apenas segunda solicitação PENDENTE
CREATE UNIQUE INDEX IF NOT EXISTS uniq_just_pendente
  ON public.participacao_justificativas(escala_id, membro_id, tipo)
  WHERE avaliacao = 'pendente';

CREATE INDEX IF NOT EXISTS idx_just_escala_membro
  ON public.participacao_justificativas (escala_id, membro_id);

CREATE INDEX IF NOT EXISTS idx_just_paroquia
  ON public.participacao_justificativas (paroquia_id, solicitado_em DESC);

ALTER TABLE public.participacao_justificativas ENABLE ROW LEVEL SECURITY;

-- Leitura: membro vê suas próprias; coord/admin vê todas da paróquia
CREATE POLICY "just_select" ON public.participacao_justificativas FOR SELECT
  USING (
    paroquia_id = public.current_paroquia_id()
    AND (
      membro_id = public._portal_membro_id()
      OR public._portal_is_admin(paroquia_id)
      OR public._portal_is_coord(public._portal_membro_id())
      OR EXISTS (
        SELECT 1 FROM public.membros
        WHERE id          = public._portal_membro_id()
          AND paroquia_id = participacao_justificativas.paroquia_id
          AND ativo       = true
          AND tipo_acesso IN ('vice','coordenador','administrador')
      )
    )
  );

-- Membro insere só a própria justificativa, apenas como 'pendente'
-- Verificação do vínculo à celebração é feita pela RPC solicitar_justificativa
CREATE POLICY "just_insert_membro" ON public.participacao_justificativas FOR INSERT
  WITH CHECK (
    paroquia_id = public.current_paroquia_id()
    AND membro_id  = public._portal_membro_id()
    AND avaliacao  = 'pendente'
  );

-- Avaliação somente via RPC SECURITY DEFINER
CREATE POLICY "just_update_deny" ON public.participacao_justificativas
  FOR UPDATE USING (false);

CREATE POLICY "just_delete_deny" ON public.participacao_justificativas
  FOR DELETE USING (false);

COMMENT ON TABLE public.participacao_justificativas IS
  'Justificativas de ausência e de impedimento de paramentação. '
  'Vinculadas a (escala_id, membro_id) — cobre função específica e convocação geral. '
  'Justificativa de paramentação aprovada suspende desconto de pontuação; não altera presença.';
