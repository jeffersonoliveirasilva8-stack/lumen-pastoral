// @ts-nocheck
// Edge Function — lembrete-escalas
// Roda diariamente via pg_cron ou chamada manual.
// Envia e-mail de lembrete para cada membro atribuído a escalas
// que ocorrem amanhã ou em 2 dias (publicadas).
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SEND_EMAIL_URL  (URL da Edge Function send-email, ex: https://<proj>.supabase.co/functions/v1/send-email)
//   SEND_EMAIL_ANON_KEY  (anon key do projeto, para chamar a função)

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sendEmailUrl = Deno.env.get("SEND_EMAIL_URL") ?? `${supabaseUrl}/functions/v1/send-email`;
  const anonKey      = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SEND_EMAIL_ANON_KEY") ?? "";

  const admin = createClient(supabaseUrl, serviceKey);

  // Datas alvo: amanhã e depois de amanhã (formato YYYY-MM-DD, fuso UTC-3)
  const now       = new Date();
  const offsetMs  = -3 * 60 * 60 * 1000;
  const localNow  = new Date(now.getTime() + offsetMs);
  const toDate    = (d: Date) => d.toISOString().slice(0, 10);
  const amanha    = new Date(localNow); amanha.setUTCDate(amanha.getUTCDate() + 1);
  const depoisDAmanha = new Date(localNow); depoisDAmanha.setUTCDate(depoisDAmanha.getUTCDate() + 2);
  const datas = [toDate(amanha), toDate(depoisDAmanha)];

  // Busca escalas publicadas nessas datas
  const { data: escalas, error: eErr } = await admin
    .from("escalas")
    .select("id, titulo, data, hora_inicio, paroquia_id, paroquias(nome)")
    .eq("status", "publicada")
    .in("data", datas);

  if (eErr) return json({ ok: false, error: eErr.message }, 500);
  if (!escalas || escalas.length === 0) return json({ ok: true, enviados: 0, msg: "Nenhuma escala nos próximos 2 dias." });

  const escalaIds = escalas.map((e: any) => e.id);

  // Busca atribuições com dados do membro e ministério
  const { data: atrib, error: aErr } = await admin
    .from("escala_membros")
    .select("escala_id, ministerio_id, membros(id, nome, email), ministerios(nome)")
    .in("escala_id", escalaIds);

  if (aErr) return json({ ok: false, error: aErr.message }, 500);

  let enviados = 0;
  const erros: string[] = [];

  for (let i = 0; i < (atrib ?? []).length; i++) {
    const a      = (atrib ?? [])[i] as any;
    const membro = a.membros;
    const min    = a.ministerios;
    const escala = escalas.find((e: any) => e.id === a.escala_id) as any;

    if (!membro?.email || !escala) continue;

    const diasRestantes = datas.indexOf(escala.data) + 1; // 1 = amanhã, 2 = depois
    const paroquiaNome  = escala.paroquias?.nome ?? "Pastoral";

    if (i > 0) await new Promise((r) => setTimeout(r, 350));

    try {
      const res = await fetch(sendEmailUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`,
          "apikey": anonKey,
        },
        body: JSON.stringify({
          template:      "lembrete_escala",
          to:            membro.email,
          nome:          membro.nome,
          paroquia:      paroquiaNome,
          escalaTitulo:  escala.titulo,
          escalaData:    escala.data,
          escalaHora:    escala.hora_inicio?.slice(0, 5) ?? "",
          ministerioNome: min?.nome ?? "",
          total:         diasRestantes,
        }),
      });
      if (res.ok) enviados++;
      else {
        const body = await res.text();
        erros.push(`${membro.email}: ${body}`);
      }
    } catch (err: any) {
      erros.push(`${membro.email}: ${err.message}`);
    }
  }

  return json({ ok: true, enviados, erros_count: erros.length, erros });
});
