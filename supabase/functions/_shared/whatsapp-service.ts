// Camada de orquestração de envio WhatsApp
//
// Fluxo: verificar consentimento+dedup (_pode_enviar_whatsapp)
//        → inserir 'pending' em whatsapp_sends
//        → chamar provider.send()
//        → atualizar status (sent/failed/unknown)
//
// Requer client Supabase com service_role (único com EXECUTE na RPC).
// O número em texto NUNCA é logado — apenas o hash SHA-256.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { IWhatsAppProvider } from "./whatsapp-provider.ts";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type EnvioWhatsAppInput = {
  membroId: string;
  paroquiaId: string;
  eventoTipo: string;
  eventoRefId: string;
  mensagem: string;
};

export type EnvioWhatsAppResult =
  | { enviado: true;  sendsId: string; provider: string }
  | { enviado: false; pulado: true;  motivo: string }
  | { enviado: false; pulado: false; motivo: string; sendsId?: string };

// ── Implementação ─────────────────────────────────────────────────────────────

export async function enviarWhatsApp(
  supabase: SupabaseClient,
  provider: IWhatsAppProvider,
  input: EnvioWhatsAppInput,
): Promise<EnvioWhatsAppResult> {
  const { membroId, paroquiaId, eventoTipo, eventoRefId, mensagem } = input;

  // 1. Verificar consentimento + deduplicação
  const { data: gateRows, error: gateErr } = await supabase.rpc(
    "_pode_enviar_whatsapp",
    {
      p_membro_id:     membroId,
      p_evento_tipo:   eventoTipo,
      p_evento_ref_id: eventoRefId,
    },
  );

  if (gateErr) {
    console.error("[whatsapp-service] Erro ao chamar _pode_enviar_whatsapp:", gateErr.message);
    return { enviado: false, pulado: false, motivo: "erro_gate: " + gateErr.message };
  }

  const gate = Array.isArray(gateRows) && gateRows.length > 0
    ? (gateRows[0] as { pode: boolean; telefone: string | null; motivo: string | null })
    : null;

  if (!gate) {
    return { enviado: false, pulado: false, motivo: "resposta_gate_vazia" };
  }

  if (!gate.pode) {
    // Bloqueia sem erro — consentimento ausente, duplicata, membro inativo, etc.
    return { enviado: false, pulado: true, motivo: gate.motivo ?? "bloqueado" };
  }

  const telefone = gate.telefone!;

  // 2. Calcular hash do número — jamais persistir o número em texto
  const telefoneHash = await sha256Hex(telefone);

  // 3. Inserir registro 'pending' ANTES de chamar o provider
  //    Se o processo morrer depois daqui, o pending bloqueia reenvio duplicado.
  const { data: sendsRow, error: insertErr } = await supabase
    .from("whatsapp_sends")
    .insert({
      membro_id:     membroId,
      paroquia_id:   paroquiaId,
      evento_tipo:   eventoTipo,
      evento_ref_id: eventoRefId,
      status:        "pending",
      telefone_hash: telefoneHash,
    })
    .select("id")
    .single();

  if (insertErr || !sendsRow) {
    console.error("[whatsapp-service] Erro ao inserir whatsapp_sends:", insertErr?.message);
    return { enviado: false, pulado: false, motivo: "erro_insert: " + (insertErr?.message ?? "sem_id") };
  }

  const sendsId: string = sendsRow.id;

  // 4. Chamar provider — não lança exceção; erros vêm no retorno
  let sendResult: Awaited<ReturnType<IWhatsAppProvider["send"]>>;
  try {
    sendResult = await provider.send(telefone, mensagem, { eventoTipo, eventoRefId, membroId });
  } catch (err) {
    // Provedor não deveria lançar, mas defendemos aqui
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-service] Exceção inesperada no provider:", detail);
    await atualizarStatus(supabase, sendsId, "failed", undefined, detail);
    return { enviado: false, pulado: false, motivo: "excecao_provider: " + detail, sendsId };
  }

  // 5. Atualizar status conforme resultado do provider
  if (sendResult.ok) {
    // providerRef = UUID da notificação no notificationSrv — útil para reconciliação
    await atualizarStatus(supabase, sendsId, "sent", undefined, sendResult.providerRef);
    return { enviado: true, sendsId, provider: provider.name };
  }

  const novoStatus = sendResult.status; // 'failed' | 'unknown'
  await atualizarStatus(supabase, sendsId, novoStatus, sendResult.httpStatus, sendResult.detail);
  return {
    enviado: false,
    pulado:  false,
    motivo:  `provider_${novoStatus}` + (sendResult.detail ? `: ${sendResult.detail}` : ""),
    sendsId,
  };
}

// ── Helpers privados ──────────────────────────────────────────────────────────

async function atualizarStatus(
  supabase: SupabaseClient,
  sendsId: string,
  status: "sent" | "failed" | "unknown",
  httpStatus?: number,
  detail?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    enviado_em:    status === "sent" ? new Date().toISOString() : undefined,
    resposta_http: httpStatus,
    resposta_body: detail ? detail.slice(0, 500) : undefined,
  };
  // Remove campos undefined para não sobrescrever com NULL acidentalmente
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) delete patch[k];
  }

  const { error } = await supabase
    .from("whatsapp_sends")
    .update(patch)
    .eq("id", sendsId);

  if (error) {
    // Mensagem pode ter sido enviada — logar mas não propagar
    console.error(`[whatsapp-service] Falha ao atualizar status '${status}' para ${sendsId}:`, error.message);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
