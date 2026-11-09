/**
 * FASE 6C — Serviço de elegibilidade por presença
 *
 * Filtra membros suspensos antes de qualquer chamada a alocarMembros.
 * Pure function: sem efeitos colaterais, testável com Vitest.
 */

export type DecisaoPresenca = {
  membro_id: string;
  tipo: "suspensao" | "restabelecimento";
  imune_ate: string | null; // DATE como string "YYYY-MM-DD"
  motivo?: string | null;
  criado_em: string;
};

export type ElegibilidadeResult<T extends { id: string }> = {
  elegiveis: T[];
  suspensos: T[];
  /** IDs dos suspensos para exibição em UI */
  idsSuspensos: Set<string>;
};

/**
 * Separa membros elegíveis de suspensos com base nas decisões ativas.
 *
 * Um membro é inelegível quando a decisão ativa é "suspensao".
 * Um membro com decisão "restabelecimento" e imune_ate >= hoje é elegível.
 *
 * @param membros   Lista de membros a filtrar
 * @param decisoes  Decisões ativas retornadas por coord_get_elegibilidade_presenca
 * @param hoje      Data de referência "YYYY-MM-DD" (padrão: hoje)
 */
export function filtrarElegiveis<T extends { id: string }>(
  membros: T[],
  decisoes: DecisaoPresenca[],
  hoje: string = new Date().toISOString().slice(0, 10),
): ElegibilidadeResult<T> {
  // Monta mapa de decisão ativa por membro_id
  const decisaoMap = new Map<string, DecisaoPresenca>();
  for (const d of decisoes) {
    decisaoMap.set(d.membro_id, d);
  }

  const elegiveis: T[] = [];
  const suspensos: T[] = [];

  for (const m of membros) {
    const decisao = decisaoMap.get(m.id);

    if (!decisao) {
      // Sem decisão ativa → elegível
      elegiveis.push(m);
      continue;
    }

    if (decisao.tipo === "suspensao") {
      suspensos.push(m);
      continue;
    }

    // tipo === "restabelecimento": membro está em imunidade → elegível
    elegiveis.push(m);
  }

  return {
    elegiveis,
    suspensos,
    idsSuspensos: new Set(suspensos.map((m) => m.id)),
  };
}
