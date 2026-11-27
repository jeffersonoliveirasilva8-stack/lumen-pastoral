-- Testes de regressão da migration 245.
-- Executar somente em banco de desenvolvimento/staging após aplicar as migrations.
-- Estes testes são somente de catálogo: não invocam a RPC e não disparam WhatsApp.

DO $$
DECLARE
  v_new_oid oid;
  v_old_exists boolean;
  v_constraint text;
BEGIN
  -- A assinatura antiga não pode coexistir com a nova (que possui 6 argumentos,
  -- sendo o sexto DEFAULT NULL).
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'coord_enviar_aviso_pastoral'
      AND p.pronargs = 5
      AND p.proargtypes = '2950 25 2950 2950 2950'::oidvector
  ) INTO v_old_exists;

  ASSERT NOT v_old_exists,
    'T245-01 FAIL: assinatura antiga de 5 argumentos ainda existe';

  SELECT p.oid
    INTO v_new_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'coord_enviar_aviso_pastoral'
    AND p.pronargs = 6
    AND p.pronargdefaults = 4;

  ASSERT v_new_oid IS NOT NULL,
    'T245-02 FAIL: RPC de 6 argumentos com quatro defaults não encontrada';

  ASSERT has_function_privilege('authenticated', v_new_oid, 'EXECUTE'),
    'T245-03 FAIL: authenticated não possui EXECUTE na nova RPC';

  ASSERT NOT has_function_privilege('anon', v_new_oid, 'EXECUTE'),
    'T245-04 FAIL: anon/PUBLIC ainda possui EXECUTE na nova RPC';

  SELECT pg_get_constraintdef(c.oid)
    INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.comunicacao_pastoral_mensagens'::regclass
    AND c.conname = 'chk_apenas_um_segmento';

  ASSERT v_constraint IS NOT NULL
     AND position('destinatario_atuacao_id' IN v_constraint) > 0,
    'T245-05 FAIL: chk_apenas_um_segmento não contempla destinatario_atuacao_id';

  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comunicacao_pastoral_mensagens'
      AND column_name = 'destinatario_atuacao_id'
      AND data_type = 'uuid'
  ), 'T245-06 FAIL: coluna destinatario_atuacao_id não existe como UUID';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.comunicacao_pastoral_mensagens'::regclass
      AND c.contype = 'f'
      AND a.attname = 'destinatario_atuacao_id'
      AND c.confrelid = 'public.atuacoes_pastorais'::regclass
  ), 'T245-07 FAIL: FK de destinatario_atuacao_id para atuacoes_pastorais não encontrada';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_new_oid
      AND prosecdef
      AND proconfig @> ARRAY['search_path=public, pg_temp']
  ), 'T245-08 FAIL: RPC SECURITY DEFINER sem search_path fixo';

  RAISE NOTICE 'Migration 245: 8 verificações de catálogo passaram.';
END $$;
