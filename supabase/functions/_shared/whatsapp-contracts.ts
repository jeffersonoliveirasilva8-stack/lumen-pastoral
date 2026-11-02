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
  "escala_completa",
  "substituicao_solicitada",
  "substituicao_aprovada",
  "substituicao_recusada",
  "substituicao_confirmada_substituto",  // substituto confirmado (mensagem própria)
  "lembrete_escala",
  "aviso_pastoral",
] as const;

export type EventoTipo = typeof EVENTO_TIPOS[number];

// ── Contextos de template por evento ─────────────────────────────────────────
// Cada EventoTipo tem um TemplateContext específico.
// A Edge Function recebe context como unknown e deve validar com isXxxContext().

export type EscalaPublicadaContext = {
  nome_membro:   string;
  data_escala:   string;  // "DD/MM/YYYY"
  hora_escala?:  string;  // "HH:MM"
  ministerio:    string;
  local?:        string;
  paroquia_nome: string;
  link_escala?:  string;  // URL completa para o portal do membro
};

export type EscalaCompletaContext = {
  nome_membro:   string;
  data_escala:   string;  // "DD/MM/YYYY"
  hora_escala?:  string;  // "HH:MM"
  ministerio:    string;
  local?:        string;
  paroquia_nome: string;
  link_escala?:  string;
};

export type SubstituicaoSolicitadaContext = {
  nome_solicitante: string;
  data_escala:      string;
  hora_escala?:     string;
  ministerio:       string;
  local?:           string;
  paroquia_nome:    string;
  link_escala?:     string;
};

export type SubstituicaoAprovadaContext = {
  nome_membro:   string;
  data_escala:   string;
  hora_escala?:  string;
  ministerio:    string;
  local?:        string;
  paroquia_nome: string;
  link_escala?:  string;
};

export type SubstituicaoRecusadaContext = {
  nome_membro:   string;
  data_escala:   string;
  hora_escala?:  string;
  ministerio:    string;
  motivo?:       string;
  paroquia_nome?: string;
};

export type SubstituicaoConfirmadaSubstitutoContext = {
  /** Nome do membro que será o substituto */
  nome_membro:      string;
  data_escala:      string;
  hora_escala?:     string;
  ministerio:       string;
  local?:           string;
  paroquia_nome:    string;
  link_escala?:     string;
  /** Nome de quem está sendo substituído — opcional mas recomendado */
  nome_solicitante?: string;
};

export type LembreteEscalaContext = {
  nome_membro:   string;
  data_escala:   string;  // "DD/MM/YYYY"
  hora_escala?:  string;  // "HH:MM"
  ministerio:    string;
  local?:        string;
  paroquia_nome: string;
  link_escala?:  string;
};

export type AvisoPastoralContext = {
  nome_membro:   string;
  paroquia_nome: string;
  /** Texto livre da mensagem pastoral — renderizado diretamente */
  mensagem:      string;
  /** Nome do coordenador/responsável que enviou — opcional */
  remetente?:    string;
};

// Union discriminada — usada internamente no renderer de templates
export type TemplateContext =
  | EscalaPublicadaContext
  | EscalaCompletaContext
  | SubstituicaoSolicitadaContext
  | SubstituicaoAprovadaContext
  | SubstituicaoRecusadaContext
  | SubstituicaoConfirmadaSubstitutoContext
  | LembreteEscalaContext
  | AvisoPastoralContext;

// ── Renderer de mensagens ─────────────────────────────────────────────────────
// A Edge Function chama renderMensagem(evento_tipo, context) antes de enviarWhatsApp.
// Retorna o texto final da mensagem ou lança RangeError se o tipo for inválido.

function _horaLocal(hora?: string): string {
  return hora ? ` às ${hora}` : "";
}

function _local(local?: string): string {
  return local ? `\n📍 Local: ${local}` : "";
}

function _link(link?: string): string {
  return link ? `\n🔗 ${link}` : "";
}

