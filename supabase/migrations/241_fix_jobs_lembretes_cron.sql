-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 241 — Corrige os jobs de cron 'lembrete-escalas-diario' e
--                 'lumen-presenca-lembretes'
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 1) lembrete-escalas-diario (cron 57, 0 11 * * * = 08:00 Brasília)
--    Erro: unrecognized configuration parameter "app.supabase_url"
--    Causa: o comando do job (migrations 052/175) usa
--      current_setting('app.supabase_url') e current_setting('app.supabase_anon_key')
--    sem missing_ok. Esses GUCs nunca existiram em produção (ALTER DATABASE exige
--    superuser no Supabase Cloud — ver migrations 091/092/155), então o job falha
--    antes de chamar a Edge Function e nenhum lembrete é enviado.
--    Correção: mesmo agendamento e mesmo body {"mode":"1dia"}; URL e anon key
--    passam a vir de public._edge_fn_url() / public._cfg_anon_key() (migration 092),
--    o mesmo padrão já usado pelo job whatsapp-outbox-worker.
--
-- 2) lumen-presenca-lembretes (cron 44, 0 9 * * * = 06:00 Brasília)
--    Erro: column p.role does not exist
--    Causa: enviar_lembretes_presenca() (PATCH_Y, aplicado manualmente) busca o
--    destinatário em profiles.role / profiles.conta_ativada, colunas que não
--    existem. Os papéis ficam em user_roles (enum app_role). O erro só aparece
--    nos dias em que existe escala publicada de ontem/anteontem com presença
--    pendente (o PL/pgSQL só compila a consulta quando entra no loop), por isso
--    a falha é intermitente. Além disso, o corpo aplicado em produção ficou com a
--    URL entre "<>" (inválida) e uma chave service_role literal, e o send-email
--    exige x-email-secret desde a migration 166 — então mesmo sem o erro de
--    coluna nenhum e-mail sairia.
--    Correção (regras de negócio preservadas):
--      • D+1 → admin da paróquia, senão coordenador ('admin' → admin_paroquial,
--        'coordenador' → coordenador em user_roles); D+2 → só admin_paroquial.
--      • E-mail do usuário vem de auth.users (mesmo padrão das triggers da 166).
--      • URL via _edge_fn_url('send-email') e autenticação via x-email-secret
--        (_push_config.internal_email_secret), sem chave chumbada.
--      • Mesmas datas, filtros, templates e campos.
--      • lembrete_presenca_*_em só é gravado quando a requisição ao send-email foi
--        enfileirada no pg_net (antes marcava mesmo sem envio). Sem destinatário
--        ou sem internal_email_secret: RAISE WARNING e a escala fica sem marca.
--        O resultado HTTP (assíncrono) fica em net._http_response; a função não
--        reenvia em caso de falha posterior (como as demais triggers de e-mail).
--
-- NÃO ALTERA: Edge Functions, outbox/worker de WhatsApp, consentimento,
--             horários dos jobs, demais jobs.
-- IDEMPOTENTE: sim (CREATE OR REPLACE + cron.schedule por nome atualiza o job).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. lembrete-escalas-diario ────────────────────────────────────────────────
SELECT cron.schedule(
  'lembrete-escalas-diario',
  '0 11 * * *',   -- 11:00 UTC = 08:00 America/Sao_Paulo (sem horário de verão desde 2019)
  $cron$
  SELECT net.http_post(
    url     := public._edge_fn_url('lembrete-escalas'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public._cfg_anon_key()
    ),
    body    := '{"mode":"1dia"}'::jsonb
  );
  $cron$
);

-- ── 2. enviar_lembretes_presenca ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enviar_lembretes_presenca()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escala       RECORD;
  v_pendentes    INT;
  v_total        INT;
  v_email        TEXT;
  v_paroquia     TEXT;
  v_fn_url       TEXT := public._edge_fn_url('send-email');
  v_email_secret TEXT;
  v_req_id       BIGINT;
BEGIN
  SELECT val INTO v_email_secret FROM public._push_config WHERE key = 'internal_email_secret';

  -- ── Lembrete D+1: admin ou coordenador ──────────────────────────────────────
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
      v_email  := NULL;
      v_req_id := NULL;
      SELECT nome INTO v_paroquia FROM paroquias WHERE id = v_escala.paroquia_id;

      SELECT u.email INTO v_email
      FROM user_roles ur
      JOIN auth.users u ON u.id = ur.user_id
      WHERE ur.paroquia_id = v_escala.paroquia_id
        AND ur.role IN ('admin_paroquial', 'coordenador')
        AND u.email IS NOT NULL
      ORDER BY CASE ur.role WHEN 'admin_paroquial' THEN 1 ELSE 2 END, ur.created_at
      LIMIT 1;

      IF v_email IS NOT NULL AND v_email_secret IS NOT NULL THEN
        v_req_id := net.http_post(
          url     := v_fn_url,
          headers := jsonb_build_object(
            'Content-Type',   'application/json',
            'x-email-secret', v_email_secret
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
      ELSIF v_email IS NOT NULL THEN
        RAISE WARNING 'enviar_lembretes_presenca: e-mail não enviado — internal_email_secret não configurado';
      ELSE
        RAISE WARNING 'enviar_lembretes_presenca: escala % sem destinatário (admin/coordenador com e-mail)', v_escala.id;
      END IF;

      -- Só marca quando a requisição foi enfileirada no pg_net.
      IF v_req_id IS NOT NULL THEN
        UPDATE escalas SET lembrete_presenca_1d_em = NOW() WHERE id = v_escala.id;
      END IF;
    END IF;
  END LOOP;

  -- ── Lembrete D+2: admin ─────────────────────────────────────────────────────
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
      v_email  := NULL;
      v_req_id := NULL;
      SELECT nome INTO v_paroquia FROM paroquias WHERE id = v_escala.paroquia_id;

      SELECT u.email INTO v_email
      FROM user_roles ur
      JOIN auth.users u ON u.id = ur.user_id
      WHERE ur.paroquia_id = v_escala.paroquia_id
        AND ur.role = 'admin_paroquial'
        AND u.email IS NOT NULL
      ORDER BY ur.created_at
      LIMIT 1;

      IF v_email IS NOT NULL AND v_email_secret IS NOT NULL THEN
        v_req_id := net.http_post(
          url     := v_fn_url,
          headers := jsonb_build_object(
            'Content-Type',   'application/json',
            'x-email-secret', v_email_secret
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
      ELSIF v_email IS NOT NULL THEN
        RAISE WARNING 'enviar_lembretes_presenca: e-mail não enviado — internal_email_secret não configurado';
      ELSE
        RAISE WARNING 'enviar_lembretes_presenca: escala % sem destinatário (admin/coordenador com e-mail)', v_escala.id;
      END IF;

      -- Só marca quando a requisição foi enfileirada no pg_net.
      IF v_req_id IS NOT NULL THEN
        UPDATE escalas SET lembrete_presenca_2d_em = NOW() WHERE id = v_escala.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;
