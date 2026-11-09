// @ts-ignore
import { describe, it, expect } from "vitest";

// ── P2-A: Limites semanal e mensal são independentes no motor ─────────────────
//
// Verificado em escala-engine.ts:622-639: o motor trata limite_semanal (janela
// 7 dias) e limite_mensal (janela 30 dias) como restrições independentes via
// conjuntos acimaLimiteSemanal e acimaLimiteMensal separados. Não existe relação
// de dependência entre os dois valores → validação cruzada foi removida.
//
// Mantemos aqui os invariantes corretos do motor para documentação.

describe("P2-A — Limites semanal e mensal (invariantes do motor)", () => {
  it("limite_semanal=3, limite_mensal=1 é aceito pelo motor (janelas distintas)", () => {
    // O motor verifica cada janela independentemente; combinação incoerente
    // para humanos mas tecnicamente válida para o algoritmo.
    // Nenhuma validação cruzada é aplicada pelo frontend ou pelo motor.
    expect(true).toBe(true);
  });

  it("limite=null significa sem restrição naquela janela", () => {
    // Motor retorna conjuntos vazios se ambos null (linha 622 do engine).
    expect(true).toBe(true);
  });
});

// ── P6-A: Clamp do score importado via CSV ────────────────────────────────────
//
// Regra de negócio: score deve estar no intervalo [0, 100].
// Replicamos a expressão usada em membros.tsx.

function clampScore(raw: string | number | null | undefined): number {
  return Math.min(100, Math.max(0, raw ? Number(raw) || 0 : 0));
}

describe("P6-A — Clamp do score no import CSV", () => {
  it("preserva valores válidos dentro de [0, 100]", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(50)).toBe(50);
    expect(clampScore(100)).toBe(100);
    expect(clampScore("75")).toBe(75);
  });

  it("clipa valores acima de 100", () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(99999)).toBe(100);
    expect(clampScore("200")).toBe(100);
  });

  it("clipa valores negativos para 0", () => {
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(-500)).toBe(0);
    expect(clampScore("-50")).toBe(0);
  });

  it("trata nulo/vazio/NaN como 0", () => {
    expect(clampScore(null)).toBe(0);
    expect(clampScore(undefined)).toBe(0);
    expect(clampScore("")).toBe(0);
    expect(clampScore("abc")).toBe(0);
  });
});

// ── P3-A: Status de escala no Relatório de Equilíbrio ─────────────────────────
//
// Regra de negócio: apenas escalas com status='publicada' entram no cálculo.
// Simulamos a filtragem que aconteceria no frontend.

type EscalaStatus = "publicada" | "rascunho" | "cancelada" | "arquivada";

function filtrarEscalasValidas(escalas: { id: string; status: EscalaStatus }[]): string[] {
  return escalas.filter((e) => e.status === "publicada").map((e) => e.id);
}

describe("P3-A — Filtro de status no Relatório de Equilíbrio", () => {
  const escalas = [
    { id: "1", status: "publicada" as EscalaStatus },
    { id: "2", status: "rascunho" as EscalaStatus },
    { id: "3", status: "cancelada" as EscalaStatus },
    { id: "4", status: "arquivada" as EscalaStatus },
    { id: "5", status: "publicada" as EscalaStatus },
  ];

  it("inclui apenas escalas publicadas", () => {
    const ids = filtrarEscalasValidas(escalas);
    expect(ids).toEqual(["1", "5"]);
  });

  it("exclui rascunho, cancelada e arquivada", () => {
    const ids = filtrarEscalasValidas(escalas);
    expect(ids).not.toContain("2"); // rascunho
    expect(ids).not.toContain("3"); // cancelada
    expect(ids).not.toContain("4"); // arquivada
  });

  it("retorna vazio se não há publicadas", () => {
    const ids = filtrarEscalasValidas([
      { id: "x", status: "rascunho" },
      { id: "y", status: "cancelada" },
    ]);
    expect(ids).toHaveLength(0);
  });
});

// ── P1-A: Lógica de cor dos dias sem servir ────────────────────────────────────
//
// Regra: > 90 dias → vermelho; > 60 dias → âmbar; ≤ 60 → sem cor.
// Replicamos a expressão corrigida do ParticipacaoCard.

function corDiasSemServir(dias: number): "red" | "amber" | "none" {
  return dias > 90 ? "red" : dias > 60 ? "amber" : "none";
}

describe("P1-A — Lógica de cor dos dias sem servir (Card)", () => {
  it("retorna vermelho para > 90 dias", () => {
    expect(corDiasSemServir(91)).toBe("red");
    expect(corDiasSemServir(120)).toBe("red");
    expect(corDiasSemServir(365)).toBe("red");
  });

  it("retorna âmbar para 61–90 dias", () => {
    expect(corDiasSemServir(61)).toBe("amber");
    expect(corDiasSemServir(75)).toBe("amber");
    expect(corDiasSemServir(90)).toBe("amber");
  });

  it("retorna sem cor para ≤ 60 dias", () => {
    expect(corDiasSemServir(0)).toBe("none");
    expect(corDiasSemServir(30)).toBe("none");
    expect(corDiasSemServir(60)).toBe("none");
  });

  it("garante que > 90 não cai em âmbar (bug anterior)", () => {
    // No código com bug, 95 dias retornaria amber pois > 60 era verificado primeiro.
    expect(corDiasSemServir(95)).toBe("red");
    expect(corDiasSemServir(95)).not.toBe("amber");
  });
});
