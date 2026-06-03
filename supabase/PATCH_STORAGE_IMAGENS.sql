-- PATCH_STORAGE_IMAGENS.sql
-- Cria o bucket paroquia-imagens (público) e define as políticas de acesso.
-- Execute no SQL Editor do Supabase → Run.

-- 1. Criar bucket público (ignora se já existir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'paroquia-imagens',
  'paroquia-imagens',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Remover políticas antigas do bucket (caso existam com nomes diferentes)
DROP POLICY IF EXISTS "paroquia-imagens insert" ON storage.objects;
DROP POLICY IF EXISTS "paroquia-imagens select" ON storage.objects;
DROP POLICY IF EXISTS "paroquia-imagens update" ON storage.objects;
DROP POLICY IF EXISTS "paroquia-imagens delete" ON storage.objects;
DROP POLICY IF EXISTS "admin pode upload imagens paroquia" ON storage.objects;

-- 3. Leitura pública (qualquer um pode visualizar as imagens)
CREATE POLICY "paroquia-imagens select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'paroquia-imagens');

-- 4. Upload para usuários autenticados
CREATE POLICY "paroquia-imagens insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'paroquia-imagens');

-- 5. Sobrescrever (upsert) para usuários autenticados
CREATE POLICY "paroquia-imagens update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'paroquia-imagens');

-- 6. Excluir para usuários autenticados
CREATE POLICY "paroquia-imagens delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'paroquia-imagens');
