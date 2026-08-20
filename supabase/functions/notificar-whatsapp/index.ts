// Edge Function — notificar-whatsapp
// Envia mensagens WhatsApp via CallMeBot para o coordenador em eventos críticos.
//
// POST /functions/v1/notificar-whatsapp
// Body: { evento: string, dados: Record<string, string> }
//
// Eventos suportados:
//   "novo_voluntario"        — membro se voluntariou para substituição
//   "nova_substituicao"      — membro abriu pedido de substituição
//   "membro_pendente"        — novo membro aguardando aprovação
//   "substituicao_aprovada"  — confirmação de aprovação (para auditoria)
//   "teste"                  — testa a integração

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendWhatsApp(phone: string, apikey: string, text: string): Promise<boolean> {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

function buildMessage(evento: string, dados: Record<string, string>): string {
  const hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  switch (evento) {
    case "novo_voluntario":
      return (
        `🙋 *Voluntário na substituição*\n` +
        `📋 Escala: ${dados.escala ?? "—"}\n` +
        `⛪ Função: ${dados.ministerio ?? "—"}\n` +
        `👤 Solicitante: ${dados.solicitante ?? "—"}\n` +
        `✅ Voluntário: ${dados.voluntario ?? "—"}\n` +
        `🕐 ${hora} — Aguardando sua aprovação no painel.`
      );

    case "nova_substituicao":
      return (
        `🔄 *Nova substituição solicitada*\n` +
        `📋 Escala: ${dados.escala ?? "—"}\n` +
        `⛪ Função: ${dados.ministerio ?? "—"}\n` +
        `👤 Membro: ${dados.solicitante ?? "—"}\n` +
        `💬 Motivo: ${dados.motivo ?? "Não informado"}\n` +
        `🕐 ${hora} — Acesse o painel para gerenciar.`
      );

    case "membro_pendente":
      return (
        `👥 *Novo membro aguardando aprovação*\n` +
        `👤 Nome: ${dados.nome ?? "—"}\n` +
        `📧 E-mail: ${dados.email ?? "—"}\n` +
        `⛪ Paróquia: ${dados.paroquia ?? "—"}\n` +
        `🕐 ${hora} — Acesse Membros para aprovar.`
      );

    case "substituicao_aprovada":
      return (
        `✅ *Substituição aprovada*\n` +
        `📋 Escala: ${dados.escala ?? "—"}\n` +
        `👤 ${dados.solicitante ?? "—"} substituído por ${dados.substituto ?? "—"}\n` +
        `🕐 ${hora}`
      );

    case "recusa_escala":
      return (
        `🚫 *Membro recusou a escala*\n` +
        `📋 Escala: ${dados.escala ?? "—"}\n` +
        `⛪ Função: ${dados.ministerio ?? "—"}\n` +
        `👤 Membro: ${dados.membro ?? "—"}\n` +
        `💬 Motivo: ${dados.motivo ?? "Não informado"}\n` +
        `🕐 ${hora} — Acesse o painel para gerenciar a substituição.`
      );

    case "teste":
      return `✅ *Lumen Pastoral*\nNotificações WhatsApp ativadas com sucesso! 🎉\n🕐 ${hora}`;

    default:
      return `📢 *Lumen Pastoral* — ${evento}\n🕐 ${hora}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const phone  = Deno.env.get("CALLMEBOT_PHONE");
    const apikey = Deno.env.get("CALLMEBOT_APIKEY");

    if (!phone || !apikey) return json({ ok: false, error: "CallMeBot not configured" }, 503);

    // Aceita chamadas autenticadas (JWT) OU internas (service role via pg_net)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    // Valida JWT se não for service role
    const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "NONE");
    if (!isServiceRole) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (error || !user) return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await req.json() as { evento: string; dados?: Record<string, string> };
    const { evento, dados = {} } = body;
    if (!evento) return json({ ok: false, error: "Missing field: evento" }, 400);

    const message = buildMessage(evento, dados);
    const ok = await sendWhatsApp(phone, apikey, message);

    return json({ ok, evento, message });

  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
