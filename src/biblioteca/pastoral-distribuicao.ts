/**
 * FASE 9 — Motor de Cobertura e Distribuição Pastoral
 *
 * Seleciona membros para missas comuns usando prioridade estrutural,
 * não pesos no score. A arquitetura é: distribuidor, não ranqueador.
 */

type AssignmentHistoryEntry = {
  memberId: string;
  ministerioId: string;
  date?: string | null;
  tipoEvento?: string | null;
};

export type UrgenciaPastoral = "critica" | "alta" | "normal" | "baixa";

export type EstadoPastoral = {
  membro_id: string;
  /** serviços nas últimas 2 semanas (history + batch) */
  servicos_14d: number;
  /** missas que o membro era elegível nas últimas 2 semanas */
  oportunidades_14d: number;
  /** servicos_14d / max(oportunidades_14d, 1) */
  taxa_cobertura_14d: number;
  /** dias desde o último serviço */
  dias_ultimo_servico: number;
  /** serviços atribuídos na rodada atual */
  servicos_rodada: number;
  /** missas elegíveis na rodada atual até este ponto */
  oportunidades_rodada: number;
  /** missas restantes na rodada que o membro pode servir */
  oportunidades_futuras: number;
};

export type MembroPastoral = {
  id: string;
  score: number;
  restricoes_dia_semana: number[];
  atuacao_ids?: string[];
};

export type FuncaoPastoral = {
  ministerio_id: string;
  quantidade: number;
};

export type RestricaoFuncao = {
  membro_id: string;
  ministerio_id: string;
  tipo: string; // "pode" | "nao_pode"
};

export function calcularUrgencia(ep: EstadoPastoral): UrgenciaPastoral {
  if (ep.dias_ultimo_servico >= 14 && ep.taxa_cobertura_14d < 0.3) return "critica";
  if (ep.dias_ultimo_servico >= 10 || ep.taxa_cobertura_14d < 0.5) return "alta";
  if (ep.oportunidades_futuras <= 1)                                return "alta";
  return ep.servicos_rodada === 0 ? "normal" : "baixa";
}

export function urgenciaNivel(u: UrgenciaPastoral): number {
  return u === "critica" ? 0 : u === "alta" ? 1 : u === "normal" ? 2 : 3;
}

export type SelecionarParams = {
  funcoes: FuncaoPastoral[];
  membros: MembroPastoral[];
  estadosPastorais: Map<string, EstadoPastoral>;
  membroMinisterios: Record<string, string[]>;
  indisponibilidades: { membro_id: string; data: string }[];
  restricoes: RestricaoFuncao[];
  celData: string;
};

/**
 * Seleciona membros para uma missa comum usando prioridade pastoral.
 *
 * 6 critérios (em ordem):
 * 1. Urgência (critica > alta > normal > baixa)
 * 2. Serviços na rodada (menos = maior prioridade)
 * 3. Taxa de cobertura histórica (menor = maior prioridade, tolerância 5%)
 * 4. Oportunidades futuras (menos = maior prioridade, protege quem só pode domingo)
 * 5. Dias sem servir (mais = maior prioridade)
 * 6. Score do banco (puro tiebreaker)
 */
export function selecionarMembrosPastoral(params: SelecionarParams): { membro_id: string; ministerio_id: string }[] {
  const { funcoes, membros, estadosPastorais, membroMinisterios,
          indisponibilidades, restricoes, celData } = params;

  const result: { membro_id: string; ministerio_id: string }[] = [];
  const escaladosNestaMissa = new Set<string>();
  const diaSemana = new Date(celData + "T12:00:00").getDay();

  for (const funcao of funcoes) {
    const candidatos = membros.filter((m) => {
      if (!membroMinisterios[m.id]?.includes(funcao.ministerio_id)) return false;
      if (escaladosNestaMissa.has(m.id)) return false;
      if (indisponibilidades.some((i) => i.membro_id === m.id && i.data === celData)) return false;
      if (m.restricoes_dia_semana?.includes(diaSemana)) return false;
      if (restricoes.some(
        (r) => r.membro_id === m.id && r.ministerio_id === funcao.ministerio_id && r.tipo === "nao_pode"
      )) return false;
      return true;
    });

    const ordenados = candidatos.slice().sort((a, b) => {
      const epA = estadosPastorais.get(a.id);
      const epB = estadosPastorais.get(b.id);
      if (!epA || !epB) return 0;

      const uA = urgenciaNivel(calcularUrgencia(epA));
      const uB = urgenciaNivel(calcularUrgencia(epB));
      if (uA !== uB) return uA - uB;

      if (epA.servicos_rodada !== epB.servicos_rodada)
        return epA.servicos_rodada - epB.servicos_rodada;

      const taxaDiff = epA.taxa_cobertura_14d - epB.taxa_cobertura_14d;
      if (Math.abs(taxaDiff) > 0.05) return taxaDiff;

      if (epA.oportunidades_futuras !== epB.oportunidades_futuras)
        return epA.oportunidades_futuras - epB.oportunidades_futuras;

      if (epA.dias_ultimo_servico !== epB.dias_ultimo_servico)
        return epB.dias_ultimo_servico - epA.dias_ultimo_servico;

      return b.score - a.score;
    });

    let selecionados = 0;
    for (const m of ordenados) {
      if (selecionados >= funcao.quantidade) break;
      result.push({ membro_id: m.id, ministerio_id: funcao.ministerio_id });
      escaladosNestaMissa.add(m.id);
      selecionados++;
    }
  }

  return result;
}

/** Inicializa o estado pastoral de um membro a partir do assignmentHistory. */
export function inicializarEstadoPastoral(
  membroId: string,
  assignmentHistory: AssignmentHistoryEntry[],
  dataReferencia: Date
): EstadoPastoral {
  const data14d = new Date(dataReferencia.getTime() - 14 * 24 * 60 * 60 * 1000);
  const data14dStr = data14d.toISOString().slice(0, 10);

  const servicos14d = assignmentHistory.filter(
    (h) => h.memberId === membroId && (h.date ?? "") >= data14dStr
  ).length;

  const ultimoServico = assignmentHistory
    .filter((h) => h.memberId === membroId && h.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];

  const diasUltimo = ultimoServico
    ? Math.floor((dataReferencia.getTime() - new Date((ultimoServico.date ?? "") + "T12:00:00").getTime()) / 86400000)
    : 999;

  return {
    membro_id: membroId,
    servicos_14d: servicos14d,
    oportunidades_14d: 0,
    taxa_cobertura_14d: 0,
    dias_ultimo_servico: diasUltimo,
    servicos_rodada: 0,
    oportunidades_rodada: 0,
    oportunidades_futuras: 0,
  };
}
