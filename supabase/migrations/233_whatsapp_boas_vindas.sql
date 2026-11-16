-- Migration 233 — Trigger WhatsApp boas-vindas no primeiro opt-in
--
-- Dispara quando membros.whatsapp_opt_in muda de false/NULL para true.
-- Insere um item em whatsapp_outbox via _outbox_insert_safe, que é idempotente:
-- a chave de dedup evento_id = _outbox_evento_id(membro_id, 'boas_vindas', membro_id)
-- garante que apenas uma mensagem de boas-vindas seja enfileirada por membro,
-- mesmo que o membro revogue e reative o consentimento.
--
-- Pré-requisitos:
--   migration 180 (whatsapp_outbox)
--   migration 185 (whatsapp_outbox_worker + next_attempt_at)
--   migration 186 (_outbox_evento_id, _outbox_insert_safe)
--
-- ATENÇÃO: a Edge Function send-whatsapp precisa ser redeploy da para aceitar
-- evento_tipo = 'boas_vindas' (adicionado em whatsapp-contracts.ts).
-- A migration pode ser aplicada antes do deploy; os itens do outbox ficarão
-- pendentes até o worker tentar processá-los. Se o EF retornar 400 (tipo
-- desconhecido), o worker marcará como 'falhou' e retentará com backoff até
-- 5 tentativas. Após o deploy, o próximo retry completará.
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

-- ── Função do trigger ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_whatsapp_boas_vindas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_paroquia_nome  TEXT;
  v_evento_id      UUID;
  v_paroquia_id    UUID;
  v_nome_membro    TEXT;
  v_link_portal    TEXT;
  v_payload        JSONB;
  v_inserido       BOOLEAN;
BEGIN
  -- Só dispara quando whatsapp_opt_in muda para true
  IF NEW.whatsapp_opt_in IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF OLD.whatsapp_opt_in IS NOT DISTINCT FROM NEW.whatsapp_opt_in THEN
    RETURN NEW;
  END IF;

  -- Precisa ter telefone cadastrado
  IF NEW.whatsapp_telefone IS NULL OR NEW.whatsapp_telefone = '' THEN
    RETURN NEW;
  END IF;

  v_paroquia_id := NEW.paroquia_id;
  v_nome_membro := COALESCE(SPLIT_PART(NEW.nome_completo, ' ', 1), 'Prezado(a)');

  -- Buscar nome da paróquia
  SELECT nome INTO v_paroquia_nome
  FROM public.paroquias
  WHERE id = v_paroquia_id;

  IF v_paroquia_nome IS NULL THEN
    RAISE WARNING '_trigger_whatsapp_boas_vindas: paróquia % não encontrada para membro %',
      v_paroquia_id, NEW.id;
    RETURN NEW;
  END IF;

  -- evento_id determinístico — garante dedup mesmo em reativações
  v_evento_id := public._outbox_evento_id(NEW.id, 'boas_vindas', NEW.id);

  -- Monta contexto completo da mensagem
  v_payload := jsonb_build_object(
    'context', jsonb_build_object(
      'nome_membro',   v_nome_membro,
      'paroquia_nome', v_paroquia_nome
    )
  );

  -- Insere no outbox (idempotente — ON CONFLICT DO NOTHING)
  v_inserido := public._outbox_insert_safe(
    p_evento_id     := v_evento_id,
    p_evento_ref_id := NEW.id,   -- membro_id como referência
    p_evento_tipo   := 'boas_vindas',
    p_membro_id     := NEW.id,
    p_paroquia_id   := v_paroquia_id,
    p_payload       := v_payload
  );

  IF NOT v_inserido THEN
    -- Duplicata: opt-in já havia sido processado anteriormente
    RAISE NOTICE '_trigger_whatsapp_boas_vindas: boas-vindas já enfileirada para membro % (dedup)', NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Nunca bloqueia o opt-in por falha no trigger WhatsApp
    RAISE WARNING '_trigger_whatsapp_boas_vindas: erro ao enfileirar boas-vindas para membro %: %',
      NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ── Trigger na tabela membros ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_whatsapp_boas_vindas ON public.membros;

CREATE TRIGGER trg_whatsapp_boas_vindas
  AFTER UPDATE OF whatsapp_opt_in ON public.membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_whatsapp_boas_vindas();

-- ── Permissões ────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._trigger_whatsapp_boas_vindas() FROM PUBLIC;
