-- Migration 171: WhatsApp para membros — evento escala_publicada
--
-- Gera e armazena um segredo dedicado (internal_wa_secret) em _push_config.
-- Esse UUID NÃO é o service_role key: tem escopo limitado a autenticar
-- chamadas dos triggers à Edge Function send-whatsapp.
--
-- Autenticação da Edge Function (após esta migration):
--   Authorization: Bearer <anon_jwt>  ← validado pelo gateway (verify_jwt=true)
--   X-Wa-Secret:   <internal_wa_secret> ← comparado via timingSafeEqual
--
-- Pós-apply obrigatório (não automatizado — envolve secret):
--   1. SELECT val FROM public._push_config WHERE key = 'internal_wa_secret';
--   2. supabase secrets set INTERNAL_WA_SECRET=<valor_do_passo_1>
--   3. supabase functions deploy send-whatsapp  (novo build com X-Wa-Secret auth)
--   (sem o passo 2 a Edge Function retorna 503; os triggers existentes não são afetados)
--
-- pg_net e rollback:
--   pg_net enfileira requisições HTTP numa fila persistida; chamadas enfileiradas
--   NÃO são revertidas se a transação que disparou o trigger for abortada.
--   Mitigação: a Edge Function (após deploy) verifica se a escala ainda está
--   publicada antes de inserir um 'pending' record — envios fantasmas são detectados
--   e descartados com motivo 'escala_nao_publicada'.
--
-- IDEMPOTENTE: sim (INSERT ON CONFLICT DO NOTHING + DROP TRIGGER IF EXISTS)

-- Gera o segredo dedicado (idempotente — não sobrescreve se já existir)
INSERT INTO public._push_config (key, val)
VALUES ('internal_wa_secret', gen_random_uuid()::TEXT)
ON CONFLICT (key) DO NOTHING;

-- ── Função trigger ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_whatsapp_escala_publicada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec           RECORD;
  v_paroquia_nm TEXT;
  v_data_fmt    TEXT;
  v_wa_secret   TEXT;
  -- JWT anon público do projeto — validado pelo gateway Supabase
  -- A autorização real é pelo X-Wa-Secret (lido de _push_config em runtime)
  c_anon_jwt    CONSTANT TEXT :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6'
    'ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0'
    '.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I';
BEGIN
  -- Guard: só na transição para 'publicada'
  IF NEW.status <> 'publicada' OR OLD.status = 'publicada' THEN
    RETURN NEW;
  END IF;

  SELECT val INTO v_wa_secret
  FROM   public._push_config WHERE key = 'internal_wa_secret';

  IF v_wa_secret IS NULL THEN
    RAISE WARNING '_trigger_whatsapp_escala_publicada: internal_wa_secret não configurado — WhatsApp ignorado para escala %', NEW.id;
    RETURN NEW;
  END IF;

  SELECT nome INTO v_paroquia_nm
  FROM   public.paroquias WHERE id = NEW.paroquia_id;

  v_data_fmt := to_char(NEW.data::date, 'DD/MM/YYYY');

  -- Pré-filtra membros com consentimento antes de gerar chamadas HTTP
  FOR rec IN
    SELECT
      em.membro_id,
      COALESCE(min.nome, 'Servidor') AS ministerio_nome,
      m.nome
    FROM   public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    JOIN     public.membros       m  ON m.id  = em.membro_id
    WHERE  em.escala_id = NEW.id
      AND  (em.ativo IS NULL OR em.ativo = true)
      AND  m.ativo           = true
      AND  m.conta_ativada   = true
      AND  m.whatsapp_opt_in = true
      AND  m.whatsapp_telefone IS NOT NULL
  LOOP
    -- fire-and-forget: EXCEPTION garante que falha HTTP não reverte o UPDATE da escala
    BEGIN
      PERFORM net.http_post(
        url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-whatsapp',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || c_anon_jwt,
          'X-Wa-Secret',   v_wa_secret
        ),
        body    := jsonb_build_object(
          'membro_id',     rec.membro_id::text,
          'paroquia_id',   NEW.paroquia_id::text,
          'evento_tipo',   'escala_publicada',
          'evento_ref_id', NEW.id::text,
          'context',       jsonb_build_object(
            'nome_membro',   rec.nome,
            'data_escala',   v_data_fmt,
            'ministerio',    rec.ministerio_nome,
            'paroquia_nome', COALESCE(v_paroquia_nm, '')
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_trigger_whatsapp_escala_publicada: pg_net falhou membro %: %',
        rec.membro_id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Trigger independente de trg_escala_publicada_membros (email/push) para
-- rollback e disable independentes.
DROP TRIGGER IF EXISTS trg_whatsapp_escala_publicada ON public.escalas;
CREATE TRIGGER trg_whatsapp_escala_publicada
  AFTER UPDATE ON public.escalas
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_whatsapp_escala_publicada();
