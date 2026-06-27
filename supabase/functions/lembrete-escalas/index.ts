// @ts-nocheck
// Edge Function — lembrete-escalas
//
// Modos de operação (parâmetro ?mode= ou campo JSON "mode"):
//   "1dia"    — envia para escalas de amanhã (rodar diariamente ~20h)
//   "sabado"  — sábado à noite: envia para missas de DOMINGO (rodar sáb ~20h)
//   "3horas"  — envia para escalas que começam em 2h30–3h30 (rodar de hora em hora)
//   "manual"  — (padrão) mantém comportamento legado: amanhã + depois de amanhã
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

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

// Converte Date para string YYYY-MM-DD no fuso UTC-3
function toLocalDate(d: Date): string {
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

// Próximo dia a partir de uma data local YYYY-MM-DD
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;

  const admin = createClient(supabaseUrl, serviceKey);

  // Lê modo do query-param ou body
  const url   = new URL(req.url);
  let mode    = url.searchParams.get("mode") ?? "manual";
  let bodyMode: string | undefined;
  try {
    const b = await req.json();
    bodyMode = b?.mode;
  } catch { /* sem body */ }
  if (bodyMode) mode = bodyMode;

  const now      = new Date();
  const hoje     = toLocalDate(now);
  const amanha   = addDays(hoje, 1);
  const semana   = new Date(now); semana.setUTCDate(now.getUTCDate() + 7);

  // Datas alvo conforme modo
  let datasAlvo: string[] = [];
  let tipoLembrete = "1dia"; // para o template

  if (mode === "1dia") {
    datasAlvo    = [amanha];
    tipoLembrete = "1dia";
  } else if (mode === "sabado") {
    // Sábado à noite → domingo (amanhã)
    const diaSemana = new Date(hoje + "T00:00:00Z").getUTCDay(); // 0=dom, 6=sab
    if (diaSemana !== 6) return json({ ok: true, msg: "Não é sábado, modo sabado ignorado." });
    datasAlvo    = [amanha];
    tipoLembrete = "1dia";
  } else if (mode === "3horas") {
    // Escalas que começam entre 2h30 e 3h30 a partir de agora
    datasAlvo    = [hoje, amanha];
    tipoLembrete = "3horas";
  } else {
    // "manual" — legado: amanhã e depois de amanhã
    datasAlvo    = [amanha, addDays(hoje, 2)];
    tipoLembrete = "1dia";
  }

  // Busca escalas publicadas nas datas alvo
  const { data: escalas, error: eErr } = await admin
    .from("escalas")
    .select("id, titulo, data, hora_inicio, paroquia_id, paroquias(nome)")
    .eq("status", "publicada")
    .in("data", datasAlvo);

  if (eErr) return json({ ok: false, error: eErr.message }, 500);
  if (!escalas || escalas.length === 0) {
    return json({ ok: true, enviados: 0, msg: `Nenhuma escala para o modo '${mode}'.` });
  }

  // Para modo "3horas": filtra apenas escalas com hora_inicio em 2h30–3h30
  let escalasFiltradas = escalas as any[];
  if (mode === "3horas") {
    const horaAtualMin = now.getUTCHours() * 60 + now.getUTCMinutes() - 3 * 60; // UTC-3
    escalasFiltradas = escalas.filter((e: any) => {
      if (!e.hora_inicio) return false;
      const [h, m] = e.hora_inicio.split(":").map(Number);
      const escalaMin = h * 60 + m;
      const diffMin   = escalaMin - horaAtualMin;
      // janela: 150–210 minutos (2h30 a 3h30)
      return diffMin >= 150 && diffMin <= 210;
    });
    if (escalasFiltradas.length === 0) {
      return json({ ok: true, enviados: 0, msg: "Nenhuma escala na janela de 3 horas." });
    }
  }

  const escalaIds = escalasFiltradas.map((e: any) => e.id);

  const { data: atrib, error: aErr } = await admin
    .from("escala_membros")
    .select("escala_id, ministerio_id, membros(id, nome, email), ministerios(nome)")
    .in("escala_id", escalaIds)
    .neq("ativo", false);

  if (aErr) return json({ ok: false, error: aErr.message }, 500);

  let enviados = 0;
  const erros: string[] = [];

  for (let i = 0; i < (atrib ?? []).length; i++) {
    const a      = (atrib ?? [])[i] as any;
    const membro = a.membros;
    const min    = a.ministerios;
    const escala = escalasFiltradas.find((e: any) => e.id === a.escala_id) as any;

    if (!membro?.email || !escala) continue;

    const paroquiaNome = escala.paroquias?.nome ?? "Pastoral";
    const diasRestantes = tipoLembrete === "3horas" ? 0 : datasAlvo.indexOf(escala.data) + 1;

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

  return json({ ok: true, mode, enviados, erros_count: erros.length, erros });
});
