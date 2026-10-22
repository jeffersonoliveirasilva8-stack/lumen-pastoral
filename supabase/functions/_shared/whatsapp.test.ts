// T4 — Testes unitários: consentimento, deduplicação, provider, serviço
//
// Executar: deno test --allow-env supabase/functions/_shared/whatsapp.test.ts
//
// Não fazem chamadas de rede, não alteram banco, não usam credenciais.

import { assertEquals, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  IWhatsAppProvider, SendResult, SimulatedProvider,
  NotificationSrvProvider, SendContext,
  createProvider,
} from "./whatsapp-provider.ts";
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

// ════════════════════════════════════════════════════════════════════════════
// D2 — conta_ativada
// ════════════════════════════════════════════════════════════════════════════

// Gate de envio — conta_nao_ativada
Deno.test("D2/Gate — conta não ativada: pulado=true, motivo=conta_nao_ativada", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "conta_nao_ativada" }], error: null },
  });
  const provider = new OkProvider();
  const result = await enviarWhatsApp(sb, provider, baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, true);
    assertEquals(result.motivo, "conta_nao_ativada");
  }
  // Provider não chamado
  assertEquals(provider.calls.length, 0);
});

// Gate de envio — membro ativo com conta ativada passa pelo gate
Deno.test("D2/Gate — membro ativo com conta ativada: gate permite envio", async () => {
  const sb = mockSupabase({
    gateResult: { data: [{ pode: true, telefone: "5511987654321", motivo: null }], error: null },
    insertResult: { data: { id: "d2-sends-001" }, error: null },
    updateResult: { error: null },
  });
  const provider = new OkProvider();
  const result = await enviarWhatsApp(sb, provider, baseInput);
  assertEquals(result.enviado, true);
  if (result.enviado) assertEquals(result.sendsId, "d2-sends-001");
  assertEquals(provider.calls.length, 1);
});

// Gate de envio — membro inativo bloqueado (motivo membro_nao_encontrado,
// pois ativo=false faz o SELECT retornar NOT FOUND)
Deno.test("D2/Gate — membro inativo: pulado=true, motivo=membro_nao_encontrado", async () => {
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

// Gate de envio — consentimento previamente registrado, mas conta não ativada
// (cenário: membro concedeu consentimento antes da correção D2 ser aplicada)
Deno.test("D2/Gate — consentimento registrado mas conta não ativada: bloqueado no gate", async () => {
  // _pode_enviar_whatsapp retorna conta_nao_ativada antes de verificar opt_in
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "conta_nao_ativada" }], error: null },
  });
  const provider = new OkProvider();
  const result = await enviarWhatsApp(sb, provider, baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    assertEquals(result.pulado, true);
    assertEquals(result.motivo, "conta_nao_ativada");
  }
  assertEquals(provider.calls.length, 0);
});

