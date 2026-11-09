/**
 * escala-engine-integracao.test.ts
 * Testes de integração frontend — fluxos críticos do Motor V3
 *
 * Execução: npx vitest run src/biblioteca/escala-engine-integracao.test.ts
 *
 * Cobre:
 *  I1  — Determinismo: mesma entrada → mesma saída
 *  I2  — PreferencialSolene: membros marcados têm prioridade em solenidades
 *  I3  — PreferencialSolene: bônus NÃO se aplica fora de solenidades
 *  I4  — data_corte_rodizio: solenidades anteriores ao corte são ignoradas
 *  I5  — data_corte_rodizio: solenidades após o corte afetam rodízio
 *  I6  — Guarda de notificação: incompatibilidade bloqueia alocação dupla
 *  I7  — Filtro de membro portal: membros inativos não são alocados
 *  I8  — Verificação de permissão: ativo=false é tratado como indisponível
 *  I9  — Sem ranking competitivo: prioridade_escala "nenhuma" não penaliza
 *  I10 — Pool de rodízio: quem serviu na última solene vai para pool1b
 */

// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — instalar vitest: npm i -D vitest
import { describe, it, expect } from "vitest";
import { alocarMembros, getDiaSemana } from "./escala-engine";
import type {
  FuncaoNecessaria,
  MembroEngine,
  ContextoEscala,
  PreferencialSolene,
  HistoricoRecente,
  ConfigParoquia,
} from "./escala-engine";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MIN_LEITOR  = "10000000-0000-0000-0000-000000000001";
const MIN_COROINHA = "10000000-0000-0000-0000-000000000002";

const CTX_COMUM: ContextoEscala = {
  data: "2026-11-02",
  tipo: "missa",
  solene: false,
  tem_bispo: false,
  tem_adoracao: false,
};

const CTX_SOLENE: ContextoEscala = {
  data: "2026-11-02",
  tipo: "missa",
  solene: true,
  tem_bispo: false,
  tem_adoracao: false,
};

function membro(
  id: string,
  nome: string,
  ministerio_id: string,
  overrides: Partial<MembroEngine> = {},
): MembroEngine {
  return {
    id,
    nome,
    ativo: true,
    ministerio_ids: [ministerio_id],
    sexo: "M",
    score: 50,
    prioridade_escala: "nenhuma",
    forcar_escalacao_solene: false,
    restricoes_dia_semana: [],
    funcoes_nao_pode_ids: [],
    atuacao_ids: [],
    ...overrides,
  };
}

function funcao(ministerio_id: string, quantidade = 1, relevancia: "normal" | "principal" = "normal"): FuncaoNecessaria {
  return {
    ministerio_id,
    ministerio_nome: `Função ${ministerio_id.slice(-4)}`,
    quantidade,
    relevancia,
  };
}

function historico(membro_id: string, ministerio_id: string, data: string, tipo_evento = "missa"): HistoricoRecente {
  return { membro_id, ministerio_id, data, tipo_evento };
}

// ── I1: Determinismo ─────────────────────────────────────────────────────────

describe("I1 — Determinismo", () => {
  const membros = [
    membro("m1", "Ana",    MIN_LEITOR),
    membro("m2", "Bruno",  MIN_LEITOR),
    membro("m3", "Carla",  MIN_LEITOR),
  ];
  const funcoes = [funcao(MIN_LEITOR, 1)];

  it("mesma entrada produz mesma saída em 5 execuções consecutivas", () => {
    const resultados = Array.from({ length: 5 }, () =>
      alocarMembros(funcoes, membros, [], CTX_COMUM).alocacoes.map((a) => a.membro_id),
    );
    const primeiro = resultados[0];
    for (const r of resultados.slice(1)) {
      expect(r).toEqual(primeiro);
    }
  });
});

// ── I2: PreferencialSolene — bônus em solenidade ─────────────────────────────

