/**
 * FASE 8 — Homologação do Motor de Escalas
 * 18 cenários de comportamento pastoral e técnico.
 *
 * Execução: npx tsx homologacao_fase8.ts
 */

import { alocarMembros } from "@/biblioteca/escala-engine";
import type {
  MembroEngine,
  FuncaoNecessaria,
  HistoricoRecente,
  ContextoEscala,
  ConfigParoquia,
} from "@/biblioteca/escala-engine";

// ── Helpers ───────────────────────────────────────────────────────────────────

let totalPass = 0, totalFail = 0;
const falhas: string[] = [];

function ok(n: number, titulo: string, cond: boolean, ev: string) {
  const lbl = `C${String(n).padStart(2, "0")} — ${titulo}`;
  if (cond) { totalPass++; console.log(`  ✅ PASS  ${lbl}`); }
  else {
    totalFail++; falhas.push(lbl);
    console.log(`  ❌ FAIL  ${lbl}`);
    console.log(`     Evidência: ${ev}`);
  }
}

function secao(t: string) { console.log(`\n${"─".repeat(65)}\n  ${t}\n${"─".repeat(65)}`); }

// Fábrica de objetos

const MIN_A = "min-acolito";
const MIN_N = "min-naveta";
const MIN_P = "min-principal";

function mb(id: string, o: Partial<MembroEngine> = {}): MembroEngine {
  return { id, nome: `Mb ${id}`, score: 100, ativo: true, ministerio_ids: [MIN_A], taxa_presenca: 1.0, ...o };
}

function fn(mid: string, o: Partial<FuncaoNecessaria> = {}): FuncaoNecessaria {
  return { ministerio_id: mid, ministerio_nome: mid, quantidade: 1, relevancia: "normal", ...o };
}

function hist(membro_id: string, data: string, ministerio_id = MIN_A, tipo_evento?: string): HistoricoRecente {
  return { membro_id, ministerio_id, data, tipo_evento };
}

function ctx(data: string, solene = false): ContextoEscala {
  return { data, tipo: "missa", solene, tem_adoracao: false, tem_bispo: false };
}

const HOJE  = "2026-09-02";
const H30   = "2026-08-03";
const H60   = "2026-07-04";
const H90   = "2026-06-04";
const ONTEM = "2026-09-01";

// ──────────────────────────────────────────────────────────────────────────────
// BLOCO 1 — EQUIDADE
// ──────────────────────────────────────────────────────────────────────────────

secao("BLOCO 1 — EQUIDADE (C01–C03)");

// C01: Quem ficou mais tempo sem servir recebe prioridade
{
  const mA = mb("A"); // serviu ontem
  const mB = mb("B"); // serviu há 60 dias
  const h: HistoricoRecente[] = [hist("A", ONTEM), hist("B", H60)];
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(1, "Quem ficou mais tempo sem servir recebe prioridade",
    escolhido === "B",
    `Esperado B (60d sem servir) | Obtido: ${escolhido ?? "ninguém"}`
  );
}

// C02: CAP_DIAS_SEM_SERVIR=120 — acima do cap, tiebreaker é determinístico
{
  const mA = mb("A"); const mB = mb("B");
  // ambos acima de 120 dias
  const h: HistoricoRecente[] = [hist("A", "2026-05-04"), hist("B", "2026-04-30")];
  const r1 = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h);
  const r2 = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h);
  const e1 = r1.alocacoes[0]?.membro_id;
  const e2 = r2.alocacoes[0]?.membro_id;
  ok(2, "CAP=120: tiebreaker determinístico acima do cap",
    e1 === e2 && !!e1,
    `Exec 1: ${e1} | Exec 2: ${e2}`
  );
}

