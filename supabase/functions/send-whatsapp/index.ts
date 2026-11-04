// Edge Function — send-whatsapp
//
// Recebe um WhatsAppEventPayload, renderiza a mensagem e envia via
// enviarWhatsApp() + createProvider(). Não altera notificar-whatsapp
// (coordenadores via CallMeBot) — este handler é exclusivo para membros.
//
// POST /functions/v1/send-whatsapp
// Headers:
//   Authorization: Bearer <anon_jwt>   ← validado pelo gateway (verify_jwt=true)
//   X-Wa-Secret:   <internal_wa_secret> ← segredo compartilhado trigger↔função
// Body: WhatsAppEventPayload (ver whatsapp-contracts.ts)
//
// Auth em duas camadas:
//   1. Gateway Supabase (verify_jwt=true): valida assinatura HMAC-SHA256 do JWT
//      — rejeita JWTs forjados. Qualquer JWT válido do projeto passa (anon ou service_role).
//   2. X-Wa-Secret: segredo dedicado (UUID gerado na migration, armazenado em
//      _push_config como 'internal_wa_secret' e em Supabase Secrets como
//      INTERNAL_WA_SECRET). Comparado via timingSafeEqual para evitar timing attacks.
//      Esse segredo NÃO é o service_role key — é de escopo limitado.
//
// Respostas:
//   200 ok:true  enviado:true  — mensagem enfileirada no notificationSrv
//   200 ok:true  enviado:false pulado:true — consentimento ausente / dedup / guard
//   200 ok:false enviado:false — falha no envio (provider/db)
//   400 ok:false error         — payload inválido
//   401 ok:false error         — não autorizado
//   503 ok:false error         — provider ou secret não configurado

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
// timingSafeEqual: compara dois strings byte a byte (XOR) para evitar timing
// attacks. Usada na verificação do X-Wa-Secret.
//
// extractJwtRole: decodifica o claim 'role' do payload JWT (base64url).
// Mantida para inspeção defensiva e testes, mas não é parte do caminho
// principal de autenticação desta função.

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
  //    (a) Gateway Supabase (verify_jwt=true) valida assinatura HMAC-SHA256 do JWT
  //        antes de passar a requisição para cá. Qualquer JWT válido do projeto
  //        passa (anon ou service_role) — rejeita apenas JWTs forjados.
  //    (b) X-Wa-Secret: segredo dedicado, escopo limitado (UUID, não é service_role key).
  //        Comparado via timingSafeEqual para evitar timing attacks.
  //        Armazenado em _push_config['internal_wa_secret'] (trigger → banco)
  //        e em INTERNAL_WA_SECRET (Supabase Secrets → Edge Function).
  const expectedSecret = Deno.env.get("INTERNAL_WA_SECRET");
  if (!expectedSecret) {
    console.error("[send-whatsapp] INTERNAL_WA_SECRET não configurado");
    return json({ ok: false, error: "WA secret não configurado" }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const waSecret = req.headers.get("X-Wa-Secret") ?? "";
  if (!timingSafeEqual(waSecret, expectedSecret)) {
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

  // 5b. Guard de rollback: verifica que o objeto de origem ainda está no estado
  //     esperado antes de inserir um pending record. pg_net não reverte chamadas
  //     HTTP em rollback de transação; esta verificação mitiga envios fantasmas.
  if (payload.evento_tipo === "escala_publicada") {
    const supabaseGuard = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // evento_ref_id pode ser escalas.id (trigger 171) ou escala_membros.id (trigger 177)
    const { data: escalaDir } = await supabaseGuard
      .from("escalas")
      .select("status")
      .eq("id", payload.evento_ref_id)
      .maybeSingle();

    let escalaStatus: string | null = null;
    if (escalaDir) {
      escalaStatus = escalaDir.status;
    } else {
      // Fallback: tenta via escala_membros.id (inclusão posterior — trigger 177)
      const { data: em } = await supabaseGuard
        .from("escala_membros")
        .select("escalas(status)")
        .eq("id", payload.evento_ref_id)
        .maybeSingle();
      escalaStatus = (em?.escalas as { status?: string } | null)?.status ?? null;
    }

    if (!escalaStatus || escalaStatus !== "publicada") {
      console.warn(`[send-whatsapp] escala ref ${payload.evento_ref_id} não está mais publicada — pulado`);
      return json({ ok: true, enviado: false, pulado: true, motivo: "escala_nao_publicada" });
    }
  }

  if (payload.evento_tipo === "escala_funcao_alterada") {
    // context.escala_id é obrigatório em runtime: o evento_ref_id é um UUID md5
    // que não referencia nenhuma tabela; a verificação do status depende do escala_id.
    const escalaId = (payload.context as { escala_id?: string }).escala_id;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!escalaId || typeof escalaId !== "string" || escalaId.trim() === "") {
      console.error("[send-whatsapp] context.escala_id ausente em escala_funcao_alterada");
      return json({ ok: false, error: "context.escala_id obrigatório para escala_funcao_alterada" }, 400);
    }
    if (!UUID_RE.test(escalaId)) {
      console.error("[send-whatsapp] context.escala_id não é um UUID válido:", escalaId);
      return json({ ok: false, error: "context.escala_id não é um UUID válido" }, 400);
    }
    const supabaseGuard = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: escala } = await supabaseGuard
      .from("escalas")
      .select("status")
      .eq("id", escalaId)
      .maybeSingle();
    if (!escala || escala.status !== "publicada") {
      console.warn(`[send-whatsapp] escala ${escalaId} não está mais publicada (funcao_alterada) — pulado`);
      return json({ ok: true, enviado: false, pulado: true, motivo: "escala_nao_publicada" });
    }
  }

  if (payload.evento_tipo === "escala_completa") {
    const supabaseGuard = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: escala } = await supabaseGuard
      .from("escalas")
      .select("status")
      .eq("id", payload.evento_ref_id)
      .single();
    if (!escala || escala.status !== "publicada") {
      console.warn(`[send-whatsapp] escala ${payload.evento_ref_id} não está mais publicada — pulado (escala_completa)`);
      return json({ ok: true, enviado: false, pulado: true, motivo: "escala_nao_publicada" });
    }
  }

  if (
    payload.evento_tipo === "substituicao_aprovada" ||
    payload.evento_tipo === "substituicao_confirmada_substituto"
  ) {
    const supabaseGuard = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: sub } = await supabaseGuard
      .from("substituicoes")
      .select("status")
      .eq("id", payload.evento_ref_id)
      .single();
    if (!sub || sub.status !== "aprovada") {
      console.warn(`[send-whatsapp] substituição ${payload.evento_ref_id} não está mais aprovada — pulado`);
      return json({ ok: true, enviado: false, pulado: true, motivo: "substituicao_nao_aprovada" });
    }
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
    // Para avisos pastorais: registra 'pulado' no destinatário so que o histórico
    // mostre o resultado real em vez de 'pending' indefinido.
    if (payload.evento_tipo === "aviso_pastoral") {
      try {
        const supabaseService = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await supabaseService.rpc("cp_marcar_pulado", {
          p_mensagem_id: payload.evento_ref_id,
          p_membro_id:   payload.membro_id,
          p_motivo:      result.motivo ?? "bloqueado",
        });
      } catch (err) {
        // Não impede a resposta — falha silenciosa no best-effort
        console.warn("[send-whatsapp] cp_marcar_pulado falhou:", String(err));
      }
    }
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