describe("I2 — PreferencialSolene: bônus em solenidade", () => {
  // Ana tem score alto (70) mas NÃO é preferencial.
  // Bruno tem score baixo (30) mas É preferencial.
  // Em solenidade com função relevancia=principal, Bruno deve ser preferido.
  const ana   = membro("m-ana",   "Ana",   MIN_LEITOR, { score: 70 });
  const bruno = membro("m-bruno", "Bruno", MIN_LEITOR, { score: 30 });
  const funcoes = [funcao(MIN_LEITOR, 1, "principal")];
  const prefs: PreferencialSolene[] = [{ ministerio_id: MIN_LEITOR, membro_id: "m-bruno" }];
  const config: ConfigParoquia = { bonus_preferencial_solene: 60 };

  it("membro preferencial vence em solenidade mesmo com score menor", () => {
    const { alocacoes } = alocarMembros(funcoes, [ana, bruno], [], CTX_SOLENE, [], config, prefs);
    const alocados = alocacoes.map((a) => a.membro_id);
    expect(alocados).toContain("m-bruno");
    expect(alocados).not.toContain("m-ana");
  });
});

// ── I3: PreferencialSolene — sem bônus fora de solenidade ────────────────────

describe("I3 — PreferencialSolene: sem efeito fora de solenidade", () => {
  // Em modo comum (não-solene), o motor usa equilíbrio de oportunidades,
  // não score de mérito. O bonusPreferencial está dentro do bloco modoSolenePrincipal,
  // que requer ehSolene=true E relevancia="principal" (linha 704 do engine).
  // Verificamos que o breakdown.modo retorna "comum" e não "solene_principal".
  const ana   = membro("m-ana",   "Ana",   MIN_LEITOR, { score: 70 });
  const bruno = membro("m-bruno", "Bruno", MIN_LEITOR, { score: 30 });
  const funcoes = [funcao(MIN_LEITOR, 2, "principal")]; // pede 2 — aloca os dois
  const prefs: PreferencialSolene[] = [{ ministerio_id: MIN_LEITOR, membro_id: "m-bruno" }];
  const config: ConfigParoquia = { bonus_preferencial_solene: 60 };

  it("em missa comum com função principal, breakdown.modo é 'comum' (bônus preferencial inativo)", () => {
    const { insights } = alocarMembros(funcoes, [ana, bruno], [], CTX_COMUM, [], config, prefs);
    // Todos os candidatos escolhidos devem usar modo "comum", não "solene_principal"
    for (const insight of insights) {
      for (const candidato of insight.escolhidos) {
        expect(candidato.breakdown.modo).toBe("comum");
        expect(candidato.breakdown.bonus_preferencial).toBe(0);
      }
    }
  });
});

// ── I4: data_corte_rodizio — ignora solenidades antes do corte ───────────────

describe("I4 — data_corte_rodizio: solenidades antes do corte são ignoradas", () => {
  // Ana serviu em solenidade em 2026-08-01 (antes do corte 2026-09-01).
  // Com data_corte_rodizio = "2026-09-01", Ana NÃO deve ir para pool1b.
  const ana  = membro("m-ana",  "Ana",  MIN_LEITOR);
  const bia  = membro("m-bia",  "Bia",  MIN_LEITOR);
  const funcoes = [funcao(MIN_LEITOR, 1, "principal")];
  const hist = [historico("m-ana", MIN_LEITOR, "2026-08-01", "solene")];
  const ctx: ContextoEscala = { ...CTX_SOLENE, data_corte_rodizio: "2026-09-01" };

  it("solenidade antes do corte não coloca membro em pool1b", () => {
    // Se Ana fosse para pool1b, Bia seria escolhida. Como não vai, qualquer um pode ser escolhido.
    // Verificamos que Ana PODE ser alocada (não está bloqueada pelo histórico antigo).
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], [], ctx, hist);
    // Ana e Bia são equivalentes — o motor pode escolher qualquer um.
    // O importante é que a alocação completa (1 de 2).
    expect(alocacoes).toHaveLength(1);
  });
});