// C03: Normalização por nº de ministérios
// mA: 4 escalas em 1 ministério (ratio=4)
// mB: 4 escalas em 4 ministérios (ratio=1) → deve ter prioridade
{
  const mA = mb("A", { ministerio_ids: [MIN_A] });
  const mB = mb("B", { ministerio_ids: [MIN_A, "m2", "m3", "m4"] });
  const h: HistoricoRecente[] = [
    hist("A", H90), hist("A", H60), hist("A", H30), hist("A", "2026-08-20"),
    hist("B", H90), hist("B", H60), hist("B", H30), hist("B", "2026-08-20"),
  ];
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(3, "Normalização: ratio=1 (B, 4 ministerios) tem prioridade sobre ratio=4 (A, 1 ministerio)",
    escolhido === "B",
    `A(ratio=4/1=4) B(ratio=4/4=1) — Obtido: ${escolhido ?? "ninguém"}`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BLOCO 2 — PRESENÇA
// ──────────────────────────────────────────────────────────────────────────────

secao("BLOCO 2 — PRESENÇA (C04–C06)");

// C04: Membro com taxa < 60% → Pool2 em missa comum
// mA (100% presença, serviu há 30d) deve vencer mB (40% presença, nunca serviu)
// porque mB vai para Pool2 — apesar de ter mais "tempo sem servir"
{
  const mA = mb("A", { taxa_presenca: 1.0 });
  const mB = mb("B", { taxa_presenca: 0.40 });
  const h: HistoricoRecente[] = [hist("A", H30)]; // mB nunca serviu
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(4, "Presença <60% → Pool2 em missa comum (mesmo com mais tempo sem servir)",
    escolhido === "A",
    `mA(100%,30d) vs mB(40%,365d) — Obtido: ${escolhido ?? "ninguém"}`
  );
}

// C05: Pool1 vazio → Pool2 é acionado (membro com baixa presença não é excluído)
{
  const mB = mb("B", { taxa_presenca: 0.40 }); // único candidato, vai para Pool2
  const r = alocarMembros([fn(MIN_A)], [mB], [], ctx(HOJE), []);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(5, "Pool1 vazio: Pool2 (taxa<60%) é acionado como fallback (não excluído)",
    escolhido === "B",
    `Obtido: ${escolhido ?? "NINGUÉM — erro: foi excluído em vez de ser rebaixado para Pool2"}`
  );
}

// C06: Em solenidade, filtro de presença <60% NÃO se aplica
// mB (40%, nunca serviu) deve vencer mA (100%, serviu há 30d) em solenidade
{
  const mA = mb("A", { taxa_presenca: 1.0 });
  const mB = mb("B", { taxa_presenca: 0.40 });
  const h: HistoricoRecente[] = [hist("A", H30)];
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE, true), h);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(6, "Solenidade: filtro de presença <60% NÃO se aplica (equidade usa tempo sem servir)",
    escolhido === "B",
    `mB(40%, 365d) em solenidade — Obtido: ${escolhido ?? "ninguém"}`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BLOCO 3 — SOLENIDADES
// ──────────────────────────────────────────────────────────────────────────────

secao("BLOCO 3 — SOLENIDADES (C07–C09)");

// C07: relevancia="principal" em solenidade → modo mérito (experiência vence)
{
  const mA = mb("A", { ministerio_ids: [MIN_P], taxa_presenca: 1.0 });
  const mB = mb("B", { ministerio_ids: [MIN_P], taxa_presenca: 1.0 });
  // mB tem 10 experiências na função principal
  // Sem tipo_evento:"solene" — o pool1b detecta "serviu na última solenidade" por esse campo.
  // Aqui queremos testar apenas mérito/scoring, não rodízio de solenidades.
  const h: HistoricoRecente[] = Array.from({ length: 10 }, (_, i) => ({
    membro_id: "B",
    ministerio_id: MIN_P,
    data: `2026-0${Math.min(8, 3 + Math.floor(i / 3))}-${String((i % 20) + 1).padStart(2, "0")}`,
  }));
  const r = alocarMembros([fn(MIN_P, { relevancia: "principal" })], [mA, mB], [], ctx(HOJE, true), h);
  const escolhido = r.alocacoes[0]?.membro_id;
  const modo = r.insights[0]?.escolhidos[0]?.breakdown?.modo;
  ok(7, "Solenidade função principal: scoring de mérito (B com 10 exp. vence A com 0)",
    escolhido === "B" && modo === "solene_principal",
    `Obtido: ${escolhido ?? "ninguém"} | modo: ${modo ?? "?"}`
  );
}

// C08: relevancia="normal" em solenidade → modo equidade, NÃO mérito
// mA sem experiência (365d sem servir) vs mB com 8 experiências recentes
{
  const mA = mb("A", { ministerio_ids: [MIN_N] });
  const mB = mb("B", { ministerio_ids: [MIN_N] });
  const h: HistoricoRecente[] = Array.from({ length: 8 }, (_, i) => ({
    membro_id: "B", ministerio_id: MIN_N,
    data: `2026-0${5 + Math.floor(i / 4)}-${String((i % 28) + 1).padStart(2, "0")}`,
  }));
  const r = alocarMembros([fn(MIN_N, { relevancia: "normal" })], [mA, mB], [], ctx(HOJE, true), h);
  const escolhido = r.alocacoes[0]?.membro_id;
  const modo = r.insights[0]?.escolhidos[0]?.breakdown?.modo;
  ok(8, "Naveta (relevancia=normal) em solenidade: modo equidade, não mérito",
    escolhido === "A" && modo === "comum",
    `mA(0exp,365d) vs mB(8exp recentes) — Obtido: ${escolhido ?? "ninguém"} | modo: ${modo ?? "?"}`
  );
}

// C09: Restrição de dia da semana aplicada em solenidade (P0-4)
{
  const dataQuarta = "2026-09-02"; // quarta-feira
  const diaQuarta = new Date(dataQuarta + "T12:00:00").getDay(); // 3
  const mA = mb("A", { ministerio_ids: [MIN_A] });
  const mB = mb("B", { ministerio_ids: [MIN_A], restricoes_dia_semana: [diaQuarta] });
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(dataQuarta, true), []);
  const escolhido = r.alocacoes[0]?.membro_id;
  const alocouB = r.alocacoes.some((a) => a.membro_id === "B");
  ok(9, "Restrição dia semana respeitada em solenidade (P0-4 corrigido)",
    escolhido === "A" && !alocouB,
    `mB restrito na quarta — Obtido: ${escolhido ?? "ninguém"} | mB alocado: ${alocouB}`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BLOCO 4 — DETERMINISMO
// ──────────────────────────────────────────────────────────────────────────────

secao("BLOCO 4 — DETERMINISMO (C10–C11)");

// C10: 3 execuções idênticas → mesmo resultado
{
  const membros = [
    mb("A", { taxa_presenca: 0.90 }), mb("B", { taxa_presenca: 0.85 }),
    mb("C", { taxa_presenca: 0.80 }), mb("D", { taxa_presenca: 0.75 }),
  ];
  const h: HistoricoRecente[] = [hist("A", H30), hist("B", H60), hist("C", H90)];
  const f = [fn(MIN_A, { quantidade: 2 })];
  const ids = (n: number) =>
    alocarMembros(f, membros, [], ctx(HOJE), h).alocacoes.map((a) => a.membro_id).sort().join(",");
  const [r1, r2, r3] = [ids(1), ids(2), ids(3)];
  ok(10, "Determinismo: 3 execuções idênticas → mesmo resultado",
    r1 === r2 && r2 === r3,
    `Exec1:[${r1}] Exec2:[${r2}] Exec3:[${r3}]`
  );
}

// C11: 50 execuções stress-test
{
  const membros = Array.from({ length: 8 }, (_, i) => mb(`m${i}`, { taxa_presenca: Math.max(0.6, 0.95 - i * 0.05) }));
  const h: HistoricoRecente[] = membros.map((m, i) =>
    hist(m.id, `2026-0${Math.max(1, 8 - Math.floor(i / 3))}-01`)
  );
  const f = [fn(MIN_A, { quantidade: 3 })];
  const ref = alocarMembros(f, membros, [], ctx(HOJE), h).alocacoes.map((a) => a.membro_id).sort().join(",");
  const divergentes = Array.from({ length: 50 }, () =>
    alocarMembros(f, membros, [], ctx(HOJE), h).alocacoes.map((a) => a.membro_id).sort().join(",")
  ).filter((r) => r !== ref);
  ok(11, "Determinismo stress: 50 execuções sem divergência",
    divergentes.length === 0,
    `Ref:[${ref}] | Divergentes: ${divergentes.length}/50`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BLOCO 5 — LIMITES
// ──────────────────────────────────────────────────────────────────────────────

secao("BLOCO 5 — LIMITES (C12–C14)");

// C12: Limite semanal → acima do limite vai para Pool2
{
  const mA = mb("A"); const mB = mb("B");
  const h: HistoricoRecente[] = [hist("A", ONTEM)]; // mA serviu ontem
  const cfg: ConfigParoquia = { limite_semanal: 1 };
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h, cfg);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(12, "Limite semanal=1: mA (serviu ontem) vai para Pool2, mB é escolhido",
    escolhido === "B",
    `mA serviu ontem (limite=1) — Obtido: ${escolhido ?? "ninguém"}`
  );
}

// C13: Limite mensal → acima do limite vai para Pool3
{
  const mA = mb("A"); const mB = mb("B");
  const h: HistoricoRecente[] = [hist("A", H30), hist("A", "2026-08-15")]; // 2 no mês
  const cfg: ConfigParoquia = { limite_mensal: 2 };
  const r = alocarMembros([fn(MIN_A)], [mA, mB], [], ctx(HOJE), h, cfg);
  const escolhido = r.alocacoes[0]?.membro_id;
  ok(13, "Limite mensal=2: mA (2x no mês) vai para Pool3, mB é escolhido",
    escolhido === "B",
    `mA serviu 2x no mês (limite=2) — Obtido: ${escolhido ?? "ninguém"}`
  );
}

// C14: Pool3 é último recurso — acionado quando Pool1/Pool2 estão esgotados
{
  const mA = mb("A"); // Pool1 (normal)
  const mB = mb("B"); // Pool3 (acima limite mensal)
  const h: HistoricoRecente[] = [hist("B", H30), hist("B", "2026-08-15")];
  const cfg: ConfigParoquia = { limite_mensal: 2 };
  // 2 vagas: Pool1 tem só mA, Pool3 tem só mB → ambos devem ser escolhidos
  const r = alocarMembros([fn(MIN_A, { quantidade: 2 })], [mA, mB], [], ctx(HOJE), h, cfg);
  const alocados = r.alocacoes.map((a) => a.membro_id);
  ok(14, "Pool3 como último recurso: acionado quando Pool1 insuficiente",
    alocados.includes("A") && alocados.includes("B"),
    `2 vagas: Pool1={A}, Pool3={B} — Alocados: [${alocados.join(",")}]`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BLOCO 6 — AVALIAÇÃO DE PARTICIPAÇÃO
// ──────────────────────────────────────────────────────────────────────────────

secao("BLOCO 6 — AVALIAÇÃO DE PARTICIPAÇÃO (C15–C18)");

// Funções extraídas da página (replicadas aqui para teste isolado)
function statusMembro(conv: number, taxa: number) {
  if (conv === 0) return "sem_escalas";
  if (conv >= 5 && taxa < 60) return "risco";
  return "ok";
}

function calcGini(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (!sum || !n) return 0;
  let num = 0;
  for (let i = 0; i < n; i++) num += (2 * (i + 1) - n - 1) * sorted[i];
  return Math.round((num / (n * sum)) * 100) / 100;
}

// C15: 0 convocações → "sem_escalas"
{
  const s = statusMembro(0, 0);
  ok(15, "statusMembro: 0 conv → 'sem_escalas'",
    s === "sem_escalas", `Obtido: ${s}`
  );
}

// C16: edge cases de status
{
  const casos = [
    { conv: 5,  taxa: 59, esp: "risco" },
    { conv: 12, taxa: 25, esp: "risco" },
    { conv: 4,  taxa: 50, esp: "ok" },   // <5 conv → ok (não é risco ainda)
    { conv: 5,  taxa: 60, esp: "ok" },   // taxa=60 → ok (limiar é < 60)
    { conv: 1,  taxa: 0,  esp: "ok" },   // 1 conv, independente de taxa → ok
  ];
  const erros = casos.filter((c) => statusMembro(c.conv, c.taxa) !== c.esp);
  ok(16, "statusMembro: edge cases (conv<5, taxa=60, 1 conv)",
    erros.length === 0,
    erros.map((e) => `conv=${e.conv} taxa=${e.taxa}: esp=${e.esp} got=${statusMembro(e.conv, e.taxa)}`).join(" | ")
  );
}

// C17: calcGini — distribuição uniforme ≈ 0, extremo ≈ > 0.80
{
  const gUni = calcGini(Array.from({ length: 10 }, () => 5));
  const gExt = calcGini([0, 0, 0, 0, 0, 0, 0, 0, 0, 50]);
  ok(17, `calcGini: uniforme=${gUni} (esperado 0), extremo=${gExt} (esperado ≥0.80)`,
    gUni === 0 && gExt >= 0.80,
    `Uniforme: ${gUni} | Extremo: ${gExt}`
  );
}

// C18: Verificação estrutural da página — sem pódio/Trophy/Star, com calcGini+statusMembro
{
  const { readFileSync } = await import("fs");
  const src = readFileSync("src/routes/_authenticated/ranking.tsx", "utf8");
  const semPodio = !src.includes("AdminPodiumPillar") && !src.includes("PODIUM") && !src.includes("Trophy");
  const semStar  = !src.includes("<Star ");
  const comEquidade = src.includes("calcGini") && src.includes("statusMembro");
  ok(18, "Página sem pódio/Trophy/Star; com calcGini e statusMembro",
    semPodio && semStar && comEquidade,
    `Pódio: ${!semPodio} | Star: ${!semStar} | Equidade: ${comEquidade}`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// RESULTADO FINAL
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(65)}`);
console.log("  RESULTADO FINAL — FASE 8 HOMOLOGAÇÃO");
console.log("═".repeat(65));
console.log(`  PASS: ${totalPass}  |  FAIL: ${totalFail}  |  TOTAL: ${totalPass + totalFail}`);

if (falhas.length > 0) {
  console.log(`\n  Cenários reprovados:`);
  falhas.forEach((f) => console.log(`    ❌ ${f}`));
  console.log();
  process.exit(1);
} else {
  console.log(`\n  Todos os cenários aprovados. Motor homologado.\n`);
}
