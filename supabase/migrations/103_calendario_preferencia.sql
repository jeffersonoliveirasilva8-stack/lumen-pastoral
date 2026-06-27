-- Migration 103 — Preferência de calendário do membro
-- Armazena qual app de calendário o membro prefere para receber seus eventos de escala.
-- Valores: 'google' | 'ics' | NULL (não configurado)
-- IDEMPOTENTE: sim

ALTER TABLE public.membros
  ADD COLUMN IF NOT EXISTS calendario_preferencia TEXT
  CHECK (calendario_preferencia IN ('google', 'ics'));

-- RLS: membro pode atualizar apenas o próprio registro
-- (a policy de update já existente em membros cobre auth_user_id = auth.uid())

NOTIFY pgrst, 'reload schema';
