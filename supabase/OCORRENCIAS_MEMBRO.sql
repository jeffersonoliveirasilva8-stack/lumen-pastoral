-- ============================================================
-- OCORRENCIAS_MEMBRO — Central de ocorrências para membros
-- Execute INTEIRO no SQL Editor do Supabase
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- TABELA
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ocorrencias_membros (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id    uuid        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  membro_id      uuid        NOT NULL REFERENCES public.membros(id)   ON DELETE CASCADE,
  tipo           text        NOT NULL,
  -- problema_escala | dificuldade_pastoral | informacao_importante | observacao_coordenacao
  titulo         text        NOT NULL,
  descricao      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'aberta',
  -- aberta | em_analise | resolvida | arquivada
  resposta       text,
  respondido_por uuid        REFERENCES public.membros(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS ocorrencias_membros_paroquia_idx ON public.ocorrencias_membros (paroquia_id);
CREATE INDEX IF NOT EXISTS ocorrencias_membros_membro_idx   ON public.ocorrencias_membros (membro_id);
CREATE INDEX IF NOT EXISTS ocorrencias_membros_status_idx   ON public.ocorrencias_membros (status);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION public._ocorrencia_membro_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$1
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ocorrencias_membros_updated_at ON public.ocorrencias_membros;
CREATE TRIGGER ocorrencias_membros_updated_at
  BEFORE UPDATE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._ocorrencia_membro_updated_at();

-- ════════════════════════════════════════════════════════════
-- GRANTS
-- ════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocorrencias_membros TO authenticated;
GRANT ALL ON public.ocorrencias_membros TO service_role;

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.ocorrencias_membros ENABLE ROW LEVEL SECURITY;

-- Membro lê suas próprias ocorrências
DROP POLICY IF EXISTS "ocorrencia_membro_read_own" ON public.ocorrencias_membros;
CREATE POLICY "ocorrencia_membro_read_own" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

-- Membro registra suas próprias ocorrências (deve ser sua paróquia)
DROP POLICY IF EXISTS "ocorrencia_membro_insert" ON public.ocorrencias_membros;
CREATE POLICY "ocorrencia_membro_insert" ON public.ocorrencias_membros
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = _portal_membro_id()
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = _portal_membro_id()
        AND m.paroquia_id = ocorrencias_membros.paroquia_id
        AND m.ativo = true
    )
  );

-- Admins e coordenadores lêem todas da paróquia
DROP POLICY IF EXISTS "ocorrencia_admin_read" ON public.ocorrencias_membros;
CREATE POLICY "ocorrencia_admin_read" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (_portal_is_admin(paroquia_id) OR _portal_is_coord(_portal_membro_id()));

-- Admins podem atualizar (status + resposta)
DROP POLICY IF EXISTS "ocorrencia_admin_update" ON public.ocorrencias_membros;
CREATE POLICY "ocorrencia_admin_update" ON public.ocorrencias_membros
  FOR UPDATE TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════
-- Notificação automática para coordenadores (via trigger)
-- Insere em `notificacoes` quando uma ocorrência é criada
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_ocorrencia_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_membro_nome text;
  v_tipo_label  text;
BEGIN
  SELECT nome INTO v_membro_nome FROM public.membros WHERE id = NEW.membro_id;

  v_tipo_label := CASE NEW.tipo
    WHEN 'problema_escala'          THEN 'Problema na escala'
    WHEN 'dificuldade_pastoral'     THEN 'Dificuldade pastoral'
    WHEN 'informacao_importante'    THEN 'Informação importante'
    WHEN 'observacao_coordenacao'   THEN 'Observação para coordenação'
    ELSE NEW.tipo
  END;

  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo)
  VALUES (
    NEW.paroquia_id,
    v_tipo_label || ' — ' || NEW.titulo,
    'Registrado por ' || COALESCE(v_membro_nome, 'membro') || ': ' || left(NEW.descricao, 200),
    'alerta'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_membro ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_membro
  AFTER INSERT ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_membro();

-- ════════════════════════════════════════════════════════════
-- Recarregar schema
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
