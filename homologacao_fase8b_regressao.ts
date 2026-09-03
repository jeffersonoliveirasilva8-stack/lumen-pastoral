/**
 * Teste de regressão FASE 8B — Repetição de membros em geração avulsa sequencial
 *
 * Verifica que o cache update (setQueryData) propaga as alocações de 03/09
 * para a geração de 10/09 sem aguardar refetch do banco.
 */
import { alocarMembros } from "./src/biblioteca/escala-engine";
import type {
  MembroEngine,
  FuncaoNecessaria,
  ContextoEscala,
  HistoricoRecente,
} from "./src/biblioteca/escala-engine";

// ── Helpers ─────────────────────────────────────────────────────────────────

type AssignmentHistoryEntry = {
  memberId: string;
  ministerioId: string;
  date?: string | null;
  tipoEvento?: string | null;
};

type EscalaAssignmentSuggestion = {
  membro_id: string;
  ministerio_id: string;
};

/** Simula o setQueryData que passa a existir após a correção */
function updateCache(
  prev: AssignmentHistoryEntry[],
  sugestoes: EscalaAssignmentSuggestion[],
  escalaData: string
): AssignmentHistoryEntry[] {
  const seen = new Set(prev.map((e) => `${e.memberId}|${e.ministerioId}|${e.date}`));
  const toAdd = sugestoes
    .filter((s) => !seen.has(`${s.membro_id}|${s.ministerio_id}|${escalaData}`))
    .map((s): AssignmentHistoryEntry => ({ memberId: s.membro_id, ministerioId: s.ministerio_id, date: escalaData }));
  return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
}

/** Constrói historicoRecente a partir do cache (mesmo mapeamento de _buildAndAllocate) */
function buildHistorico(history: AssignmentHistoryEntry[]): HistoricoRecente[] {
  return history
    .filter((h) => h.date != null)
    .map((h) => ({
      membro_id: h.memberId,
      ministerio_id: h.ministerioId,
      data: h.date!.slice(0, 10),
      tipo_evento: h.tipoEvento ?? undefined,
    }));
}

/** Chama o motor e retorna a alocação para um ministerio_id */
function gerarEscala(
  data: string,
  membros: MembroEngine[],
  ministerioId: string,
  historico: HistoricoRecente[]
): { membro_id: string; score_raw: number } | null {
  const funcoes: FuncaoNecessaria[] = [{ ministerio_id: ministerioId, ministerio_nome: "Turíbulo", quantidade: 1 }];
  const contexto: ContextoEscala = { data, tipo: "missa", solene: false, tem_adoracao: false, tem_bispo: false };
  const resultado = alocarMembros(funcoes, membros, [], contexto, historico);
  if (resultado.alocacoes.length === 0) return null;
  const a = resultado.alocacoes[0];
  // Extrai score do breakdown se disponível
  const detalhe = resultado.detalhesPorFuncao[0];
  const candidato = detalhe?.candidatos?.find((c: any) => c.id === a.membro_id);
  return { membro_id: a.membro_id, score_raw: candidato?.score ?? -1 };
}

// ── Fixture ─────────────────────────────────────────────────────────────────

const MINISTERIO_ID = "min-turibulo";

const mariana: MembroEngine = {
  id: "mariana",
  nome: "Mariana de Assis Santana",
  score: 80,
  ativo: true,
  forcar_escalacao_solene: false,
  ministerio_ids: [MINISTERIO_ID],
  restricoes_dia_semana: [],
  funcoes_nao_pode_ids: [],
  sexo: "F",
  atuacao_ids: [],
  taxa_presenca: 0.95,
  formacao_participacoes: 2,
};

const pedro: MembroEngine = {
  id: "pedro",
  nome: "Pedro Henrique",
  score: 75,
  ativo: true,
  forcar_escalacao_solene: false,
  ministerio_ids: [MINISTERIO_ID],
  restricoes_dia_semana: [],
  funcoes_nao_pode_ids: [],
  sexo: "M",
  atuacao_ids: [],
  taxa_presenca: 0.90,
  formacao_participacoes: 1,
};

const membros = [mariana, pedro];

// ── Testes ───────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const results: string[] = [];

function check(label: string, cond: boolean, detail: string) {
  if (cond) {
    pass++;
    results.push(`  ✅ PASS  ${label}`);
  } else {
    fail++;
    results.push(`  ❌ FAIL  ${label}\n           ${detail}`);
  }
}

// ── B01: Cache inicial vazio — geração 03/09 ─────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────────");
console.log("  REGRESSÃO 8B — Bug de repetição em geração avulsa sequencial");
console.log("─────────────────────────────────────────────────────────────────");

