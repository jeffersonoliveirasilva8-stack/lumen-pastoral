-- Migration 211 — Sprint B Fix: política SELECT de escala_convocacoes
--
-- Adiciona leitura para auxiliar ativo na paróquia e administrador
-- ativo escalado na mesma celebração.
-- Verificado: escala_membros.RLS não referencia escala_convocacoes → sem recursão.

DROP POLICY IF EXISTS "conv_select" ON public.escala_convocacoes;

CREATE POLICY "conv_select" ON public.escala_convocacoes
  FOR SELECT USING (
    -- membro vê suas próprias convocações
    membro_id = public._portal_membro_id()
    -- coordenador pastoral (qualquer perfil de coord via função helper)
    OR public._portal_is_coord(public._portal_membro_id())
    -- admin de portal (nível de paróquia)
    OR public._portal_is_admin(paroquia_id)
    -- auxiliar (Secretário) ativo na mesma paróquia
    OR EXISTS (
      SELECT 1 FROM public.membros
      WHERE id          = public._portal_membro_id()
        AND paroquia_id = escala_convocacoes.paroquia_id
        AND ativo       = true
        AND tipo_acesso = 'auxiliar'
    )
    -- administrador ativo escalado nesta celebração específica
    OR EXISTS (
      SELECT 1 FROM public.membros m
      JOIN   public.escala_membros em ON em.membro_id = m.id
      WHERE  m.id          = public._portal_membro_id()
        AND  m.paroquia_id = escala_convocacoes.paroquia_id
        AND  m.ativo       = true
        AND  m.tipo_acesso = 'administrador'
        AND  em.escala_id  = escala_convocacoes.escala_id
        AND  (em.ativo IS NULL OR em.ativo = true)
    )
  );