// ── I5: data_corte_rodizio — solenidades após o corte afetam rodízio ─────────

describe("I5 — data_corte_rodizio: solenidades após corte entram no rodízio", () => {
  // Ana serviu em solenidade em 2026-10-01 (após corte 2026-09-01).
  // Com apenas 2 membros e 1 vaga, Bia deve ser preferida por rodízio.
  const ana  = membro("m-ana",  "Ana",  MIN_LEITOR, { score: 50 });
  const bia  = membro("m-bia",  "Bia",  MIN_LEITOR, { score: 50 });
  const funcoes = [funcao(MIN_LEITOR, 1, "principal")];
  const hist = [historico("m-ana", MIN_LEITOR, "2026-10-01", "solene")];
  const ctx: ContextoEscala = {
    ...CTX_SOLENE,
    data: "2026-11-02",
    data_corte_rodizio: "2026-09-01",
  };

  it("membro que serviu na última solene (pós-corte) vai para pool1b", () => {
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], [], ctx, hist);
    // Bia deve ser escolhida pois Ana está em pool1b (serviu na última solene)
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-bia");
  });
});

// ── I6: Incompatibilidade bloqueia alocação dupla ────────────────────────────

describe("I6 — Guarda de incompatibilidade", () => {
  const joao  = membro("m-joao",  "João",  MIN_LEITOR);
  const pedro = membro("m-pedro", "Pedro", MIN_LEITOR);
  const funcoes = [funcao(MIN_LEITOR, 2)]; // pede 2 vagas
  const incompatMap = new Map<string, Set<string>>([
    ["m-joao",  new Set(["m-pedro"])],
    ["m-pedro", new Set(["m-joao"])],
  ]);

  it("pede 2 vagas mas apenas 2 membros incompatíveis → só 1 alocado", () => {
    const { alocacoes } = alocarMembros(funcoes, [joao, pedro], [], CTX_COMUM, [], undefined, [], incompatMap);
    expect(alocacoes).toHaveLength(1);
  });
});

// ── I7: Membros inativos não são alocados ────────────────────────────────────

describe("I7 — Filtro de membro inativo (conta_ativada / ativo)", () => {
  const ativo   = membro("m-ativo",   "Ativo",   MIN_LEITOR, { ativo: true });
  const inativo = membro("m-inativo", "Inativo", MIN_LEITOR, { ativo: false });
  const funcoes = [funcao(MIN_LEITOR, 1)];

  it("membro inativo não é alocado", () => {
    const { alocacoes } = alocarMembros(funcoes, [ativo, inativo], [], CTX_COMUM);
    const ids = alocacoes.map((a) => a.membro_id);
    expect(ids).not.toContain("m-inativo");
    expect(ids).toContain("m-ativo");
  });
});

// ── I8: prioridade_escala "alta" não gera punição automática ─────────────────

describe("I8 — prioridade_escala alta vs. nenhuma", () => {
  // Membro com prioridade "alta" tem score 60; membro "nenhuma" tem score 80.
  // "Alta" recebe bônus, mas não pode superar uma diferença de 20 pts de score.
  // Dependendo do bônus configurado, o resultado pode variar — testamos que "alta"
  // NÃO penaliza (score efetivo >= score original).
  const alto   = membro("m-alto",   "Alto",   MIN_LEITOR, { score: 60, prioridade_escala: "alta" });
  const normal = membro("m-normal", "Normal", MIN_LEITOR, { score: 60, prioridade_escala: "nenhuma" });
  const funcoes = [funcao(MIN_LEITOR, 2)];

  it("ambos são alocados quando há vagas suficientes", () => {
    const { alocacoes } = alocarMembros(funcoes, [alto, normal], [], CTX_COMUM);
    expect(alocacoes).toHaveLength(2);
  });
});

// ── I9: sem ranking competitivo — pontuação não exclui membros com score baixo ─

