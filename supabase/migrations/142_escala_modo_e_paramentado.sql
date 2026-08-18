-- Migration 142: modo_selecao e todos_paramentados na tabela escalas
--
-- modo_selecao: 'equidade' (padrão) ou 'merito' (prioriza score + taxa de presença)
-- todos_paramentados: quando true, cria evento de formação com todos os escalados

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS modo_selecao      TEXT    NOT NULL DEFAULT 'equidade'
    CHECK (modo_selecao IN ('equidade', 'merito')),
  ADD COLUMN IF NOT EXISTS todos_paramentados BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.escalas.modo_selecao IS
  'equidade: equilibra oportunidades (padrão). merito: prioriza maiores scores e melhor taxa de presença.';
COMMENT ON COLUMN public.escalas.todos_paramentados IS
  'Quando true, todos os membros escalados devem estar paramentados. Cria evento de formação automaticamente.';
