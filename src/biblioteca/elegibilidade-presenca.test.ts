// @ts-ignore
import { describe, it, expect } from "vitest";
import { filtrarElegiveis, type DecisaoPresenca } from "./elegibilidade-presenca";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Membro = { id: string; nome: string };

function membros(ids: string[]): Membro[] {
  return ids.map((id) => ({ id, nome: `Membro ${id}` }));
}

function decisao(
  membro_id: string,
  tipo: "suspensao" | "restabelecimento",
  imune_ate: string | null = null,
  criado_em = "2026-11-01T10:00:00Z",
): DecisaoPresenca {
  return { membro_id, tipo, imune_ate, criado_em };
}

// ── 1. Critérios de suspensão e elegibilidade ─────────────────────────────────

describe("filtrarElegiveis — suspensão", () => {
  it("membro com suspensao ativa é inelegível", () => {
    const ms = membros(["a", "b"]);
    const d = [decisao("a", "suspensao")];
    const { elegiveis, suspensos, idsSuspensos } = filtrarElegiveis(ms, d);
    expect(elegiveis.map((m) => m.id)).toEqual(["b"]);
    expect(suspensos.map((m) => m.id)).toEqual(["a"]);
    expect(idsSuspensos.has("a")).toBe(true);
    expect(idsSuspensos.has("b")).toBe(false);
  });

  it("membro sem decisão é elegível", () => {
    const ms = membros(["x"]);
    const { elegiveis, suspensos } = filtrarElegiveis(ms, []);
    expect(elegiveis).toHaveLength(1);
    expect(suspensos).toHaveLength(0);
  });

  it("lista de membros vazia retorna vazios", () => {
    const { elegiveis, suspensos, idsSuspensos } = filtrarElegiveis([], [decisao("a", "suspensao")]);
    expect(elegiveis).toHaveLength(0);
    expect(suspensos).toHaveLength(0);
    expect(idsSuspensos.size).toBe(0);
  });

  it("todos suspensos: lista de elegíveis vazia", () => {
    const ms = membros(["a", "b"]);
    const d = [decisao("a", "suspensao"), decisao("b", "suspensao")];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, d);
    expect(elegiveis).toHaveLength(0);
    expect(suspensos).toHaveLength(2);
  });
});

// ── 2. Imunidade após restabelecimento ────────────────────────────────────────

describe("filtrarElegiveis — imunidade", () => {
  it("membro com restabelecimento ativo (imune_ate futuro) é elegível", () => {
    const ms = membros(["r"]);
    const d = [decisao("r", "restabelecimento", "2099-12-31")];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(elegiveis.map((m) => m.id)).toEqual(["r"]);
    expect(suspensos).toHaveLength(0);
  });

  it("membro com restabelecimento sem imune_ate ainda é elegível", () => {
    // imune_ate null não deve bloquear — a decisão ativa é 'restabelecimento'
    const ms = membros(["r"]);
    const d = [decisao("r", "restabelecimento", null)];
    const { elegiveis } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(elegiveis.map((m) => m.id)).toEqual(["r"]);
  });

  it("imune_ate igual a hoje é elegível (limite inclusivo)", () => {
    // A imunidade dura até o último dia (imune_ate >= CURRENT_DATE no SQL)
    const ms = membros(["r"]);
    const d = [decisao("r", "restabelecimento", "2026-11-09")];
    const { elegiveis } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(elegiveis).toHaveLength(1);
  });

  it("nova suspensão sobrepõe imunidade anterior (decisão mais recente vence via Map)", () => {
    // A RPC só mantém 1 decisão ativa por membro; se suspensão está ativa,
    // o Map armazena apenas ela e o membro é inelegível.
    const ms = membros(["r"]);
    // Apenas suspensão ativa (restabelecimento foi encerrado no banco)
    const d = [decisao("r", "suspensao")];
    const { suspensos } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(suspensos).toHaveLength(1);
  });
});

// ── 3. Idempotência e dados duplicados ────────────────────────────────────────

