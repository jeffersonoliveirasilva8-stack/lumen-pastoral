-- PATCH_PDF_IMAGENS.sql
-- Adiciona colunas de imagens de cabeçalho e rodapé do PDF na tabela paroquias.
-- Execução: cole no SQL Editor do Supabase → Run.

ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS pdf_cabecalho_url TEXT,
  ADD COLUMN IF NOT EXISTS pdf_rodape_url    TEXT;

-- Bucket para armazenar as imagens (execute uma vez via dashboard ou API):
-- INSERT INTO storage.buckets (id, name, public)
--   VALUES ('paroquia-imagens', 'paroquia-imagens', true)
--   ON CONFLICT DO NOTHING;

-- RLS: apenas o admin da paróquia pode fazer upload/delete
-- (habilitar depois de criar o bucket no dashboard)
-- CREATE POLICY "admin pode upload imagens paroquia"
--   ON storage.objects FOR INSERT
--   WITH CHECK (
--     bucket_id = 'paroquia-imagens'
--     AND auth.uid() IN (
--       SELECT ur.user_id FROM user_roles ur
--       WHERE ur.paroquia_id = (split_part(name, '/', 1))::uuid
--         AND ur.role IN ('admin_paroquial', 'super_admin')
--     )
--   );
