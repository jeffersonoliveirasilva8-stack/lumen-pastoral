// Re-exporta o engine litúrgico completo
export * from "../biblioteca/escala-engine";

// ── Tipos de interface pública ────────────────────────────────────────────────

export type EscalaEvent = {
  titulo: string;
  data: string;
  tipo: string;
  observacoes?: string | null;
};

export type EscalaMinisterio = {
  id: string;
  nome: string;
  cor?: string;
};

export type EscalaMembroInput = {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  score?: number;
  forcar_escalacao_solene?: boolean;
  restricoes_dia_semana?: number[];
  sexo?: "M" | "F" | null;
  atuacao_ids?: string[];
  prioridade_escala?: string;
};

export type EscalaFuncaoPedido = {
  ministerio_id: string;
  quantidade: number;
  ministerio: EscalaMinisterio;
  atuacoes_exigidas?: string[];
};

export type EscalaAssignmentSuggestion = {
  ministerio_id: string;
  membro_id: string;
  motivo?: string;
};

export type AssignmentHistoryEntry = {
  memberId: string;
  ministerioId: string;
  date?: string | null;
};

export type FuncaoRestricao = {
  membro_id: string;
  ministerio_id: string;
  tipo: string; // "pode" | "nao_pode"
};

// ── Tipos internos ────────────────────────────────────────────────────────────

import {
  alocarMembros,
  type MembroEngine,
  type IndisponibilidadeEngine,
  type FuncaoNecessaria,
  type ContextoEscala,
  type ConfigParoquia,
  type HistoricoRecente,
  type DetalheFuncao,
  type InsightFuncao,
} from "../biblioteca/escala-engine";

type AllocOptions = {
  history?: AssignmentHistoryEntry[];
  existingAssignments?: { membro_id: string; ministerio_id: string }[];
  indisponibilidades?: IndisponibilidadeEngine[];
  restricoes?: FuncaoRestricao[];
  config?: ConfigParoquia;
  solene?: boolean;
  tem_adoracao?: boolean;
  tem_bispo?: boolean;
  debug?: boolean;
};

// ── Logging condicional ───────────────────────────────────────────────────────

function logDebug(msg: string, debug?: boolean) {
  if (debug === true) console.log(`[ESCALA-ENGINE] ${msg}`);
}

// ── _buildAndAllocate ─────────────────────────────────────────────────────────

