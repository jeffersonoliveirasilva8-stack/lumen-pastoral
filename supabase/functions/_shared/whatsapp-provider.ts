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

export interface IWhatsAppProvider {
  /**
   * Envia uma mensagem para o número E.164 indicado.
   * @param telefone - número E.164 somente dígitos (ex: "5511987654321")
   * @param mensagem - texto a enviar
   * @returns SendResult — nunca lança exceção; erros são encapsulados no retorno
   */
  send(telefone: string, mensagem: string): Promise<SendResult>;

  /** Identificador legível do provedor — gravado no log de envios. */
  readonly name: string;
}

// ── SimulatedProvider ─────────────────────────────────────────────────────────
// Não faz chamadas de rede. Registra os parâmetros em console.log para
// inspeção durante desenvolvimento/testes e retorna ok:true.
// Ativo quando WHATSAPP_MODE=simulate no ambiente da Edge Function.

export class SimulatedProvider implements IWhatsAppProvider {
  readonly name = "simulated";

  async send(telefone: string, mensagem: string): Promise<SendResult> {
    // Ofusca os últimos 4 dígitos no log para não expor o número completo
    const redacted = telefone.slice(0, -4).replace(/\d/g, "*") + telefone.slice(-4);
    console.log(
      `[SimulatedProvider] SEND → ${redacted}` +
      ` | ${mensagem.slice(0, 80)}${mensagem.length > 80 ? "…" : ""}`,
    );
    return { ok: true, providerRef: "simulated" };
  }
}

// ── Fábrica: escolhe o provider pela variável de ambiente ─────────────────────
// Uso: const provider = createProvider();
// Retorna SimulatedProvider quando WHATSAPP_MODE=simulate OU quando
// o provedor real não estiver configurado.
// Provedores reais (CallMeBot, oficial) serão adicionados aqui em M3.

export function createProvider(): IWhatsAppProvider {
  const mode = Deno.env.get("WHATSAPP_MODE") ?? "";
  if (mode === "simulate") {
    console.log("[whatsapp-provider] Modo simulado ativo (WHATSAPP_MODE=simulate).");
    return new SimulatedProvider();
  }
  // Provedor real ainda não implementado (aguarda F5/F6/F3).
  // Retorna SimulatedProvider como fallback seguro para não enviar inadvertidamente.
  console.warn(
    "[whatsapp-provider] Provedor real não configurado — usando SimulatedProvider como fallback.",
  );
  return new SimulatedProvider();
}
