/**
 * Homologação FASE 9 — Motor de Cobertura e Distribuição Pastoral
 *
 * Verifica que o seletor pastoral garante equidade de cobertura,
 * prioriza membros em urgência estrutural, e respeita restrições.
 *
 * Execução: npx ts-node --project tsconfig.node.json homologacao_fase9.ts
 */

import {
  selecionarMembrosPastoral,
  calcularUrgencia,
  urgenciaNivel,
  inicializarEstadoPastoral,
  type EstadoPastoral,
  type MembroPastoral,
  type FuncaoPastoral,
  type RestricaoFuncao,
} from "./src/biblioteca/pastoral-distribuicao";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ep(overrides: Partial<EstadoPastoral> & { membro_id: string }): EstadoPastoral {
  return {
    servicos_14d: 0,
    oportunidades_14d: 0,
    taxa_cobertura_14d: 0,
    dias_ultimo_servico: 0,
    servicos_rodada: 0,
    oportunidades_rodada: 0,
    oportunidades_futuras: 5,
    ...overrides,
  };
}

function membro(id: string, score = 100): MembroPastoral {
  return { id, score, restricoes_dia_semana: [] };
}

function funcao(ministerio_id: string, quantidade = 1): FuncaoPastoral {
  return { ministerio_id, quantidade };
}

const MIN_A = "min-a";
const MIN_B = "min-b";

// Todos os membros estão vinculados a MIN_A por padrão
function vinculos(memberIds: string[], ministerioId = MIN_A): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const id of memberIds) result[id] = [ministerioId];
  return result;
}

function selecionar(params: {
  funcoes: FuncaoPastoral[];
  membros: MembroPastoral[];
  estados: Map<string, EstadoPastoral>;
  ministerios?: Record<string, string[]>;
  indisp?: { membro_id: string; data: string }[];
  restricoes?: RestricaoFuncao[];
  data?: string;
}): { membro_id: string; ministerio_id: string }[] {
  const memberIds = params.membros.map((m) => m.id);
  return selecionarMembrosPastoral({
    funcoes: params.funcoes,
    membros: params.membros,
    estadosPastorais: params.estados,
    membroMinisterios: params.ministerios ?? vinculos(memberIds),
    indisponibilidades: params.indisp ?? [],
    restricoes: params.restricoes ?? [],
    celData: params.data ?? "2026-09-07",
  });
}

// ── Harness ──────────────────────────────────────────────────────────────────

let total = 0;
let pass = 0;
const falhas: string[] = [];

function assert(label: string, condition: boolean, detalhe = "") {
  total++;
  if (condition) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    falhas.push(`${label}${detalhe ? " — " + detalhe : ""}`);
    console.log(`  ❌ ${label}${detalhe ? " — " + detalhe : ""}`);
  }
}

