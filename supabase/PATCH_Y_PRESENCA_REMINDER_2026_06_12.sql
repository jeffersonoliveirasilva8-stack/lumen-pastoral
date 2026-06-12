-- ============================================================
-- LUMEN PASTORAL — PATCH Y: Lembretes de Presença + RLS Fix
-- Data: 2026-06-12
--
-- FUNCIONALIDADE:
--   1. Corrige INSERT anon na tabela solicitacoes_membros (se PATCH_L não aplicado)
--   2. Adiciona colunas de controle de lembretes na tabela escalas
--   3. Cria cron job diário (09:00 UTC) que:
--        - Após 1 dia sem registro: chama edge function send-email → coordenador
--        - Após 2 dias sem registro: chama edge function send-email → admin
--
-- PRÉ-REQUISITOS:
--   • pg_cron habilitado (Settings → Database → Extensions)
--   • pg_net habilitado (normalmente já vem)
--   • Edge function send-email deployada com templates novos (ver bloco SQL abaixo)
--
-- COMO EXECUTAR:
--   1. Substituir <SEU_PROJETO_ID> pelo ID do projeto Supabase
--      (Settings → API → Project URL: https://<ID>.supabase.co)
--   2. Substituir <SERVICE_ROLE_KEY> pela chave de serviço
--      (Settings → API → service_role key)
--   3. Dashboard Supabase → SQL Editor → Executar este arquivo
--
-- IDEMPOTENTE: sim
-- ============================================================

-- ── 1. RLS solicitacoes_membros (idempotente / cobre caso PATCH_L não aplicado) ─
DROP POLICY IF EXISTS "solicitacoes_public_insert" ON solicitacoes_membros;
CREATE POLICY "solicitacoes_public_insert" ON solicitacoes_membros
  FOR INSERT TO anon
  WITH CHECK (paroquia_id IN (SELECT id FROM paroquias));

GRANT INSERT ON solicitacoes_membros TO anon;
GRANT USAGE  ON SCHEMA public TO anon;

-- ── 2. Colunas de controle de lembretes ───────────────────────────────────────
ALTER TABLE escalas
  ADD COLUMN IF NOT EXISTS lembrete_presenca_1d_em TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lembrete_presenca_2d_em TIMESTAMPTZ DEFAULT NULL;

-- ── 3. Função de envio de lembretes ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enviar_lembretes_presenca()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escala      RECORD;
  v_pendentes   INT;
  v_total       INT;
  v_email       TEXT;
  v_paroquia    TEXT;
  v_fn_url      TEXT := 'https://<SEU_PROJETO_ID>.supabase.co/functions/v1/send-email';
  v_fn_auth     TEXT := 'Bearer <SERVICE_ROLE_KEY>';
BEGIN
  -- ── Lembrete D+1: coordenador ─────────────────────────────────────────────
  FOR v_escala IN
    SELECT e.id, e.titulo, e.data, e.hora_inicio, e.paroquia_id
    FROM escalas e
    WHERE e.data = (CURRENT_DATE - INTERVAL '1 day')::DATE
      AND e.status = 'publicada'
      AND e.lembrete_presenca_1d_em IS NULL
      AND EXISTS (SELECT 1 FROM escala_membros WHERE escala_id = e.id AND status = 'pendente')
  LOOP
    SELECT COUNT(*) FILTER (WHERE status = 'pendente'), COUNT(*)
    INTO v_pendentes, v_total
    FROM escala_membros WHERE escala_id = v_escala.id;

    IF v_pendentes > 0 THEN
      SELECT p.email, pq.nome INTO v_email, v_paroquia
      FROM profiles p
      JOIN paroquias pq ON pq.id = p.paroquia_id
      WHERE p.paroquia_id = v_escala.paroquia_id
        AND p.role IN ('admin', 'coordenador')
        AND p.conta_ativada = true
      ORDER BY CASE p.role WHEN 'admin' THEN 1 ELSE 2 END
      LIMIT 1;

      IF v_email IS NOT NULL THEN
        PERFORM net.http_post(
          url     := v_fn_url,
          headers := jsonb_build_object(
            'Authorization', v_fn_auth,
            'Content-Type',  'application/json'
          ),
          body    := jsonb_build_object(
            'template',       'lembrete_presenca_coord',
            'to',             v_email,
            'paroquia',       COALESCE(v_paroquia, 'Pastoral'),
            'escalaTitulo',   v_escala.titulo,
            'escalaData',     to_char(v_escala.data::DATE, 'DD/MM/YYYY'),
            'escalaHora',     COALESCE(left(v_escala.hora_inicio::TEXT, 5), ''),
            'pendentes',      v_pendentes,
            'total',          v_total
          )
        );
      END IF;

      UPDATE escalas SET lembrete_presenca_1d_em = NOW() WHERE id = v_escala.id;
    END IF;
  END LOOP;

  -- ── Lembrete D+2: admin ───────────────────────────────────────────────────
  FOR v_escala IN
    SELECT e.id, e.titulo, e.data, e.paroquia_id
    FROM escalas e
    WHERE e.data = (CURRENT_DATE - INTERVAL '2 days')::DATE
      AND e.status = 'publicada'
      AND e.lembrete_presenca_2d_em IS NULL
      AND EXISTS (SELECT 1 FROM escala_membros WHERE escala_id = e.id AND status = 'pendente')
  LOOP
    SELECT COUNT(*) FILTER (WHERE status = 'pendente'), COUNT(*)
    INTO v_pendentes, v_total
    FROM escala_membros WHERE escala_id = v_escala.id;

    IF v_pendentes > 0 THEN
      SELECT p.email, pq.nome INTO v_email, v_paroquia
      FROM profiles p
      JOIN paroquias pq ON pq.id = p.paroquia_id
      WHERE p.paroquia_id = v_escala.paroquia_id
        AND p.role = 'admin'
        AND p.conta_ativada = true
      LIMIT 1;

      IF v_email IS NOT NULL THEN
        PERFORM net.http_post(
          url     := v_fn_url,
          headers := jsonb_build_object(
            'Authorization', v_fn_auth,
            'Content-Type',  'application/json'
          ),
          body    := jsonb_build_object(
            'template',       'lembrete_presenca_admin',
            'to',             v_email,
            'paroquia',       COALESCE(v_paroquia, 'Pastoral'),
            'escalaTitulo',   v_escala.titulo,
            'escalaData',     to_char(v_escala.data::DATE, 'DD/MM/YYYY'),
            'pendentes',      v_pendentes,
            'total',          v_total
          )
        );
      END IF;

      UPDATE escalas SET lembrete_presenca_2d_em = NOW() WHERE id = v_escala.id;
    END IF;
  END LOOP;
END;
$$;

-- ── 4. Cron job diário ─────────────────────────────────────────────────────────
SELECT cron.unschedule(jobid)
FROM cron.job WHERE jobname = 'lumen-presenca-lembretes';

SELECT cron.schedule(
  'lumen-presenca-lembretes',
  '0 9 * * *',   -- 09:00 UTC = 06:00 BRT
  $$ SELECT public.enviar_lembretes_presenca(); $$
);

-- ── 5. Verificar agendamento ──────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'lumen-presenca-lembretes';

-- ─────────────────────────────────────────────────────────────────────────────
-- TEMPLATES A ADICIONAR EM supabase/functions/send-email/index.ts
-- (já adicionados no commit deste patch)
-- ─────────────────────────────────────────────────────────────────────────────
