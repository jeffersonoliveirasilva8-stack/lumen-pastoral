/**
 * AccessInvitationService — fonte única de geração de links de convite.
 *
 * TODOS os 4 fluxos de convite passam por aqui:
 *   1. Aprovação de solicitação (email automático)
 *   2. Enviar link de acesso (email manual pelo painel)
 *   3. Copiar link de acesso (clipboard)
 *   4. Enviar pelo WhatsApp
 *
 * Todos geram o mesmo destino: /membro/primeiro-acesso?token=UUID
 */

import { supabase } from "@/integrations/supabase/client";

// ── Helpers de rate-limit Supabase Auth ────────────────────────────────────────

/** Detecta se a mensagem de erro é o cooldown de OTP do Supabase Auth. */
export function isCooldownError(error: string | null | undefined): boolean {
  if (!error) return false;
  return (
    /for security purposes.*you can only request this after/i.test(error) ||
    /you can only request this after \d+ seconds?/i.test(error) ||
    /email rate limit exceeded/i.test(error)
  );
}

/** Extrai o número de segundos do cooldown da mensagem de erro. Retorna null se não encontrar. */
export function parseCooldownSeconds(error: string | null | undefined): number | null {
  if (!error) return null;
  const match = error.match(/after (\d+) seconds?/i);
  return match ? parseInt(match[1], 10) : null;
}

// ──────────────────────────────────────────────────────────────────────────────

export const AccessInvitationService = {
  /** URL canônica de ativação para um token_acesso de membro. */
  getLink(tokenAcesso: string): string {
    return `${window.location.origin}/membro/primeiro-acesso?token=${tokenAcesso}`;
  },

  /**
   * Envia e-mail de convite/ativação via Edge Function send-email.
   * Fallback para signInWithOtp se a Edge Function falhar.
   *
   * Retorna `{ cooldown: N }` quando o Supabase Auth está em rate-limit —
   * isso NÍO é falha de envio; o chamador deve tratar como "aguardar N segundos".
   */
  async sendEmail(params: {
    email: string;
    nome: string;
    paroquiaNome: string;
    tokenAcesso: string;
    template?: "ativacao_conta" | "reenvio_ativacao";
  }): Promise<{ ok: boolean; error?: string; cooldown?: number }> {
    const redirectTo = this.getLink(params.tokenAcesso);

    const { error: efErr } = await supabase.functions.invoke("send-email", {
      body: {
        template:   params.template ?? "ativacao_conta",
        to:         params.email,
        nome:       params.nome,
        paroquia:   params.paroquiaNome,
        redirectTo,
      },
    });

    if (efErr) {
      // A Edge Function pode repassar o erro de cooldown do OTP interno.
      if (isCooldownError(efErr.message)) {
        const secs = parseCooldownSeconds(efErr.message);
        return { ok: false, error: efErr.message, cooldown: secs ?? 60 };
      }

      // Fallback: OTP nativo — usa o mesmo redirectTo com o token
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email:   params.email,
        options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
      });

      if (otpErr) {
        if (isCooldownError(otpErr.message)) {
          const secs = parseCooldownSeconds(otpErr.message);
          return { ok: false, error: otpErr.message, cooldown: secs ?? 60 };
        }
        return { ok: false, error: otpErr.message };
      }
    }

    return { ok: true };
  },

  /**
   * Solicita reenvio do link a partir do token (sem precisar do email).
   * Usado pela página /membro/primeiro-acesso quando o membro não está autenticado.
   * A Edge Function busca o email pelo token_acesso no servidor.
   */
  async sendByToken(tokenAcesso: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase.functions.invoke("send-email", {
      body: { template: "ativacao_por_token", token: tokenAcesso },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Copia o link de ativação do membro para a área de transferência. */
  copy(tokenAcesso: string): void {
    navigator.clipboard.writeText(this.getLink(tokenAcesso));
  },

  /** Abre o WhatsApp Web com mensagem e link de ativação do membro. */
  whatsApp(tokenAcesso: string, nome: string): void {
    const link = this.getLink(tokenAcesso);
    const msg = [
      `Olá, ${nome}!`,
      ``,
      `Seu acesso ao Portal Lumen foi liberado.`,
      ``,
      `Caso não tenha recebido o e-mail, utilize o link abaixo para criar sua senha:`,
      link,
      ``,
      `Qualquer dúvida, entre em contato com a coordenação.`,
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  },
};