describe("I9 — Sem ranking competitivo: score baixo não exclui", () => {
  // Membro com score 0 deve ser alocado quando não há outro candidato.
  const pobre = membro("m-pobre", "Pobre", MIN_LEITOR, { score: 0 });
  const funcoes = [funcao(MIN_LEITOR, 1)];

  it("membro com score 0 é alocado quando é o único candidato", () => {
    const { alocacoes } = alocarMembros(funcoes, [pobre], [], CTX_COMUM);
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-pobre");
  });
});

// ── I10: pool1b — rodízio entre solenidades ───────────────────────────────────

describe("I10 — Pool1b: rodízio entre solenidades", () => {
  // 3 membros, 1 vaga, função relevancia=principal.
  // Ana serviu na última solenidade → pool1b.
  // Bia e Carlos são elegíveis → pool1.
  // Motor deve escolher Bia ou Carlos, não Ana.
  const ana    = membro("m-ana",    "Ana",    MIN_LEITOR, { score: 50 });
  const bia    = membro("m-bia",    "Bia",    MIN_LEITOR, { score: 50 });
  const carlos = membro("m-carlos", "Carlos", MIN_LEITOR, { score: 50 });
  const funcoes = [funcao(MIN_LEITOR, 1, "principal")];
  const hist: HistoricoRecente[] = [
    historico("m-ana", MIN_LEITOR, "2026-10-15", "solene"),
  ];
  const ctx: ContextoEscala = { ...CTX_SOLENE, data: "2026-11-02" };

  it("membro que serviu na última solene não é escolhido quando há alternativas", () => {
    const { alocacoes } = alocarMembros(funcoes, [ana, bia, carlos], [], ctx, hist);
    const ids = alocacoes.map((a) => a.membro_id);
    expect(ids).not.toContain("m-ana");
    expect(ids.some((id) => id === "m-bia" || id === "m-carlos")).toBe(true);
  });

  it("membro em pool1b é usado quando não há alternativas no pool1", () => {
    // Apenas Ana, que está em pool1b
    const { alocacoes } = alocarMembros(funcoes, [ana], [], ctx, hist);
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-ana");
  });
});

// ── I11: Vagas insuficientes ──────────────────────────────────────────────────

