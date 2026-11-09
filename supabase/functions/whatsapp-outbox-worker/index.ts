// whatsapp-outbox-worker — Transactional Outbox Worker para WhatsApp
//
// Protocolo v5 (aprovado). Chamado via pg_cron → net.http_post.
//
// Fluxo por item:
//   1. _adquirir_outbox_pendente       → outbox_id, tentativa_id, token, expires_at
//   2. PATCH tentativas (status=iniciado, dispatch_started_at)
//   3. POST /send-whatsapp              (timeout 20s)
//   4. _finalizar_tentativa_outbox      → 'sent'|'retry'|'aguardando'|'failed'|'cancelled'
//
// p_resultado mapeado a partir da resposta da EF:
//   ok:true  enviado:true             → 'confirmado'
//   ok:true  enviado:false pulado:true → consultar DB via motivo
//   ok:false                          → 'falhou' | 'incerto' (se AbortError do fetch worker)
//   fetch AbortError / rede           → 'incerto'
//
// Autenticação: SERVICE_ROLE_KEY (Authorization: Bearer) + INTERNAL_WA_SECRET (X-Wa-Secret)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_WA_SECRET
//
// Resposta do worker: { processed: number, results: WorkerResult[] }
// HTTP 200 sempre — erros são embutidos nos resultados.

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type AcquisitionRow = {
  outbox_id:              string;
  tentativa_id:           string;
  reservation_token:      string;
  reservation_expires_at: string;
};

type OutboxPayload = {
  membro_id:     string;
  paroquia_id:   string;
  evento_tipo:   string;
  evento_ref_id: string;
  context:       Record<string, unknown>;
};

type EFResponse =
  | { ok: true;  enviado: true;  sends_id: string; provider: string }
  | { ok: true;  enviado: false; pulado: true;  motivo: string }
  | { ok: false; enviado: false; pulado: false; motivo: string; sends_id?: string };

type Resultado = "confirmado" | "falhou" | "incerto" | "cancelar";

type WorkerResult = {
  outbox_id:    string;
  tentativa_id: string;
  resultado:    Resultado | null;
  finalizacao:  string | null;    // 'sent'|'retry'|'aguardando'|'failed'|'cancelled'|'noop'
  erro?:        string;
};

// ── Constantes ────────────────────────────────────────────────────────────────

const EF_TIMEOUT_MS    = 20_000;    // timeout worker→EF (20s)
const MAX_ITEMS        = 10;        // max itens por invocação do worker
const MAX_TENTATIVAS   = 5;

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabaseUrl     = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalWaSecret = Deno.env.get("INTERNAL_WA_SECRET") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !internalWaSecret) {
    return Response.json(
      { error: "Env vars ausentes: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_WA_SECRET" },
      { status: 503 },
    );
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const results: WorkerResult[] = [];

  // Processa até MAX_ITEMS pendentes por invocação
  for (let i = 0; i < MAX_ITEMS; i++) {
    const row = await adquirir(client);
    if (!row) break;   // fila vazia

    const result = await processarItem(client, row, supabaseUrl, serviceRoleKey, internalWaSecret);
    results.push(result);

    // Parar se a fila parece vazia (resultado indica que o outbox não foi enfileirado novamente)
    if (result.finalizacao === "sent" || result.finalizacao === "failed" || result.finalizacao === "cancelled") {
      // continua — pode haver mais pendentes
    }
  }

  return Response.json({ processed: results.length, results });
});

// ── Passo 1: adquirir item pendente ───────────────────────────────────────────

