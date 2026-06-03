// Re-exporta o engine litúrgico completo
export * from "../biblioteca/escala-engine";

// ── Tipos de compatibilidade ──────────────────────────────────────────────────

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
};

export type EscalaFuncaoPedido = {
  ministerio_id: string;
  quantidade: number;
  ministerio: EscalaMinisterio;
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
};

// ── _buildAndAllocate (interno) ───────────────────────────────────────────────
// Constrói os modelos do engine e executa a alocação.
// Centraliza a lógica compartilhada entre as duas funções públicas,
// evitando duplicação e garantindo comportamento consistente.

function _buildAndAllocate(
  evento: EscalaEvent,
  funcoes: EscalaFuncaoPedido[],
  membros: EscalaMembroInput[],
  membroMinisterios: Record<string, string[]>,
  options?: AllocOptions,
) {
  const existing = new Set(
    (options?.existingAssignments ?? []).map((a) => a.membro_id),
  );

  // Inverte o mapa ministerio→membros para membro→ministerios
  const membroParaMinisterios: Record<string, string[]> = {};
  for (const [minId, mids] of Object.entries(membroMinisterios)) {
    for (const mid of mids) {
      if (!membroParaMinisterios[mid]) membroParaMinisterios[mid] = [];
      membroParaMinisterios[mid].push(minId);
    }
  }

  const restricoes = options?.restricoes ?? [];

  const membrosEngine: MembroEngine[] = membros
    .filter((m) => !existing.has(m.id))
    .map((m) => {
      // Blocklist: ministérios em que o membro explicitamente não pode servir
      const naoPodemIds = restricoes
        .filter((r) => r.membro_id === m.id && r.tipo === "nao_pode")
        .map((r) => r.ministerio_id);

      // Allowlist: ministérios extras concedidos além do membro_ministerios normal.
      // "pode" garante permissão em ministérios fora da vinculação padrão do membro.
      const podemIds = restricoes
        .filter((r) => r.membro_id === m.id && r.tipo === "pode")
        .map((r) => r.ministerio_id);

      const ministerioIdsBase = membroParaMinisterios[m.id] ?? [];
      const ministerioIdsEfetivo = [
        ...new Set([...ministerioIdsBase, ...podemIds]),
      ];

      return {
        id: m.id,
        nome: m.nome,
        score: m.score ?? 0,
        ativo: true,
        forcar_escalacao_solene: m.forcar_escalacao_solene ?? false,
        ministerio_ids: ministerioIdsEfetivo,
        restricoes_dia_semana: m.restricoes_dia_semana ?? [],
        funcoes_nao_pode_ids: naoPodemIds,
        sexo: (m.sexo === "M" || m.sexo === "F") ? m.sexo : null,
      };
    });

  const funcoesEngine: FuncaoNecessaria[] = funcoes.map((f) => ({
    ministerio_id: f.ministerio_id,
    ministerio_nome: f.ministerio.nome,
    quantidade: f.quantidade,
  }));

  const contexto: ContextoEscala = {
    data: evento.data,
    tipo: evento.tipo,
    solene: options?.solene ?? false,
    tem_adoracao: options?.tem_adoracao ?? false,
    tem_bispo: options?.tem_bispo ?? false,
  };

  const config: ConfigParoquia = options?.config ?? { usa_tochas: false };

  const historicoRecente: HistoricoRecente[] = (options?.history ?? [])
    .filter((h) => h.date != null)
    .map((h) => ({
      membro_id: h.memberId,
      ministerio_id: h.ministerioId,
      data: h.date!.slice(0, 10),
    }));

  // ── Fix 1: bloqueio de dupla escalação no mesmo dia ───────────────────────
  // Entradas do histórico com data === evento.data representam alocações já
  // existentes em OUTRAS escalas neste mesmo dia (horários diferentes).
  // Tratá-las como indisponibilidade impede que o membro seja sugerido mais de
  // uma vez no mesmo dia calendário, tanto na geração manual quanto em lote.
  const sameDayBlocks: IndisponibilidadeEngine[] = historicoRecente
    .filter((h) => h.data === evento.data)
    .map((h) => ({ membro_id: h.membro_id, data: evento.data }));

  // ── Fix 2: normalização defensiva de datas das indisponibilidades ─────────
  // Datas vindas do Supabase podem conter componente de hora em algumas
  // configurações de timezone (ex.: "2025-06-01T00:00:00+00:00"). O motor
  // compara strings exatas; slice(0, 10) garante formato YYYY-MM-DD em
  // qualquer caso — indisponibilidades de qualquer origem são respeitadas.
  const indisponibilidades: IndisponibilidadeEngine[] = [
    ...(options?.indisponibilidades ?? []).map((i) => ({
      membro_id: i.membro_id,
      data: i.data.slice(0, 10),
    })),
    ...sameDayBlocks,
  ];

  return alocarMembros(
    funcoesEngine,
    membrosEngine,
    indisponibilidades,
    contexto,
    historicoRecente,
    config,
  );
}

// ── generateEscalaAssignments ─────────────────────────────────────────────────
// API de alto nível — retorna apenas as sugestões de alocação.

export function generateEscalaAssignments(
  evento: EscalaEvent,
  funcoes: EscalaFuncaoPedido[],
  membros: EscalaMembroInput[],
  membroMinisterios: Record<string, string[]>,
  options?: AllocOptions,
): EscalaAssignmentSuggestion[] {
  const resultado = _buildAndAllocate(evento, funcoes, membros, membroMinisterios, options);
  return resultado.alocacoes.map((a) => ({
    ministerio_id: a.ministerio_id,
    membro_id: a.membro_id,
  }));
}

// ── generateEscalaWithAlertas ─────────────────────────────────────────────────
// Igual a generateEscalaAssignments, mas também devolve os alertas do motor.

export function generateEscalaWithAlertas(
  evento: EscalaEvent,
  funcoes: EscalaFuncaoPedido[],
  membros: EscalaMembroInput[],
  membroMinisterios: Record<string, string[]>,
  options?: AllocOptions,
): { sugestoes: EscalaAssignmentSuggestion[]; alertas: string[] } {
  const resultado = _buildAndAllocate(evento, funcoes, membros, membroMinisterios, options);
  return {
    sugestoes: resultado.alocacoes.map((a) => ({
      ministerio_id: a.ministerio_id,
      membro_id: a.membro_id,
      motivo: a.motivo,
    })),
    alertas: resultado.alertas,
  };
}
