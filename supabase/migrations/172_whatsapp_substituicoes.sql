-- Migration 172: WhatsApp para membros — eventos de substituição
--
-- Eventos tratados:
--   aprovada  → solicitante: substituicao_aprovada
--              → substituto: substituicao_confirmada_substituto (tipo e template distintos)
--   rejeitada → solicitante: substituicao_recusada
--
-- Deduplicação:
--   (membro_id, evento_tipo, evento_ref_id) é o triplo dedup em whatsapp_sends.
--   Solicitante e substituto usam o MESMO evento_ref_id (substituicao.id, UUID válido)
--   mas evento_tipo diferente — portanto são registros independentes no dedup index.
--   NÃO é necessário sufixo artificial; evento_tipo já discrimina.
--
-- paroquia_id do substituto:
--   Usamos a paroquia_id do próprio membro substituto (consultada em public.membros),
--   não a da substituição. Garante RLS e logs corretos mesmo que substituto e
--   solicitante pertençam a paróquias diferentes.
--
-- Auth: mesma estratégia da migration 171 (anon JWT + X-Wa-Secret).
-- pg_net e rollback: a Edge Function (após deploy) verifica status da substituição
--   antes de inserir pending record — mitiga envios por rollback.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS)

CREATE OR REPLACE FUNCTION public._trigger_whatsapp_substituicoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wa_secret        TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
  v_paroquia_nm      TEXT;
  v_data_fmt         TEXT;

  -- Solicitante
  v_sol_nome        TEXT;
  v_sol_paroquia_id UUID;
  v_sol_opt_in      BOOLEAN;

  -- Substituto
  v_sub_nome        TEXT;
  v_sub_paroquia_id UUID;
  v_sub_opt_in      BOOLEAN;

  c_anon_jwt    CONSTANT TEXT :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6'
    'ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0'
    '.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I';
BEGIN
  -- Guard: só em mudanças de status relevantes
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('aprovada', 'rejeitada') THEN RETURN NEW; END IF;

  SELECT val INTO v_wa_secret
  FROM   public._push_config WHERE key = 'internal_wa_secret';

  IF v_wa_secret IS NULL THEN
    RAISE WARNING '_trigger_whatsapp_substituicoes: internal_wa_secret não configurado — WhatsApp ignorado';
    RETURN NEW;
  END IF;

  -- Dados comuns da escala/ministério/paróquia
  SELECT e.titulo, e.data, min.nome, p.nome
  INTO   v_escala_titulo, v_escala_data, v_ministerio_nome, v_paroquia_nm
  FROM   public.escala_membros em
  JOIN   public.escalas     e   ON e.id   = em.escala_id
  JOIN   public.ministerios min ON min.id = em.ministerio_id
  JOIN   public.paroquias   p   ON p.id   = e.paroquia_id
  WHERE  em.id = NEW.escala_membro_id;

  v_data_fmt := to_char(v_escala_data, 'DD/MM/YYYY');

  -- Dados do solicitante (elegibilidade + paróquia própria)
  SELECT m.nome,
         m.paroquia_id,
         (m.whatsapp_opt_in = true
          AND m.whatsapp_telefone IS NOT NULL
          AND m.ativo = true
          AND m.conta_ativada = true)
  INTO   v_sol_nome, v_sol_paroquia_id, v_sol_opt_in
  FROM   public.membros m WHERE m.id = NEW.solicitante_id;

  -- ── aprovada ──────────────────────────────────────────────────────────────
  IF NEW.status = 'aprovada' THEN

    -- Notifica solicitante: "sua substituição foi aprovada"
    IF v_sol_opt_in THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-whatsapp',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || c_anon_jwt,
            'X-Wa-Secret',   v_wa_secret
          ),
          body    := jsonb_build_object(
            'membro_id',     NEW.solicitante_id::text,
            'paroquia_id',   COALESCE(v_sol_paroquia_id, NEW.paroquia_id)::text,
            'evento_tipo',   'substituicao_aprovada',
            'evento_ref_id', NEW.id::text,          -- UUID válido; dedup por (membro, tipo, ref)
            'context',       jsonb_build_object(
              'nome_membro',   COALESCE(v_sol_nome, '—'),
              'data_escala',   v_data_fmt,
              'ministerio',    COALESCE(v_ministerio_nome, '—'),
              'paroquia_nome', COALESCE(v_paroquia_nm, '')
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_trigger_whatsapp_substituicoes: pg_net falhou solicitante %: %',
          NEW.solicitante_id, SQLERRM;
      END;
    END IF;

    -- Notifica substituto: template distinto via substituicao_confirmada_substituto
    IF NEW.substituto_id IS NOT NULL THEN
      SELECT m.nome,
             m.paroquia_id,
             (m.whatsapp_opt_in = true
              AND m.whatsapp_telefone IS NOT NULL
              AND m.ativo = true
              AND m.conta_ativada = true)
      INTO   v_sub_nome, v_sub_paroquia_id, v_sub_opt_in
      FROM   public.membros m WHERE m.id = NEW.substituto_id;

      IF v_sub_opt_in THEN
        BEGIN
          PERFORM net.http_post(
            url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-whatsapp',
            headers := jsonb_build_object(
              'Content-Type',  'application/json',
              'Authorization', 'Bearer ' || c_anon_jwt,
              'X-Wa-Secret',   v_wa_secret
            ),
            body    := jsonb_build_object(
              'membro_id',     NEW.substituto_id::text,
              'paroquia_id',   COALESCE(v_sub_paroquia_id, NEW.paroquia_id)::text,
              'evento_tipo',   'substituicao_confirmada_substituto',
              'evento_ref_id', NEW.id::text,         -- mesmo UUID, tipo diferente → dedup independente
              'context',       jsonb_build_object(
                'nome_membro',       COALESCE(v_sub_nome, '—'),
                'data_escala',       v_data_fmt,
                'ministerio',        COALESCE(v_ministerio_nome, '—'),
                'paroquia_nome',     COALESCE(v_paroquia_nm, ''),
                'nome_solicitante',  v_sol_nome  -- quem o substituto está cobrindo
              )
            )
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '_trigger_whatsapp_substituicoes: pg_net falhou substituto %: %',
            NEW.substituto_id, SQLERRM;
        END;
      END IF;
    END IF;

  -- ── rejeitada ─────────────────────────────────────────────────────────────
  ELSIF NEW.status = 'rejeitada' THEN

    IF v_sol_opt_in THEN
      BEGIN
        PERFORM net.http_post(
          url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-whatsapp',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || c_anon_jwt,
            'X-Wa-Secret',   v_wa_secret
          ),
          body    := jsonb_build_object(
            'membro_id',     NEW.solicitante_id::text,
            'paroquia_id',   COALESCE(v_sol_paroquia_id, NEW.paroquia_id)::text,
            'evento_tipo',   'substituicao_recusada',
            'evento_ref_id', NEW.id::text,
            'context',       jsonb_build_object(
              'nome_membro', COALESCE(v_sol_nome, '—'),
              'data_escala', v_data_fmt,
              'ministerio',  COALESCE(v_ministerio_nome, '—'),
              'motivo',      NEW.motivo_rejeicao  -- null → template omite linha "Motivo:"
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_trigger_whatsapp_substituicoes: pg_net falhou rejeição solicitante %: %',
          NEW.solicitante_id, SQLERRM;
      END;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_substituicoes ON public.substituicoes;
CREATE TRIGGER trg_whatsapp_substituicoes
  AFTER UPDATE ON public.substituicoes
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_whatsapp_substituicoes();
