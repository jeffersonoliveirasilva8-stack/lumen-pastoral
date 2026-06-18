// Edge Function — notificar-substituicao
// Envia e-mail de "vaga disponível" para todos os membros elegíveis quando uma
// substituição de escala é aberta (recusa ou solicitação manual).
//
// POST /functions/v1/notificar-substituicao
// Body: { substituicao_id: string }
//
// Elegível = mesmo ministério + ativo + tem e-mail + não é o solicitante
//           + não está na escala nesta função + dia da semana disponível
//           + sem indisponibilidade registrada nesta data
//
// Usa delay de 400ms entre envios para não ultrapassar o rate-limit do Resend.

// @ts-ignore — import de URL válido no runtime Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DELAY_MS = 400; // entre cada e-mail

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── htmlSafe (copiado do send-email para consistência) ──────────────────────
function htmlSafe(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g,        "&amp;")
    .replace(/</g,        "&lt;")
    .replace(/>/g,        "&gt;")
    .replace(/"/g,        "&quot;")
    .replace(/'/g,        "&#39;")
    .replace(/[à]/g, "&agrave;").replace(/[á]/g, "&aacute;")
    .replace(/[â]/g, "&acirc;") .replace(/[ã]/g, "&atilde;")
    .replace(/[è]/g, "&egrave;").replace(/[é]/g, "&eacute;")
    .replace(/[ê]/g, "&ecirc;")
    .replace(/[ì]/g, "&igrave;").replace(/[í]/g, "&iacute;")
    .replace(/[ò]/g, "&ograve;").replace(/[ó]/g, "&oacute;")
    .replace(/[ô]/g, "&ocirc;") .replace(/[õ]/g, "&otilde;")
    .replace(/[ù]/g, "&ugrave;").replace(/[ú]/g, "&uacute;")
    .replace(/[ç]/g, "&ccedil;")
    .replace(/[À]/g, "&Agrave;").replace(/[Á]/g, "&Aacute;")
    .replace(/[Ã]/g, "&Atilde;").replace(/[Ç]/g, "&Ccedil;")
    .replace(/[É]/g, "&Eacute;").replace(/[Ê]/g, "&Ecirc;")
    .replace(/[Í]/g, "&Iacute;").replace(/[Ó]/g, "&Oacute;")
    .replace(/[Ô]/g, "&Ocirc;") .replace(/[Õ]/g, "&Otilde;")
    .replace(/[Ú]/g, "&Uacute;");
}

function fmtData(escalaData: string): string {
  try {
    const [y, mo, d] = escalaData.split("-").map(Number);
    const M = ["janeiro","fevereiro","mar&ccedil;o","abril","maio","junho",
               "julho","agosto","setembro","outubro","novembro","dezembro"];
    return `${d} de ${M[mo - 1]} de ${y}`;
  } catch { return escalaData; }
}

function emailVagaDisponivel(
  nome: string, paroquia: string, ministerioNome: string,
  escalaTitulo: string, escalaData: string, escalaHora: string, siteUrl: string,
): string {
  const sn  = htmlSafe(nome);
  const sp  = htmlSafe(paroquia);
  const sf  = htmlSafe(ministerioNome);
  const st  = htmlSafe(escalaTitulo);
  const sd  = fmtData(escalaData);
  const sh  = escalaHora ? ` &agrave;s ${htmlSafe(escalaHora)}` : "";
  const url = `${siteUrl}/portal-membro/substituicoes`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <title>Vaga dispon&iacute;vel</title>
  <style>
    body{margin:0;padding:0;background:#f0efe9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#333}
    .wrap{max-width:560px;margin:32px auto;padding:0 12px 40px}
    .card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07)}
    .hd{background:#1a1a2e;padding:24px 32px 20px;text-align:center}
    .hd-par{font-size:20px;font-weight:700;color:#f5c842;letter-spacing:-.3px;margin:0;line-height:1.25}
    .hd-sub{font-size:11px;color:rgba(255,255,255,.5);margin:5px 0 0;letter-spacing:.12em;text-transform:uppercase}
    .bd{padding:32px 36px}
    h1{font-size:20px;font-weight:700;color:#111;margin:0 0 16px;line-height:1.3}
    p{font-size:15px;color:#555;line-height:1.7;margin:0 0 16px}
    .hi{color:#111;font-weight:600}
    .bw{text-align:center;margin:26px 0}
    a.btn{display:inline-block;background:#1a1a2e;color:#fff!important;text-decoration:none!important;font-weight:600;font-size:15px;padding:13px 32px;border-radius:8px}
    table{width:100%;border-collapse:collapse;margin:16px 0}
    td{padding:6px 0;font-size:13px}
    .lb{color:#888;width:100px}.vl{font-weight:600;color:#111}
    .ft{text-align:center;padding:16px 12px 8px;font-size:11.5px;color:#aaa;line-height:1.8}
    @media only screen and (max-width:540px){.bd{padding:22px 20px!important}.hd{padding:20px!important}}
  </style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="hd">
      <p class="hd-par">${sp}</p>
      <p class="hd-sub">Portal do Servidor &middot; Lumen Pastoral</p>
    </div>
    <div class="bd">
      <h1>Vaga dispon&iacute;vel &#128276;</h1>
      <p>Ol&aacute;, <span class="hi">${sn}</span>!</p>
      <p>Uma vaga em <span class="hi">${sf}</span> ficou dispon&iacute;vel na escala da <span class="hi">${sp}</span>. Se voc&ecirc; puder servir, candidate-se no portal:</p>
      <table>
        <tr><td class="lb">Escala</td><td class="vl">${st}</td></tr>
        <tr><td class="lb">Data</td><td class="vl">${sd}${sh}</td></tr>
        <tr><td class="lb">Fun&ccedil;&atilde;o</td><td class="vl">${sf}</td></tr>
      </table>
      <div class="bw"><a href="${url}" class="btn">Quero me candidatar &rarr;</a></div>
      <p style="font-size:13px;color:#888">A vaga ser&aacute; preenchida ap&oacute;s aprova&ccedil;&atilde;o da coordena&ccedil;&atilde;o. Primeiro a se candidatar tem prioridade.</p>
    </div>
  </div>
  <div class="ft">${sp} &mdash; Lumen Pastoral<br/>Este &eacute; um e-mail autom&aacute;tico &mdash; n&atilde;o responda.</div>
</div>
</body>
</html>`;
}

// ─── Templates: aprovada / rejeitada ─────────────────────────────────────────

function emailAprovada(nome: string, paroquia: string, ministerioNome: string,
  escalaTitulo: string, escalaData: string, escalaHora: string, siteUrl: string): string {
  const sn = htmlSafe(nome); const sp = htmlSafe(paroquia);
  const sf = htmlSafe(ministerioNome); const st = htmlSafe(escalaTitulo);
  const sd = fmtData(escalaData); const sh = escalaHora ? ` &agrave;s ${htmlSafe(escalaHora)}` : "";
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<title>Substitui&ccedil;&atilde;o aprovada</title>
<style>body{margin:0;padding:0;background:#f0efe9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#333}
.wrap{max-width:560px;margin:32px auto;padding:0 12px 40px}.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07)}
.hd{background:#1a1a2e;padding:24px 32px 20px;text-align:center}.hd-par{font-size:20px;font-weight:700;color:#f5c842;letter-spacing:-.3px;margin:0;line-height:1.25}
.hd-sub{font-size:11px;color:rgba(255,255,255,.5);margin:5px 0 0;letter-spacing:.12em;text-transform:uppercase}
.bd{padding:32px 36px}h1{font-size:20px;font-weight:700;color:#111;margin:0 0 16px;line-height:1.3}
p{font-size:15px;color:#555;line-height:1.7;margin:0 0 16px}.hi{color:#111;font-weight:600}
table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:6px 0;font-size:13px}
.lb{color:#888;width:100px}.vl{font-weight:600;color:#111}
.ft{text-align:center;padding:16px 12px 8px;font-size:11.5px;color:#aaa;line-height:1.8}
.badge{display:inline-block;background:#16a34a;color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;margin-bottom:14px}
@media only screen and (max-width:540px){.bd{padding:22px 20px!important}.hd{padding:20px!important}}</style>
</head><body><div class="wrap"><div class="card">
<div class="hd"><p class="hd-par">${sp}</p><p class="hd-sub">Portal do Servidor &middot; Lumen Pastoral</p></div>
<div class="bd"><span class="badge">&#10003; Aprovada</span>
<h1>Substitui&ccedil;&atilde;o aprovada &#127881;</h1>
<p>Ol&aacute;, <span class="hi">${sn}</span>! A substitui&ccedil;&atilde;o foi aprovada pela coordena&ccedil;&atilde;o.</p>
<table>
<tr><td class="lb">Escala</td><td class="vl">${st}</td></tr>
<tr><td class="lb">Data</td><td class="vl">${sd}${sh}</td></tr>
<tr><td class="lb">Fun&ccedil;&atilde;o</td><td class="vl">${sf}</td></tr>
</table>
<p style="font-size:13px;color:#888">Acesse o <a href="${siteUrl}/portal-membro/escalas" style="color:#1a1a2e">portal</a> para ver seus detalhes.</p>
</div></div>
<div class="ft">${sp} &mdash; Lumen Pastoral<br/>E-mail autom&aacute;tico &mdash; n&atilde;o responda.</div>
</div></body></html>`;
}

function emailRejeitada(nome: string, paroquia: string, ministerioNome: string,
  escalaTitulo: string, escalaData: string, motivo: string, siteUrl: string): string {
  const sn = htmlSafe(nome); const sp = htmlSafe(paroquia);
  const sf = htmlSafe(ministerioNome); const st = htmlSafe(escalaTitulo);
  const sd = fmtData(escalaData); const sm = htmlSafe(motivo || "Sem motivo informado");
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<title>Substitui&ccedil;&atilde;o n&atilde;o aprovada</title>
<style>body{margin:0;padding:0;background:#f0efe9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#333}
.wrap{max-width:560px;margin:32px auto;padding:0 12px 40px}.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07)}
.hd{background:#1a1a2e;padding:24px 32px 20px;text-align:center}.hd-par{font-size:20px;font-weight:700;color:#f5c842;letter-spacing:-.3px;margin:0;line-height:1.25}
.hd-sub{font-size:11px;color:rgba(255,255,255,.5);margin:5px 0 0;letter-spacing:.12em;text-transform:uppercase}
.bd{padding:32px 36px}h1{font-size:20px;font-weight:700;color:#111;margin:0 0 16px;line-height:1.3}
p{font-size:15px;color:#555;line-height:1.7;margin:0 0 16px}.hi{color:#111;font-weight:600}
.mot{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;font-size:13px;color:#7f1d1d;margin:16px 0}
table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:6px 0;font-size:13px}
.lb{color:#888;width:100px}.vl{font-weight:600;color:#111}
.ft{text-align:center;padding:16px 12px 8px;font-size:11.5px;color:#aaa;line-height:1.8}
.badge{display:inline-block;background:#dc2626;color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;margin-bottom:14px}
@media only screen and (max-width:540px){.bd{padding:22px 20px!important}.hd{padding:20px!important}}</style>
</head><body><div class="wrap"><div class="card">
<div class="hd"><p class="hd-par">${sp}</p><p class="hd-sub">Portal do Servidor &middot; Lumen Pastoral</p></div>
<div class="bd"><span class="badge">&#10007; N&atilde;o aprovada</span>
<h1>Substitui&ccedil;&atilde;o n&atilde;o aprovada</h1>
<p>Ol&aacute;, <span class="hi">${sn}</span>. Infelizmente a coordena&ccedil;&atilde;o n&atilde;o p&ocirc;de aprovar esta substitui&ccedil;&atilde;o.</p>
<table>
<tr><td class="lb">Escala</td><td class="vl">${st}</td></tr>
<tr><td class="lb">Data</td><td class="vl">${sd}</td></tr>
<tr><td class="lb">Fun&ccedil;&atilde;o</td><td class="vl">${sf}</td></tr>
</table>
<p style="font-size:13px;color:#555;font-weight:600">Motivo informado pela coordena&ccedil;&atilde;o:</p>
<div class="mot">${sm}</div>
<p style="font-size:13px;color:#888">Em caso de d&uacute;vidas, entre em contato com a coordena&ccedil;&atilde;o ou acesse o <a href="${siteUrl}/portal-membro/escalas" style="color:#1a1a2e">portal</a>.</p>
</div></div>
<div class="ft">${sp} &mdash; Lumen Pastoral<br/>E-mail autom&aacute;tico &mdash; n&atilde;o responda.</div>
</div></body></html>`;
}

// ─── Utilitário: envio simples ────────────────────────────────────────────────
async function sendOne(resendKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json; charset=utf-8",
      "Accept": "application/json",
    },
    body: new TextEncoder().encode(JSON.stringify({ from, to: [to], subject, html })),
  });
  return res.ok;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
// acao = "vaga_disponivel" (padrão) | "aprovada" | "rejeitada"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const siteUrl   = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const emailFrom = Deno.env.get("EMAIL_FROM") ?? "Lumen Pastoral <noreply@lumenpastoral.com.br>";

    if (!resendKey) return json({ ok: false, error: "RESEND_API_KEY not configured" }, 503);
    if (!siteUrl)   return json({ ok: false, error: "SITE_URL not configured" }, 503);
    if (!req.headers.get("Authorization"))
      return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json() as { substituicao_id: string; acao?: string };
    const { substituicao_id, acao = "vaga_disponivel" } = body;
    if (!substituicao_id) return json({ ok: false, error: "Missing field: substituicao_id" }, 400);

    // Service role — acesso total
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Carrega substituição completa ─────────────────────────────────────────
    const { data: subst, error: se } = await (admin as any)
      .from("substituicoes")
      .select(`
        id, paroquia_id, solicitante_id, substituto_id, motivo_rejeicao,
        escala_membro_id,
        escala_membros(
          ministerio_id,
          escalas(id, titulo, data, hora_inicio)
        ),
        paroquias(nome)
      `)
      .eq("id", substituicao_id)
      .maybeSingle();

    if (se || !subst) return json({ ok: false, error: "substituicao_not_found" }, 404);

    const escalaRow    = subst.escala_membros?.escalas;
    const ministerioId = subst.escala_membros?.ministerio_id;
    const paroquiaNome = subst.paroquias?.nome ?? "Pastoral";

    if (!escalaRow || !ministerioId) return json({ ok: false, error: "escala_or_ministerio_not_found" }, 404);

    const escalaData    = escalaRow.data as string;
    const escalaHora    = (escalaRow.hora_inicio as string | null)?.slice(0, 5) ?? "";
    const escalaTitulo  = escalaRow.titulo as string;
    const escalaId      = escalaRow.id as string;
    const paroquiaId    = subst.paroquia_id as string;
    const solicitanteId = subst.solicitante_id as string;
    const substitutoId  = subst.substituto_id as string | null;

    // Nome do ministério
    const { data: minRow } = await (admin as any)
      .from("ministerios").select("nome").eq("id", ministerioId).maybeSingle();
    const ministerioNome = minRow?.nome ?? "—";

    // ── Ações de aprovação / rejeição ─────────────────────────────────────────
    if (acao === "aprovada" || acao === "rejeitada") {
      // Busca e-mail do solicitante
      const { data: authSolicitante } = await (admin as any).auth.admin.getUserById(solicitanteId);
      const emailSolicitante = authSolicitante?.user?.email ?? null;
      const nomeSolicitante  = (await (admin as any).from("membros").select("nome").eq("id", solicitanteId).maybeSingle())?.data?.nome ?? "Membro";

      let enviados = 0;

      if (acao === "aprovada") {
        // E-mail ao solicitante (você foi substituído — confirmação)
        if (emailSolicitante) {
          const ok = await sendOne(resendKey, emailFrom, emailSolicitante,
            `${paroquiaNome} — Sua substituição foi aprovada`,
            emailAprovada(nomeSolicitante, paroquiaNome, ministerioNome, escalaTitulo, escalaData, escalaHora, siteUrl));
          if (ok) enviados++;
        }
        // E-mail ao substituto (você entrou na escala)
        if (substitutoId) {
          const { data: authSub } = await (admin as any).auth.admin.getUserById(substitutoId);
          const emailSub = authSub?.user?.email ?? null;
          const { data: nomeSubRow } = await (admin as any).from("membros").select("nome").eq("id", substitutoId).maybeSingle();
          const nomeSub = nomeSubRow?.nome ?? "Membro";
          if (emailSub) {
            await sleep(DELAY_MS);
            const ok = await sendOne(resendKey, emailFrom, emailSub,
              `${paroquiaNome} — Você está confirmado na escala`,
              emailAprovada(nomeSub, paroquiaNome, ministerioNome, escalaTitulo, escalaData, escalaHora, siteUrl));
            if (ok) enviados++;
          }
        }
      } else {
        // rejeitada — e-mail apenas ao solicitante
        if (emailSolicitante) {
          const ok = await sendOne(resendKey, emailFrom, emailSolicitante,
            `${paroquiaNome} — Substituição não aprovada`,
            emailRejeitada(nomeSolicitante, paroquiaNome, ministerioNome, escalaTitulo, escalaData,
              subst.motivo_rejeicao ?? "", siteUrl));
          if (ok) enviados++;
        }
      }

      return json({ ok: true, acao, enviados });
    }

    // ── Ação padrão: vaga_disponivel (broadcast) ─────────────────────────────
    // Só faz sentido para escalas futuras
    if (escalaData <= new Date().toISOString().slice(0, 10)) {
      return json({ ok: true, enviados: 0, motivo: "escala_no_passado" });
    }

    const diaSemana = new Date(escalaData + "T12:00:00").getDay();

    // Membros já nesta função na escala
    const { data: jaEscalados } = await (admin as any)
      .from("escala_membros").select("membro_id")
      .eq("escala_id", escalaId).eq("ministerio_id", ministerioId);
    const jaEscaladosSet = new Set<string>((jaEscalados ?? []).map((r: { membro_id: string }) => r.membro_id));

    // Indisponibilidades nesta data
    const { data: indisps } = await (admin as any)
      .from("indisponibilidades").select("membro_id")
      .eq("paroquia_id", paroquiaId).eq("data", escalaData).eq("cancelada", false);
    const indispsSet = new Set<string>((indisps ?? []).map((r: { membro_id: string }) => r.membro_id));

    // Membros do ministério elegíveis
    const { data: memMinRows } = await (admin as any)
      .from("membro_ministerios")
      .select("membros(id, nome, email, restricoes_dia_semana, ativo)")
      .eq("ministerio_id", ministerioId);

    type MembroRow = { id: string; nome: string; email: string | null; restricoes_dia_semana: number[] | null; ativo: boolean };
    const candidatos: MembroRow[] = (memMinRows ?? [])
      .map((r: { membros: MembroRow }) => r.membros)
      .filter((m: MembroRow) => {
        if (!m || !m.ativo)                                return false;
        if (!m.email)                                      return false;
        if (m.id === solicitanteId)                        return false;
        if (jaEscaladosSet.has(m.id))                      return false;
        if (indispsSet.has(m.id))                          return false;
        if (m.restricoes_dia_semana?.includes(diaSemana))  return false;
        return true;
      });

    if (candidatos.length === 0) {
      return json({ ok: true, enviados: 0, motivo: "sem_candidatos" });
    }

    let enviados = 0;
    const erros: string[] = [];

    for (let i = 0; i < candidatos.length; i++) {
      const m = candidatos[i];
      const html    = emailVagaDisponivel(m.nome, paroquiaNome, ministerioNome, escalaTitulo, escalaData, escalaHora, siteUrl);
      const subject = `${paroquiaNome} — Vaga disponível: ${ministerioNome}`;
      const ok = await sendOne(resendKey, emailFrom, m.email!, subject, html);
      if (ok) enviados++; else erros.push(m.nome);
      if (i < candidatos.length - 1) await sleep(DELAY_MS);
    }

    return json({ ok: true, enviados, total: candidatos.length, erros: erros.length > 0 ? erros : undefined });

  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
