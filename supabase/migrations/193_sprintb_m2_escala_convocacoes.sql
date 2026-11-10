-- Migration 193 — Sprint B M2
-- Nova tabela escala_convocacoes: convocação geral para Missas Solenes
--
-- Registra todos os membros ativos das pastorais convocadas,
-- inclusive aqueles que possuem função específica em escala_membros.
-- Função e convocação são conceitos independentes.

CREATE TABLE IF NOT EXISTS public.escala_convocacoes (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id                uuid        NOT NULL REFERENCES public.escalas(id)   ON DELETE CASCADE,
  membro_id                uuid        NOT NULL REFERENCES public.membros(id)   ON DELETE CASCADE,
  paroquia_id              uuid        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  status                   text        NOT NULL DEFAULT 'convocado'
                             CHECK (status IN ('convocado','presente','ausente','justificou')),
  paramentado              boolean,
  convocado_por            uuid        REFERENCES auth.users(id),
  convocado_em             timestamptz NOT NULL DEFAULT now(),
  presenca_registrada_por  uuid        REFERENCES auth.users(id),
  presenca_registrada_em   timestamptz,
  UNIQUE(escala_id, membro_id)
);

CREATE INDEX IF NOT EXISTS idx_escala_convocacoes_escala
  ON public.escala_convocacoes (escala_id);

CREATE INDEX IF NOT EXISTS idx_escala_convocacoes_membro
  ON public.escala_convocacoes (membro_id, paroquia_id);

ALTER TABLE public.escala_convocacoes ENABLE ROW LEVEL SECURITY;

-- Leitura: membro vê só suas convocações; coord/admin vê todas da paróquia
CREATE POLICY "conv_select" ON public.escala_convocacoes FOR SELECT
  USING (
    paroquia_id = public.current_paroquia_id()
    AND (
      membro_id = public._portal_membro_id()
      OR public._portal_is_admin(paroquia_id)
      OR public._portal_is_coord(public._portal_membro_id())
      OR EXISTS (
        SELECT 1 FROM public.membros
        WHERE id          = public._portal_membro_id()
          AND paroquia_id = escala_convocacoes.paroquia_id
          AND ativo       = true
          AND tipo_acesso IN ('vice','coordenador','administrador')
      )
    )
  );

-- Escrita direta bloqueada — somente via RPCs SECURITY DEFINER
CREATE POLICY "conv_insert_deny" ON public.escala_convocacoes
  FOR INSERT WITH CHECK (false);

CREATE POLICY "conv_update_deny" ON public.escala_convocacoes
  FOR UPDATE USING (false);

CREATE POLICY "conv_delete_deny" ON public.escala_convocacoes
  FOR DELETE USING (false);

COMMENT ON TABLE public.escala_convocacoes IS
  'Convocação geral para Missas Solenes. '
  'Inclui membros com e sem função específica. '
  'Escrita exclusivamente via RPCs convocar_pastoral_solene e registrar_comparecimento_solene.';
