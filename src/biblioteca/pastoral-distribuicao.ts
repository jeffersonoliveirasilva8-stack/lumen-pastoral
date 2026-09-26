/**
 * Motor de Cobertura e Distribuição Pastoral
 *
 * Seleciona membros para missas comuns usando prioridade estrutural:
 * 1. Quem foi menos vezes na rodada atual (equilíbrio dentro do mês)
 * 2. Quem ficou mais tempo sem servir (rodízio principal)
 * 3. Quem tem menos oportunidades futuras (protege quem só pode em datas específicas)
 * 4. Taxa histórica de cobertura (equidade a longo prazo)
 * 5. Score do banco (desempate determinístico)
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
  /** dias desde o último serviço (recalculado antes de cada missa) */
  dias_ultimo_servico: number;
  /** data do último serviço (histórico ou batch) — usado para recalcular dias_ultimo_servico */
  lastServiceDate: string | null;
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

/** Mantida para exibição de status — não é mais usada na ordenação interna */
export function calcularUrgencia(ep: EstadoPastoral): UrgenciaPastoral {
  if (ep.dias_ultimo_servico >= 28) return "critica";
  if (ep.dias_ultimo_servico >= 14) return "alta";
  if (ep.servicos_rodada === 0) return "normal";
  return "baixa";
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
  /** Intervalo mínimo em dias entre serviços (hard-block) */
  intervaloMinimoDias?: number;
};

/**
 * Seleciona membros para uma missa comum garantindo rodízio e equilíbrio.
 *
 * Critérios em ordem de prioridade:
 * 1. servicos_rodada    — quem foi menos vezes este mês (=0 > =1 > =2...)
 * 2. dias_ultimo_servico — quem ficou mais tempo sem servir (rodízio principal)
 * 3. oportunidades_futuras — quem tem menos chances restantes (cobre quem só pode em datas específicas)
 * 4. taxa_cobertura_14d — quem tem menor taxa histórica (equidade a longo prazo)
 * 5. score              — desempate determinístico
 */
export function selecionarMembrosPastoral(params: SelecionarParams): { membro_id: string; ministerio_id: string }[] {
  const { funcoes, membros, estadosPastorais, membroMinisterios,
          indisponibilidades, restricoes, celData, intervaloMinimoDias } = params;

  const membroPara = membroMinisterios;

  const result: { membro_id: string; ministerio_id: string }[] = [];
  const escaladosNestaMissa = new Set<string>();
  const diaSemana = new Date(celData + "T12:00:00").getDay();
  const celDataObj = new Date(celData + "T12:00:00");

  for (const funcao of funcoes) {
    const candidatos = membros.filter((m) => {
      if (!membroPara[m.id]?.includes(funcao.ministerio_id)) return false;
      if (escaladosNestaMissa.has(m.id)) return false;
      if (indisponibilidades.some((i) => {
        if (i.membro_id !== m.id) return false;
        if ((i as any).cancelada) return false;
        if ((i as any).tipo === "intervalo" && (i as any).data_fim) return celData >= i.data && celData <= (i as any).data_fim;
        return i.data === celData;
      })) return false;
      if (m.restricoes_dia_semana?.includes(diaSemana)) return false;
      if (restricoes.some(
        (r) => r.membro_id === m.id && r.ministerio_id === funcao.ministerio_id && r.tipo === "nao_pode"
      )) return false;
      if (intervaloMinimoDias && intervaloMinimoDias > 0) {
        const ep = estadosPastorais.get(m.id);
        if (ep?.lastServiceDate) {
          const diasDesde = Math.floor((celDataObj.getTime() - new Date(ep.lastServiceDate + "T12:00:00").getTime()) / 86400000);
          if (diasDesde < intervaloMinimoDias) return false;
        }
      }
      return true;
    });

    const ordenados = candidatos.slice().sort((a, b) => {
      const epA = estadosPastorais.get(a.id);
      const epB = estadosPastorais.get(b.id);
      if (!epA || !epB) return 0;

      // 1. Quem foi menos vezes na rodada atual (distribui dentro do mês)
      if (epA.servicos_rodada !== epB.servicos_rodada)
        return epA.servicos_rodada - epB.servicos_rodada;

      // 2. Quem ficou mais tempo sem servir (rodízio principal — normalizado em 120 dias)
      const diasA = Math.min(epA.dias_ultimo_servico, 120);
      const diasB = Math.min(epB.dias_ultimo_servico, 120);
      if (diasA !== diasB) return diasB - diasA;

      // 3. Quem tem menos oportunidades futuras (protege disponibilidade restrita)
      if (epA.oportunidades_futuras !== epB.oportunidades_futuras)
        return epA.oportunidades_futuras - epB.oportunidades_futuras;

      // 4. Taxa histórica de cobertura (equidade a longo prazo, tolerância 5%)
      const taxaDiff = epA.taxa_cobertura_14d - epB.taxa_cobertura_14d;
      if (Math.abs(taxaDiff) > 0.05) return taxaDiff;

      // 5. Score do banco (desempate determinístico)
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
    taxa_cobertura_14d: 0.5,
    dias_ultimo_servico: diasUltimo,
    lastServiceDate: ultimoServico?.date ?? null,
    servicos_rodada: 0,
    oportunidades_rodada: 0,
    oportunidades_futuras: 0,
  };
}
