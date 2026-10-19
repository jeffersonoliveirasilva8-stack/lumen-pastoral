// T5 — Testes dos contratos: renderMensagem, validatePayload, assertEnvVars
//
// Executar: deno test --allow-env supabase/functions/_shared/whatsapp-contracts.test.ts

import {
  assertEquals,
  assertMatch,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertEnvVars,
  renderMensagem,
  validatePayload,
} from "./whatsapp-contracts.ts";

// ── renderMensagem ────────────────────────────────────────────────────────────

Deno.test("renderMensagem — escala_publicada contém nome e data", () => {
  const msg = renderMensagem("escala_publicada", {
    nome_membro: "Maria",
    data_escala: "25/12/2026",
    ministerio: "Canto",
    paroquia_nome: "São José",
  });
  assertMatch(msg, /Maria/);
  assertMatch(msg, /25\/12\/2026/);
  assertMatch(msg, /Canto/);
  assertMatch(msg, /São José/);
});

Deno.test("renderMensagem — substituicao_solicitada contém nome do solicitante", () => {
  const msg = renderMensagem("substituicao_solicitada", {
    nome_solicitante: "João",
    data_escala: "01/01/2027",
    ministerio: "Leitura",
    paroquia_nome: "Santa Maria",
  });
  assertMatch(msg, /João/);
  assertMatch(msg, /01\/01\/2027/);
});

Deno.test("renderMensagem — substituicao_aprovada contém confirmação", () => {
  const msg = renderMensagem("substituicao_aprovada", {
    nome_membro: "Pedro",
    data_escala: "15/03/2027",
    ministerio: "Acolhida",
    paroquia_nome: "São Paulo",
  });
  assertMatch(msg, /Pedro/);
  assertMatch(msg, /aprovada/i);
});

Deno.test("renderMensagem — substituicao_recusada sem motivo", () => {
  const msg = renderMensagem("substituicao_recusada", {
    nome_membro: "Ana",
    data_escala: "20/04/2027",
    ministerio: "Coral",
  });
  assertMatch(msg, /Ana/);
  // Sem motivo, não deve aparecer "Motivo:"
  assertEquals(msg.includes("Motivo:"), false);
});

Deno.test("renderMensagem — substituicao_recusada com motivo", () => {
  const msg = renderMensagem("substituicao_recusada", {
    nome_membro: "Ana",
    data_escala: "20/04/2027",
    ministerio: "Coral",
    motivo: "Agenda cheia",
  });
  assertMatch(msg, /Agenda cheia/);
});

Deno.test("renderMensagem — lembrete_escala com hora", () => {
  const msg = renderMensagem("lembrete_escala", {
    nome_membro: "Carlos",
    data_escala: "10/05/2027",
    hora_escala: "09:30",
    ministerio: "Organista",
    paroquia_nome: "Nossa Senhora",
  });
  assertMatch(msg, /09:30/);
  assertMatch(msg, /Carlos/);
});

Deno.test("renderMensagem — lembrete_escala sem hora não menciona horário", () => {
  const msg = renderMensagem("lembrete_escala", {
    nome_membro: "Carlos",
    data_escala: "10/05/2027",
    ministerio: "Organista",
    paroquia_nome: "Nossa Senhora",
  });
  // "às" só aparece quando há hora
  assertEquals(msg.includes(" às "), false);
});

Deno.test("renderMensagem — tipo desconhecido lança RangeError", () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => renderMensagem("tipo_inexistente" as any, {} as any),
    RangeError,
    "tipo_inexistente",
  );
});

// ── validatePayload ───────────────────────────────────────────────────────────

Deno.test("validatePayload — payload válido retorna null", () => {
  assertEquals(
    validatePayload({
      membro_id:     "uuid-membro",
      paroquia_id:   "uuid-paroquia",
      evento_tipo:   "escala_publicada",
      evento_ref_id: "uuid-escala",
      context:       { nome_membro: "X", data_escala: "01/01/2027", ministerio: "Y", paroquia_nome: "Z" },
    }),
    null,
  );
});

Deno.test("validatePayload — sem membro_id retorna erro", () => {
  const err = validatePayload({
    paroquia_id: "x", evento_tipo: "escala_publicada",
    evento_ref_id: "x", context: {},
  });
  assertMatch(err!, /membro_id/);
});

Deno.test("validatePayload — evento_tipo inválido retorna erro com lista de aceitos", () => {
  const err = validatePayload({
    membro_id: "x", paroquia_id: "x",
    evento_tipo: "tipo_invalido",
    evento_ref_id: "x", context: {},
  });
  assertMatch(err!, /tipo_invalido/);
  assertMatch(err!, /escala_publicada/);
});

Deno.test("validatePayload — sem context retorna erro", () => {
  const err = validatePayload({
    membro_id: "x", paroquia_id: "x",
    evento_tipo: "lembrete_escala", evento_ref_id: "x",
  });
  assertMatch(err!, /context/);
});

Deno.test("validatePayload — payload não-objeto retorna erro", () => {
  assertEquals(typeof validatePayload(null), "string");
  assertEquals(typeof validatePayload("string"), "string");
  assertEquals(typeof validatePayload(42), "string");
});

// ── assertEnvVars ─────────────────────────────────────────────────────────────

Deno.test("assertEnvVars — todas presentes: não lança", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    WHATSAPP_MODE: "simulate",
  };
  // Não deve lançar
  assertEnvVars((k) => env[k]);
});

Deno.test("assertEnvVars — variável ausente: lança com o nome da variável", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://x.supabase.co",
    // SUPABASE_SERVICE_ROLE_KEY ausente
    WHATSAPP_MODE: "simulate",
  };
  assertThrows(
    () => assertEnvVars((k) => env[k]),
    Error,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
});

Deno.test("assertEnvVars — múltiplas ausentes: todas listadas no erro", () => {
  assertThrows(
    () => assertEnvVars(() => undefined),
    Error,
    "SUPABASE_URL",
  );
});
