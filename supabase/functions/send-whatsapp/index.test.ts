// Testes da Edge Function send-whatsapp
//
// Cobertura:
//   SW-1  validatePayload: payload completo válido → null
//   SW-2  validatePayload: membro_id ausente → erro
//   SW-3  validatePayload: paroquia_id ausente → erro
//   SW-4  validatePayload: evento_tipo inválido → erro
//   SW-5  validatePayload: evento_ref_id ausente → erro
//   SW-6  validatePayload: context ausente → erro
//   SW-7  assertProviderConfigured: simulate configurado → não lança
//   SW-8  assertProviderConfigured: URL+KEY configurados → não lança
//   SW-9  assertProviderConfigured: nenhum provider → lança
//   SW-10 renderMensagem: escala_publicada → contém nome e data
//   SW-11 renderMensagem: lembrete_escala com hora → contém hora
//   SW-12 renderMensagem: lembrete_escala sem hora → sem "às"
//   SW-13 renderMensagem: substituicao_recusada sem motivo → sem "Motivo:"
//   SW-14 renderMensagem: evento_tipo inválido → lança RangeError
//   SW-15 renderMensagem: substituicao_confirmada_substituto com nome_solicitante → contém "no lugar de"
//   SW-16 renderMensagem: substituicao_confirmada_substituto sem nome_solicitante → sem "no lugar de"

import { assertEquals, assertMatch, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  assertProviderConfigured,
  renderMensagem,
  validatePayload,
} from "../_shared/whatsapp-contracts.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function basePayload(): Record<string, unknown> {
  return {
    membro_id:     "membro-uuid-001",
    paroquia_id:   "paroquia-uuid-001",
    evento_tipo:   "escala_publicada",
    evento_ref_id: "escala-uuid-001",
    context: {
      nome_membro:   "João Silva",
      data_escala:   "25/12/2026",
      ministerio:    "Leitores",
      paroquia_nome: "Paróquia São José",
    },
  };
}

// ── SW-1 a SW-6: validatePayload ──────────────────────────────────────────────

Deno.test("SW-1 validatePayload: payload completo → null", () => {
  assertEquals(validatePayload(basePayload()), null);
});

Deno.test("SW-2 validatePayload: membro_id ausente → erro", () => {
  const p = { ...basePayload(), membro_id: "" };
  const err = validatePayload(p);
  assertEquals(typeof err, "string");
  assertMatch(err!, /membro_id/);
});

Deno.test("SW-3 validatePayload: paroquia_id ausente → erro", () => {
  const p = { ...basePayload(), paroquia_id: undefined };
  const err = validatePayload(p);
  assertEquals(typeof err, "string");
  assertMatch(err!, /paroquia_id/);
});

Deno.test("SW-4 validatePayload: evento_tipo inválido → erro", () => {
  const p = { ...basePayload(), evento_tipo: "tipo_inexistente" };
  const err = validatePayload(p);
  assertEquals(typeof err, "string");
  assertMatch(err!, /evento_tipo/);
});

Deno.test("SW-5 validatePayload: evento_ref_id ausente → erro", () => {
  const p = { ...basePayload(), evento_ref_id: "" };
  const err = validatePayload(p);
  assertEquals(typeof err, "string");
  assertMatch(err!, /evento_ref_id/);
});

Deno.test("SW-6 validatePayload: context ausente → erro", () => {
  const p = { ...basePayload(), context: null };
  const err = validatePayload(p);
  assertEquals(typeof err, "string");
  assertMatch(err!, /context/);
});

// ── SW-7 a SW-9: assertProviderConfigured ────────────────────────────────────

Deno.test("SW-7 assertProviderConfigured: WHATSAPP_MODE=simulate → não lança", () => {
  const env: Record<string, string> = { WHATSAPP_MODE: "simulate" };
  assertProviderConfigured((k) => env[k]);
});

Deno.test("SW-8 assertProviderConfigured: URL+KEY → não lança", () => {
  const env: Record<string, string> = {
    NOTIFICATION_SRV_URL: "https://example.com",
    NOTIFICATION_SRV_KEY: "key-123",
  };
  assertProviderConfigured((k) => env[k]);
});

Deno.test("SW-9 assertProviderConfigured: nenhum provider → lança", () => {
  assertThrows(
    () => assertProviderConfigured((_k) => undefined),
    Error,
    "Nenhum provider",
  );
});

// ── SW-10 a SW-14: renderMensagem ─────────────────────────────────────────────

Deno.test("SW-10 renderMensagem: escala_publicada contém nome e data", () => {
  const msg = renderMensagem("escala_publicada", {
    nome_membro:   "Maria",
    data_escala:   "25/12/2026",
    ministerio:    "Coroinhas",
    paroquia_nome: "Paróquia Matriz",
  });
  assertMatch(msg, /Maria/);
  assertMatch(msg, /25\/12\/2026/);
  assertMatch(msg, /Coroinhas/);
});

Deno.test("SW-11 renderMensagem: lembrete_escala com hora → contém hora", () => {
  const msg = renderMensagem("lembrete_escala", {
    nome_membro:   "Pedro",
    data_escala:   "26/12/2026",
    hora_escala:   "08:00",
    ministerio:    "Ministério da Música",
    paroquia_nome: "Paróquia São Pedro",
  });
  assertMatch(msg, /08:00/);
});

Deno.test("SW-12 renderMensagem: lembrete_escala sem hora → sem 'às'", () => {
  const msg = renderMensagem("lembrete_escala", {
    nome_membro:   "Ana",
    data_escala:   "27/12/2026",
    ministerio:    "Acolhida",
    paroquia_nome: "Paróquia Nossa Senhora",
  });
  assertEquals(msg.includes(" às "), false);
});

Deno.test("SW-13 renderMensagem: substituicao_recusada sem motivo → sem 'Motivo:'", () => {
  const msg = renderMensagem("substituicao_recusada", {
    nome_membro: "Carlos",
    data_escala: "28/12/2026",
    ministerio:  "Leitores",
  });
  assertEquals(msg.includes("Motivo:"), false);
});

Deno.test("SW-14 renderMensagem: evento_tipo inválido → lança RangeError", () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => renderMensagem("tipo_invalido" as any, {} as any),
    RangeError,
  );
});

// ── SW-15 a SW-16: substituicao_confirmada_substituto ─────────────────────────

Deno.test("SW-15 renderMensagem: substituicao_confirmada_substituto com nome_solicitante", () => {
  const msg = renderMensagem("substituicao_confirmada_substituto", {
    nome_membro:      "Ana Costa",
    data_escala:      "15/11/2026",
    ministerio:       "Leitores",
    paroquia_nome:    "Paróquia São Pedro",
    nome_solicitante: "João Silva",
  });
  assertMatch(msg, /Ana Costa/);
  assertMatch(msg, /João Silva/);
  assertMatch(msg, /no lugar de/);
  assertMatch(msg, /15\/11\/2026/);
});

Deno.test("SW-16 renderMensagem: substituicao_confirmada_substituto sem nome_solicitante", () => {
  const msg = renderMensagem("substituicao_confirmada_substituto", {
    nome_membro:   "Carlos Mendes",
    data_escala:   "20/11/2026",
    ministerio:    "Acolhida",
    paroquia_nome: "Paróquia Nossa Senhora",
  });
  assertMatch(msg, /Carlos Mendes/);
  assertEquals(msg.includes("no lugar de"), false);
});
