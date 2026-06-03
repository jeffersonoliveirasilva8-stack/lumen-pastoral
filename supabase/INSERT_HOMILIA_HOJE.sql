-- ============================================================
-- INSERT_HOMILIA_HOJE.sql
-- Insere manualmente uma homilia do dia para teste.
-- Útil quando a Edge Function homilia-diaria ainda não rodou
-- ou quando o vídeo do dia precisa ser corrigido/substituído.
--
-- Como usar:
--   1. Vá ao YouTube → canal do Pe. Paulo Ricardo
--   2. Abra o vídeo da homilia de hoje
--   3. Copie o video_id da URL: youtube.com/watch?v=VIDEO_ID_AQUI
--   4. Preencha os campos abaixo e execute no SQL Editor do Supabase
-- ============================================================

-- Substitua os valores entre << >> antes de executar
INSERT INTO homilias_diarias (
  data,
  titulo,
  descricao,
  youtube_url,
  video_id,
  thumbnail_url,
  autor
)
VALUES (
  CURRENT_DATE,                                                          -- data de hoje
  'Homilia do dia - <<TÍTULO DO VÍDEO>>',                               -- título do vídeo
  NULL,                                                                  -- descrição opcional
  'https://www.youtube.com/watch?v=<<VIDEO_ID>>',                       -- URL completa
  '<<VIDEO_ID>>',                                                        -- só o ID (ex: 2CXV9p_uOwY)
  'https://i.ytimg.com/vi/<<VIDEO_ID>>/hqdefault.jpg',                  -- thumbnail automática
  'Padre Paulo Ricardo'
)
ON CONFLICT (data) DO UPDATE SET
  titulo        = EXCLUDED.titulo,
  descricao     = EXCLUDED.descricao,
  youtube_url   = EXCLUDED.youtube_url,
  video_id      = EXCLUDED.video_id,
  thumbnail_url = EXCLUDED.thumbnail_url,
  autor         = EXCLUDED.autor,
  updated_at    = now();

-- Verificar resultado
SELECT id, data, titulo, video_id, autor, created_at
FROM homilias_diarias
WHERE data >= CURRENT_DATE - 3
ORDER BY data DESC;