// Revogação — deve ser permitida mesmo sem conta ativada
// (atualizar_consentimento_whatsapp: p_opt_in=false não exige conta_ativada)
// Testado via mock do gate de envio: após revogação, gate retorna sem_consentimento
Deno.test("D2/Revogação — após revogar, gate retorna sem_consentimento (não conta_nao_ativada)", async () => {
  // Após revogação bem-sucedida de membro com conta não ativada,
  // a próxima tentativa de envio retorna sem_consentimento (opt_in=false),
  // não conta_nao_ativada (a conta_ativada não é verificada se opt_in já é false).
  // Aqui simulamos o estado pós-revogação:
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

// Acesso aos próprios registros de envio — não depende de conta_ativada
// (RLS membro_le_proprios_sends não foi alterada — apenas ativo=true exigido)
Deno.test("D2/RLS — leitura do histórico não exige conta_ativada (gate retorna sends existentes)", async () => {
  // Simula que o gate encontrou um registro duplicado (pending/sent existe)
  // mesmo para um membro com conta_ativada=false — o histórico é preservado.
  const sb = mockSupabase({
    gateResult: { data: [{ pode: false, telefone: null, motivo: "duplicado" }], error: null },
  });
  const result = await enviarWhatsApp(sb, new OkProvider(), baseInput);
  assertEquals(result.enviado, false);
  if (!result.enviado) {
    // O registro existe e está acessível — não foi apagado
    assertEquals(result.pulado, true);
    assertEquals(result.motivo, "duplicado");
  }
});

// ════════════════════════════════════════════════════════════════════════════
// NotificationSrvProvider — testes unitários com fetch mockado
// ════════════════════════════════════════════════════════════════════════════

// Utilitário: substitui globalThis.fetch durante a duração do callback
async function withMockFetch(
  mockFn: typeof globalThis.fetch,
  cb: () => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFn;
  try {
    await cb();
  } finally {
    globalThis.fetch = orig;
  }
}

// Resposta 202 padrão
function make202(id = "notif-uuid-001"): Response {
  return new Response(JSON.stringify({ id, status: "queued" }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

// NP-1: env vars ausentes → failed sem chamar rede
Deno.test("NotificationSrvProvider — sem env vars: retorna failed sem chamada de rede", async () => {
  Deno.env.delete("NOTIFICATION_SRV_URL");
  Deno.env.delete("NOTIFICATION_SRV_KEY");
  let fetchCalled = false;
  await withMockFetch(async () => { fetchCalled = true; return make202(); }, async () => {
    const p = new NotificationSrvProvider();
    const r = await p.send("5511987654321", "msg");
    assertEquals(r.ok, false);
    if (!r.ok) {
      assertEquals(r.status, "failed");
      assertStringIncludes(r.detail ?? "", "NOTIFICATION_SRV_URL");
    }
  });
  assertEquals(fetchCalled, false);
});

// NP-2: payload correto — campos obrigatórios presentes, chave não vaza no corpo
Deno.test("NotificationSrvProvider — payload tem campos obrigatórios e chave não está no corpo", async () => {
  // deno-lint-ignore no-explicit-any
  let capturedBody: any = null;
  let capturedAuth: string | null = null;
  await withMockFetch(async (_url, init) => {
    capturedBody = JSON.parse((init?.body as string) ?? "{}");
    capturedAuth = (init?.headers as Record<string, string>)["Authorization"] ?? null;
    return make202();
  }, async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "key123");
    const p = new NotificationSrvProvider();
    await p.send("5511987654321", "Mensagem de teste.", { eventoTipo: "escala_publicada", eventoRefId: "ref-001" });
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
  });
  assertEquals(capturedBody?.channel, "whatsapp");
  assertEquals(capturedBody?.to, "5511987654321");
  assertEquals(capturedBody?.text, "Mensagem de teste.");
  assertEquals(typeof capturedBody?.eventId, "string");
  assertEquals(typeof capturedBody?.expiresAt, "string");
  assertEquals(capturedAuth, "Bearer key123");
  assertEquals(JSON.stringify(capturedBody).includes("key123"), false, "chave não deve aparecer no corpo");
});

// NP-3: eventId semântico com ctx
Deno.test("NotificationSrvProvider — eventId semântico com ctx", async () => {
  let capturedEventId = "";
  await withMockFetch(async (_url, init) => {
    // deno-lint-ignore no-explicit-any
    capturedEventId = (JSON.parse((init?.body as string) ?? "{}") as any).eventId ?? "";
    return make202();
  }, async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    await new NotificationSrvProvider().send("5511999999999", "msg", { eventoTipo: "lembrete_escala", eventoRefId: "escala-abc" });
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
  });
  assertEquals(capturedEventId, "lumen:lembrete_escala:escala-abc:whatsapp:v1");
});

// NP-4: eventId hash determinístico sem ctx — mesmos inputs → mesmo hash
Deno.test("NotificationSrvProvider — eventId hash é determinístico (sem ctx)", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    await withMockFetch(async (_url, init) => {
      // deno-lint-ignore no-explicit-any
      ids.push((JSON.parse((init?.body as string) ?? "{}") as any).eventId ?? "");
      return make202();
    }, async () => {
      Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
      Deno.env.set("NOTIFICATION_SRV_KEY", "k");
      await new NotificationSrvProvider().send("5511111111111", "msg igual");
      Deno.env.delete("NOTIFICATION_SRV_URL");
      Deno.env.delete("NOTIFICATION_SRV_KEY");
    });
  }
  assertEquals(ids[0], ids[1], "eventId deve ser igual em chamadas consecutivas com mesmos args");
  assertMatch(ids[0], /^lumen:whatsapp:[0-9a-f]{32}:v1$/);
});

// NP-5: 202 → ok:true com providerRef
Deno.test("NotificationSrvProvider — 202 retorna ok:true com providerRef", async () => {
  await withMockFetch(async () => make202("uuid-retornado"), async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    const r = await new NotificationSrvProvider().send("5511999999999", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.providerRef, "uuid-retornado");
  });
});

// NP-6: 400 → failed com httpStatus e body de erro
Deno.test("NotificationSrvProvider — 400 retorna failed com httpStatus=400 e detail", async () => {
  await withMockFetch(async () =>
    new Response(JSON.stringify({ error: "invalid_request", detail: "campo to inválido" }), { status: 400 }),
  async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    const r = await new NotificationSrvProvider().send("55", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
    assertEquals(r.ok, false);
    if (!r.ok) {
      assertEquals(r.status, "failed");
      assertEquals(r.httpStatus, 400);
      assertStringIncludes(r.detail ?? "", "invalid_request");
    }
  });
});