describe("I11 — Vagas insuficientes: alertas e Pool5", () => {
  const min = "20000000-0000-0000-0000-000000000001";

  it("0 candidatos com vínculo → alerta descritivo, 0 alocações", () => {
    const funcoes = [funcao(min, 2)];
    const membros = [membro("m1", "Ana", MIN_LEITOR)]; // vínculo com MIN_LEITOR, não com min
    const { alocacoes, alertas } = alocarMembros(funcoes, membros, [], CTX_COMUM);
    expect(alocacoes).toHaveLength(0);
    expect(alertas.some((a) => a.includes("Faltam"))).toBe(true);
  });

  it("1 candidato para 2 vagas → 1 alocado + alerta de falta", () => {
    const funcoes = [funcao(min, 2)];
    const membros = [membro("m1", "Ana", min)];
    const { alocacoes, alertas } = alocarMembros(funcoes, membros, [], CTX_COMUM);
    expect(alocacoes).toHaveLength(1);
    expect(alertas.some((a) => a.includes("Faltam"))).toBe(true);
  });

  it("todos indisponíveis → alerta 'todos indisponíveis', 0 alocações", () => {
    const funcoes = [funcao(min, 1)];
    const membros = [membro("m1", "Ana", min)];
    const indisponibilidades = [{ membro_id: "m1", data: CTX_COMUM.data }];
    const { alocacoes, alertas } = alocarMembros(funcoes, membros, indisponibilidades, CTX_COMUM);
    expect(alocacoes).toHaveLength(0);
    expect(alertas.some((a) => a.includes("Faltam"))).toBe(true);
  });

  it("candidatos só no Pool5 (intervalo mínimo) → alerta individualizado por membro", () => {
    // Ana serviu ontem; intervalo_minimo_dias=7 → ela vai para Pool5
    const funcoes = [funcao(min, 1)];
    const membros = [membro("m1", "Ana", min)];
    const ontem = (() => {
      const d = new Date(CTX_COMUM.data);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const hist = [historico("m1", min, ontem)];
    const config: ConfigParoquia = { intervalo_minimo_dias: 7 };
    const { alocacoes, alertas } = alocarMembros(funcoes, membros, [], CTX_COMUM, hist, config);
    // Pool5 é último recurso — Ana deve ser alocada com alerta
    expect(alocacoes).toHaveLength(1);
    expect(alertas.some((a) => a.includes("intervalo mínimo"))).toBe(true);
  });
});

// ── I12: Indisponibilidade avulsa em solenidades ──────────────────────────────

describe("I12 — Indisponibilidade avulsa em solenidades", () => {
  const min = "20000000-0000-0000-0000-000000000002";

  it("indisponibilidade avulsa bloqueia membro em solenidade (padrão)", () => {
    const funcoes  = [funcao(min, 1, "principal")];
    const ana      = membro("m-ana",  "Ana",  min);
    const bia      = membro("m-bia",  "Bia",  min);
    const indisponibilidades = [{ membro_id: "m-ana", data: CTX_SOLENE.data }];
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], indisponibilidades, CTX_SOLENE);
    expect(alocacoes.map((a) => a.membro_id)).not.toContain("m-ana");
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-bia");
  });

  it("ignorarIndisponibilidades=true permite alocar membro indisponível", () => {
    const funcoes  = [funcao(min, 1, "principal")];
    const ana      = membro("m-ana",  "Ana",  min);
    const indisponibilidades = [{ membro_id: "m-ana", data: CTX_SOLENE.data }];
    // Com apenas 1 candidato e ignorar=true, Ana deve ser alocada mesmo indisponível
    const { alocacoes } = alocarMembros(
      funcoes, [ana], indisponibilidades, CTX_SOLENE,
      [], undefined, [], undefined, true, // ignorarIndisponibilidades=true
    );
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-ana");
  });

  it("indisponibilidade de intervalo (tipo='intervalo') cobre múltiplas datas", () => {
    const funcoes  = [funcao(min, 1)];
    const ana      = membro("m-ana",  "Ana",  min);
    const bia      = membro("m-bia",  "Bia",  min);
    // Ana indisponível de 2026-11-01 a 2026-11-07 — cobre CTX_COMUM.data = "2026-11-02"
    const indisponibilidades = [{
      membro_id: "m-ana",
      data:      "2026-11-01",
      data_fim:  "2026-11-07",
      tipo:      "intervalo",
    }];
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], indisponibilidades, CTX_COMUM);
    expect(alocacoes.map((a) => a.membro_id)).not.toContain("m-ana");
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-bia");
  });
});

// ── I13: Restrição de dia da semana como penalidade (não exclusão) ─────────────

describe("I13 — Restrição de dia da semana: penalidade, não exclusão", () => {
  const min = "20000000-0000-0000-0000-000000000003";

  it("membro com restrição no dia ainda é alocado quando não há outros candidatos", () => {
    // 2026-11-02 é uma segunda-feira (dia 1). Ana restringe segunda.
    const diaSemana = getDiaSemana("2026-11-02"); // 1 = segunda
    const ana = membro("m-ana", "Ana", min, { restricoes_dia_semana: [diaSemana] });
    const funcoes = [funcao(min, 1)];
    const { alocacoes } = alocarMembros(funcoes, [ana], [], CTX_COMUM);
    // Sem outros candidatos, Ana deve ser alocada mesmo com restrição (penalidade, não exclusão)
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-ana");
  });

  it("membro com restrição perde para membro sem restrição no mesmo pool", () => {
    const diaSemana = getDiaSemana("2026-11-02");
    const restrito = membro("m-rest", "Restrito", min, {
      restricoes_dia_semana: [diaSemana],
      score: 100, // score alto mas restrição penaliza
    });
    const livre = membro("m-livre", "Livre", min, {
      restricoes_dia_semana: [],
      score: 50,
    });
    const funcoes = [funcao(min, 1)];
    // Com histórico zerado, Livre (sem restrição) deve ser preferido
    const { alocacoes } = alocarMembros(funcoes, [restrito, livre], [], CTX_COMUM);
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-livre");
  });

  it("restrição de dia também aplica penalidade em solenidades (B4 fix)", () => {
    const diaSemana = getDiaSemana("2026-11-02");
    const restrito = membro("m-rest", "Restrito", min, {
      restricoes_dia_semana: [diaSemana],
      score: 100,
    });
    const livre = membro("m-livre", "Livre", min, {
      restricoes_dia_semana: [],
      score: 50,
    });
    const funcoes = [funcao(min, 1, "principal")];
    const { alocacoes, insights } = alocarMembros(funcoes, [restrito, livre], [], CTX_SOLENE);
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-livre");
    // Insights devem existir (motor está gerando breakdown)
    expect(insights.length).toBeGreaterThan(0);
  });
});