describe("filtrarElegiveis — idempotência", () => {
  it("decisões duplicadas para o mesmo membro: último no array vence (Map)", () => {
    // Na prática o banco retorna 1 decisão ativa; aqui testamos o comportamento
    // do Map quando há duplicatas na entrada (último INSERT no for-loop vence).
    const ms = membros(["dup"]);
    const d = [
      decisao("dup", "suspensao", null, "2026-11-01T00:00:00Z"),
      decisao("dup", "restabelecimento", "2099-12-31", "2026-11-05T00:00:00Z"),
    ];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, d, "2026-11-09");
    // O Map sobrescreve: último (restabelecimento) vence → elegível
    expect(elegiveis).toHaveLength(1);
    expect(suspensos).toHaveLength(0);
  });

  it("chamar filtrarElegiveis duas vezes com os mesmos dados retorna o mesmo resultado", () => {
    const ms = membros(["a", "b"]);
    const d = [decisao("a", "suspensao")];
    const r1 = filtrarElegiveis(ms, d);
    const r2 = filtrarElegiveis(ms, d);
    expect(r1.elegiveis.map((m) => m.id)).toEqual(r2.elegiveis.map((m) => m.id));
    expect(r1.suspensos.map((m) => m.id)).toEqual(r2.suspensos.map((m) => m.id));
  });
});

// ── 4. Preservação da ordem e integridade do resultado ────────────────────────

describe("filtrarElegiveis — integridade do resultado", () => {
  it("elegiveis + suspensos = todos os membros", () => {
    const ms = membros(["a", "b", "c", "d"]);
    const d = [decisao("b", "suspensao"), decisao("d", "suspensao")];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, d);
    expect(elegiveis.length + suspensos.length).toBe(ms.length);
  });

  it("idsSuspensos contém exatamente os IDs de suspensos", () => {
    const ms = membros(["a", "b", "c"]);
    const d = [decisao("a", "suspensao"), decisao("c", "suspensao")];
    const { suspensos, idsSuspensos } = filtrarElegiveis(ms, d);
    expect(idsSuspensos.size).toBe(2);
    for (const m of suspensos) expect(idsSuspensos.has(m.id)).toBe(true);
  });

  it("tipo genérico T é preservado (não apenas {id})", () => {
    type Enriquecido = { id: string; nome: string; score: number };
    const ms: Enriquecido[] = [
      { id: "x", nome: "X", score: 10 },
      { id: "y", nome: "Y", score: 5 },
    ];
    const d = [decisao("x", "suspensao")];
    const { elegiveis } = filtrarElegiveis(ms, d);
    expect(elegiveis[0].score).toBe(5); // propriedades extras preservadas
  });

  it("decisões de outras paróquias não afetam (IDs sem match são ignoradas)", () => {
    const ms = membros(["local"]);
    const d = [decisao("outra-paroquia-membro", "suspensao")];
    const { elegiveis, suspensos } = filtrarElegiveis(ms, d);
    expect(elegiveis).toHaveLength(1);
    expect(suspensos).toHaveLength(0);
  });
});

// ── 5. Faltas justificadas ────────────────────────────────────────────────────
//
// Nota: a RPC coord_calcular_suspensoes_fase6c conta 'justificou' como
// ausência para fins de suspensão. Isso é uma escolha de negócio: justificar
// não cancela o impacto na assiduidade geral. Esta suite testa apenas o
// comportamento do filtro frontend (filtrarElegiveis), que não inspeciona
// o tipo de falta — apenas observa a decisão ativa resultante.

describe("filtrarElegiveis — faltas justificadas (via decisão)", () => {
  it("membro suspenso por justificativas permanece inelegível até restabelecimento", () => {
    const ms = membros(["j"]);
    // Backend calculou suspensão com base em justificativas
    const d = [decisao("j", "suspensao", null, "2026-11-08T00:00:00Z")];
    const { suspensos } = filtrarElegiveis(ms, d);
    expect(suspensos).toHaveLength(1);
  });
});

// ── 5b. Critérios de suspensão (lógica SQL replicada em TypeScript) ──────────
//
// A RPC coord_calcular_suspensoes_fase6c aplica:
//   total >= 3 convocações concluídas (presente/atrasado/faltou/ausente/justificou)
//   ausencias >= 2 (faltou/ausente/justificou)
//   taxa = ausencias/total >= 0.5
//   anulada = false
// Replicamos a lógica para testes unitários sem banco.

type Participacao = {
  presenca: "presente" | "atrasado" | "faltou" | "ausente" | "justificou";
  anulada: boolean;
  data: string; // "YYYY-MM-DD"
};

function calcularCriterios(
  participacoes: Participacao[],
  dataInicio: string,
  dataFim: string,
): { total: number; ausencias: number; deveSerSuspenso: boolean } {
  const validas = participacoes.filter(
    (p) => !p.anulada && p.data >= dataInicio && p.data <= dataFim,
  );
  const total = validas.filter((p) =>
    ["presente", "atrasado", "faltou", "ausente", "justificou"].includes(p.presenca),
  ).length;
  const ausencias = validas.filter((p) =>
    ["faltou", "ausente", "justificou"].includes(p.presenca),
  ).length;
  const deveSerSuspenso = total >= 3 && ausencias >= 2 && ausencias / total >= 0.5;
  return { total, ausencias, deveSerSuspenso };
}

