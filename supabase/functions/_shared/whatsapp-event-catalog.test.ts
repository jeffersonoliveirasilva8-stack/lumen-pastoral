// T6 — Testes do catálogo de eventos e resolvedores de contexto
//
// Executar: deno test --allow-env supabase/functions/_shared/whatsapp-event-catalog.test.ts

import { assertEquals, assertMatch, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CATALOGO,
  entradaDoCatalogo,
  eventosPorPrioridade,
  formatarData,
  formatarHora,
  resolverContexto,
  resolverEscalaPublicada,
  resolverLembreteEscala,
  resolverSubstituicaoAprovada,
  resolverSubstituicaoRecusada,
  resolverSubstituicaoSolicitada,
  type EscalaRow,
  type SubstituicaoRow,
} from "./whatsapp-event-catalog.ts";
import { EVENTO_TIPOS } from "./whatsapp-contracts.ts";

// ── Completude do catálogo ────────────────────────────────────────────────────

Deno.test("CATALOGO cobre todos os EventoTipo definidos em EVENTO_TIPOS", () => {
  const catalogoTipos = new Set(CATALOGO.map((e) => e.evento_tipo));
  for (const tipo of EVENTO_TIPOS) {
    assertEquals(catalogoTipos.has(tipo), true, `Tipo '${tipo}' ausente no catálogo`);
  }
});

Deno.test("CATALOGO não tem entradas duplicadas por evento_tipo", () => {
  const vistos = new Set<string>();
  for (const e of CATALOGO) {
    assertEquals(vistos.has(e.evento_tipo), false, `Duplicata: ${e.evento_tipo}`);
    vistos.add(e.evento_tipo);
  }
});

Deno.test("Todas as entradas têm campos obrigatórios preenchidos", () => {
  for (const e of CATALOGO) {
    assertEquals(typeof e.descricao, "string", `descricao ausente em ${e.evento_tipo}`);
    assertEquals(typeof e.fonte_tabela, "string", `fonte_tabela ausente em ${e.evento_tipo}`);
    assertEquals(e.contexto_campos.length > 0, true, `contexto_campos vazio em ${e.evento_tipo}`);
    assertEquals(typeof e.dedup_nota, "string", `dedup_nota ausente em ${e.evento_tipo}`);
    assertEquals([1, 2, 3].includes(e.prioridade), true, `prioridade inválida em ${e.evento_tipo}`);
  }
});

// ── entradaDoCatalogo ─────────────────────────────────────────────────────────

Deno.test("entradaDoCatalogo — retorna entrada correta para tipo existente", () => {
  const e = entradaDoCatalogo("escala_publicada");
  assertEquals(e?.evento_tipo, "escala_publicada");
  assertEquals(e?.prioridade, 1);
});

Deno.test("entradaDoCatalogo — retorna undefined para tipo inexistente", () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(entradaDoCatalogo("nao_existe" as any), undefined);
});

// ── eventosPorPrioridade ──────────────────────────────────────────────────────

Deno.test("eventosPorPrioridade(1) contém escala_publicada", () => {
  const p1 = eventosPorPrioridade(1);
  assertEquals(p1.includes("escala_publicada"), true);
});

Deno.test("eventosPorPrioridade(3) contém lembrete_escala", () => {
  assertEquals(eventosPorPrioridade(3).includes("lembrete_escala"), true);
});

Deno.test("eventosPorPrioridade — P1+P2+P3 cobre todos os tipos do catálogo", () => {
  const todos = [...eventosPorPrioridade(1), ...eventosPorPrioridade(2), ...eventosPorPrioridade(3)];
  for (const tipo of EVENTO_TIPOS) {
    assertEquals(todos.includes(tipo), true, `${tipo} não aparece em nenhuma prioridade`);
  }
});

// ── formatarData / formatarHora ───────────────────────────────────────────────

Deno.test("formatarData converte ISO para DD/MM/YYYY", () => {
  assertEquals(formatarData("2026-12-25"), "25/12/2026");
  assertEquals(formatarData("2027-01-01"), "01/01/2027");
});

Deno.test("formatarHora descarta segundos de HH:MM:SS", () => {
  assertEquals(formatarHora("09:30:00"), "09:30");
  assertEquals(formatarHora("18:00:00"), "18:00");
});

// ── Resolvedores individuais ──────────────────────────────────────────────────

const escalaRow: EscalaRow = {
  escala_id:   "esc-001",
  membro_nome: "Maria",
  data_escala: "2026-12-25",
  ministerio:  "Canto",
  paroquia_nome: "São José",
  hora_inicio: "09:00:00",
};

const subRow: SubstituicaoRow = {
  substituicao_id:  "sub-001",
  solicitante_nome: "João",
  substituto_nome:  "Pedro",
  data_escala:      "2027-01-15",
  ministerio:       "Leitura",
  paroquia_nome:    "Santa Maria",
  motivo_rejeicao:  "Sem disponibilidade",
};

Deno.test("resolverEscalaPublicada — formata data e preserva campos", () => {
  const ctx = resolverEscalaPublicada(escalaRow);
  assertEquals(ctx.nome_membro, "Maria");
  assertEquals(ctx.data_escala, "25/12/2026");
  assertEquals(ctx.ministerio, "Canto");
  assertEquals(ctx.paroquia_nome, "São José");
});

