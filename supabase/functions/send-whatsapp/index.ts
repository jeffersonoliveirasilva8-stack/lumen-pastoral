// Edge Function — send-whatsapp
//
// Recebe um WhatsAppEventPayload, renderiza a mensagem e envia via
// enviarWhatsApp() + createProvider(). Não altera notificar-whatsapp
// (coordenadores via CallMeBot) — este handler é exclusivo para membros.
//
// POST /functions/v1/send-whatsapp
// Headers: Authorization: Bearer <service_role_key>
// Body: WhatsAppEventPayload (ver whatsapp-contracts.ts)
//
// Respostas:
//   200 ok:true  enviado:true  — mensagem enfileirada no notificationSrv
//   200 ok:true  enviado:false pulado:true — consentimento ausente / dedup
//   200 ok:false enviado:false — falha no envio (provider/db)
//   400 ok:false error         — payload inválido
//   401 ok:false error         — não autorizado
//   503 ok:false error         — provider não configurado

// @ts-ignore — tipos Deno injetados pelo runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertEnvVars,
  assertProviderConfigured,
  renderMensagem,
  validatePayload,
  type WhatsAppEventPayload,
  type WhatsAppEventResponse,
} from "../_shared/whatsapp-contracts.ts";
import { enviarWhatsApp } from "../_shared/whatsapp-service.ts";
import { createProvider } from "../_shared/whatsapp-provider.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Autenticação ─────────────────────────────────────────────────────────────
// Compara o token apresentado contra SUPABASE_SERVICE_ROLE_KEY usando
// comparação timing-safe (XOR byte a byte). Isso evita timing attacks e
// não depende de validação de assinatura JWT — o token correto SÓ pode ser
// obtido via Supabase Secrets (nunca exposto em código ou logs).
// Fallback de segurança: também verifica o claim 'role' no payload JWT.

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function extractJwtRole(token: string): string | null {
  try {
    const parts  = token.split(".");
    if (parts.length !== 3) return null;
    const b64url = parts[1];
    const b64    = b64url
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(b64url.length + (4 - b64url.length % 4) % 4, "=");
    const claims = JSON.parse(atob(b64)) as Record<string, unknown>;
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const json = (d: WhatsAppEventResponse | { ok: false; error: string }, s = 200) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  // 1. Variáveis de ambiente obrigatórias
  try {
    assertEnvVars(Deno.env.get);
  } catch (err) {
    console.error("[send-whatsapp] Env vars ausentes");
    return json({ ok: false, error: String(err) }, 503);
  }

  // 2. Autenticação — duas camadas:
  //    (a) timing-safe comparison contra SUPABASE_SERVICE_ROLE_KEY
  //    (b) verificação do claim 'role' === 'service_role' no payload JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const token      = authHeader.slice(7).trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // (a) O token deve ser idêntico ao secret armazenado
  if (!serviceKey || !timingSafeEqual(token, serviceKey)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // (b) Defense-in-depth: verifica claim 'role' no payload (sem confiar apenas nele)
  const role = extractJwtRole(token);
  if (role !== "service_role") {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // 3. Validação do payload
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body não é JSON válido" }, 400);
  }

  const validationError = validatePayload(body);
  if (validationError) {
    return json({ ok: false, error: validationError }, 400);
  }

  const payload = body as WhatsAppEventPayload;

  // 4. Provider configurado?
  try {
    assertProviderConfigured(Deno.env.get);
  } catch (err) {
    console.error("[send-whatsapp] Provider não configurado:", String(err));
    return json({ ok: false, error: String(err) }, 503);
  }

  // 5. Renderizar mensagem
  let mensagem: string;
  try {
    mensagem = renderMensagem(payload.evento_tipo, payload.context);
  } catch (err) {
    return json({ ok: false, error: `Erro ao renderizar mensagem: ${String(err)}` }, 400);
  }

  // 6. Enviar via service layer
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const provider = createProvider();

  const result = await enviarWhatsApp(supabase, provider, {
    membroId:    payload.membro_id,
    paroquiaId:  payload.paroquia_id,
    eventoTipo:  payload.evento_tipo,
    eventoRefId: payload.evento_ref_id,
    mensagem,
  });

  // 7. Mapear resultado para resposta HTTP
  if (result.enviado) {
    return json({ ok: true, enviado: true, sends_id: result.sendsId, provider: result.provider });
  }

  if (result.pulado) {
    return json({ ok: true, enviado: false, pulado: true, motivo: result.motivo });
  }

  return json({
    ok:      false,
    enviado: false,
    pulado:  false,
    motivo:  result.motivo,
    ...(result.sendsId ? { sends_id: result.sendsId } : {}),
  });
});
