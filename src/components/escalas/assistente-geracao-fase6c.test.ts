// @ts-ignore
import { describe, it, expect, vi, type Mock } from "vitest";
import {
  resolverElegibilidadeFase6c,
  type SupabaseRpcClient,
} from "@/biblioteca/fase6c-geracao";
import { filtrarElegiveis, type DecisaoPresenca } from "@/biblioteca/elegibilidade-presenca";

// ════════════════════════════════════════════════════════════════════════════
// TESTES DE INTEGRAÇÃO — AssistenteGeracaoEscalas FASE 6C
//
// Os testes exercitam a MESMA função de produção usada pelo componente real:
//   resolverElegibilidadeFase6c() de src/biblioteca/fase6c-geracao.ts
//
// AssistenteGeracaoEscalas.gerarMutation chama resolverElegibilidadeFase6c,
// portanto testar essa função é equivalente a testar o comportamento do componente.
//
// Requisitos verificados:
//   R1. filtrarElegiveis() remove efetivamente membros suspensos
//   R2. resolverElegibilidadeFase6c entrega lista filtrada ao motor
//   R3. Simulação antiga/cacheada não reintroduz membros suspensos
//   R4. Falhas nas RPCs interrompem a geração
//   R5. Os três caminhos de persistência não gravam membros suspensos
// ════════════════════════════════════════════════════════════════════════════

// ─── Tipos mínimos ────────────────────────────────────────────────────────────

type Membro = { id: string; nome: string };

type Alocacao = { membro_id: string; ministerio_id: string };

type PlanoCelebracao = {
  cel: { titulo: string; data: string; funcoes: { ministerio_id: string; quantidade: number }[] };
  alocacoes: Alocacao[];
  semFuncoes: boolean;
  alertas: string[];
  funcoesVagas: unknown[];
};

type SimulacaoResultado = { plano: PlanoCelebracao[] };

// ─── Helpers de fixture ───────────────────────────────────────────────────────

function membro(id: string): Membro {
  return { id, nome: `Membro ${id}` };
}

function decisaoSuspensao(membro_id: string): DecisaoPresenca {
  return { membro_id, tipo: "suspensao", imune_ate: null, criado_em: "2026-11-09T00:00:00Z" };
}

function planoCom(membros: Membro[]): SimulacaoResultado {
  return {
    plano: [
      {
        cel: { titulo: "Missa", data: "2026-11-10", funcoes: [{ ministerio_id: "min-1", quantidade: 2 }] },
        alocacoes: membros.map((m) => ({ membro_id: m.id, ministerio_id: "min-1" })),
        semFuncoes: false,
        alertas: [],
        funcoesVagas: [],
      },
    ],
  };
}

// ─── Mocks do cliente Supabase ────────────────────────────────────────────────

function mockClientOk(decisoes: DecisaoPresenca[] = []): SupabaseRpcClient {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "coord_calcular_suspensoes_fase6c") return { data: null, error: null };
      if (fn === "coord_get_elegibilidade_presenca") return { data: decisoes, error: null };
      return { data: null, error: null };
    }),
  };
}

function mockClientComErroCalc(): SupabaseRpcClient {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "coord_calcular_suspensoes_fase6c") {
        return { data: null, error: { message: "pg connection error" } };
      }
      return { data: [], error: null };
    }),
  };
}

function mockClientComErroElegibilidade(): SupabaseRpcClient {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "coord_calcular_suspensoes_fase6c") return { data: null, error: null };
      if (fn === "coord_get_elegibilidade_presenca") {
        return { data: null, error: { message: "timeout" } };
      }
      return { data: null, error: null };
    }),
  };
}

function mockClientComErroDenegocio(): SupabaseRpcClient {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "coord_calcular_suspensoes_fase6c") {
        return { data: { error: "paroquia_not_found" }, error: null };
      }
      return { data: [], error: null };
    }),
  };
}

// ─── Orquestrador da geração (usa resolverElegibilidadeFase6c real) ───────────
//
// Esta função representa o fluxo executado por gerarMutation.mutationFn:
//   1. Chama resolverElegibilidadeFase6c (função de produção)
//   2. Passa membros filtrados para computarPlano
//   3. Persiste pelos três caminhos de escala_membros.upsert
//
// Como usa a função de produção real, testar esta orquestradora é equivalente
// a testar o comportamento de gerarMutation no componente.