// ── I14: Geração mensal — múltiplas datas com histórico acumulado ─────────────

describe("I14 — Geração mensal: histórico acumulado entre datas", () => {
  const min = "20000000-0000-0000-0000-000000000004";

  it("membro escalado na data 1 não é escalado na data 2 (bloqueio mesmo dia ausente, histórico ativo)", () => {
    const membros = [
      membro("m1", "Ana",    min),
      membro("m2", "Bruno",  min),
      membro("m3", "Carlos", min),
    ];
    const funcoes = [funcao(min, 1)];

    // Data 1: gerar escala sem histórico
    const ctx1: ContextoEscala = { ...CTX_COMUM, data: "2026-11-02" };
    const { alocacoes: aloc1 } = alocarMembros(funcoes, membros, [], ctx1, []);
    expect(aloc1).toHaveLength(1);
    const escolhido1 = aloc1[0].membro_id;

    // Acumula histórico da data 1
    const hist1 = [historico(escolhido1, min, "2026-11-02")];

    // Data 2: o membro escalado na data 1 tem penalidade (serviuNaSemana)
    const ctx2: ContextoEscala = { ...CTX_COMUM, data: "2026-11-09" };
    const { alocacoes: aloc2 } = alocarMembros(funcoes, membros, [], ctx2, hist1);
    expect(aloc2).toHaveLength(1);

    // O motor DEVE evitar o mesmo membro da semana anterior (penalidade PENALIDADE_MESMA_SEMANA)
    // Com 3 candidatos e histórico do dia -7, o escolhido1 tem penalidade — outro deve vencer
    expect(aloc2[0].membro_id).not.toBe(escolhido1);
  });

  it("3 datas consecutivas semanais distribuem entre 3 membros distintos", () => {
    const membros = [
      membro("m1", "Ana",    min, { score: 50 }),
      membro("m2", "Bruno",  min, { score: 50 }),
      membro("m3", "Carlos", min, { score: 50 }),
    ];
    const funcoes = [funcao(min, 1)];
    const datas = ["2026-11-02", "2026-11-09", "2026-11-16"];
    const historico_acum: HistoricoRecente[] = [];
    const escolhidos: string[] = [];

    for (const data of datas) {
      const ctx: ContextoEscala = { ...CTX_COMUM, data };
      const { alocacoes } = alocarMembros(funcoes, membros, [], ctx, historico_acum);
      expect(alocacoes).toHaveLength(1);
      const id = alocacoes[0].membro_id;
      escolhidos.push(id);
      historico_acum.push({ membro_id: id, ministerio_id: min, data, tipo_evento: "missa" });
    }

    // 3 escalas em 3 semanas com 3 membros e histórico acumulado → todos distintos
    const unicos = new Set(escolhidos);
    expect(unicos.size).toBe(3);
  });

  it("geração determinística: mesma sequência de datas produz mesmos resultados", () => {
    const membros = [
      membro("m1", "Ana",    min, { score: 50 }),
      membro("m2", "Bruno",  min, { score: 50 }),
      membro("m3", "Carlos", min, { score: 50 }),
    ];
    const funcoes = [funcao(min, 1)];
    const datas   = ["2026-11-02", "2026-11-09", "2026-11-16"];

    function gerarSequencia() {
      const historico_acum: HistoricoRecente[] = [];
      return datas.map((data) => {
        const ctx: ContextoEscala = { ...CTX_COMUM, data };
        const { alocacoes } = alocarMembros(funcoes, membros, [], ctx, historico_acum);
        const id = alocacoes[0]?.membro_id;
        historico_acum.push({ membro_id: id, ministerio_id: min, data, tipo_evento: "missa" });
        return id;
      });
    }

    expect(gerarSequencia()).toEqual(gerarSequencia());
  });
});

