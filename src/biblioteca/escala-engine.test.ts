/**
 * escala-engine.test.ts
 * Testes unitários do motor de escalas V3 — cenários de homologação
 *
 * Execução: npx vitest run src/biblioteca/escala-engine.test.ts
 * (requer: npm i -D vitest)
 */

// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — instalar vitest: npm i -D vitest
import { describe, it, expect } from "vitest";
import { alocarMembros } from "./escala-engine";
import type { FuncaoNecessaria, MembroEngine, IndisponibilidadeEngine, ContextoEscala } from "./escala-engine";

// ── Fixtures ────────────────────────────────────────────────────────────────

const contexto: ContextoEscala = {
  data: "2026-07-06",
  tipo: "missa",
  solene: false,
  tem_bispo: false,
  tem_adoracao: false,
};

function membro(id: string, nome: string, ministerio_id: string, sexo: "M" | "F" | null = "M"): MembroEngine {
  return {
    id,
    nome,
    ativo: true,
    ministerio_ids: [ministerio_id],
    sexo,
    score: 50,
    prioridade_escala: "nenhuma",
    forcar_escalacao_solene: false,
    restricoes_dia_semana: [],
    funcoes_nao_pode_ids: [],
    atuacao_ids: [],
  };
}

function funcao(ministerio_id: string, quantidade: number): FuncaoNecessaria {
  return {
    ministerio_id,
    ministerio_nome: `Função ${ministerio_id}`,
    quantidade,
  };
}

const MIN_A = "00000000-0000-0000-0000-000000000001";

// ── 1. INCOMPATIBILIDADE ─────────────────────────────────────────────────────

describe("Regra: incompatibilidade entre membros", () => {
  const joao  = membro("id-joao",  "João",  MIN_A, "M");
  const pedro = membro("id-pedro", "Pedro", MIN_A, "M");
  const maria = membro("id-maria", "Maria", MIN_A, "F");

  const incompatMap = new Map<string, Set<string>>([
    ["id-joao",  new Set(["id-pedro"])],
    ["id-pedro", new Set(["id-joao"])],
  ]);

  it("João e Pedro não devem ser alocados juntos na mesma função", () => {
    const resultado = alocarMembros(
      [funcao(MIN_A, 2)],
      [joao, pedro, maria],
      [], contexto, [], undefined, [], incompatMap,
    );

    const alocadosIds = resultado.alocacoes.map((a) => a.membro_id);
    // Nunca devem aparecer juntos
    const ambos = alocadosIds.includes("id-joao") && alocadosIds.includes("id-pedro");
    expect(ambos).toBe(false);
    // Deve alocar 2 membros (um deles + maria)
    expect(alocadosIds.length).toBe(2);
  });

  it("João e Pedro não devem ser alocados juntos em funções diferentes", () => {
    const MIN_B = "00000000-0000-0000-0000-000000000002";
    const joaoB  = { ...joao,  ministerio_ids: [MIN_A] };
    const pedroB = { ...pedro, ministerio_ids: [MIN_B] };
    const mariaB = { ...maria, ministerio_ids: [MIN_A, MIN_B] };

    const resultado = alocarMembros(
      [funcao(MIN_A, 1), funcao(MIN_B, 1)],
      [joaoB, pedroB, mariaB],
      [], contexto, [], undefined, [], incompatMap,
    );

    const alocadosIds = resultado.alocacoes.map((a) => a.membro_id);
    const ambos = alocadosIds.includes("id-joao") && alocadosIds.includes("id-pedro");
    expect(ambos).toBe(false);
  });
});

// ── 2. DISTRIBUIÇÃO DE GÊNERO GLOBAL ─────────────────────────────────────────

describe("Regra: distribuição de gênero — cálculo global entre pools", () => {
  // Pool1 (sem limite): 5 mulheres + 1 homem
  // Pool2 (acima semanal, mas ainda usável): 3 homens + 1 mulher
  // Meta: 50% M / 50% F, 8 vagas → esperado 4H + 4F

  it("Deve atingir 4H+4F com pool1=[5F+1H] e pool2=[3H+1F]", () => {
    const config = {
      distribuicao_masc_pct: 50,
      // limite_semanal = 0 força pool1 para todos sem histórico
      limite_semanal: undefined,
      limite_mensal: undefined,
    };

    // 5 mulheres + 1 homem com score alto (pool1)
    const membros: MembroEngine[] = [
      membro("f1", "F1", MIN_A, "F"),
      membro("f2", "F2", MIN_A, "F"),
      membro("f3", "F3", MIN_A, "F"),
      membro("f4", "F4", MIN_A, "F"),
      membro("f5", "F5", MIN_A, "F"),
      membro("h1", "H1", MIN_A, "M"),
      // pool2 — terão histórico para cair em pool2
      membro("h2", "H2", MIN_A, "M"),
      membro("h3", "H3", MIN_A, "M"),
      membro("h4", "H4", MIN_A, "M"),
      membro("f6", "F6", MIN_A, "F"),
    ];

    // Simular H2/H3/H4/F6 como "acima do limite semanal" via histórico
    const historico = ["h2", "h3", "h4", "f6"].map((id) => ({
      membro_id: id,
      ministerio_id: MIN_A,
      data: "2026-07-04", // 2 dias antes — dentro da janela semanal (6 dias)
      paroquia_id: "par",
    }));

    const resultado = alocarMembros(
      [funcao(MIN_A, 8)],
      membros,
      [], contexto, historico, config, [], undefined,
    );

    const alocacoes = resultado.alocacoes;
    expect(alocacoes.length).toBe(8);

    const masc = alocacoes.filter((a) =>
      membros.find((m) => m.id === a.membro_id)?.sexo === "M"
    ).length;
    const fem = alocacoes.filter((a) =>
      membros.find((m) => m.id === a.membro_id)?.sexo === "F"
    ).length;

    // Com o algoritmo corrigido, deve alocar todos os 4H disponíveis
    expect(masc).toBe(4);
    expect(fem).toBe(4);
  });

  it("Percentual final deve estar dentro de ±1 da meta quando candidatos suficientes existem", () => {
    const membrosBalanceados: MembroEngine[] = Array.from({ length: 10 }, (_, i) => ({
      ...membro(`m${i}`, `M${i}`, MIN_A, i < 5 ? "M" : "F"),
    }));

    const resultado = alocarMembros(
      [funcao(MIN_A, 6)],
      membrosBalanceados,
      [], contexto, [], { distribuicao_masc_pct: 50 }, [], undefined,
    );

    const masc = resultado.alocacoes.filter((a) =>
      membrosBalanceados.find((m) => m.id === a.membro_id)?.sexo === "M"
    ).length;
    const fem = resultado.alocacoes.filter((a) =>
      membrosBalanceados.find((m) => m.id === a.membro_id)?.sexo === "F"
    ).length;

    expect(masc).toBe(3);
    expect(fem).toBe(3);
  });
});

