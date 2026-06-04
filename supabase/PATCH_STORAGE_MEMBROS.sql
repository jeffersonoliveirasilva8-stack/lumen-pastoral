-- ============================================================
-- PATCH: Storage público para fotos de membros
-- Execute no Supabase SQL Editor.
-- ============================================================

-- 1. Criar bucket "membros" se não existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'membros',
  'membros',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- 2. Remover policies antigas do bucket
DROP POLICY IF EXISTS "membros_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "membros_auth_upload"   ON storage.objects;
DROP POLICY IF EXISTS "membros_auth_delete"   ON storage.objects;
DROP POLICY IF EXISTS "membros_auth_update"   ON storage.objects;

-- 3. Leitura pública (sem autenticação)
CREATE POLICY "membros_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'membros');

-- 4. Upload autenticado
CREATE POLICY "membros_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'membros');

-- 5. Atualização autenticada
CREATE POLICY "membros_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'membros');

-- 6. Exclusão autenticada
CREATE POLICY "membros_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'membros');

-- 7. Garantir coluna foto_url em membros
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS foto_url TEXT;

-- Verificação
SELECT id, name, public FROM storage.buckets WHERE id = 'membros';
