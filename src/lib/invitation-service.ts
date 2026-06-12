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

export const AccessInvitationService = {
  /** URL canônica de ativação para um token_acesso de membro. */
  getLink(tokenAcesso: string): string {
    return `${window.location.origin}/membro/primeiro-acesso?token=${tokenAcesso}`;
  },

  /**
   * Envia e-mail de convite/ativação via Edge Function send-email.
   * Fallback para signInWithOtp se a Edge Function falhar.
   */
  async sendEmail(params: {
    email: string;
    nome: string;
    paroquiaNome: string;
    tokenAcesso: string;
    template?: "ativacao_conta" | "reenvio_ativacao";
  }): Promise<{ ok: boolean; error?: string }> {
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
      // Fallback: OTP nativo — usa o mesmo redirectTo com o token
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email:   params.email,
        options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
      });
      if (otpErr) return { ok: false, error: otpErr.message };
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
    const msg  = `Olá, ${nome}! Acesse o portal litúrgico da sua paróquia pelo link abaixo:\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  },
};