// ── C01: Urgência crítica tem prioridade absoluta sobre baixa ─────────────────
console.log("\nC01 — Urgência crítica precede urgência baixa");
{
  const m1 = membro("m1"); // urgência baixa: serviu ontem
  const m2 = membro("m2"); // urgência crítica: 15 dias sem servir, taxa < 30%

  const estados = new Map([
    ["m1", ep({ membro_id: "m1", dias_ultimo_servico: 1, taxa_cobertura_14d: 0.9, servicos_rodada: 2 })],
    ["m2", ep({ membro_id: "m2", dias_ultimo_servico: 15, taxa_cobertura_14d: 0.2, servicos_rodada: 0 })],
  ]);

  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros: [m1, m2], estados });
  assert("C01.1 — seleciona m2 (urgência crítica)", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C02: Menos serviços na rodada = maior prioridade (mesmo nível de urgência) ─
console.log("\nC02 — Menos serviços na rodada = maior prioridade");
{
  const membros = [membro("m1"), membro("m2"), membro("m3")];
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", servicos_rodada: 3, taxa_cobertura_14d: 0.5, dias_ultimo_servico: 5 })],
    ["m2", ep({ membro_id: "m2", servicos_rodada: 0, taxa_cobertura_14d: 0.5, dias_ultimo_servico: 5 })],
    ["m3", ep({ membro_id: "m3", servicos_rodada: 1, taxa_cobertura_14d: 0.5, dias_ultimo_servico: 5 })],
  ]);
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados });
  assert("C02.1 — seleciona m2 (0 serviços na rodada)", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C03: Taxa de cobertura histórica baixa = maior prioridade ─────────────────
console.log("\nC03 — Taxa de cobertura histórica baixa = maior prioridade");
{
  const membros = [membro("m1"), membro("m2")];
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", servicos_rodada: 0, taxa_cobertura_14d: 0.8, dias_ultimo_servico: 5 })],
    ["m2", ep({ membro_id: "m2", servicos_rodada: 0, taxa_cobertura_14d: 0.2, dias_ultimo_servico: 5 })],
  ]);
  // taxa_cobertura_14d difere em > 5% → critério 3 ativo
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados });
  assert("C03.1 — seleciona m2 (taxa cobertura 20% < 80%)", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C04: Oportunidades futuras escassas = maior prioridade ────────────────────
console.log("\nC04 — Membro com poucas oportunidades futuras tem prioridade");
{
  const membros = [membro("m1"), membro("m2")];
  const estados = new Map([
    // Ambos iguais exceto oportunidades_futuras — taxa_cobertura_14d igual (tolerância 5%)
    ["m1", ep({ membro_id: "m1", servicos_rodada: 1, taxa_cobertura_14d: 0.5, oportunidades_futuras: 10 })],
    ["m2", ep({ membro_id: "m2", servicos_rodada: 1, taxa_cobertura_14d: 0.5, oportunidades_futuras: 1 })],
  ]);
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados });
  assert("C04.1 — seleciona m2 (1 oportunidade futura vs 10)", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C05: Dias sem servir desempata quando tudo mais é igual ──────────────────
console.log("\nC05 — Dias sem servir como tiebreaker");
{
  const membros = [membro("m1"), membro("m2")];
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", servicos_rodada: 1, taxa_cobertura_14d: 0.5, oportunidades_futuras: 5, dias_ultimo_servico: 3 })],
    ["m2", ep({ membro_id: "m2", servicos_rodada: 1, taxa_cobertura_14d: 0.5, oportunidades_futuras: 5, dias_ultimo_servico: 12 })],
  ]);
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados });
  assert("C05.1 — seleciona m2 (12 dias sem servir > 3)", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C06: Score do banco como último tiebreaker ────────────────────────────────
console.log("\nC06 — Score do banco é último tiebreaker");
{
  const membros = [membro("m1", 50), membro("m2", 200)];
  const estadoIgual = { servicos_rodada: 1, taxa_cobertura_14d: 0.5, oportunidades_futuras: 5, dias_ultimo_servico: 7 };
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", ...estadoIgual })],
    ["m2", ep({ membro_id: "m2", ...estadoIgual })],
  ]);
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados });
  assert("C06.1 — seleciona m2 (score 200 > 50)", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C07: Membro indisponível não é selecionado ────────────────────────────────
console.log("\nC07 — Indisponibilidade bloqueia seleção");
{
  const membros = [membro("m1"), membro("m2")];
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", dias_ultimo_servico: 20, taxa_cobertura_14d: 0.1 })],
    ["m2", ep({ membro_id: "m2", dias_ultimo_servico: 2, taxa_cobertura_14d: 0.8 })],
  ]);
  const indisp = [{ membro_id: "m1", data: "2026-09-07" }];
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados, indisp });
  assert("C07.1 — m1 indisponível é ignorado", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
  assert("C07.2 — somente 1 resultado", resultado.length === 1,
    `total: ${resultado.length}`);
}

// ── C08: Restrição "nao_pode" para ministério bloqueia ───────────────────────
console.log("\nC08 — Restrição nao_pode bloqueia para o ministério específico");
{
  const membros = [membro("m1"), membro("m2")];
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", dias_ultimo_servico: 20, taxa_cobertura_14d: 0.1 })],
    ["m2", ep({ membro_id: "m2", dias_ultimo_servico: 2 })],
  ]);
  const restricoes: RestricaoFuncao[] = [{ membro_id: "m1", ministerio_id: MIN_A, tipo: "nao_pode" }];
  const resultado = selecionar({ funcoes: [funcao(MIN_A)], membros, estados, restricoes });
  assert("C08.1 — m1 com nao_pode é ignorado", resultado[0]?.membro_id === "m2",
    `selecionado: ${resultado[0]?.membro_id}`);
}