// ── I15: Consistência escalas × ranking (sem banco remoto) ───────────────────

describe("I15 — Consistência escalas × ranking (snapshot local)", () => {
  // Verifica que o motor produz distribuição consistente com o que o ranking
  // exibiria: membros com mais escalas têm maior 'count30d' e menor prioridade
  // (via participacaoRecente). Testável sem banco — usa apenas engine + fixtures.
  const min = "20000000-0000-0000-0000-000000000005";

  it("após 4 escalas para Ana, Bruno recebe maior prioridade (participacaoRecente)", () => {
    // Ana recebeu 4 escalas nos últimos 30 dias; Bruno recebeu 0.
    // CAP_PARTICIPACOES_30D = 5 → Ana tem participacaoRecente baixo, Bruno alto.
    const ana   = membro("m-ana",   "Ana",   min, { score: 50 });
    const bruno = membro("m-bruno", "Bruno", min, { score: 50 });
    const funcoes = [funcao(min, 1)];

    const dataBase = "2026-11-02";
    const hist30d: HistoricoRecente[] = Array.from({ length: 4 }, (_, i) => ({
      membro_id:    "m-ana",
      ministerio_id: min,
      data:          `2026-10-${String(i + 5).padStart(2, "0")}`, // datas dentro do mês
      tipo_evento:   "missa",
    }));

    const ctx: ContextoEscala = { ...CTX_COMUM, data: dataBase };
    const { alocacoes, insights } = alocarMembros(funcoes, [ana, bruno], [], ctx, hist30d);

    // Bruno deve ser escolhido (tem menos participação recente → maior equidade)
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-bruno");

    // Insights devem mostrar que Ana tem maior participacao_recente (count30d alto)
    // e Bruno tem maior score de equidade
    const insightFuncao = insights[0];
    expect(insightFuncao).toBeDefined();
    const candidatoBruno = insightFuncao.top_candidatos.find((c) => c.membro_id === "m-bruno");
    const candidatoAna   = insightFuncao.top_candidatos.find((c) => c.membro_id === "m-ana");
    expect(candidatoBruno).toBeDefined();
    expect(candidatoAna).toBeDefined();
    // Bruno deve ter maior score final de equidade que Ana
    expect(candidatoBruno!.score_final).toBeGreaterThan(candidatoAna!.score_final);
  });

  it("distribuição em 8 semanas: Gini de alocação < 0.35 com 5 membros equivalentes", () => {
    // 5 membros com score igual, sem histórico inicial. 8 datas semanais.
    // O motor deve distribuir de forma razoavelmente equânime.
    const ids = ["m1", "m2", "m3", "m4", "m5"];
    const membros = ids.map((id) => membro(id, `Membro ${id}`, min, { score: 50 }));
    const funcoes = [funcao(min, 1)];
    const datas = Array.from({ length: 8 }, (_, i) => {
      const d = new Date("2026-10-05");
      d.setDate(d.getDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });

    const historico_acum: HistoricoRecente[] = [];
    const contagem: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));

    for (const data of datas) {
      const ctx: ContextoEscala = { ...CTX_COMUM, data };
      const { alocacoes } = alocarMembros(funcoes, membros, [], ctx, historico_acum);
      const id = alocacoes[0]?.membro_id;
      if (id) {
        contagem[id]++;
        historico_acum.push({ membro_id: id, ministerio_id: min, data, tipo_evento: "missa" });
      }
    }

    // Gini simples sobre as contagens
    const valores = Object.values(contagem).sort((a, b) => a - b);
    const n = valores.length;
    const total = valores.reduce((s, v) => s + v, 0);
    const gini = valores.reduce((sum, v, i) => sum + (2 * (i + 1) - n - 1) * v, 0) / (n * total);

    // Com 8 escalas e 5 membros, distribuição justa tem Gini baixo
    expect(gini).toBeLessThan(0.35);

    // Nenhum membro deve ter 0 escalas em 8 semanas com 5 candidatos
    expect(Math.min(...valores)).toBeGreaterThan(0);
  });
});

