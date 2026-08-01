-- ── 131: SaaS — Policies de enforcement de plano nas tabelas existentes ───

-- Policies de INSERT bloqueadas quando paróquia está suspensa/bloqueada
-- (READ sempre permitido para não perder dados)

-- escalas: bloqueia criação se paróquia inacessível
DROP POLICY IF EXISTS "escalas_write_requires_active_sub" ON public.escalas;
CREATE POLICY "escalas_write_requires_active_sub" ON public.escalas
  FOR INSERT WITH CHECK (
    paroquia_id = public.current_paroquia_id()
    AND public.paroquia_is_accessible()
  );

-- membros: bloqueia criação de novo membro se acima do limite do plano
-- (O check de limite é feito nas RPCs; aqui só verifica acessibilidade)
DROP POLICY IF EXISTS "membros_write_requires_active_sub" ON public.membros;
CREATE POLICY "membros_write_requires_active_sub" ON public.membros
  FOR INSERT WITH CHECK (
    paroquia_id = public.current_paroquia_id()
    AND public.paroquia_is_accessible()
  );