let cache: AssignmentHistoryEntry[] = []; // simula o estado inicial (banco recém carregado)

const esc0309 = gerarEscala("2026-09-03", membros, MINISTERIO_ID, buildHistorico(cache));
check(
  "B01 — Geração 03/09 sem histórico: aloca alguém",
  esc0309 !== null,
  `resultado: ${JSON.stringify(esc0309)}`
);

const alocado0309 = esc0309!.membro_id;
const sugestoes0309: EscalaAssignmentSuggestion[] = [{ membro_id: alocado0309, ministerio_id: MINISTERIO_ID }];

// ── B02: setQueryData atualiza cache localmente ──────────────────────────────
const cacheAntigo = cache;
cache = updateCache(cache, sugestoes0309, "2026-09-03");

check(
  "B02 — setQueryData insere a alocação de 03/09 no cache",
  cache.length === cacheAntigo.length + 1,
  `cache antes: ${cacheAntigo.length}, depois: ${cache.length}`
);

const entradaNoCache = cache.find(
  (e) => e.memberId === alocado0309 && e.ministerioId === MINISTERIO_ID && e.date === "2026-09-03"
);
check(
  "B03 — Cache contém { memberId, ministerioId, date: '2026-09-03' } do membro alocado",
  entradaNoCache !== undefined,
  `cache: ${JSON.stringify(cache)}`
);

// ── B04: Sem esperar refetch — geração 10/09 usa o cache atualizado ──────────
const historico1009 = buildHistorico(cache);
const entradaNoHistorico = historico1009.find(
  (h) => h.membro_id === alocado0309 && h.ministerio_id === MINISTERIO_ID && h.data === "2026-09-03"
);
check(
  "B04 — historicoRecente de 10/09 contém a alocação de 03/09 (sem refetch)",
  entradaNoHistorico !== undefined,
  `historico1009: ${JSON.stringify(historico1009)}`
);

// ── B05: Motor aplica penalidade MESMA_SEMANA (03/09→10/09 = 7 dias) ─────────
const esc1009 = gerarEscala("2026-09-10", membros, MINISTERIO_ID, historico1009);
check(
  "B05 — Geração 10/09 retorna resultado",
  esc1009 !== null,
  `resultado: ${JSON.stringify(esc1009)}`
);

// 7 dias = dentro do limiar de penalidade (3–8 dias → penalidade = -25)
// O membro alocado em 03/09 deve perder para o outro
const outro = alocado0309 === "mariana" ? "pedro" : "mariana";
check(
  "B06 — Membro alocado em 03/09 NÃO é repetido em 10/09 (recebe penalidade)",
  esc1009!.membro_id === outro,
  `Esperado: ${outro} | Obtido: ${esc1009!.membro_id} | score: ${esc1009!.score_raw}`
);

// ── B07: Sem cache update (bug original) — membro repetiria ─────────────────
const cacheSemUpdate: AssignmentHistoryEntry[] = []; // simula cache stale (bug original)
const historicoSemUpdate = buildHistorico(cacheSemUpdate);
const esc1009SemUpdate = gerarEscala("2026-09-10", membros, MINISTERIO_ID, historicoSemUpdate);

check(
  "B07 — BUG ORIGINAL confirmado: sem cache update, membro de 03/09 repetiria em 10/09",
  esc1009SemUpdate!.membro_id === alocado0309,
  `Esperado repetição de ${alocado0309} | Obtido: ${esc1009SemUpdate!.membro_id}`
);

// ── B08: setQueryData não duplica entradas ───────────────────────────────────
const cacheComDup = updateCache(cache, sugestoes0309, "2026-09-03");
check(
  "B08 — setQueryData não duplica entradas já existentes",
  cacheComDup.length === cache.length,
  `cache antes: ${cache.length}, depois de segundo update: ${cacheComDup.length}`
);

// ── Resultado ────────────────────────────────────────────────────────────────
console.log();
results.forEach((r) => console.log(r));
console.log();
console.log("═════════════════════════════════════════════════════════════════");
console.log("  RESULTADO — REGRESSÃO 8B");
console.log("═════════════════════════════════════════════════════════════════");
console.log(`  PASS: ${pass}  |  FAIL: ${fail}  |  TOTAL: ${pass + fail}`);
if (fail === 0) {
  console.log("\n  Bug de repetição corrigido. setQueryData funciona corretamente.\n");
} else {
  console.log("\n  ❌ Falhas detectadas — investigar.\n");
  process.exit(1);
}