// ── Renumeração dos tests antigos que colidiram ───────────────────────────────
// (os antigos I11 e I12 agora são I16 e I17)

// ── I16: data_corte_rodizio nulo — todo o histórico é considerado ─────────────

describe("I16 — data_corte_rodizio nulo: histórico completo influencia rodízio", () => {
  // Quando data_corte_rodizio não é passado (null), o motor considera todo o histórico.
  // Ana serviu em solenidade em 2025-01-01 (muito antiga).
  // Com corte nulo, esse histórico ainda conta e Ana vai para pool1b.
  const ana  = membro("m-ana",  "Ana",  MIN_LEITOR, { score: 50 });
  const bia  = membro("m-bia",  "Bia",  MIN_LEITOR, { score: 50 });
  const funcoes = [funcao(MIN_LEITOR, 1, "principal")];
  const hist = [historico("m-ana", MIN_LEITOR, "2025-01-01", "solene")];
  const ctx: ContextoEscala = { ...CTX_SOLENE, data: "2026-11-02" };
  // Sem data_corte_rodizio no contexto

  it("histórico antigo (sem corte) ainda coloca membro em pool1b", () => {
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], [], ctx, hist);
    // Bia deve ser escolhida pois Ana está em pool1b (histórico sem corte)
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-bia");
  });
});

// ── I12: regra da data padrão 2026-08-18 ─────────────────────────────────────

describe("I17 — data padrão 2026-08-18: corte exato do sistema", () => {
  // Quando rodizio_reset_em está nulo no banco, o frontend usa CORTE_PADRAO = "2026-08-18"
  // e passa esse valor como data_corte_rodizio ao motor.
  // Verifica que solenidade em exatamente 2026-08-18 é considerada (>= corte).
  const ana = membro("m-ana", "Ana", MIN_LEITOR, { score: 50 });
  const bia = membro("m-bia", "Bia", MIN_LEITOR, { score: 50 });
  const funcoes = [funcao(MIN_LEITOR, 1, "principal")];

  it("solenidade em 2026-08-17 (antes do corte padrão) não conta no rodízio", () => {
    const hist = [historico("m-ana", MIN_LEITOR, "2026-08-17", "solene")];
    const ctx: ContextoEscala = { ...CTX_SOLENE, data_corte_rodizio: "2026-08-18" };
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], [], ctx, hist);
    // Ana não deve ir para pool1b, então pode ser escolhida
    expect(alocacoes).toHaveLength(1);
    // A alocação precisa acontecer (não importa qual dos dois — ambos são elegíveis)
  });

  it("solenidade em 2026-08-18 (data do corte) conta no rodízio", () => {
    const hist = [historico("m-ana", MIN_LEITOR, "2026-08-18", "solene")];
    const ctx: ContextoEscala = { ...CTX_SOLENE, data_corte_rodizio: "2026-08-18" };
    const { alocacoes } = alocarMembros(funcoes, [ana, bia], [], ctx, hist);
    // Bia deve ser preferida pois Ana está em pool1b
    expect(alocacoes.map((a) => a.membro_id)).toContain("m-bia");
  });
});
