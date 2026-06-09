-- ============================================================
-- LUMEN PASTORAL — PATCH E (2026-06-09)
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
-- Idempotente.
--
-- Problema: admin vê "Nenhuma ocorrência" mesmo após PATCH_D.
-- Causa: ocorrencia_admin_read usa _portal_is_admin() que só
--   cobre 'admin_paroquial', 'super_admin', 'lider'. Usuários
--   com role 'coordenador' têm acesso ao painel admin mas são
--   barrados pelo RLS — _portal_is_coord() também falha se não
--   estiverem na tabela coordenadores.
--
-- Fix: policy passa a checar user_roles diretamente, cobrindo
--   todos os papéis com acesso ao painel: admin_paroquial,
--   super_admin, lider, coordenador.
-- ============================================================

-- ── DIAGNÓSTICO — rode antes para entender o estado atual ────
-- Descomente e execute para ver os dados:

-- SELECT count(*), status FROM ocorrencias_membros GROUP BY status;
-- → Se 0 linhas: tabela vazia (membro ainda não criou nenhuma)
-- → Se > 0: policy está bloqueando o admin

-- SELECT ur.user_id, ur.role, ur.paroquia_id
-- FROM user_roles ur WHERE ur.user_id = auth.uid();
-- → Mostra o role do usuário logado atualmente

-- ── FIX: atualiza ocorrencia_admin_read para incluir coordenador ──

DROP POLICY IF EXISTS "ocorrencia_admin_read" ON public.ocorrencias_membros;

-- Qualquer usuário com role de coordenação ou administração da
-- paróquia pode ler todas as ocorrências. Isso alinha com o que
-- o frontend já considera como hasAdminAccess.
CREATE POLICY "ocorrencia_admin_read" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
        AND (ur.paroquia_id = ocorrencias_membros.paroquia_id OR ur.paroquia_id IS NULL)
    )
  );

-- Mesma lógica para UPDATE (responder ocorrências)
DROP POLICY IF EXISTS "ocorrencia_admin_update" ON public.ocorrencias_membros;

CREATE POLICY "ocorrencia_admin_update" ON public.ocorrencias_membros
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
        AND (ur.paroquia_id = ocorrencias_membros.paroquia_id OR ur.paroquia_id IS NULL)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
        AND (ur.paroquia_id = ocorrencias_membros.paroquia_id OR ur.paroquia_id IS NULL)
    )
  );

NOTIFY pgrst, 'reload schema';

-- ── VALIDAÇÃO ─────────────────────────────────────────────────
SELECT
  'PATCH E aplicado' AS status,
  (SELECT qual FROM pg_policies
   WHERE tablename = 'ocorrencias_membros'
     AND policyname = 'ocorrencia_admin_read') AS policy_admin_read,
  (SELECT count(*) FROM ocorrencias_membros)   AS total_ocorrencias;
-- total_ocorrencias = 0 → tabela vazia (membro precisa criar uma)
-- total_ocorrencias > 0 → policy corrigida, admin deve ver agora