// ── C09: Membro não é selecionado duas vezes na mesma missa ──────────────────
console.log("\nC09 — Membro não duplicado na mesma missa (dois ministérios)");
{
  const m1 = membro("m1");
  const m2 = membro("m2");
  // m1 vinculado a MIN_A e MIN_B, m2 apenas MIN_B
  const ministerios: Record<string, string[]> = {
    "m1": [MIN_A, MIN_B],
    "m2": [MIN_B],
  };
  const estados = new Map([
    ["m1", ep({ membro_id: "m1", dias_ultimo_servico: 20, taxa_cobertura_14d: 0.1 })],
    ["m2", ep({ membro_id: "m2", dias_ultimo_servico: 2 })],
  ]);
  const resultado = selecionar({
    funcoes: [funcao(MIN_A, 1), funcao(MIN_B, 1)],
    membros: [m1, m2],
    estados,
    ministerios,
  });
  const m1Count = resultado.filter((r) => r.membro_id === "m1").length;
  assert("C09.1 — m1 escalado no máximo uma vez", m1Count <= 1,
    `m1 aparece ${m1Count} vezes`);
  assert("C09.2 — total = 2 alocações (um por ministério)", resultado.length === 2,
    `total: ${resultado.length}`);
}

// ── C10: calcularUrgencia classifica corretamente os 4 níveis ────────────────
console.log("\nC10 — calcularUrgencia retorna nível correto em todos os casos");
{
  const critico = ep({ membro_id: "x", dias_ultimo_servico: 15, taxa_cobertura_14d: 0.2, oportunidades_futuras: 5 });
  const alto1   = ep({ membro_id: "x", dias_ultimo_servico: 11, taxa_cobertura_14d: 0.6, oportunidades_futuras: 5 });
  const alto2   = ep({ membro_id: "x", dias_ultimo_servico: 5, taxa_cobertura_14d: 0.4, oportunidades_futuras: 5 });
  const alto3   = ep({ membro_id: "x", dias_ultimo_servico: 5, taxa_cobertura_14d: 0.6, oportunidades_futuras: 1 });
  const normal  = ep({ membro_id: "x", dias_ultimo_servico: 5, taxa_cobertura_14d: 0.6, servicos_rodada: 0, oportunidades_futuras: 5 });
  const baixo   = ep({ membro_id: "x", dias_ultimo_servico: 5, taxa_cobertura_14d: 0.6, servicos_rodada: 2, oportunidades_futuras: 5 });

  assert("C10.1 — critico: 15d + taxa 20%", calcularUrgencia(critico) === "critica");
  assert("C10.2 — alto: 11d sem servir",     calcularUrgencia(alto1)   === "alta");
  assert("C10.3 — alto: taxa 40%",           calcularUrgencia(alto2)   === "alta");
  assert("C10.4 — alto: 1 oportunidade",     calcularUrgencia(alto3)   === "alta");
  assert("C10.5 — normal: sem servir na rodada", calcularUrgencia(normal) === "normal");
  assert("C10.6 — baixo: serviu na rodada",  calcularUrgencia(baixo)   === "baixa");

  const niveis = [
    urgenciaNivel("critica"), urgenciaNivel("alta"),
    urgenciaNivel("normal"),  urgenciaNivel("baixa"),
  ];
  assert("C10.7 — níveis em ordem crescente", niveis[0] < niveis[1] && niveis[1] < niveis[2] && niveis[2] < niveis[3]);
}

// ── Resultado ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`FASE 9: ${pass}/${total} cenários PASS`);
if (falhas.length > 0) {
  console.log("\nFALHAS:");
  falhas.forEach((f) => console.log(`  ❌ ${f}`));
  process.exit(1);
} else {
  console.log("Todos os cenários PASS ✅");
}