function _buildAndAllocate(
  evento: EscalaEvent,
  funcoes: EscalaFuncaoPedido[],
  membros: EscalaMembroInput[],
  membroMinisterios: Record<string, string[]>,
  options?: AllocOptions,
) {
  const debug = options?.debug;

  logDebug(`Evento: ${evento.titulo} | Data: ${evento.data}`, debug);
  logDebug(`Funções: ${funcoes.length} | Membros: ${membros.length} | Ministérios mapeados: ${Object.keys(membroMinisterios).length}`, debug);

  // ── Validações de entrada ──────────────────────────────────────────────────
  if (membros.length === 0) {
    return {
      alocacoes: [], alertas: ["Nenhum membro ativo cadastrado no sistema."],
      detalhesPorFuncao: [], insights: [],
    };
  }
  if (funcoes.length === 0) {
    return {
      alocacoes: [], alertas: ["Nenhuma função definida para esta escala."],
      detalhesPorFuncao: [], insights: [],
    };
  }
  if (Object.keys(membroMinisterios).length === 0) {
    return {
      alocacoes: [],
      alertas: [
        "Nenhum membro possui vínculo com funções litúrgicas. " +
        "Acesse Membros → edite cada membro → seção Funções e marque as funções que ele exerce.",
      ],
      detalhesPorFuncao: [], insights: [],
    };
  }

  const existing = new Set((options?.existingAssignments ?? []).map((a) => a.membro_id));

  // ── Inverter mapa ministerio→membros para membro→ministerios ──────────────
  const membroParaMinisterios: Record<string, string[]> = {};
  for (const [minId, mids] of Object.entries(membroMinisterios)) {
    for (const mid of mids) {
      if (!membroParaMinisterios[mid]) membroParaMinisterios[mid] = [];
      membroParaMinisterios[mid].push(minId);
    }
  }

  logDebug(`Membros com vínculos: ${Object.keys(membroParaMinisterios).length} de ${membros.length}`, debug);

  // ── DIAGNÓSTICO: membros sem nenhum vínculo ────────────────────────────────
  if (debug) {
    const semVinculo = membros.filter((m) => !membroParaMinisterios[m.id] || membroParaMinisterios[m.id].length === 0);
    if (semVinculo.length > 0) {
      console.warn(`[ENGINE] ⚠ ${semVinculo.length} membros SEM nenhum vínculo em membro_ministerios:`,
        semVinculo.map((m) => `${m.nome} (${m.id})`));
    }
    console.log("[ENGINE] membroMinisterios (ministerio→membros):", membroMinisterios);
    console.log("[ENGINE] membroParaMinisterios (membro→ministerios):", membroParaMinisterios);
  }

  const restricoes = options?.restricoes ?? [];

  const membrosEngine: MembroEngine[] = membros
    .filter((m) => !existing.has(m.id))
    .map((m) => {
      const naoPodemIds = restricoes.filter((r) => r.membro_id === m.id && r.tipo === "nao_pode").map((r) => r.ministerio_id);
      const podemIds    = restricoes.filter((r) => r.membro_id === m.id && r.tipo === "pode").map((r) => r.ministerio_id);
      const base        = membroParaMinisterios[m.id] ?? [];
      const efetivo     = [...new Set([...base, ...podemIds])];
      return {
        id: m.id,
        nome: m.nome,
        score: m.score ?? 0,
        ativo: true,
        forcar_escalacao_solene: m.forcar_escalacao_solene ?? false,
        ministerio_ids: efetivo,
        restricoes_dia_semana: m.restricoes_dia_semana ?? [],
        funcoes_nao_pode_ids: naoPodemIds,
        sexo: (m.sexo === "M" || m.sexo === "F") ? m.sexo : null,
        atuacao_ids: m.atuacao_ids ?? [],
        prioridade_escala: m.prioridade_escala,
      };
    });

  const funcoesEngine: FuncaoNecessaria[] = funcoes.map((f) => ({
    ministerio_id:    f.ministerio_id,
    ministerio_nome:  f.ministerio.nome,
    quantidade:       f.quantidade,
    atuacoes_exigidas: f.atuacoes_exigidas,
  }));

  const contexto: ContextoEscala = {
    data:         evento.data,
    tipo:         evento.tipo,
    solene:       options?.solene       ?? false,
    tem_adoracao: options?.tem_adoracao ?? false,
    tem_bispo:    options?.tem_bispo    ?? false,
  };

  const config: ConfigParoquia = options?.config ?? { usa_tochas: false };

  const historicoRecente: HistoricoRecente[] = (options?.history ?? [])
    .filter((h) => h.date != null)
    .map((h) => ({ membro_id: h.memberId, ministerio_id: h.ministerioId, data: h.date!.slice(0, 10) }));

  logDebug(`Histórico: ${historicoRecente.length} registros`, debug);

  // ── Bloqueia dupla escalação no mesmo dia em outra celebração ──────────────
  const sameDayBlocks: IndisponibilidadeEngine[] = historicoRecente
    .filter((h) => h.data === evento.data)
    .map((h) => ({ membro_id: h.membro_id, data: evento.data }));

  const indisponibilidades: IndisponibilidadeEngine[] = [
    ...(options?.indisponibilidades ?? []).map((i) => ({
      membro_id: i.membro_id,
      data: i.data.slice(0, 10),
      tipo: i.tipo,
      hora_inicio: i.hora_inicio,
      hora_fim: i.hora_fim,
      data_fim: i.data_fim,
    })),
    ...sameDayBlocks,
  ];

  logDebug(`Indisponibilidades + bloqueios mesmo dia: ${indisponibilidades.length}`, debug);

  // ── DIAGNÓSTICO: candidatos por função ────────────────────────────────────
  if (debug) {
    console.group("[ENGINE] Candidatos por função (pré-alocação)");
    for (const f of funcoesEngine) {
      const comVinculo = membrosEngine.filter((m) => m.ministerio_ids.includes(f.ministerio_id));
      const nomes = comVinculo.map((m) => m.nome);
      if (comVinculo.length === 0) {
        console.warn(`  ❌ "${f.ministerio_nome}" (${f.ministerio_id}): 0 candidatos`);
        console.warn(`     ministerio_ids conhecidos:`, Object.keys(membroMinisterios));
      } else {
        console.log(`  ✓ "${f.ministerio_nome}": ${comVinculo.length} candidato(s):`, nomes);
      }
    }
    console.groupEnd();
  }

  const resultado = alocarMembros(funcoesEngine, membrosEngine, indisponibilidades, contexto, historicoRecente, config);

  if (debug) {
    logDebug(`Resultado: ${resultado.alocacoes.length} alocações | ${resultado.alertas.length} alertas`, debug);
    resultado.alertas.forEach((a) => logDebug(`  ${a}`, debug));
    resultado.detalhesPorFuncao.forEach((d) =>
      logDebug(`  ${d.ministerio_nome}: ${d.alocados}/${d.solicitados}${d.motivo_vazio ? ` — ${d.motivo_vazio}` : ""}`, debug),
    );
  }

  return resultado;
}

// ── generateEscalaAssignments ─────────────────────────────────────────────────

export function generateEscalaAssignments(
  evento: EscalaEvent,
  funcoes: EscalaFuncaoPedido[],
  membros: EscalaMembroInput[],
  membroMinisterios: Record<string, string[]>,
  options?: AllocOptions,
): EscalaAssignmentSuggestion[] {
  const r = _buildAndAllocate(evento, funcoes, membros, membroMinisterios, options);
  return r.alocacoes.map((a) => ({ ministerio_id: a.ministerio_id, membro_id: a.membro_id }));
}

// ── generateEscalaWithAlertas ─────────────────────────────────────────────────

export type ResultadoCompleto = {
  sugestoes: EscalaAssignmentSuggestion[];
  alertas: string[];
  detalhesPorFuncao: DetalheFuncao[];
  insights: InsightFuncao[];
};

export function generateEscalaWithAlertas(
  evento: EscalaEvent,
  funcoes: EscalaFuncaoPedido[],
  membros: EscalaMembroInput[],
  membroMinisterios: Record<string, string[]>,
  options?: AllocOptions,
): ResultadoCompleto {
  const r = _buildAndAllocate(evento, funcoes, membros, membroMinisterios, options);
  return {
    sugestoes: r.alocacoes.map((a) => ({ ministerio_id: a.ministerio_id, membro_id: a.membro_id, motivo: a.motivo })),
    alertas:          r.alertas,
    detalhesPorFuncao: r.detalhesPorFuncao,
    insights:         r.insights,
  };
}
