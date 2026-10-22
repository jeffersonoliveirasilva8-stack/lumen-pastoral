// Camada de transporte WhatsApp — interface + SimulatedProvider
//
// IWhatsAppProvider abstrai o provedor real (CallMeBot, oficial, etc.).
// SimulatedProvider loga o envio sem fazer chamadas de rede — ativado via
// env WHATSAPP_MODE=simulate ou instanciado diretamente em testes.
//
// O provedor NÃO verifica consentimento nem deduplicação — essas
// responsabilidades pertencem ao whatsapp-service.ts.

export type SendResult =
  | { ok: true;  providerRef?: string }
  | { ok: false; status: "failed" | "unknown"; httpStatus?: number; detail?: string };

export type SendContext = {
  eventoTipo?: string;
  eventoRefId?: string;
};

export interface IWhatsAppProvider {
  /**
   * Envia uma mensagem para o número E.164 indicado.
   * @param telefone - número E.164 somente dígitos (ex: "5511987654321")
   * @param mensagem - texto a enviar
   * @param ctx      - contexto de negócio opcional (usado para eventId semântico)
   * @returns SendResult — nunca lança exceção; erros são encapsulados no retorno
   */
  send(telefone: string, mensagem: string, ctx?: SendContext): Promise<SendResult>;

  /** Identificador legível do provedor — gravado no log de envios. */
  readonly name: string;
}

// ── SimulatedProvider ─────────────────────────────────────────────────────────
// Não faz chamadas de rede. Registra os parâmetros em console.log para
// inspeção durante desenvolvimento/testes e retorna ok:true.
// Ativo quando WHATSAPP_MODE=simulate no ambiente da Edge Function.

export class SimulatedProvider implements IWhatsAppProvider {
  readonly name = "simulated";

  async send(telefone: string, mensagem: string, _ctx?: SendContext): Promise<SendResult> {
    // Ofusca os últimos 4 dígitos no log para não expor o número completo
    const redacted = telefone.slice(0, -4).replace(/\d/g, "*") + telefone.slice(-4);
    console.log(
      `[SimulatedProvider] SEND → ${redacted}` +
      ` | ${mensagem.slice(0, 80)}${mensagem.length > 80 ? "…" : ""}`,
    );
    return { ok: true, providerRef: "simulated" };
  }
}

// ── NotificationSrvProvider ───────────────────────────────────────────────────
// Chama o notificationSrv via HTTP REST.
// Env vars necessárias (Supabase Secrets):
//   NOTIFICATION_SRV_URL  — URL HTTPS base do serviço (sem barra final)
//   NOTIFICATION_SRV_KEY  — API_KEY de consumo (nunca logada)
//
// O eventId é gerado deterministicamente a partir de eventoTipo + eventoRefId
// quando passados via opções; caso contrário usa hash(telefone + mensagem).
// expiresAt padrão: 24h a partir do envio.

export type NotificationSrvOptions = {
  expiresInMs?: number; // padrão 86_400_000 (24h)
};

export class NotificationSrvProvider implements IWhatsAppProvider {
  readonly name = "notification-srv";

  constructor(private readonly opts: NotificationSrvOptions = {}) {}

  async send(telefone: string, mensagem: string, ctx?: SendContext): Promise<SendResult> {
    const baseUrl = (Deno.env.get("NOTIFICATION_SRV_URL") ?? "").replace(/\/$/, "");
    const apiKey  = Deno.env.get("NOTIFICATION_SRV_KEY") ?? "";

    if (!baseUrl || !apiKey) {
      return {
        ok: false,
        status: "failed",
        detail: "NOTIFICATION_SRV_URL ou NOTIFICATION_SRV_KEY não configurados",
      };
    }

    const eventId   = await this._buildEventId(telefone, mensagem, ctx);
    const expiresAt = new Date(
      Date.now() + (this.opts.expiresInMs ?? 86_400_000),
    ).toISOString();

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/notifications`, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          eventId,
          channel:   "whatsapp",
          to:        telefone,
          text:      mensagem,
          expiresAt,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // AbortError = timeout; outros = erro de rede
      // Ambos são "unknown": a requisição pode ter chegado ao servidor
      return { ok: false, status: "unknown", detail: String(err) };
    }

    if (res.status === 202) {
      let providerRef: string | undefined;
      try {
        const body = await res.json() as { id?: string };
        providerRef = body.id;
      } catch { /* não-fatal */ }
      return { ok: true, providerRef };
    }

    // Lê corpo do erro para diagnóstico (truncado a 200 chars)
    let errorDetail: string | undefined;
    try {
      const text = await res.text();
      errorDetail = text.slice(0, 200) || undefined;
    } catch { /* não-fatal */ }

    // 409 = conflito de idempotência (conteúdo divergente — não reenviar)
    // 422 = expirado (não deveria ocorrer com 24h)
    // ambos mapeiam para failed
    return { ok: false, status: "failed", httpStatus: res.status, detail: errorDetail };
  }

  private async _buildEventId(telefone: string, mensagem: string, ctx?: SendContext): Promise<string> {
    const tipo  = ctx?.eventoTipo;
    const refId = ctx?.eventoRefId;
    if (tipo && refId) {
      return `lumen:${tipo}:${refId}:whatsapp:v1`;
    }
    // Fallback: hash dos dados — determinístico para idempotência em retry
    const raw = new TextEncoder().encode(`${telefone}:${mensagem}`);
    const buf  = await crypto.subtle.digest("SHA-256", raw);
    const hex  = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    return `lumen:whatsapp:${hex}:v1`;
  }
}

// ── UnconfiguredProvider ─────────────────────────────────────────────────────
// Fallback quando nenhum provider real está configurado e modo simulate não
// foi explicitamente ativado. Retorna failed — nunca ok:true — para evitar
// que envios simulados sejam gravados como 'sent' em whatsapp_sends.

class UnconfiguredProvider implements IWhatsAppProvider {
  readonly name = "unconfigured";
  async send(_tel: string, _msg: string, _ctx?: SendContext): Promise<SendResult> {
    return {
      ok:     false,
      status: "failed",
      detail: "Nenhum provedor configurado. Defina NOTIFICATION_SRV_URL + NOTIFICATION_SRV_KEY ou WHATSAPP_MODE=simulate.",
    };
  }
}

// ── Fábrica: escolhe o provider pela variável de ambiente ─────────────────────
// WHATSAPP_MODE=simulate  → SimulatedProvider (para testes/desenvolvimento)
// NOTIFICATION_SRV_URL+KEY configurados → NotificationSrvProvider (produção)
// nenhum → UnconfiguredProvider (falha explícita — não marca como sent)

export function createProvider(opts?: NotificationSrvOptions): IWhatsAppProvider {
  const mode = Deno.env.get("WHATSAPP_MODE") ?? "";
  if (mode === "simulate") {
    console.log("[whatsapp-provider] Modo simulado ativo (WHATSAPP_MODE=simulate).");
    return new SimulatedProvider();
  }

  const hasUrl = !!Deno.env.get("NOTIFICATION_SRV_URL");
  const hasKey = !!Deno.env.get("NOTIFICATION_SRV_KEY");

  if (hasUrl && hasKey) {
    console.log("[whatsapp-provider] Usando NotificationSrvProvider.");
    return new NotificationSrvProvider(opts);
  }

  console.error(
    "[whatsapp-provider] NOTIFICATION_SRV_URL/KEY não configurados e WHATSAPP_MODE != simulate. " +
    "Usando UnconfiguredProvider — envios falharão explicitamente.",
  );
  return new UnconfiguredProvider();
}
