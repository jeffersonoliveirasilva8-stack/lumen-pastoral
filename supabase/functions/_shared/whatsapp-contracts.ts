// T5 — Contratos de dados para a Edge Function de envio WhatsApp real
//
// Este arquivo define APENAS tipos e constantes. Sem lógica executável.
// Usado por: whatsapp-service.ts, a futura Edge Function send-whatsapp,
// e os testes de integração (T4/futuro T6).
//
// Bloqueadores ativos (F5/F6/F3): a Edge Function real (M3) ainda não pode
// ser implementada. Este arquivo prepara o contrato sem ativar envio.

// ── Payload de entrada ────────────────────────────────────────────────────────
// Formato recebido pela Edge Function via HTTP POST (chamada interna ou trigger).

export type WhatsAppEventPayload = {
  /** UUID do membro destinatário */
  membro_id: string;
  /** UUID da paróquia — necessário para log e RLS */
  paroquia_id: string;
  /** Tipo canônico do evento — deve existir em EVENTO_TIPOS */
  evento_tipo: EventoTipo;
  /** UUID do objeto que originou o evento (escala_id, substituicao_id, etc.) */
  evento_ref_id: string;
  /**
   * Dados de contexto para renderizar o template da mensagem.
   * Formato específico por evento_tipo — ver TemplateContext abaixo.
   */
  context: TemplateContext;
};

// ── Resposta da Edge Function ─────────────────────────────────────────────────

export type WhatsAppEventResponse =
  | { ok: true;  enviado: true;  sends_id: string; provider: string }
  | { ok: true;  enviado: false; pulado: true;  motivo: string }
  | { ok: false; enviado: false; pulado: false; motivo: string; sends_id?: string }
  | { ok: false; error: string };  // erro de validação / infra antes do gate

// ── Tipos canônicos de evento ─────────────────────────────────────────────────
// Acrescentar aqui ao criar novos tipos; o TypeScript exigirá template correspondente.

export const EVENTO_TIPOS = [
  "escala_publicada",
  "substituicao_solicitada",
  "substituicao_aprovada",
  "substituicao_recusada",
  "substituicao_confirmada_substituto",  // substituto confirmado (mensagem própria)
  "lembrete_escala",
] as const;

export type EventoTipo = typeof EVENTO_TIPOS[number];

// ── Contextos de template por evento ─────────────────────────────────────────
// Cada EventoTipo tem um TemplateContext específico.
// A Edge Function recebe context como unknown e deve validar com isXxxContext().

export type EscalaPublicadaContext = {
  nome_membro:   string;
  data_escala:   string;  // "DD/MM/YYYY"
  ministerio:    string;
  paroquia_nome: string;
};

export type SubstituicaoSolicitadaContext = {
  nome_solicitante: string;
  data_escala:      string;
  ministerio:       string;
  paroquia_nome:    string;
};

export type SubstituicaoAprovadaContext = {
  nome_membro:   string;
  data_escala:   string;
  ministerio:    string;
  paroquia_nome: string;
};

export type SubstituicaoRecusadaContext = {
  nome_membro:   string;
  data_escala:   string;
  ministerio:    string;
  motivo?:       string;
};

export type SubstituicaoConfirmadaSubstitutoContext = {
  /** Nome do membro que será o substituto */
  nome_membro:      string;
  data_escala:      string;
  ministerio:       string;
  paroquia_nome:    string;
  /** Nome de quem está sendo substituído — opcional mas recomendado */
  nome_solicitante?: string;
};

export type LembreteEscalaContext = {
  nome_membro:   string;
  data_escala:   string;  // "DD/MM/YYYY"
  hora_escala?:  string;  // "HH:MM"
  ministerio:    string;
  paroquia_nome: string;
};

// Union discriminada — usada internamente no renderer de templates
export type TemplateContext =
  | EscalaPublicadaContext
  | SubstituicaoSolicitadaContext
  | SubstituicaoAprovadaContext
  | SubstituicaoRecusadaContext
  | SubstituicaoConfirmadaSubstitutoContext
  | LembreteEscalaContext;

// ── Renderer de mensagens ─────────────────────────────────────────────────────
// A Edge Function chama renderMensagem(evento_tipo, context) antes de enviarWhatsApp.
// Retorna o texto final da mensagem ou lança RangeError se o tipo for inválido.