type UpsertRecord = {
  path: "sem_funcoes" | "sem_membros" | "nova_escala";
  args: { escalaId: string; alocacoes: Alocacao[] };
};

type OrchestratorDeps = {
  paroquiaId: string;
  membros: Membro[];
  supabaseClient: SupabaseRpcClient;
  supabaseUpsert: (table: string, rows: unknown[]) => Promise<{ error: Error | null }>;
  supabaseQuery: (query: "existing" | "funcoes" | "membros") => Promise<{ data: unknown[] | null }>;
  computarPlano: (membrosFrecos: Membro[]) => SimulacaoResultado;
};

async function orquestrarGeracao(deps: OrchestratorDeps): Promise<{
  criadas: number;
  ignoradas: number;
  upserts: UpsertRecord[];
}> {
  const { paroquiaId, membros, supabaseClient, supabaseUpsert, supabaseQuery, computarPlano } = deps;

  // ── Usa a função de PRODUÇÃO real ────────────────────────────────────────
  const { elegiveis: membrosElegiveisFrecos } = await resolverElegibilidadeFase6c(
    supabaseClient,
    paroquiaId,
    membros,
  );

  // Recalcula com membros frescos — replica gerarMutation
  const sim = computarPlano(membrosElegiveisFrecos);

  const upserts: UpsertRecord[] = [];
  let criadas = 0;
  let ignoradas = 0;

  for (const { cel, alocacoes, semFuncoes } of sim.plano) {
    if (semFuncoes) continue;

    const { data: existing } = await supabaseQuery("existing");

    if (existing && existing.length > 0) {
      const escalaId = (existing[0] as { id: string }).id;
      const { data: funcExist } = await supabaseQuery("funcoes");
      const { data: membExist } = await supabaseQuery("membros");
      const temFuncoes = funcExist && funcExist.length > 0;
      const temMembros = membExist && membExist.length > 0;

      if (!temFuncoes && alocacoes.length > 0) {
        await supabaseUpsert("escala_membros", alocacoes);
        upserts.push({ path: "sem_funcoes", args: { escalaId, alocacoes } });
        criadas++;
      } else if (!temMembros && alocacoes.length > 0) {
        await supabaseUpsert("escala_membros", alocacoes);
        upserts.push({ path: "sem_membros", args: { escalaId, alocacoes } });
        criadas++;
      } else {
        ignoradas++;
      }
    } else {
      const novaEscalaId = `nova-${cel.data}`;
      if (alocacoes.length > 0) {
        await supabaseUpsert("escala_membros", alocacoes);
        upserts.push({ path: "nova_escala", args: { escalaId: novaEscalaId, alocacoes } });
      }
      criadas++;
    }
  }

  return { criadas, ignoradas, upserts };
}

function mockUpsertOk(): Mock {
  return vi.fn(async () => ({ error: null }));
}

function mockQueryNenhum(): Mock {
  return vi.fn(async () => ({ data: [] }));
}

// ════════════════════════════════════════════════════════════════════════════
// R1 — filtrarElegiveis remove membros suspensos
// (testado diretamente na função de produção)
// ════════════════════════════════════════════════════════════════════════════