export function renderMensagem(tipo: EventoTipo, ctx: TemplateContext): string {
  switch (tipo) {
    case "escala_publicada": {
      const c = ctx as EscalaPublicadaContext;
      return (
        `Paz e bem, ${c.nome_membro}! 🙏\n\n` +
        `Você foi escalado(a) para servir como *${c.ministerio}* na ` +
        `${c.paroquia_nome}.\n\n` +
        `📅 Data: *${c.data_escala}*${_horaLocal(c.hora_escala)}` +
        `${_local(c.local)}\n\n` +
        `Sua participação é um presente para a nossa comunidade. ` +
        `Que o Senhor abençoe o seu serviço!` +
        `${_link(c.link_escala)}`
      );
    }
    case "escala_completa": {
      const c = ctx as EscalaCompletaContext;
      return (
        `Paz e bem, ${c.nome_membro}! 🙏\n\n` +
        `A escala de *${c.data_escala}*${_horaLocal(c.hora_escala)} está completa! ` +
        `Todos os ministérios foram preenchidos para a celebração na ${c.paroquia_nome}.\n\n` +
        `Você está confirmado(a) no *${c.ministerio}*. ` +
        `Contamos com a sua presença!` +
        `${_local(c.local)}` +
        `${_link(c.link_escala)}`
      );
    }
    case "substituicao_solicitada": {
      const c = ctx as SubstituicaoSolicitadaContext;
      return (
        `Paz e bem! 🙏\n\n` +
        `*${c.nome_solicitante}* precisa de um substituto para o serviço ` +
        `de *${c.ministerio}* na ${c.paroquia_nome}.\n\n` +
        `📅 Data: *${c.data_escala}*${_horaLocal(c.hora_escala)}` +
        `${_local(c.local)}\n\n` +
        `Você pode ajudar? Acesse o portal para aceitar ou recusar.` +
        `${_link(c.link_escala)}`
      );
    }
    case "substituicao_aprovada": {
      const c = ctx as SubstituicaoAprovadaContext;
      return (
        `Paz e bem, ${c.nome_membro}! 🙏\n\n` +
        `Boa notícia! Sua substituição para o serviço de *${c.ministerio}* ` +
        `na ${c.paroquia_nome} foi aprovada. ✅\n\n` +
        `📅 Data: *${c.data_escala}*${_horaLocal(c.hora_escala)}` +
        `${_local(c.local)}\n\n` +
        `Fique tranquilo(a). Que Deus abençoe!` +
        `${_link(c.link_escala)}`
      );
    }
    case "substituicao_recusada": {
      const c = ctx as SubstituicaoRecusadaContext;
      const motivoLine = c.motivo ? `\n\nMotivo: _${c.motivo}_` : "";
      return (
        `Paz e bem, ${c.nome_membro}. 🙏\n\n` +
        `Sua solicitação de substituição para *${c.ministerio}* em ` +
        `*${c.data_escala}* não foi aprovada desta vez.${motivoLine}\n\n` +
        `Em caso de dúvidas, entre em contato com a coordenação.`
      );
    }
    case "substituicao_confirmada_substituto": {
      const c = ctx as SubstituicaoConfirmadaSubstitutoContext;
      const quem = c.nome_solicitante
        ? ` no lugar de *${c.nome_solicitante}*`
        : "";
      return (
        `Paz e bem, ${c.nome_membro}! 🙏\n\n` +
        `Obrigado por aceitar substituir${quem} no serviço de ` +
        `*${c.ministerio}* na ${c.paroquia_nome}. ✅\n\n` +
        `📅 Data: *${c.data_escala}*${_horaLocal(c.hora_escala)}` +
        `${_local(c.local)}\n\n` +
        `Que o Senhor recompense a sua generosidade!` +
        `${_link(c.link_escala)}`
      );
    }
    case "lembrete_escala": {
      const c = ctx as LembreteEscalaContext;
      return (
        `Paz e bem, ${c.nome_membro}! 🙏\n\n` +
        `⏰ *Lembrete de serviço*\n\n` +
        `Você tem *${c.ministerio}* amanhã${_horaLocal(c.hora_escala)} ` +
        `na ${c.paroquia_nome}.\n\n` +
        `📅 Data: *${c.data_escala}*` +
        `${_local(c.local)}\n\n` +
        `Contamos com você! Que Deus abençoe o seu serviço.` +
        `${_link(c.link_escala)}`
      );
    }
    case "aviso_pastoral": {
      const c = ctx as AvisoPastoralContext;
      const assinatura = c.remetente
        ? `\n\n_— ${c.remetente} · ${c.paroquia_nome}_`
        : `\n\n_— ${c.paroquia_nome}_`;
      return (
        `Paz e bem, ${c.nome_membro}! 🙏\n\n` +
        `${c.mensagem}` +
        `${assinatura}`
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