// ── 3. ATUAÇÃO OBRIGATÓRIA ───────────────────────────────────────────────────

describe("Regra: atuação obrigatória", () => {
  it("Membro sem atuação exigida não deve ser alocado", () => {
    const AUT_ID = "aut-001";
    const membroComAtuacao    = { ...membro("m1", "Com", MIN_A, "M"), atuacao_ids: [AUT_ID] };
    const membroSemAtuacao    = { ...membro("m2", "Sem", MIN_A, "M"), atuacao_ids: [] };

    const funcaoComExigencia: FuncaoNecessaria = {
      ...funcao(MIN_A, 1),
      atuacoes_exigidas: [AUT_ID],
    };

    const resultado = alocarMembros(
      [funcaoComExigencia],
      [membroComAtuacao, membroSemAtuacao],
      [], contexto, [], undefined, [], undefined,
    );

    expect(resultado.alocacoes.length).toBe(1);
    expect(resultado.alocacoes[0].membro_id).toBe("m1");
  });
});

// ── 4. PRIORIDADE ALTA ───────────────────────────────────────────────────────

describe("Regra: prioridade do membro", () => {
  it("Membro com prioridade alta deve ser preferido sobre membro normal de mesmo score", () => {
    const normal   = { ...membro("m-normal",  "Normal", MIN_A, "M"), score: 50, prioridade_escala: "nenhuma" as const };
    const prioritario = { ...membro("m-prio", "Prioritário", MIN_A, "M"), score: 50, prioridade_escala: "alta" as const };

    const resultado = alocarMembros(
      [funcao(MIN_A, 1)],
      [normal, prioritario],
      [], contexto, [],
      { prioridade_bonus_alto: 15 },
      [], undefined,
    );

    expect(resultado.alocacoes[0].membro_id).toBe("m-prio");
  });
});

// ── 5. MISSA RESTRITA (via indisponibilidade sintética) ──────────────────────

describe("Regra: restrição de missa específica", () => {
  it("Membro com restrição na missa não deve ser alocado", () => {
    const restrito  = membro("m-rest", "Restrito", MIN_A, "M");
    const livre     = membro("m-livre", "Livre", MIN_A, "M");

    // Indisponibilidade sintética — mesmo padrão do buildMissaRestricaoIndisp
    const indisp: IndisponibilidadeEngine[] = [
      { membro_id: "m-rest", data: contexto.data },
    ];

    const resultado = alocarMembros(
      [funcao(MIN_A, 1)],
      [restrito, livre],
      indisp, contexto, [], undefined, [], undefined,
    );

    expect(resultado.alocacoes.length).toBe(1);
    expect(resultado.alocacoes[0].membro_id).toBe("m-livre");
  });
});

// ── 6. INDISPONIBILIDADE CANCELADA ───────────────────────────────────────────

describe("Regra: indisponibilidades canceladas não bloqueiam", () => {
  it("Indisponibilidade cancelada não deve ser passada ao motor", () => {
    // A query em escalas.tsx já filtra cancelada=true antes de chegar ao motor.
    // Este teste verifica que um membro sem indisponibilidade ativa é escalado normalmente.
    const membroLivre = membro("m-livre2", "Livre2", MIN_A, "M");

    // Motor recebe array vazio (cancelada já filtrada na query)
    const resultado = alocarMembros(
      [funcao(MIN_A, 1)],
      [membroLivre],
      [], contexto, [], undefined, [], undefined,
    );

    expect(resultado.alocacoes.length).toBe(1);
    expect(resultado.alocacoes[0].membro_id).toBe("m-livre2");
  });

  it("Apenas indisponibilidades ativas bloqueiam o membro", () => {
    const bloqueado = membro("m-block", "Bloqueado", MIN_A, "M");
    const livre     = membro("m-ok",    "Ok",        MIN_A, "M");

    const indisp: IndisponibilidadeEngine[] = [
      { membro_id: "m-block", data: contexto.data }, // ativa — passa ao motor
    ];

    const resultado = alocarMembros(
      [funcao(MIN_A, 1)],
      [bloqueado, livre],
      indisp, contexto, [], undefined, [], undefined,
    );

    expect(resultado.alocacoes[0].membro_id).toBe("m-ok");
  });
});