export function renderMensagem(tipo: EventoTipo, ctx: TemplateContext): string {
  switch (tipo) {
    case "escala_publicada": {
      const c = ctx as EscalaPublicadaContext;
      return (
        `Olá, ${c.nome_membro}! 📋\n` +
        `Você foi escalado(a) para *${c.ministerio}* em ${c.paroquia_nome}.\n` +
        `📅 Data: ${c.data_escala}\n` +
        `Acesse o portal para ver os detalhes.`
      );
    }
    case "substituicao_solicitada": {
      const c = ctx as SubstituicaoSolicitadaContext;
      return (
        `Olá! Há uma solicitação de substituição de *${c.nome_solicitante}*.\n` +
        `📅 Escala: ${c.ministerio} — ${c.data_escala} (${c.paroquia_nome})\n` +
        `Acesse o portal para aceitar ou recusar.`
      );
    }
    case "substituicao_aprovada": {
      const c = ctx as SubstituicaoAprovadaContext;
      return (
        `Olá, ${c.nome_membro}! ✅\n` +
        `Sua substituição foi aprovada.\n` +
        `📅 ${c.ministerio} — ${c.data_escala} (${c.paroquia_nome})`
      );
    }
    case "substituicao_recusada": {
      const c = ctx as SubstituicaoRecusadaContext;
      const motivoLine = c.motivo ? `\nMotivo: ${c.motivo}` : "";
      return (
        `Olá, ${c.nome_membro}. A substituição para ${c.data_escala} ` +
        `(${c.ministerio}) não foi aceita.${motivoLine}`
      );
    }
    case "substituicao_confirmada_substituto": {
      const c = ctx as SubstituicaoConfirmadaSubstitutoContext;
      const quem = c.nome_solicitante ? ` no lugar de ${c.nome_solicitante}` : "";
      return (
        `Olá, ${c.nome_membro}! ✅\n` +
        `Você foi confirmado como substituto${quem}.\n` +
        `📅 ${c.ministerio} — ${c.data_escala} (${c.paroquia_nome})`
      );
    }
    case "lembrete_escala": {
      const c = ctx as LembreteEscalaContext;
      const hora = c.hora_escala ? ` às ${c.hora_escala}` : "";
      return (
        `Olá, ${c.nome_membro}! ⏰ Lembrete:\n` +
        `Você tem *${c.ministerio}* amanhã${hora} em ${c.paroquia_nome}.\n` +
        `📅 ${c.data_escala}`
      );
    }
    default: {
      // Garante exhaustiveness em tempo de compilação
      const _never: never = tipo;
      throw new RangeError(`evento_tipo desconhecido: ${_never}`);
    }
  }
}

// ── Variáveis de ambiente requeridas ─────────────────────────────────────────
// A Edge Function valida estas no startup via assertEnvVars().
// Acrescentar aqui ao adicionar novos provedores.

export const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  // NOTIFICATION_SRV_URL + KEY → ativam NotificationSrvProvider
  // WHATSAPP_MODE=simulate → ativa SimulatedProvider (para dev/testes)
  // Pelo menos um dos dois pares deve estar presente em produção.
] as const;

export type RequiredEnvVar = typeof REQUIRED_ENV_VARS[number];

/** Lança se alguma variável obrigatória estiver ausente. */
export function assertEnvVars(get: (key: string) => string | undefined): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !get(v));
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(", ")}`);
  }
}

/**
 * Valida que existe pelo menos um provider configurado.
 * Lança se nem WHATSAPP_MODE=simulate nem NOTIFICATION_SRV_URL+KEY estiverem presentes.
 */
export function assertProviderConfigured(get: (key: string) => string | undefined): void {
  const mode   = get("WHATSAPP_MODE") ?? "";
  const hasUrl = !!get("NOTIFICATION_SRV_URL");
  const hasKey = !!get("NOTIFICATION_SRV_KEY");
  if (mode !== "simulate" && !(hasUrl && hasKey)) {
    throw new Error(
      "Nenhum provider WhatsApp configurado. " +
      "Defina NOTIFICATION_SRV_URL + NOTIFICATION_SRV_KEY ou WHATSAPP_MODE=simulate.",
    );
  }
}

// ── Validação de payload ──────────────────────────────────────────────────────

/** Retorna null se válido, ou string de erro se inválido. */
export function validatePayload(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "payload deve ser um objeto JSON";
  const p = raw as Record<string, unknown>;
  if (typeof p.membro_id !== "string" || !p.membro_id)
    return "membro_id ausente ou inválido";
  if (typeof p.paroquia_id !== "string" || !p.paroquia_id)
    return "paroquia_id ausente ou inválido";
  if (!EVENTO_TIPOS.includes(p.evento_tipo as EventoTipo))
    return `evento_tipo inválido: ${p.evento_tipo}. Aceitos: ${EVENTO_TIPOS.join(", ")}`;
  if (typeof p.evento_ref_id !== "string" || !p.evento_ref_id)
    return "evento_ref_id ausente ou inválido";
  if (!p.context || typeof p.context !== "object")
    return "context ausente ou inválido";
  return null;
}