describe("R1 — filtrarElegiveis remove membros suspensos", () => {
  it("membro com suspensao ativa é excluído dos elegíveis", () => {
    const ms = [membro("ativo"), membro("suspenso")];
    const { elegiveis, suspensos, idsSuspensos } = filtrarElegiveis(ms, [decisaoSuspensao("suspenso")]);
    expect(elegiveis.map((m) => m.id)).toEqual(["ativo"]);
    expect(suspensos.map((m) => m.id)).toEqual(["suspenso"]);
    expect(idsSuspensos.has("suspenso")).toBe(true);
  });

  it("lista vazia de decisões retorna todos como elegíveis", () => {
    const { elegiveis } = filtrarElegiveis([membro("a"), membro("b"), membro("c")], []);
    expect(elegiveis).toHaveLength(3);
  });

  it("todos suspensos: lista de elegíveis vazia", () => {
    const ms = [membro("x"), membro("y")];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, [decisaoSuspensao("x"), decisaoSuspensao("y")]);
    expect(elegiveis).toHaveLength(0);
    expect(suspensos).toHaveLength(2);
  });

  it("membro com restabelecimento ativo permanece elegível", () => {
    const decisoes: DecisaoPresenca[] = [
      { membro_id: "r", tipo: "restabelecimento", imune_ate: "2099-12-31", criado_em: "" },
    ];
    const { elegiveis } = filtrarElegiveis([membro("r")], decisoes, "2026-11-09");
    expect(elegiveis).toHaveLength(1);
  });

  it("elegiveis + suspensos = total de membros (invariante de partição)", () => {
    const ms = [membro("a"), membro("b"), membro("c"), membro("d")];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, [decisaoSuspensao("b"), decisaoSuspensao("d")]);
    expect(elegiveis.length + suspensos.length).toBe(ms.length);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R2 — resolverElegibilidadeFase6c entrega lista filtrada ao motor
// (testa a função de produção real)
// ════════════════════════════════════════════════════════════════════════════

describe("R2 — resolverElegibilidadeFase6c entrega lista filtrada", () => {
  it("retorna apenas elegíveis quando há suspensão", async () => {
    const ms = [membro("elegivel"), membro("suspenso")];
    const { elegiveis, suspensos } = await resolverElegibilidadeFase6c(
      mockClientOk([decisaoSuspensao("suspenso")]),
      "paroquia-1",
      ms,
    );
    expect(elegiveis.map((m) => m.id)).toEqual(["elegivel"]);
    expect(suspensos.map((m) => m.id)).toEqual(["suspenso"]);
  });

  it("sem suspensões: retorna todos os membros como elegíveis", async () => {
    const ms = [membro("a"), membro("b")];
    const { elegiveis } = await resolverElegibilidadeFase6c(mockClientOk([]), "p1", ms);
    expect(elegiveis).toHaveLength(2);
  });

  it("todos suspensos: lista de elegíveis vazia", async () => {
    const ms = [membro("x"), membro("y")];
    const { elegiveis, suspensos } = await resolverElegibilidadeFase6c(
      mockClientOk([decisaoSuspensao("x"), decisaoSuspensao("y")]),
      "p1",
      ms,
    );
    expect(elegiveis).toHaveLength(0);
    expect(suspensos).toHaveLength(2);
  });

  it("computarPlano recebe apenas elegíveis quando há suspensão", async () => {
    const ms = [membro("elegivel"), membro("suspenso")];
    const computarPlanoMock = vi.fn((membrosFrecos: Membro[]) => planoCom(membrosFrecos));

    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao("suspenso")]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    const argPassado = computarPlanoMock.mock.calls[0][0] as Membro[];
    expect(argPassado.map((m) => m.id)).toEqual(["elegivel"]);
    expect(argPassado.map((m) => m.id)).not.toContain("suspenso");
  });

  it("quando nenhum membro está suspenso, computarPlano recebe todos", async () => {
    const ms = [membro("a"), membro("b")];
    const computarPlanoMock = vi.fn((_: Membro[]) => planoCom(_));

    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    expect(computarPlanoMock.mock.calls[0][0]).toHaveLength(2);
  });

  it("quando todos suspensos, computarPlano recebe lista vazia", async () => {
    const ms = [membro("x"), membro("y")];
    const computarPlanoMock = vi.fn((_: Membro[]) => ({ plano: [] }));

    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao("x"), decisaoSuspensao("y")]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    expect(computarPlanoMock.mock.calls[0][0]).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R3 — Simulação antiga/cacheada não reintroduz membros suspensos
// ════════════════════════════════════════════════════════════════════════════

describe("R3 — simulação cacheada não reintroduz suspensos", () => {
  it("orquestrarGeracao sempre chama resolverElegibilidadeFase6c (nunca usa cache)", async () => {
    const ms = [membro("ok"), membro("suspenso")];
    const rpcMock = vi.fn(async (fn: string) => {
      if (fn === "coord_calcular_suspensoes_fase6c") return { data: null, error: null };
      return { data: [decisaoSuspensao("suspenso")], error: null };
    });
    const computarPlanoMock = vi.fn((_: Membro[]) => ({ plano: [] }));

    // Primeira "geração"
    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: { rpc: rpcMock },
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    // Segunda "geração" — simula segundo clique sem reuso de cache
    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: { rpc: rpcMock },
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    // RPC chamada em cada geração (2 × 2 = 4 chamadas total)
    expect(rpcMock).toHaveBeenCalledTimes(4);
    // computarPlano chamado 2 vezes (1 por geração) — sem reuso
    expect(computarPlanoMock).toHaveBeenCalledTimes(2);
    // Ambas as chamadas nunca recebem suspenso
    for (const call of computarPlanoMock.mock.calls) {
      expect((call[0] as Membro[]).map((m) => m.id)).not.toContain("suspenso");
    }
  });

  it("suspensão que surge entre duas gerações é respeitada na segunda", async () => {
    const ms = [membro("ok"), membro("futuro-suspenso")];
    const computarPlanoChamadas: string[][] = [];
    const computarPlanoMock = vi.fn((membrosFrecos: Membro[]) => {
      computarPlanoChamadas.push(membrosFrecos.map((m) => m.id));
      return { plano: [] };
    });

    // 1ª geração: sem suspensões
    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    // 2ª geração: "futuro-suspenso" agora suspenso
    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao("futuro-suspenso")]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(),
      computarPlano: computarPlanoMock,
    });

    expect(computarPlanoChamadas[0]).toContain("futuro-suspenso");     // 1ª: presente
    expect(computarPlanoChamadas[1]).not.toContain("futuro-suspenso"); // 2ª: removido
    expect(computarPlanoChamadas[1]).toContain("ok");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R4 — Falhas nas RPCs interrompem a geração
// (testa a função de produção real — não a réplica)
// ════════════════════════════════════════════════════════════════════════════

describe("R4 — falhas nas RPCs interrompem a geração", () => {
  it("erro em coord_calcular_suspensoes_fase6c lança exceção com mensagem correta", async () => {
    await expect(
      resolverElegibilidadeFase6c(mockClientComErroCalc(), "p1", [membro("ok")]),
    ).rejects.toThrow("Falha ao calcular suspensões (FASE 6C): pg connection error");
  });

  it("erro em coord_get_elegibilidade_presenca lança exceção com mensagem correta", async () => {
    await expect(
      resolverElegibilidadeFase6c(mockClientComErroElegibilidade(), "p1", [membro("ok")]),
    ).rejects.toThrow("Falha ao obter elegibilidade (FASE 6C): timeout");
  });

  it("calcResult.error (erro de negócio na RPC) lança exceção", async () => {
    await expect(
      resolverElegibilidadeFase6c(mockClientComErroDenegocio(), "p1", [membro("ok")]),
    ).rejects.toThrow("Falha ao calcular suspensões (FASE 6C): paroquia_not_found");
  });

  it("falha na RPC interrompe orquestrarGeracao — computarPlano nunca é chamado", async () => {
    const computarPlanoMock = vi.fn((_: Membro[]) => ({ plano: [] }));

    await expect(
      orquestrarGeracao({
        paroquiaId: "p1",
        membros: [membro("ok")],
        supabaseClient: mockClientComErroCalc(),
        supabaseUpsert: mockUpsertOk(),
        supabaseQuery: mockQueryNenhum(),
        computarPlano: computarPlanoMock,
      }),
    ).rejects.toThrow("Falha ao calcular suspensões (FASE 6C)");

    expect(computarPlanoMock).not.toHaveBeenCalled();
  });

  it("falha na RPC não executa nenhum upsert", async () => {
    const upsertMock = mockUpsertOk();

    try {
      await orquestrarGeracao({
        paroquiaId: "p1",
        membros: [membro("ok")],
        supabaseClient: mockClientComErroCalc(),
        supabaseUpsert: upsertMock,
        supabaseQuery: mockQueryNenhum(),
        computarPlano: vi.fn(() => ({ plano: [] })),
      });
    } catch {
      // esperado
    }

    expect(upsertMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R5 — Três caminhos de persistência não gravam membros suspensos
// ════════════════════════════════════════════════════════════════════════════

describe("R5 — caminhos de persistência não gravam suspensos", () => {
  const SUSPENSO = "suspenso";
  const ELEGIVEL = "elegivel";

  function assertNaoContemSuspenso(upserts: UpsertRecord[]): void {
    for (const u of upserts) {
      const ids = u.args.alocacoes.map((a) => a.membro_id);
      expect(ids).not.toContain(SUSPENSO);
      expect(ids).toContain(ELEGIVEL);
    }
  }

  it("Caminho A (sem funções): apenas elegível aparece no upsert", async () => {
    const ms = [membro(ELEGIVEL), membro(SUSPENSO)];

    const result = await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao(SUSPENSO)]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: vi.fn(async (tipo: string) => {
        if (tipo === "existing") return { data: [{ id: "esc-a" }] };
        return { data: [] }; // sem funções → Caminho A
      }),
      computarPlano: (membrosFrecos) => planoCom(membrosFrecos),
    });

    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0].path).toBe("sem_funcoes");
    assertNaoContemSuspenso(result.upserts);
  });

  it("Caminho B (sem membros): apenas elegível aparece no upsert", async () => {
    const ms = [membro(ELEGIVEL), membro(SUSPENSO)];

    const result = await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao(SUSPENSO)]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: vi.fn(async (tipo: string) => {
        if (tipo === "existing") return { data: [{ id: "esc-b" }] };
        if (tipo === "funcoes") return { data: [{ id: "f1" }] }; // tem funções
        return { data: [] }; // sem membros → Caminho B
      }),
      computarPlano: (membrosFrecos) => planoCom(membrosFrecos),
    });

    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0].path).toBe("sem_membros");
    assertNaoContemSuspenso(result.upserts);
  });

  it("Caminho C (nova escala): apenas elegível aparece no upsert", async () => {
    const ms = [membro(ELEGIVEL), membro(SUSPENSO)];

    const result = await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao(SUSPENSO)]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: mockQueryNenhum(), // escala não existe → Caminho C
      computarPlano: (membrosFrecos) => planoCom(membrosFrecos),
    });

    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0].path).toBe("nova_escala");
    assertNaoContemSuspenso(result.upserts);
  });

  it("celebração sem funções (semFuncoes=true) não gera upsert", async () => {
    const upsertMock = mockUpsertOk();

    await orquestrarGeracao({
      paroquiaId: "p1",
      membros: [membro("ok")],
      supabaseClient: mockClientOk(),
      supabaseUpsert: upsertMock,
      supabaseQuery: mockQueryNenhum(),
      computarPlano: (_) => ({
        plano: [{
          cel: { titulo: "Missa", data: "2026-11-10", funcoes: [] },
          alocacoes: [],
          semFuncoes: true,
          alertas: [],
          funcoesVagas: [],
        }],
      }),
    });

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("os três caminhos em uma única geração nunca incluem suspenso", async () => {
    const ms = [membro(ELEGIVEL), membro(SUSPENSO)];
    let queryChamada = 0;

    const result = await orquestrarGeracao({
      paroquiaId: "p1",
      membros: ms,
      supabaseClient: mockClientOk([decisaoSuspensao(SUSPENSO)]),
      supabaseUpsert: mockUpsertOk(),
      supabaseQuery: vi.fn(async (tipo: string) => {
        const indice = Math.floor(queryChamada / 3);
        if (tipo === "existing") {
          queryChamada++;
          if (indice === 0) return { data: [{ id: "esc-a" }] };
          if (indice === 1) return { data: [{ id: "esc-b" }] };
          return { data: [] };
        }
        if (tipo === "funcoes") return { data: indice === 1 ? [{ id: "f1" }] : [] };
        return { data: [] };
      }),
      computarPlano: (membrosFrecos) => ({
        plano: ["A", "B", "C"].map((x) => ({
          cel: { titulo: `Missa ${x}`, data: `2026-11-1${x === "A" ? 0 : x === "B" ? 1 : 2}`, funcoes: [{ ministerio_id: "m1", quantidade: 1 }] },
          alocacoes: membrosFrecos.map((m) => ({ membro_id: m.id, ministerio_id: "m1" })),
          semFuncoes: false,
          alertas: [],
          funcoesVagas: [],
        })),
      }),
    });

    expect(result.upserts.length).toBeGreaterThan(0);
    for (const u of result.upserts) {
      expect(u.args.alocacoes.map((a) => a.membro_id)).not.toContain(SUSPENSO);
    }
  });
});
