-- Migration 170: D2 — exigir conta_ativada para consentimento e gate de envio WhatsApp
--
-- Problema identificado na auditoria D2:
--   As funções atualizar_consentimento_whatsapp e _pode_enviar_whatsapp verificavam
--   apenas `ativo = true`, permitindo que membros com conta não ativada (conta_ativada=false)
--   concedessem consentimento ou fossem elegíveis para receber mensagens.
--
-- Correção:
--   1. atualizar_consentimento_whatsapp: bloqueia CONCESSÃO se conta_ativada=false.
--      Revogação (p_opt_in=false) permanece disponível para qualquer membro ativo.
--   2. _pode_enviar_whatsapp: exige ativo=true AND conta_ativada=true.
--   3. membro_le_proprios_sends (RLS): sem alteração — leitura dos próprios registros
--      não depende de conta_ativada e deve permanecer disponível para histórico/suporte.
--
-- Pré-requisito: migrations 168 e 169 aplicadas.
-- Não executa em produção nesta etapa — aguardar autorização explícita.


-- ── 1. RPC atualizar_consentimento_whatsapp ───────────────────────────────────
-- Adiciona verificação de conta_ativada apenas no branch p_opt_in=true (concessão).
-- Revogação (p_opt_in=false) permanece disponível para o membro ativo, mesmo
-- que conta_ativada=false, para que ele possa revogar um consentimento já concedido.

CREATE OR REPLACE FUNCTION public.atualizar_consentimento_whatsapp(
  p_opt_in   BOOLEAN,
  p_telefone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_membro_id      UUID;
  v_conta_ativada  BOOLEAN;
  v_tel_clean      TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_opt_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'opt_in_obrigatorio');
  END IF;

  IF p_opt_in = true THEN
    IF p_telefone IS NULL OR trim(p_telefone) = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'telefone_obrigatorio');
    END IF;
    v_tel_clean := regexp_replace(trim(p_telefone), '[^0-9]', '', 'g');
    IF length(v_tel_clean) < 8 OR length(v_tel_clean) > 15 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'telefone_invalido',
        'detalhe', 'O número deve ter entre 8 e 15 dígitos incluindo DDI e DDD'
      );
    END IF;
  END IF;

  BEGIN
    SELECT id, conta_ativada
    INTO STRICT v_membro_id, v_conta_ativada
    FROM public.membros
    WHERE auth_user_id = v_uid
      AND ativo = true;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
    WHEN TOO_MANY_ROWS THEN
      RETURN jsonb_build_object('success', false, 'error', 'multiplos_membros_encontrados');
  END;

  -- Concessão exige conta ativada; revogação é sempre permitida ao membro ativo.
  IF p_opt_in = true AND NOT v_conta_ativada THEN
    RETURN jsonb_build_object('success', false, 'error', 'conta_nao_ativada');
  END IF;

  IF p_opt_in = true THEN
    UPDATE public.membros
    SET whatsapp_opt_in    = true,
        whatsapp_opt_in_at = now(),
        whatsapp_telefone  = v_tel_clean
    WHERE id = v_membro_id;
  ELSE
    UPDATE public.membros
    SET whatsapp_opt_in    = false,
        whatsapp_opt_in_at = now()
    WHERE id = v_membro_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'opt_in', p_opt_in);
END;
$$;


-- ── 2. Função _pode_enviar_whatsapp ──────────────────────────────────────────
-- Adiciona verificação conta_ativada=true como condição (a).
-- Novo motivo de bloqueio: 'conta_nao_ativada'.

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
  v_opt_in        boolean;
  v_telefone      text;
  v_conta_ativada boolean;
BEGIN
  -- (a) membro existe, está ativo e com conta ativada
  SELECT m.whatsapp_opt_in, m.whatsapp_telefone, m.conta_ativada
  INTO   v_opt_in, v_telefone, v_conta_ativada
  FROM   public.membros m
  WHERE  m.id = p_membro_id
    AND  m.ativo = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, null::text, 'membro_nao_encontrado'::text;
    RETURN;
  END IF;

  IF NOT v_conta_ativada THEN
    RETURN QUERY SELECT false, null::text, 'conta_nao_ativada'::text;
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

-- Permissões: mantém somente service_role (idêntico à migration 169)
REVOKE EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._pode_enviar_whatsapp(uuid, text, uuid) TO service_role;


-- ── 3. RLS membro_le_proprios_sends — sem alteração ──────────────────────────
-- A leitura dos próprios registros de envio (para suporte / histórico) não deve
-- depender de conta_ativada. O membro pode continuar visualizando seu histórico
-- independentemente do status de ativação. Nenhuma alteração necessária.


-- ── 4. Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
