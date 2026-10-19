-- Migration 169: Infraestrutura de envio WhatsApp (T1 + T3)
--
-- Cria:
--   1. public.whatsapp_sends   — log de tentativas com deduplicação e auditoria
--   2. public._pode_enviar_whatsapp — verifica consentimento + duplicata antes de enviar
--
-- Não ativa envio real. Sem triggers, cron jobs ou filas.
-- Pré-requisito: migration 168 (colunas whatsapp_* em membros) aplicada.


-- ── 1. Extensão para hash SHA-256 ────────────────────────────────────────────
-- pgcrypto é padrão no Supabase; o IF NOT EXISTS garante idempotência.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ── 2. Tabela de log de envios ────────────────────────────────────────────────
-- telefone_hash: SHA-256 do número E.164 — nunca o número em texto.
-- evento_ref_id: referência ao objeto que originou o evento (escala, substituição etc.)
--   NOT NULL por design — todo evento tem referência; uso gen_random_uuid() como sentinela
--   apenas para eventos sem objeto natural (registrar explicitamente).
-- status: 'pending' | 'sent' | 'failed' | 'unknown'
--   'unknown' = HTTP 202 ou timeout — não retentar sem reconciliação manual.

CREATE TABLE IF NOT EXISTS public.whatsapp_sends (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id       uuid        NOT NULL REFERENCES public.membros(id)   ON DELETE CASCADE,
  paroquia_id     uuid        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  evento_tipo     text        NOT NULL,
  evento_ref_id   uuid        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
    CONSTRAINT whatsapp_sends_status_check
      CHECK (status IN ('pending', 'sent', 'failed', 'unknown')),
  telefone_hash   text        NOT NULL,
  enviado_em      timestamptz,
  resposta_http   int,
  resposta_body   text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.whatsapp_sends IS
  'Log de tentativas de envio WhatsApp por membro/evento. telefone_hash = SHA-256 do número E.164.';
COMMENT ON COLUMN public.whatsapp_sends.telefone_hash IS
  'encode(digest(telefone_e164, ''sha256''), ''hex'') — nunca armazenar o número em texto.';
COMMENT ON COLUMN public.whatsapp_sends.status IS
  'pending=aguardando envio; sent=HTTP 2xx com confirmação; failed=erro; unknown=202/timeout sem confirmação.';
COMMENT ON COLUMN public.whatsapp_sends.evento_ref_id IS
  'ID do objeto que originou o evento (escala_id, substituicao_id, etc.). '
  'Obrigatório. Usar gen_random_uuid() apenas para eventos sem objeto natural.';


-- ── 3. Índice de deduplicação (parcial) ──────────────────────────────────────
-- Bloqueia reenvio enquanto há um registro pending ou sent para o mesmo triplo.
-- Registros failed/unknown NÃO participam — permitem nova tentativa após reconciliação.

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_sends_dedup
  ON public.whatsapp_sends (membro_id, evento_tipo, evento_ref_id)
  WHERE (status IN ('pending', 'sent'));


-- ── 4. Índices de suporte ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS whatsapp_sends_membro_idx
  ON public.whatsapp_sends (membro_id);

CREATE INDEX IF NOT EXISTS whatsapp_sends_paroquia_status_idx
  ON public.whatsapp_sends (paroquia_id, status);

CREATE INDEX IF NOT EXISTS whatsapp_sends_criado_idx
  ON public.whatsapp_sends (criado_em DESC);


-- ── 5. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_sends ENABLE ROW LEVEL SECURITY;

-- authenticated: lê somente os próprios registros (via join com membros)
-- Útil para suporte e debugging pelo próprio membro; não expõe dados de terceiros.
CREATE POLICY "membro_le_proprios_sends"
  ON public.whatsapp_sends
  FOR SELECT
  TO authenticated
  USING (
    membro_id IN (
      SELECT id FROM public.membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
  );

-- INSERT/UPDATE/DELETE: bloqueados para authenticated e anon.
-- Apenas service_role (Edge Functions) opera a tabela — RLS é bypass por padrão para service_role.


-- ── 6. Função _pode_enviar_whatsapp ──────────────────────────────────────────
-- Verifica, na ordem:
--   (a) membro existe e está ativo
--   (b) whatsapp_opt_in = true
--   (c) whatsapp_telefone IS NOT NULL
--   (d) sem registro pending/sent para o mesmo (membro_id, evento_tipo, evento_ref_id)
--
-- Retorna (pode, telefone, motivo):
--   (true,  '<número_e164>', NULL)          — pode enviar
--   (false, NULL, 'membro_nao_encontrado')  — membro não existe ou inativo
--   (false, NULL, 'sem_consentimento')      — whatsapp_opt_in = false
--   (false, NULL, 'telefone_ausente')       — opt_in = true mas sem número
--   (false, NULL, 'duplicado')              — já existe pending/sent para este evento
--
-- ACL: somente service_role — authenticated e anon não têm EXECUTE.
-- O chamador (Edge Function) é responsável por:
--   - Não logar o número retornado em texto
--   - Armazenar apenas o hash: encode(digest(telefone, 'sha256'), 'hex')
--   - Inserir em whatsapp_sends antes de chamar o provedor (status='pending')
--   - Atualizar status após resposta (sent/failed/unknown)

CREATE OR REPLACE FUNCTION public._pode_enviar_whatsapp(
  p_membro_id     uuid,
  p_evento_tipo   text,
  p_evento_ref_id uuid
)
RETURNS TABLE(pode boolean, telefone text, motivo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_opt_in   boolean;
  v_telefone text;
BEGIN
  -- (a) membro existe e está ativo
  SELECT m.whatsapp_opt_in, m.whatsapp_telefone
  INTO   v_opt_in, v_telefone
  FROM   public.membros m
  WHERE  m.id = p_membro_id
    AND  m.ativo = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, null::text, 'membro_nao_encontrado'::text;
    RETURN;
  END IF;

  -- (b) consentimento ativo
  IF NOT v_opt_in THEN
    RETURN QUERY SELECT false, null::text, 'sem_consentimento'::text;
    RETURN;
  END IF;

  -- (c) número preenchido
  IF v_telefone IS NULL OR trim(v_telefone) = '' THEN
    RETURN QUERY SELECT false, null::text, 'telefone_ausente'::text;
    RETURN;
  END IF;

  -- (d) deduplicação: nenhum pending/sent para este triplo
  IF EXISTS (
    SELECT 1
    FROM   public.whatsapp_sends ws
    WHERE  ws.membro_id     = p_membro_id
      AND  ws.evento_tipo   = p_evento_tipo
      AND  ws.evento_ref_id = p_evento_ref_id
      AND  ws.status IN ('pending', 'sent')
  ) THEN
    RETURN QUERY SELECT false, null::text, 'duplicado'::text;
    RETURN;
  END IF;

  -- Aprovado
  RETURN QUERY SELECT true, v_telefone, null::text;
END;
$$;


-- ── 7. Permissões da função ───────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) TO service_role;


-- ── 8. Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