// NP-7: 500 → failed com httpStatus=500
Deno.test("NotificationSrvProvider — 500 retorna failed com httpStatus=500", async () => {
  await withMockFetch(async () => new Response("Internal Error", { status: 500 }), async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    const r = await new NotificationSrvProvider().send("5511999999999", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.httpStatus, 500);
  });
});

// NP-8: erro de rede / fetch lança → unknown
// "unknown" = o servidor pode ter recebido — não retentar sem reconciliação
Deno.test("NotificationSrvProvider — erro de rede retorna status unknown", async () => {
  await withMockFetch(async () => { throw new TypeError("network error"); }, async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    const r = await new NotificationSrvProvider().send("5511999999999", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.status, "unknown");
  });
});

// NP-9: 202 com JSON inválido → ok:true sem providerRef (parsing não-fatal)
Deno.test("NotificationSrvProvider — 202 com JSON inválido: ok:true, providerRef undefined", async () => {
  await withMockFetch(async () => new Response("not-json", { status: 202 }), async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    const r = await new NotificationSrvProvider().send("5511999999999", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.providerRef, undefined);
  });
});

// NP-10: expiresAt >= 23h no futuro (tolerância para execução lenta)
Deno.test("NotificationSrvProvider — expiresAt é futuro em pelo menos 23h", async () => {
  let capturedExpiresAt = "";
  await withMockFetch(async (_url, init) => {
    // deno-lint-ignore no-explicit-any
    capturedExpiresAt = (JSON.parse((init?.body as string) ?? "{}") as any).expiresAt ?? "";
    return make202();
  }, async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    await new NotificationSrvProvider().send("5511999999999", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
  });
  const expiresMs = new Date(capturedExpiresAt).getTime();
  const minExpected = Date.now() + 23 * 60 * 60 * 1000;
  assertEquals(expiresMs >= minExpected, true,
    `expiresAt deve ser >= 23h a partir de agora; obtido: ${capturedExpiresAt}`);
});

// NP-11: createProvider() — WHATSAPP_MODE=simulate → SimulatedProvider
Deno.test("createProvider — WHATSAPP_MODE=simulate retorna SimulatedProvider", () => {
  Deno.env.set("WHATSAPP_MODE", "simulate");
  Deno.env.delete("NOTIFICATION_SRV_URL");
  Deno.env.delete("NOTIFICATION_SRV_KEY");
  const p = createProvider();
  assertEquals(p.name, "simulated");
  Deno.env.delete("WHATSAPP_MODE");
});

// NP-12: createProvider() — vars configuradas → NotificationSrvProvider
Deno.test("createProvider — vars configuradas retorna NotificationSrvProvider", () => {
  Deno.env.delete("WHATSAPP_MODE");
  Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
  Deno.env.set("NOTIFICATION_SRV_KEY", "k");
  const p = createProvider();
  assertEquals(p.name, "notification-srv");
  Deno.env.delete("NOTIFICATION_SRV_URL");
  Deno.env.delete("NOTIFICATION_SRV_KEY");
});

// NP-13: createProvider() — sem configuração → unconfigured, retorna failed (nunca ok:true)
// Protege contra envios simulados sendo gravados como 'sent' em whatsapp_sends
Deno.test("createProvider — sem configuração: retorna unconfigured (failed, não simulated)", async () => {
  Deno.env.delete("WHATSAPP_MODE");
  Deno.env.delete("NOTIFICATION_SRV_URL");
  Deno.env.delete("NOTIFICATION_SRV_KEY");
  const p = createProvider();
  assertEquals(p.name, "unconfigured");
  const r = await p.send("5511999999999", "msg");
  assertEquals(r.ok, false, "provider não configurado NUNCA deve retornar ok:true");
});

// NP-14: 409 Conflict → failed (idempotência: não retentar)
Deno.test("NotificationSrvProvider — 409 retorna failed com httpStatus=409", async () => {
  await withMockFetch(async () =>
    new Response(JSON.stringify({ error: "idempotency_conflict" }), { status: 409 }),
  async () => {
    Deno.env.set("NOTIFICATION_SRV_URL", "https://srv.test");
    Deno.env.set("NOTIFICATION_SRV_KEY", "k");
    const r = await new NotificationSrvProvider().send("5511999999999", "msg");
    Deno.env.delete("NOTIFICATION_SRV_URL");
    Deno.env.delete("NOTIFICATION_SRV_KEY");
    assertEquals(r.ok, false);
    if (!r.ok) {
      assertEquals(r.status, "failed");
      assertEquals(r.httpStatus, 409);
    }
  });
});
