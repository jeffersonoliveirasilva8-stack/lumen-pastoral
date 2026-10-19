// T4 — Testes unitários: consentimento, deduplicação, provider, serviço
//
// Executar: deno test --allow-env supabase/functions/_shared/whatsapp.test.ts
//
// Não fazem chamadas de rede, não alteram banco, não usam credenciais.

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { IWhatsAppProvider, SendResult, SimulatedProvider } from "./whatsapp-provider.ts";
import { enviarWhatsApp, EnvioWhatsAppInput } from "./whatsapp-service.ts";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type GateRow = { pode: boolean; telefone: string | null; motivo: string | null };

/** Constrói um SupabaseClient mockado com respostas configuráveis. */
function mockSupabase(opts: {
  gateResult?: { data: GateRow[] | null; error: { message: string } | null };
  insertResult?: { data: { id: string } | null; error: { message: string } | null };
  updateResult?: { error: { message: string } | null };
  // Captura chamadas para asserção
  calls?: { rpc?: unknown[]; insert?: unknown[]; update?: unknown[] };
}) {
  // deno-lint-ignore no-explicit-any
  const mock: any = {
    rpc: (_fn: string, args: unknown) => {
      opts.calls?.rpc?.push(args);
      return Promise.resolve(
        opts.gateResult ?? { data: null, error: { message: "rpc_não_configurado" } },
      );
    },
    from: (_table: string) => ({
      insert: (row: unknown) => {
        opts.calls?.insert?.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                opts.insertResult ?? { data: { id: "mock-id" }, error: null },
              ),
          }),
        };
      },
      update: (patch: unknown) => {
        opts.calls?.update?.push(patch);
        return {
          eq: () =>
            Promise.resolve(opts.updateResult ?? { error: null }),
        };
      },
    }),
  };
  return mock;
}

/** Provider que sempre retorna ok:true */
class OkProvider implements IWhatsAppProvider {
  readonly name = "ok-provider";
  calls: Array<{ telefone: string; mensagem: string }> = [];
  async send(telefone: string, mensagem: string): Promise<SendResult> {
    this.calls.push({ telefone, mensagem });
    return { ok: true, providerRef: "test-ref" };
  }
}

/** Provider que retorna falha configurável */
class FailProvider implements IWhatsAppProvider {
  readonly name = "fail-provider";
  constructor(private status: "failed" | "unknown", private detail = "erro_teste") {}
  async send(_tel: string, _msg: string): Promise<SendResult> {
    return { ok: false, status: this.status, httpStatus: 500, detail: this.detail };
  }
}

/** Provider que lança exceção */
class ThrowProvider implements IWhatsAppProvider {
  readonly name = "throw-provider";
  async send(_tel: string, _msg: string): Promise<SendResult> {
    throw new Error("excecao_inesperada");
  }
}

const baseInput: EnvioWhatsAppInput = {
  membroId:    "aaaa-membro",
  paroquiaId:  "bbbb-paroquia",
  eventoTipo:  "escala_publicada",
  eventoRefId: "cccc-escala",
  mensagem:    "Você foi escalado para domingo.",
};

// ════════════════════════════════════════════════════════════════════════════
// SimulatedProvider
// ════════════════════════════════════════════════════════════════════════════

Deno.test("SimulatedProvider — retorna ok:true sem chamar rede", async () => {
  const p = new SimulatedProvider();
  const result = await p.send("5511987654321", "Teste de mensagem.");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.providerRef, "simulated");
});

Deno.test("SimulatedProvider — nome é 'simulated'", () => {
  assertEquals(new SimulatedProvider().name, "simulated");
});

Deno.test("SimulatedProvider — aceita número com menos de 4 dígitos sem crash", async () => {
  const p = new SimulatedProvider();
  // Número curto: ofuscação deve funcionar sem panic
  const result = await p.send("55", "msg");
  assertEquals(result.ok, true);
});

// ════════════════════════════════════════════════════════════════════════════
// enviarWhatsApp — gate bloqueia
// ════════════════════════════════════════════════════════════════════════════

Deno.test("Serviço — sem consentimento: pulado=true, motivo=sem_consentimento", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "sem_consentimento" }], error: null },
  });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, true);
    assertEquals(result.motivo, "sem_consentimento");
  }
});

Deno.test("Serviço — membro não encontrado: pulado=true, motivo=membro_nao_encontrado", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "membro_nao_encontrado" }], error: null },
  });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, true);
    assertEquals(result.motivo, "membro_nao_encontrado");
  }
});

Deno.test("Serviço — telefone ausente: pulado=true, motivo=telefone_ausente", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "telefone_ausente" }], error: null },
  });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) assertEquals(result.pulado, true);
});

Deno.test("Serviço — duplicata: pulado=true, motivo=duplicado", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "duplicado" }], error: null },
  });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, true);
    assertEquals(result.motivo, "duplicado");
  }
});

Deno.test("Serviço — gate retorna array vazio: pulado=false, motivo=resposta_gate_vazia", async () => {
  const sb = mockSupabase({ gateResult: { data: [], error: null } });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, false);
    assertEquals(result.motivo, "resposta_gate_vazia");
  }
});