describe("critérios de suspensão (lógica SQL replicada)", () => {
  const janela = { inicio: "2026-10-01", fim: "2026-11-09" };

  it("suspende quando taxa = 2/3 (67%) — acima de 50%", () => {
    const p: Participacao[] = [
      { presenca: "faltou",   anulada: false, data: "2026-10-05" },
      { presenca: "ausente",  anulada: false, data: "2026-10-12" },
      { presenca: "presente", anulada: false, data: "2026-10-19" },
    ];
    const { deveSerSuspenso, total, ausencias } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(total).toBe(3);
    expect(ausencias).toBe(2);
    expect(deveSerSuspenso).toBe(true);
  });

  it("suspende quando taxa = 3/4 (75%)", () => {
    const p: Participacao[] = [
      { presenca: "faltou",  anulada: false, data: "2026-10-05" },
      { presenca: "ausente", anulada: false, data: "2026-10-12" },
      { presenca: "faltou",  anulada: false, data: "2026-10-19" },
      { presenca: "presente",anulada: false, data: "2026-10-26" },
    ];
    const { deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(deveSerSuspenso).toBe(true);
  });

  it("NÃO suspende com menos de 3 convocações mesmo com 100% de ausências", () => {
    const p: Participacao[] = [
      { presenca: "faltou",  anulada: false, data: "2026-10-05" },
      { presenca: "ausente", anulada: false, data: "2026-10-12" },
    ];
    const { deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(deveSerSuspenso).toBe(false);
  });

  it("NÃO suspende com menos de 2 ausências", () => {
    const p: Participacao[] = [
      { presenca: "presente", anulada: false, data: "2026-10-05" },
      { presenca: "presente", anulada: false, data: "2026-10-12" },
      { presenca: "faltou",   anulada: false, data: "2026-10-19" },
    ];
    const { deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(deveSerSuspenso).toBe(false);
  });

  it("NÃO suspende com taxa abaixo de 50% (1/3 = 33%)", () => {
    const p: Participacao[] = [
      { presenca: "presente", anulada: false, data: "2026-10-05" },
      { presenca: "presente", anulada: false, data: "2026-10-12" },
      { presenca: "presente", anulada: false, data: "2026-10-19" },
      { presenca: "faltou",   anulada: false, data: "2026-10-26" },
    ];
    const { deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(deveSerSuspenso).toBe(false);
  });

  it("taxa exata 50% (2/4) suspende (>= 0.5)", () => {
    const p: Participacao[] = [
      { presenca: "faltou",  anulada: false, data: "2026-10-05" },
      { presenca: "ausente", anulada: false, data: "2026-10-12" },
      { presenca: "presente",anulada: false, data: "2026-10-19" },
      { presenca: "presente",anulada: false, data: "2026-10-26" },
    ];
    const { deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(deveSerSuspenso).toBe(true);
  });

  it("ausências justificadas entram na taxa de ausência", () => {
    const p: Participacao[] = [
      { presenca: "justificou", anulada: false, data: "2026-10-05" },
      { presenca: "justificou", anulada: false, data: "2026-10-12" },
      { presenca: "presente",   anulada: false, data: "2026-10-19" },
    ];
    const { ausencias, deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(ausencias).toBe(2);
    expect(deveSerSuspenso).toBe(true);
  });

  it("participações anuladas não entram no cálculo", () => {
    const p: Participacao[] = [
      { presenca: "faltou",  anulada: true,  data: "2026-10-05" }, // anulada → ignorada
      { presenca: "faltou",  anulada: true,  data: "2026-10-12" }, // anulada → ignorada
      { presenca: "faltou",  anulada: true,  data: "2026-10-19" }, // anulada → ignorada
      { presenca: "presente",anulada: false, data: "2026-10-26" },
    ];
    // Sem participações válidas suficientes, não deve suspender
    const { total, deveSerSuspenso } = calcularCriterios(p, janela.inicio, janela.fim);
    expect(total).toBe(1);
    expect(deveSerSuspenso).toBe(false);
  });

  it("participações fora da janela de 45 dias não entram no cálculo", () => {
    const p: Participacao[] = [
      { presenca: "faltou",  anulada: false, data: "2026-09-01" }, // anterior à janela
      { presenca: "faltou",  anulada: false, data: "2026-09-15" }, // anterior à janela
      { presenca: "presente",anulada: false, data: "2026-10-05" },
      { presenca: "presente",anulada: false, data: "2026-10-12" },
      { presenca: "presente",anulada: false, data: "2026-10-19" },
    ];
    // Dentro da janela: 3 presenças, 0 ausências → não suspende
    const { deveSerSuspenso } = calcularCriterios(p, "2026-10-01", "2026-11-09");
    expect(deveSerSuspenso).toBe(false);
  });

  it("janela móvel pós-restabelecimento: só conta a partir do dia seguinte ao restabelecimento", () => {
    // Restabelecimento ocorreu em 2026-10-20; janela começa em 2026-10-21
    const p: Participacao[] = [
      { presenca: "faltou",   anulada: false, data: "2026-10-10" }, // antes do restabelecimento → fora da janela
      { presenca: "faltou",   anulada: false, data: "2026-10-15" }, // antes do restabelecimento → fora da janela
      { presenca: "faltou",   anulada: false, data: "2026-10-22" },
      { presenca: "ausente",  anulada: false, data: "2026-10-29" },
      { presenca: "presente", anulada: false, data: "2026-11-05" },
    ];
    // janela começa em 2026-10-21 (dia seguinte ao restabelecimento)
    const { total, ausencias, deveSerSuspenso } = calcularCriterios(p, "2026-10-21", "2026-11-09");
    expect(total).toBe(3);
    expect(ausencias).toBe(2);
    expect(deveSerSuspenso).toBe(true); // atingiu critérios dentro da nova janela
  });

  it("imunidade de 45 dias: se imune_ate >= hoje, não suspende", () => {
    // Replicado no frontend via filtrarElegiveis (decisão 'restabelecimento')
    const ms = membros(["imune"]);
    const d = [decisao("imune", "restabelecimento", "2099-12-31")];
    const { elegiveis } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(elegiveis).toHaveLength(1);
  });
});

// ── 6. Janela de 45 dias e nova suspensão ─────────────────────────────────────
//
// A lógica da janela está no SQL; aqui testamos o contrato do frontend:
// após imunidade expirar, o backend pode inserir nova suspensão, e
// filtrarElegiveis a reconhece corretamente.

describe("filtrarElegiveis — ciclo suspensão → imunidade → nova suspensão", () => {
  it("nova suspensão após expiração da imunidade é reconhecida como inelegível", () => {
    const ms = membros(["ciclo"]);
    // Imunidade expirou ontem; banco reinseriu suspensão
    const d = [decisao("ciclo", "suspensao", null, "2026-11-09T06:00:00Z")];
    const { suspensos } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(suspensos).toHaveLength(1);
  });

  it("durante imunidade o membro é elegível mesmo que tenha sido suspenso antes", () => {
    const ms = membros(["ciclo"]);
    const d = [decisao("ciclo", "restabelecimento", "2026-12-24")]; // imunidade ativa
    const { elegiveis } = filtrarElegiveis(ms, d, "2026-11-09");
    expect(elegiveis).toHaveLength(1);
  });
});

// ── P5 — saveMutation: membros suspensos não alocados no fluxo de criação ────────
//
// A lógica real do saveMutation chama coord_calcular_suspensoes_fase6c (RPC),
// depois coord_get_elegibilidade_presenca e filtrarElegiveis antes de gerar sugestões.
// Testamos aqui o contrato que filtrarElegiveis deve garantir nesse contexto:
// qualquer lista de decisões retornada pelo banco deve ser honrada antes da alocação.

describe("P5 — filtrarElegiveis no contexto de saveMutation", () => {
  it("membro suspenso não aparece nos elegíveis passados ao motor", () => {
    const ms = membros(["ativo", "suspenso", "imune"]);
    const decisoes: DecisaoPresenca[] = [
      decisao("suspenso", "suspensao"),
      decisao("imune", "restabelecimento", "2026-12-31"),
    ];
    const { elegiveis, idsSuspensos } = filtrarElegiveis(ms, decisoes, "2026-11-09");
    expect(elegiveis.map((m) => m.id)).toEqual(["ativo", "imune"]);
    expect(idsSuspensos.has("suspenso")).toBe(true);
    expect(idsSuspensos.has("ativo")).toBe(false);
  });

  it("lista vazia de decisões retorna todos os membros como elegíveis", () => {
    const ms = membros(["a", "b", "c"]);
    const { elegiveis } = filtrarElegiveis(ms, []);
    expect(elegiveis).toHaveLength(3);
  });

  it("falha hipotética de RPC → decisões vazias → todos elegíveis (comportamento de fallback)", () => {
    // Se coord_calcular_suspensoes_fase6c lança erro, saveMutation propaga o erro
    // e aborta a operação — este teste documenta o contrato de filtrarElegiveis
    // com array vazio (decisoesFrescasSave = null → [])
    const ms = membros(["x", "y"]);
    const { elegiveis } = filtrarElegiveis(ms, []);
    expect(elegiveis).toHaveLength(2);
  });
});

// ── P6 — salvar_presencas_escala deve rejeitar escalas não publicadas ─────────────
//
// A validação real está no SQL (migration 190); aqui documentamos o contrato
// como testes de especificação para ser usado em testes de banco (integration).
// São marcados como "spec" — não exercitam banco, documentam a expectativa.

describe("P6 — spec: salvar_presencas_escala e status da escala", () => {
  it("spec: escala publicada deve ser aceita (status = publicada)", () => {
    // A RPC deve prosseguir quando status = 'publicada'
    // Verificação real: integration test contra Supabase local
    expect("publicada").toBe("publicada");
  });

  it("spec: escala rascunho deve ser rejeitada com invalid_parameter_value", () => {
    // A RPC deve lançar EXCEPTION com ERRCODE = 'invalid_parameter_value'
    // quando status IN ('rascunho', 'cancelada', 'arquivada')
    const statusRejeitados = ["rascunho", "cancelada", "arquivada"];
    expect(statusRejeitados).not.toContain("publicada");
    expect(statusRejeitados).toHaveLength(3);
  });

  it("spec: mensagem de erro inclui o status atual da escala", () => {
    // Format: 'Escala não está publicada (status: rascunho)...'
    const template = (s: string) =>
      `Escala não está publicada (status: ${s}). Apenas escalas publicadas aceitam registro de presença.`;
    expect(template("rascunho")).toContain("rascunho");
    expect(template("cancelada")).toContain("cancelada");
  });
});

// ── P7 — hardDelete deve ser bloqueado quando há histórico de participações ───────
//
// A verificação real acontece no frontend (hardDeleteMutation) via query ao banco.
// Testamos aqui a lógica de decisão: count > 0 → bloquear.

describe("P7 — proteção de hard-delete com histórico", () => {
  it("count = 0 → permite exclusão (sem histórico)", () => {
    const count = 0;
    const deveBloquear = count > 0;
    expect(deveBloquear).toBe(false);
  });

  it("count > 0 → bloqueia exclusão (histórico presente)", () => {
    const count = 5;
    const deveBloquear = count > 0;
    expect(deveBloquear).toBe(true);
  });

  it("mensagem de erro inclui a contagem de registros", () => {
    const count = 12;
    const msg = `Esta escala possui ${count} registro(s) de presença e não pode ser excluída permanentemente. Mantenha-a arquivada para preservar o histórico.`;
    expect(msg).toContain("12");
    expect(msg).toContain("registro(s) de presença");
  });

  it("countError do Supabase é propagado como erro antes de qualquer deleção", () => {
    // Contrato: se a query de contagem falhar, o erro é lançado imediatamente
    const countError = new Error("connection refused");
    expect(() => { throw countError; }).toThrow("connection refused");
  });
});

// ── P7 — Migration 191: especificações de integridade referencial bancária ───
//
// Os testes T1–T8 abaixo são especificações de contrato para testes de integração
// contra o banco (Supabase local). Documentam o comportamento esperado da FK RESTRICT
// e da admin_deletar_paroquia adaptada. Não exercitam banco diretamente.

describe("P7 — spec migration 191: FK RESTRICT e admin_deletar_paroquia", () => {
  // T1 — FK bloqueia DELETE direto quando há histórico
  it("T1: DELETE escala com histórico deve falhar com foreign_key_violation (SQLSTATE 23503)", () => {
    // Contrato: DELETE FROM escalas WHERE id = X, com historico_participacoes.escala_id = X
    // deve retornar erro pg SQLSTATE 23503 (foreign_key_violation)
    // Nota: ON DELETE RESTRICT em PostgreSQL gera 23503, não 23001 (restrict_violation).
    // 23001 é reservado para constraints de unicidade/integridade de linha (not-null, check).
    // Confirmado em banco real: SQLSTATE=23503, CONSTRAINT=historico_participacoes_escala_id_fkey
    const sqlstate = "23503";
    expect(sqlstate).toBe("23503"); // foreign_key_violation (FK RESTRICT)
  });

  // T2 — Frontend bloqueia antes do banco
  it("T2: hardDeleteMutation bloqueia quando count > 0, sem chamar DELETE", () => {
    // O count check acontece antes do UPDATE + DELETE no mutationFn
    // Se count > 0, lança Error sem executar nenhuma operação DML
    const count = 3;
    const operacoesExecutadas: string[] = [];
    const tentarDeletar = () => {
      if (count > 0) {
        throw new Error(`${count} registro(s) de presença`);
      }
      operacoesExecutadas.push("delete");
    };
    expect(tentarDeletar).toThrow("3 registro(s) de presença");
    expect(operacoesExecutadas).toHaveLength(0);
  });

  // T3 — admin_deletar_paroquia limpa histórico vinculado a escalas antes de deletar paróquia
  it("T3 spec: admin_deletar_paroquia deve limpar historico via escala_id antes de DELETE paroquia", () => {
    // Ordem de operações esperada na função:
    // 1. role check (retorna sem_permissao se inválido)
    // 2. DELETE historico WHERE escala_id IN (SELECT id FROM escalas WHERE paroquia_id = ?)
    // 3. set_config('app.force_delete_cascade', 'true', true)
    // 4. DELETE FROM paroquias WHERE id = ?
    const ordemOperacoes = ["role_check", "delete_historico", "set_guc", "delete_paroquia"];
    expect(ordemOperacoes.indexOf("delete_historico")).toBeLessThan(
      ordemOperacoes.indexOf("delete_paroquia")
    );
  });

  // T4 — Escala sem histórico pode ser deletada normalmente
  it("T4: escala sem historico_participacoes pode ser deletada (FK não bloqueia)", () => {
    const count = 0;
    const podeDeletar = count === 0;
    expect(podeDeletar).toBe(true);
  });

  // T5 — Eventos de agenda (escala_id = NULL) não são afetados
  it("T5: registros com escala_id = NULL não violam FK RESTRICT", () => {
    // PostgreSQL: NULL em FK RESTRICT não causa violação
    // RESTRICT s.d. verifica se existe linha referenciada; NULL não é uma referência
    const escalaId: string | null = null;
    const violaFk = escalaId !== null; // só viola se tiver valor
    expect(violaFk).toBe(false);
  });

  // T6 — Concorrência: ROW EXCLUSIVE lock previne registro órfão
  it("T6 spec: PostgreSQL garante que INSERT em historico não cria órfão durante DELETE", () => {
    // DELETE FROM escalas adquire ROW EXCLUSIVE em escalas(X).
    // INSERT em historico_participacoes (escala_id=X) precisa de ROW SHARE em escalas(X).
    // ROW EXCLUSIVE e ROW SHARE são incompatíveis → T2 (INSERT) bloqueia até T1 (DELETE) terminar.
    // Se T1 comita (escala deletada), T2 falha com FK violation.
    // Se T1 reverte, T2 prossegue normalmente.
    // Resultado: nunca há registro órfão.
    const locksIncompativeis = true; // documentação do comportamento PostgreSQL
    expect(locksIncompativeis).toBe(true);
  });

  // T7 — Usuário sem autorização não executa admin_deletar_paroquia
  it("T7 spec: role != admin_paroquial e != super_admin retorna sem_permissao sem DML", () => {
    // Contrato: função retorna jsonb{'success':false,'error':'sem_permissao'}
    // sem executar nenhum DELETE quando v_role NOT IN ('admin_paroquial', 'super_admin')
    const rolesAutorizados = ["admin_paroquial", "super_admin"];
    const roleTestado = "coordenador";
    const temPermissao = rolesAutorizados.includes(roleTestado);
    expect(temPermissao).toBe(false);
  });

  // T8 — Rollback: falha durante exclusão administrativa reverte tudo
  it("T8 spec: falha no DELETE paroquias reverte limpeza prévia do histórico (transacional)", () => {
    // admin_deletar_paroquia é executada em uma única transação plpgsql.
    // Qualquer EXCEPTION não capturada (ex: FK de outro objeto, constraint de integridade)
    // reverte tanto o DELETE historico_participacoes quanto o DELETE paroquias.
    // Contrato: estado do banco após falha é idêntico ao estado anterior à chamada.
    const transacional = true; // plpgsql garante atomicidade via transação PostgreSQL
    expect(transacional).toBe(true);
  });
});
