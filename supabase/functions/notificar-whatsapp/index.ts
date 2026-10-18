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

    const body = await req.json() as { evento: string; dados?: Record<string, string>; paroquia_id?: string };
    const { evento, dados = {}, paroquia_id } = body;
    if (!evento) return json({ ok: false, error: "Missing field: evento" }, 400);

    // Evento especial: push de teste para um usuário específico (sem WhatsApp)
    if (evento === "teste_push" && dados.user_id && paroquia_id) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: cfg } = await admin.from("_push_config").select("val").eq("key", "internal_push_secret").single();
        if (cfg?.val) {
          const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
              "x-push-secret": cfg.val,
            },
            body: JSON.stringify({
              user_ids: [dados.user_id],
              title: "🔔 Notificações ativas!",
              body: "Lumen Pastoral está enviando alertas para este dispositivo.",
              url: "/painel",
            }),
          });
          const pushData = await pushRes.json().catch(() => ({ status: pushRes.status }));
          return json({ ok: true, evento, push: pushData, push_status: pushRes.status });
        }
        return json({ ok: false, evento, push: "cfg.val ausente" });
      } catch (e) { return json({ ok: false, evento, push_error: String(e) }); }
    }

    const phone  = Deno.env.get("CALLMEBOT_PHONE");
    const apikey = Deno.env.get("CALLMEBOT_APIKEY");
    if (!phone || !apikey) return json({ ok: false, error: "CallMeBot not configured" }, 503);

    const message = buildMessage(evento, dados);
    const ok = await sendWhatsApp(phone, apikey, message);

    // Push para coordenação — apenas para eventos sem push via trigger do banco
    // (nova_substituicao e novo_voluntario já têm push na migration 161)
    const EVENTOS_COM_PUSH = ["recusa_escala", "membro_pendente"];
    if (EVENTOS_COM_PUSH.includes(evento) && paroquia_id) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const admin = createClient(supabaseUrl, serviceKey);

        // Busca auth_user_id de todos os coordenadores/admins da paróquia
        const { data: coords } = await admin
          .from("membros")
          .select("auth_user_id")
          .eq("paroquia_id", paroquia_id)
          .in("tipo_acesso", ["coordenador", "administrador", "vice"])
          .eq("ativo", true)
          .not("auth_user_id", "is", null);

        const userIds = (coords ?? [])
          .map((c: { auth_user_id: string }) => c.auth_user_id)
          .filter(Boolean);

        if (userIds.length > 0) {
          const { data: cfg } = await admin
            .from("_push_config")
            .select("val")
            .eq("key", "internal_push_secret")
            .single();

          const pushSecret = cfg?.val;
          if (pushSecret) {
            const pushTitle = evento === "recusa_escala"
              ? `🚫 ${dados.membro ?? "Membro"} recusou a escala`
              : `👥 Novo membro aguardando aprovação`;
            const pushBody = evento === "recusa_escala"
              ? `${dados.escala ?? ""} · ${dados.ministerio ?? ""}`
              : `${dados.nome ?? ""} · ${dados.paroquia ?? ""}`;
            const pushUrl = evento === "recusa_escala" ? "/substituicoes" : "/membros";

            await fetch(`${supabaseUrl}/functions/v1/send-push`, {
              method: "POST",
              headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
                "x-push-secret": pushSecret,
              },
              body: JSON.stringify({ user_ids: userIds, title: pushTitle, body: pushBody, url: pushUrl }),
            });
          }
        }
      } catch {
        // push é fire-and-forget — falha não bloqueia WhatsApp
      }
    }

    return json({ ok, evento, message });

  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