Deno.test("Serviço — erro no gate: pulado=false, motivo começa com 'erro_gate'", async () => {
  const sb = mockSupabase({
    gateResult: { data: null, error: { message: "db_error" } },
  });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, false);
    assertMatch(result.motivo, /^erro_gate/);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// enviarWhatsApp — fluxo de envio bem-sucedido
// ════════════════════════════════════════════════════════════════════════════

Deno.test("Serviço — envio bem-sucedido: enviado=true, sendsId preenchido", async () => {
  const calls = { rpc: [] as unknown[], insert: [] as unknown[], update: [] as unknown[] };
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: { id: "sends-uuid-001" }, error: null },
    updateResult: { error: null },
    calls,
  });
  const provider = new OkProvider();
  const result = await enviarWhatsApp(sb, provider, baseInput);

  assertEquals(result.enviado, true);
  if (result.enviado) {
    assertEquals(result.sendsId, "sends-uuid-001");
    assertEquals(result.provider, "ok-provider");
  }
  // Provider foi chamado com o número correto
  assertEquals(provider.calls.length, 1);
  assertEquals(provider.calls[0].telefone, "5511987654321");
  assertEquals(provider.calls[0].mensagem, baseInput.mensagem);
  // Insert foi feito com status pending
  assertEquals(calls.insert.length, 1);
  assertEquals((calls.insert[0] as Record<string, unknown>).status, "pending");
  // Update foi chamado com status sent
  assertEquals(calls.update.length, 1);
  assertEquals((calls.update[0] as Record<string, unknown>).status, "sent");
});

Deno.test("Serviço — insert não grava telefone em texto", async () => {
  const calls = { insert: [] as unknown[] };
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: { id: "x" }, error: null },
    updateResult: { error: null },
    calls,
  });
  await enviarWhatsApp(sb, new OkProvider(), baseInput);
  const row = calls.insert[0] as Record<string, unknown>;
  // Deve ter hash, não número em texto
  assertEquals("telefone_hash" in row, true);
  assertEquals("telefone" in row, false);
  // Hash deve ser 64 hex chars (SHA-256)
  assertMatch(row.telefone_hash as string, /^[0-9a-f]{64}$/);
});

Deno.test("Serviço — SHA-256 é determinístico para o mesmo número", async () => {
  const hashes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const calls = { insert: [] as unknown[] };
    const sb = mockSupabase({
      gateResult: { data: [{ pode: true, telefone: "5511999990000", motivo: null }], error: null },
      insertResult: { data: { id: "x" }, error: null },
      updateResult: { error: null },
      calls,
    });
    await enviarWhatsApp(sb, new OkProvider(), baseInput);
    hashes.push((calls.insert[0] as Record<string, unknown>).telefone_hash as string);
  }
  assertEquals(hashes[0], hashes[1]);
});

// ════════════════════════════════════════════════════════════════════════════
// enviarWhatsApp — falhas de provider
// ════════════════════════════════════════════════════════════════════════════

Deno.test("Serviço — provider retorna 'failed': status gravado, enviado=false", async () => {
  const calls = { update: [] as unknown[] };
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: { id: "sends-fail-001" }, error: null },
    updateResult: { error: null },
    calls,
  });
  const result = await enviarWhatsApp(sb, new FailProvider("failed"), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado && !result.pulado) {
    assertEquals(result.sendsId, "sends-fail-001");
    assertMatch(result.motivo, /provider_failed/);
  }
  assertEquals((calls.update[0] as Record<string, unknown>).status, "failed");
});

Deno.test("Serviço — provider retorna 'unknown': status gravado", async () => {
  const calls = { update: [] as unknown[] };
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: { id: "sends-unk-001" }, error: null },
    updateResult: { error: null },
    calls,
  });
  const result = await enviarWhatsApp(sb, new FailProvider("unknown"), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) assertMatch(result.motivo, /provider_unknown/);
  assertEquals((calls.update[0] as Record<string, unknown>).status, "unknown");
});

Deno.test("Serviço — provider lança exceção: status=failed, motivo começa com excecao_provider", async () => {
  const calls = { update: [] as unknown[] };
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: { id: "sends-throw-001" }, error: null },
    updateResult: { error: null },
    calls,
  });
  const result = await enviarWhatsApp(sb, new ThrowProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) assertMatch(result.motivo, /^excecao_provider/);
  assertEquals((calls.update[0] as Record<string, unknown>).status, "failed");
});

// ════════════════════════════════════════════════════════════════════════════
// enviarWhatsApp — erro no insert
// ════════════════════════════════════════════════════════════════════════════

Deno.test("Serviço — erro no insert: não chama provider, retorna enviado=false", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: null, error: { message: "unique_violation" } },
  });
  const provider = new OkProvider();
  const result = await enviarWhatsApp(sb, provider, baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) assertMatch(result.motivo, /^erro_insert/);
  // Provider NÃO foi chamado
  assertEquals(provider.calls.length, 0);
});
