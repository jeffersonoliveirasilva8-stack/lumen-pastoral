-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  PONTUACAO_TRIGGER — Execute no SQL Editor do Supabase          ║
-- ║  Gera pontos pendentes ao escalar; confirma ao marcar presente  ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════
-- Função principal: dispara em INSERT e UPDATE de escala_membros
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_escala_membro_pontuacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id UUID;
  v_data        DATE;
  v_solene      BOOLEAN;
  v_pontos      INT;
BEGIN
  -- Busca dados da escala
  SELECT paroquia_id, data, solene
  INTO v_paroquia_id, v_data, v_solene
  FROM escalas WHERE id = NEW.escala_id;

  -- Pontos: 1 ponto por escala comum, 2 pontos se solene
  v_pontos := CASE WHEN v_solene THEN 2 ELSE 1 END;

  IF TG_OP = 'INSERT' THEN
    -- Membro escalado → cria entrada PENDENTE (não conta no score ainda)
    INSERT INTO historico_participacoes (
      id, paroquia_id, membro_id, escala_id, ministerio_id,
      presenca, data, pontos
    )
    VALUES (
      gen_random_uuid(),
      v_paroquia_id,
      NEW.membro_id,
      NEW.escala_id,
      NEW.ministerio_id,
      'pendente',
      v_data,
      v_pontos
    )
    ON CONFLICT (membro_id, escala_id, ministerio_id) DO NOTHING;

  ELSIF TG_OP = 'UPDATE' THEN

    -- Coordenador marcou PRESENTE → confirma os pontos (score é recalculado pelo trigger existente)
    IF NEW.status = 'presente' AND (OLD.status IS DISTINCT FROM 'presente') THEN
      INSERT INTO historico_participacoes (
        id, paroquia_id, membro_id, escala_id, ministerio_id,
        presenca, data, pontos
      )
      VALUES (
        gen_random_uuid(),
        v_paroquia_id,
        NEW.membro_id,
        NEW.escala_id,
        NEW.ministerio_id,
        'confirmado',
        v_data,
        v_pontos
      )
      ON CONFLICT (membro_id, escala_id, ministerio_id) DO UPDATE
        SET presenca = 'confirmado';

    -- Coordenador reverteu (de presente para outro status) → volta a pendente
    ELSIF OLD.status = 'presente' AND NEW.status NOT IN ('presente') THEN
      UPDATE historico_participacoes
      SET presenca = 'pendente'
      WHERE membro_id = NEW.membro_id
        AND escala_id = NEW.escala_id
        AND ministerio_id = NEW.ministerio_id;

    -- Membro recusou ou faltou → remove os pontos pendentes
    ELSIF NEW.status IN ('recusado', 'faltou') AND OLD.status NOT IN ('recusado', 'faltou') THEN
      DELETE FROM historico_participacoes
      WHERE membro_id = NEW.membro_id
        AND escala_id = NEW.escala_id
        AND ministerio_id = NEW.ministerio_id
        AND presenca = 'pendente';

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- Registra o trigger (recria se já existia)
-- ════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS tg_escala_membro_pontuacao ON escala_membros;
CREATE TRIGGER tg_escala_membro_pontuacao
  AFTER INSERT OR UPDATE OF status ON escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION fn_escala_membro_pontuacao();

-- ════════════════════════════════════════════════════════════════════
-- Backfill: gera pontos pendentes para membros já escalados
-- (execute uma vez; o ON CONFLICT protege contra duplicatas)
-- ════════════════════════════════════════════════════════════════════

INSERT INTO historico_participacoes (
  id, paroquia_id, membro_id, escala_id, ministerio_id,
  presenca, data, pontos
)
SELECT
  gen_random_uuid(),
  e.paroquia_id,
  em.membro_id,
  em.escala_id,
  em.ministerio_id,
  CASE WHEN em.status = 'presente' THEN 'confirmado' ELSE 'pendente' END,
  e.data,
  CASE WHEN e.solene THEN 2 ELSE 1 END
FROM escala_membros em
JOIN escalas e ON e.id = em.escala_id
WHERE em.status NOT IN ('recusado', 'faltou')
  AND e.status = 'publicada'
ON CONFLICT (membro_id, escala_id, ministerio_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- Verifica resultado
-- ════════════════════════════════════════════════════════════════════

SELECT
  m.nome,
  COUNT(*) FILTER (WHERE h.presenca = 'pendente')   AS pontos_pendentes,
  COUNT(*) FILTER (WHERE h.presenca = 'confirmado') AS pontos_confirmados,
  COALESCE(SUM(h.pontos) FILTER (WHERE h.presenca = 'confirmado'), 0) AS score_atual
FROM historico_participacoes h
JOIN membros m ON m.id = h.membro_id
GROUP BY m.nome
ORDER BY score_atual DESC;
