-- Migration 112 — Proteção contra hard-delete de escalas publicadas/arquivadas
--
-- Escalas publicadas ou arquivadas têm histórico de presenças e atribuições.
-- Este trigger impede exclusão acidental — o fluxo correto é status='arquivada'.
-- A UI já usa soft-archive, mas este trigger é a rede de segurança no banco.

CREATE OR REPLACE FUNCTION public.prevent_delete_published_escala()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('publicada', 'arquivada') THEN
    RAISE EXCEPTION
      'Escala "%" não pode ser excluída diretamente pois está com status "%". Use status=arquivada para arquivar.',
      OLD.titulo, OLD.status
    USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_published_escala ON public.escalas;
CREATE TRIGGER trg_prevent_delete_published_escala
  BEFORE DELETE ON public.escalas
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_published_escala();

-- Adiciona coluna para registrar quem arquivou e quando
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS arquivada_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arquivada_por UUID REFERENCES public.profiles(id);