async function adquirir(client: SupabaseClient): Promise<AcquisitionRow | null> {
  const { data, error } = await client.rpc("_adquirir_outbox_pendente");
  if (error) {
    console.error("[worker] _adquirir_outbox_pendente erro:", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  return data[0] as AcquisitionRow;
}

// ── Passo 2+3+4: processar um item ───────────────────────────────────────────

async function processarItem(
  client:           SupabaseClient,
  row:              AcquisitionRow,
  supabaseUrl:      string,
  serviceRoleKey:   string,
  internalWaSecret: string,
): Promise<WorkerResult> {
  const { outbox_id, tentativa_id, reservation_token } = row;

  // ── Passo 2: marcar tentativa como iniciada ────────────────────────────────
  const { error: patchErr } = await client
    .from("whatsapp_outbox_tentativas")
    .update({
      status:              "iniciado",
      dispatch_started_at: new Date().toISOString(),
    })
    .eq("id", tentativa_id)
    .eq("reservation_token", reservation_token)
    .eq("status", "reservado");

  if (patchErr) {
    // Outro worker pode ter finalizado — abortar sem dupla finalização
    console.warn("[worker] patch iniciado falhou:", patchErr.message, "outbox:", outbox_id);
    return {
      outbox_id,
      tentativa_id,
      resultado: null,
      finalizacao: null,
      erro: `patch_iniciado: ${patchErr.message}`,
    };
  }

  // ── Passo 3: buscar payload do outbox para montar o request ───────────────
  const { data: outboxRow, error: fetchErr } = await client
    .from("whatsapp_outbox")
    .select("membro_id, paroquia_id, evento_tipo, evento_ref_id, payload")
    .eq("id", outbox_id)
    .single();

  if (fetchErr || !outboxRow) {
    return await finalizar(client, outbox_id, tentativa_id, reservation_token, "falhou", null, {
      erro: `fetch_outbox: ${fetchErr?.message ?? "not found"}`,
    });
  }

  const efPayload: OutboxPayload = {
    membro_id:     outboxRow.membro_id,
    paroquia_id:   outboxRow.paroquia_id,
    evento_tipo:   outboxRow.evento_tipo,
    evento_ref_id: outboxRow.evento_ref_id,
    context:       outboxRow.payload?.context ?? outboxRow.payload ?? {},
  };

  // ── Passo 3b: chamar send-whatsapp EF ─────────────────────────────────────
  let efResponse: EFResponse | null = null;
  let resultado: Resultado = "incerto";
  let sendsId: string | undefined;

  try {
    const ctrl   = new AbortController();
    const timerId = setTimeout(() => ctrl.abort(), EF_TIMEOUT_MS);

    const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "X-Wa-Secret":   internalWaSecret,
      },
      body:   JSON.stringify(efPayload),
      signal: ctrl.signal,
    });

    clearTimeout(timerId);

    if (!res.ok) {
      // HTTP erro da EF (não da rede) — resultado indeterminado
      const body = await res.text().catch(() => "");
      console.warn("[worker] EF retornou HTTP", res.status, body.slice(0, 200));
      resultado = "falhou";
    } else {
      efResponse = await res.json() as EFResponse;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Timeout worker→EF: EF pode ainda estar rodando
      resultado = "incerto";
    } else {
      // Erro de rede: conexão recusada, DNS, etc.
      resultado = "incerto";
      console.warn("[worker] fetch EF erro de rede:", String(err));
    }
  }

  // ── Mapear resposta da EF para p_resultado ─────────────────────────────────
  if (efResponse !== null) {
    if (efResponse.ok && efResponse.enviado) {
      // ok:true, enviado:true — confirmado
      resultado = "confirmado";
      sendsId   = efResponse.sends_id;
    } else if (efResponse.ok && !efResponse.enviado && efResponse.pulado) {
      // ok:true, enviado:false, pulado:true — EF não disparou por motivo de negócio
      resultado = mapearPuladoParaResultado(efResponse.motivo);
    } else if (!efResponse.ok && !efResponse.enviado) {
      // ok:false — EF retornou erro explícito
      resultado = "falhou";
      sendsId   = efResponse.sends_id;
    }
  }

  return await finalizar(client, outbox_id, tentativa_id, reservation_token, resultado, sendsId ?? null, {});
}

// ── Mapeamento motivo pulado → resultado ──────────────────────────────────────
//
// 'duplicado' e 'escala_nao_publicada' são cancelamentos de negócio (sem retry).
// 'sem_consentimento' e 'telefone_ausente' são definitivos (p_definitivo=true).
// 'membro_nao_encontrado' é raro mas definitivo.

function mapearPuladoParaResultado(motivo: string): Resultado {
  switch (motivo) {
    case "duplicado":
    case "escala_nao_publicada":
    case "sem_consentimento":
    case "telefone_ausente":
    case "membro_nao_encontrado":
      return "cancelar";
    default:
      // Motivo desconhecido — tratar como falha para inspeção
      console.warn("[worker] motivo pulado desconhecido:", motivo);
      return "falhou";
  }
}

// ── Passo 4: finalizar tentativa ──────────────────────────────────────────────

async function finalizar(
  client:            SupabaseClient,
  outbox_id:         string,
  tentativa_id:      string,
  reservation_token: string,
  resultado:         Resultado,
  sendsId:           string | null,
  extra:             { erro?: string },
): Promise<WorkerResult> {
  const params: Record<string, unknown> = {
    p_outbox_id:         outbox_id,
    p_tentativa_id:      tentativa_id,
    p_reservation_token: reservation_token,
    p_resultado:         resultado,
    p_max_tentativas:    MAX_TENTATIVAS,
    p_definitivo:        resultado === "cancelar",
  };

  if (sendsId) {
    params.p_sends_id = sendsId;
  }

  const { data, error } = await client.rpc("_finalizar_tentativa_outbox", params);

  if (error) {
    console.error("[worker] _finalizar_tentativa_outbox erro:", error.message, "outbox:", outbox_id);
    return {
      outbox_id,
      tentativa_id,
      resultado,
      finalizacao: null,
      erro: extra.erro
        ? `${extra.erro} | finalizar: ${error.message}`
        : `finalizar: ${error.message}`,
    };
  }

  return {
    outbox_id,
    tentativa_id,
    resultado,
    finalizacao: data as string,
    ...(extra.erro ? { erro: extra.erro } : {}),
  };
}