Deno.test("resolverSubstituicaoSolicitada — usa nome do solicitante", () => {
  const ctx = resolverSubstituicaoSolicitada(subRow);
  assertEquals(ctx.nome_solicitante, "João");
  assertEquals(ctx.data_escala, "15/01/2027");
});

Deno.test("resolverSubstituicaoAprovada — usa nome do substituto", () => {
  const ctx = resolverSubstituicaoAprovada(subRow);
  assertEquals(ctx.nome_membro, "Pedro");
});

Deno.test("resolverSubstituicaoAprovada — fallback para solicitante se substituto ausente", () => {
  const ctx = resolverSubstituicaoAprovada({ ...subRow, substituto_nome: undefined });
  assertEquals(ctx.nome_membro, "João");
});

Deno.test("resolverSubstituicaoRecusada — inclui motivo_rejeicao quando presente", () => {
  const ctx = resolverSubstituicaoRecusada(subRow);
  assertEquals(ctx.motivo, "Sem disponibilidade");
});

Deno.test("resolverSubstituicaoRecusada — motivo undefined quando motivo_rejeicao ausente", () => {
  const ctx = resolverSubstituicaoRecusada({ ...subRow, motivo_rejeicao: undefined });
  assertEquals(ctx.motivo, undefined);
});

Deno.test("resolverLembreteEscala — formata hora corretamente", () => {
  const ctx = resolverLembreteEscala(escalaRow);
  assertEquals(ctx.hora_escala, "09:00");
  assertEquals(ctx.nome_membro, "Maria");
});

Deno.test("resolverLembreteEscala — hora_escala undefined quando hora_inicio ausente", () => {
  const ctx = resolverLembreteEscala({ ...escalaRow, hora_inicio: undefined });
  assertEquals(ctx.hora_escala, undefined);
});

// ── resolverContexto (dispatcher) ────────────────────────────────────────────

Deno.test("resolverContexto — roteia escala_publicada corretamente", () => {
  const ctx = resolverContexto("escala_publicada", escalaRow);
  assertMatch(JSON.stringify(ctx), /Maria/);
});

Deno.test("resolverContexto — roteia substituicao_solicitada corretamente", () => {
  const ctx = resolverContexto("substituicao_solicitada", subRow);
  assertMatch(JSON.stringify(ctx), /João/);
});

Deno.test("resolverContexto — tipo desconhecido lança RangeError", () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => resolverContexto("tipo_invalido" as any, escalaRow),
    RangeError,
  );
});

// ── Condições de disparo — compatibilidade com estados reais do banco ─────────

Deno.test("Catálogo substituicao_aprovada documenta transição com_voluntario→aprovada", () => {
  const e = entradaDoCatalogo("substituicao_aprovada");
  assertMatch(e!.condicao_disparo!, /com_voluntario/);
  assertMatch(e!.condicao_disparo!, /aprovada/);
  // Garante que 'pendente' (status inexistente) não está documentado
  assertEquals(e!.condicao_disparo!.includes("pendente"), false);
});

Deno.test("Catálogo substituicao_recusada documenta transição para rejeitada (status real do banco)", () => {
  const e = entradaDoCatalogo("substituicao_recusada");
  assertMatch(e!.condicao_disparo!, /rejeitada/);
  // Garante que 'recusada' (status inexistente) não está documentado
  assertEquals(e!.condicao_disparo!.includes("'recusada'"), false);
});

Deno.test("Catálogo substituicao_recusada usa motivo_rejeicao (campo real do banco)", () => {
  const e = entradaDoCatalogo("substituicao_recusada");
  assertEquals(e!.contexto_campos.some((c) => c.includes("motivo_rejeicao")), true);
  assertEquals(e!.contexto_campos.some((c) => c.includes("motivo_recusa")), false);
});

// ── Guards de runtime — campos obrigatórios ausentes ─────────────────────────

Deno.test("resolverContexto — lança TypeError se membro_nome ausente em escala_publicada", () => {
  assertThrows(
    () => resolverContexto("escala_publicada", { ...escalaRow, membro_nome: "" }),
    TypeError,
    "membro_nome",
  );
});

Deno.test("resolverContexto — lança TypeError se data_escala ausente em escala_publicada", () => {
  assertThrows(
    () => resolverContexto("escala_publicada", { ...escalaRow, data_escala: "" }),
    TypeError,
    "data_escala",
  );
});

Deno.test("resolverContexto — lança TypeError se solicitante_nome ausente em substituicao_recusada", () => {
  assertThrows(
    () => resolverContexto("substituicao_recusada", { ...subRow, solicitante_nome: "" }),
    TypeError,
    "solicitante_nome",
  );
});

Deno.test("formatarData — lança TypeError para string vazia", () => {
  assertThrows(() => formatarData(""), TypeError);
});

Deno.test("formatarData — lança TypeError para formato incorreto", () => {
  assertThrows(() => formatarData("25/12/2026"), TypeError, "YYYY-MM-DD");
});
