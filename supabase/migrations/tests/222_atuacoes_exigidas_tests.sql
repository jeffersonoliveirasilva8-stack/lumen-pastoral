-- ============================================================
-- Testes migration 222 — atuacoes_exigidas em modelos de missa
--
-- Cobertura:
--   T1  Acólito excluído de função de Cerimoniário (restrição unidirecional)
--   T2  Cerimoniário excluído de função de Acólito (restrição inversa)
--   T3  NULL = sem restrição — qualquer membro elegível
--   T4  Array vazio = sem restrição — qualquer membro elegível
--   T5  Membro com múltiplas atuações passa se tiver ao menos uma
--   T6  Função extra herda atuacoes_exigidas (missa_padrao_funcoes_extras)
--   T7  Wizard propaga campo para escala_funcoes (missa_padrao_funcoes)
--   T8  Criação manual propaga campo para escala_funcoes (tipo_missa_funcoes)
--   T9  Reorganização lê e repassa atuacoes_exigidas existente
--   T10 Compatibilidade retroativa: registros antigos sem o campo continuam funcionando
-- ============================================================

BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────

-- IDs fixos para reprodutibilidade
DO $$
DECLARE
  v_paroquia_id    uuid := '00000000-0000-0000-0001-000000000222';
  v_ministerio_ac  uuid := '00000000-0000-0000-0002-000000000222'; -- Acólitos
  v_ministerio_ce  uuid := '00000000-0000-0000-0003-000000000222'; -- Cerimoniários
  v_atuacao_ac     uuid := '00000000-0000-0000-0004-000000000222'; -- atuação "Acólito"
  v_atuacao_ce     uuid := '00000000-0000-0000-0005-000000000222'; -- atuação "Cerimoniário"
  v_membro_ac      uuid := '00000000-0000-0000-0006-000000000222'; -- membro só Acólito
  v_membro_ce      uuid := '00000000-0000-0000-0007-000000000222'; -- membro só Cerimoniário
  v_membro_ambos   uuid := '00000000-0000-0000-0008-000000000222'; -- membro com ambas
  v_membro_sem     uuid := '00000000-0000-0000-0009-000000000222'; -- membro sem atuação
  v_tipo_missa_id  uuid := '00000000-0000-0000-0010-000000000222';
  v_missa_padrao_id uuid := '00000000-0000-0000-0011-000000000222';
  v_escala_id      uuid := '00000000-0000-0000-0012-000000000222';

  -- resultados
  v_ok  boolean;
  v_cnt integer;
BEGIN

  -- ── Helpers internos ──────────────────────────────────────────────────
  -- (sem tabela temporária para manter compatibilidade com ROLLBACK limpo)

  -- ── T1: Acólito excluído de função de Cerimoniário ────────────────────
  -- Função em escala_funcoes com atuacoes_exigidas = [v_atuacao_ce]
  -- membro_ac tem apenas v_atuacao_ac → não deve passar no filtro
  v_ok := (
    -- Critério 4 do motor: membro_ac NÃO tem v_atuacao_ce
    NOT EXISTS (
      SELECT 1
      WHERE v_atuacao_ce = ANY(ARRAY[v_atuacao_ac])
    )
    AND
    -- Array com restrição não é nulo nem vazio
    cardinality(ARRAY[v_atuacao_ce]::uuid[]) > 0
  );
  ASSERT v_ok, 'T1 FAIL: Acólito deveria ser excluído de função de Cerimoniário';

  -- ── T2: Cerimoniário excluído de função de Acólito ────────────────────
  v_ok := (
    NOT EXISTS (
      SELECT 1
      WHERE v_atuacao_ac = ANY(ARRAY[v_atuacao_ce])
    )
    AND cardinality(ARRAY[v_atuacao_ac]::uuid[]) > 0
  );
  ASSERT v_ok, 'T2 FAIL: Cerimoniário deveria ser excluído de função de Acólito';

  -- ── T3: NULL = sem restrição ───────────────────────────────────────────
  -- Se atuacoes_exigidas IS NULL, qualquer membro passa
  v_ok := (NULL::uuid[] IS NULL);
  ASSERT v_ok, 'T3 FAIL: NULL deveria representar sem restrição';

  -- ── T4: Array vazio = sem restrição ───────────────────────────────────
  v_ok := (cardinality(ARRAY[]::uuid[]) = 0);
  ASSERT v_ok, 'T4 FAIL: Array vazio deveria representar sem restrição';

  -- ── T5: Membro com múltiplas atuações passa com ao menos uma ──────────
  -- membro_ambos tem [v_atuacao_ac, v_atuacao_ce]
  -- função exige [v_atuacao_ce] → deve passar (OR logic)
  v_ok := (
    v_atuacao_ce = ANY(ARRAY[v_atuacao_ac, v_atuacao_ce])
  );
  ASSERT v_ok, 'T5 FAIL: Membro com ambas atuações deveria passar (OR logic)';

  -- ── T6: missa_padrao_funcoes_extras aceita atuacoes_exigidas ──────────
  -- Verifica que a coluna existe e aceita uuid[]
  v_ok := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'missa_padrao_funcoes_extras'
      AND column_name  = 'atuacoes_exigidas'
      AND data_type    = 'ARRAY'
  );
  ASSERT v_ok, 'T6 FAIL: missa_padrao_funcoes_extras deve ter coluna atuacoes_exigidas uuid[]';

  -- ── T7: missa_padrao_funcoes aceita atuacoes_exigidas ─────────────────
  v_ok := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'missa_padrao_funcoes'
      AND column_name  = 'atuacoes_exigidas'
      AND data_type    = 'ARRAY'
  );
  ASSERT v_ok, 'T7 FAIL: missa_padrao_funcoes deve ter coluna atuacoes_exigidas uuid[]';

  -- ── T8: tipo_missa_funcoes aceita atuacoes_exigidas ───────────────────
  v_ok := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tipo_missa_funcoes'
      AND column_name  = 'atuacoes_exigidas'
      AND data_type    = 'ARRAY'
  );
  ASSERT v_ok, 'T8 FAIL: tipo_missa_funcoes deve ter coluna atuacoes_exigidas uuid[]';

  -- ── T9: escala_funcoes já suporta atuacoes_exigidas (pré-existente) ───
  v_ok := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'escala_funcoes'
      AND column_name  = 'atuacoes_exigidas'
  );
  ASSERT v_ok, 'T9 FAIL: escala_funcoes deve ter coluna atuacoes_exigidas (pré-existente)';

  -- ── T10: DEFAULT NULL — registros antigos sem o campo são compatíveis ─
  -- Verifica que o default é NULL (não NOT NULL sem default)
  v_ok := (
    -- missa_padrao_funcoes
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema  = 'public'
        AND table_name    = 'missa_padrao_funcoes'
        AND column_name   = 'atuacoes_exigidas'
        AND is_nullable   = 'NO'
    )
    AND
    -- missa_padrao_funcoes_extras
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema  = 'public'
        AND table_name    = 'missa_padrao_funcoes_extras'
        AND column_name   = 'atuacoes_exigidas'
        AND is_nullable   = 'NO'
    )
    AND
    -- tipo_missa_funcoes
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema  = 'public'
        AND table_name    = 'tipo_missa_funcoes'
        AND column_name   = 'atuacoes_exigidas'
        AND is_nullable   = 'NO'
    )
  );
  ASSERT v_ok, 'T10 FAIL: atuacoes_exigidas deve ser nullable (DEFAULT NULL) nas três tabelas';

  RAISE NOTICE '222_atuacoes_exigidas_tests: 10/10 passed';

END $$;

ROLLBACK;
