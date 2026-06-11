// Edge Function — send-email v2
// E-mails transacionais para o Portal do Servidor Lumen Pastoral.
//
// POST /functions/v1/send-email
// Body: { template: string, to: string, nome?: string, paroquia?: string }
//
// Templates:
//   "ativacao_conta"   — membro aprovado + magic link para criar senha
//   "reenvio_ativacao" — reenvio do link de ativação a pedido
//   "reset_senha"      — redefinição de senha (iniciada pelo admin)
//   "boas_vindas"      — confirmação de cadastro completo
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY — chave do Resend (resend.com)
//   SITE_URL       — URL base (ex: https://seuprojeto.com.br)
//   EMAIL_FROM     — remetente (ex: "Portal <noreply@paroquia.com.br>")

// @ts-ignore — import de URL válido no runtime Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Utilitários de MFA ───────────────────────────────────────────────────────

function generateMfaCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── HTML-safe para conteúdo dinâmico ──────────────────────────────────────────
// Usa Unicode escapes nos padrões de regex: seguro independente do encoding do
// arquivo-fonte. Converte acentos para entidades HTML (pure ASCII no output).

function htmlSafe(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g,        "&amp;")
    .replace(/</g,        "&lt;")
    .replace(/>/g,        "&gt;")
    .replace(/"/g,        "&quot;")
    .replace(/'/g,        "&#39;")
    // Vogais minúsculas com acento (Latin-1 Supplement)
    .replace(/[à]/g, "&agrave;").replace(/[á]/g, "&aacute;")
    .replace(/[â]/g, "&acirc;") .replace(/[ã]/g, "&atilde;")
    .replace(/[ä]/g, "&auml;")
    .replace(/[è]/g, "&egrave;").replace(/[é]/g, "&eacute;")
    .replace(/[ê]/g, "&ecirc;") .replace(/[ë]/g, "&euml;")
    .replace(/[ì]/g, "&igrave;").replace(/[í]/g, "&iacute;")
    .replace(/[î]/g, "&icirc;")
    .replace(/[ò]/g, "&ograve;").replace(/[ó]/g, "&oacute;")
    .replace(/[ô]/g, "&ocirc;") .replace(/[õ]/g, "&otilde;")
    .replace(/[ù]/g, "&ugrave;").replace(/[ú]/g, "&uacute;")
    .replace(/[û]/g, "&ucirc;")
    .replace(/[ç]/g, "&ccedil;")
    // Maiúsculas com acento
    .replace(/[À]/g, "&Agrave;").replace(/[Á]/g, "&Aacute;")
    .replace(/[Â]/g, "&Acirc;") .replace(/[Ã]/g, "&Atilde;")
    .replace(/[Ç]/g, "&Ccedil;").replace(/[É]/g, "&Eacute;")
    .replace(/[Ê]/g, "&Ecirc;") .replace(/[Í]/g, "&Iacute;")
    .replace(/[Ó]/g, "&Oacute;").replace(/[Ô]/g, "&Ocirc;")
    .replace(/[Õ]/g, "&Otilde;").replace(/[Ú]/g, "&Uacute;");
}

// ─── Layout base ──────────────────────────────────────────────────────────────
// Paróquia em destaque no cabeçalho; "via Lumen Pastoral" como plataforma.
// Todo texto estático usa entidades HTML — não depende de charset do servidor.

function baseLayout(paroquia: string, body: string, siteUrl: string): string {
  const sp = htmlSafe(paroquia);
  const su = htmlSafe(siteUrl);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal do Servidor</title>
  <style>
    body    { margin:0; padding:0; background:#f0efe9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; color:#333; -webkit-font-smoothing:antialiased; }
    .wrap   { max-width:560px; margin:32px auto; padding:0 12px 40px; }
    .card   { background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.07); }
    .hd     { background:#1a1a2e; padding:24px 32px 20px; text-align:center; }
    .hd-par { font-size:20px; font-weight:700; color:#f5c842; letter-spacing:-0.3px; margin:0; line-height:1.25; }
    .hd-sub { font-size:11px; color:rgba(255,255,255,0.5); margin:5px 0 0; letter-spacing:0.12em; text-transform:uppercase; }
    .bd     { padding:32px 36px; }
    h1      { font-size:20px; font-weight:700; color:#111; margin:0 0 16px; line-height:1.3; }
    p       { font-size:15px; color:#555; line-height:1.7; margin:0 0 16px; }
    .hi     { color:#111; font-weight:600; }
    .bw     { text-align:center; margin:26px 0; }
    a.btn   { display:inline-block; background:#1a1a2e; color:#fff !important; text-decoration:none !important; font-weight:600; font-size:15px; padding:13px 32px; border-radius:8px; }
    hr      { border:none; border-top:1px solid #eee; margin:20px 0; }
    .urlbox { background:#f7f6f2; border:1px solid #e4e3dd; border-radius:6px; padding:10px 13px; font-size:12px; color:#666; word-break:break-all; line-height:1.55; }
    .note   { font-size:13px; color:#888; line-height:1.6; }
    ul.feat { font-size:14px; color:#555; line-height:1.9; margin:0 0 16px; padding-left:20px; }
    .ft     { text-align:center; padding:16px 12px 8px; font-size:11.5px; color:#aaa; line-height:1.8; }
    .ft a   { color:#aaa; text-decoration:underline; }
    @media only screen and (max-width:540px){
      .bd { padding:22px 20px !important; }
      .hd { padding:20px !important; }
    }
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
        ${body}
      </div>
    </div>
    <div class="ft">
      ${sp} &mdash; Portal do Servidor via Lumen Pastoral<br/>
      Este &eacute; um e-mail autom&aacute;tico &mdash; n&atilde;o responda a esta mensagem.<br/>
      Se voc&ecirc; n&atilde;o solicitou esta a&ccedil;&atilde;o, ignore este e-mail com seguran&ccedil;a.<br/>
      <a href="${su}">${su}</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

function tAtivacaoConta(nome: string, paroquia: string, link: string, siteUrl: string): string {
  const sn = htmlSafe(nome);
  const sp = htmlSafe(paroquia);
  const body = `
    <h1>Sua conta foi aprovada! &#127881;</h1>
    <p>Ol&aacute;, <span class="hi">${sn}</span>!</p>
    <p>
      Temos uma &oacute;tima not&iacute;cia: sua solicita&ccedil;&atilde;o para servir como
      servidor(a) na <span class="hi">${sp}</span> foi <strong>aprovada</strong>.
      Que alegria t&ecirc;-lo(a) conosco!
    </p>
    <p>Para come&ccedil;ar, clique no bot&atilde;o abaixo e crie sua senha de acesso:</p>
    <div class="bw"><a href="${link}" class="btn">Criar minha senha &rarr;</a></div>
    <p class="note">
      &#9888;&#65039;&nbsp; Este link &eacute; v&aacute;lido por <strong>24 horas</strong>
      e pode ser usado apenas uma vez. Ap&oacute;s criar a senha, voc&ecirc; ser&aacute;
      direcionado(a) para concluir seu cadastro.
    </p>
    <hr/>
    <p class="note">Se o bot&atilde;o n&atilde;o funcionar, copie e cole o endere&ccedil;o abaixo no navegador:</p>
    <div class="urlbox">${link}</div>
    <hr/>
    <p class="note">Se voc&ecirc; n&atilde;o solicitou acesso a este portal, ignore este e-mail.</p>`;
  return baseLayout(paroquia, body, siteUrl);
}

function tReenvioAtivacao(nome: string, paroquia: string, link: string, siteUrl: string): string {
  const sn = htmlSafe(nome);
  const sp = htmlSafe(paroquia);
  const body = `
    <h1>Novo link de ativa&ccedil;&atilde;o</h1>
    <p>Ol&aacute;, <span class="hi">${sn}</span>!</p>
    <p>
      A pedido, enviamos um novo link de ativa&ccedil;&atilde;o para sua conta
      no portal da <span class="hi">${sp}</span>.
    </p>
    <p>Clique no bot&atilde;o abaixo para criar sua senha de acesso:</p>
    <div class="bw"><a href="${link}" class="btn">Criar minha senha &rarr;</a></div>
    <p class="note">
      &#9888;&#65039;&nbsp; Este link &eacute; v&aacute;lido por <strong>24 horas</strong>
      e pode ser usado apenas uma vez.
    </p>
    <hr/>
    <p class="note">Se o bot&atilde;o n&atilde;o funcionar, copie e cole o endere&ccedil;o abaixo no navegador:</p>
    <div class="urlbox">${link}</div>
    <hr/>
    <p class="note">
      Se voc&ecirc; n&atilde;o solicitou este reenvio, entre em contato com a
      coordena&ccedil;&atilde;o da sua par&oacute;quia.
    </p>`;
  return baseLayout(paroquia, body, siteUrl);
}

function tResetSenha(nome: string, paroquia: string, link: string, siteUrl: string): string {
  const sn = htmlSafe(nome) || "servidor(a)";
  const sp = htmlSafe(paroquia);
  const body = `
    <h1>Redefini&ccedil;&atilde;o de senha</h1>
    <p>Ol&aacute;, <span class="hi">${sn}</span>!</p>
    <p>
      Recebemos uma solicita&ccedil;&atilde;o para redefinir a senha da sua conta
      no portal${sp ? ` da <span class="hi">${sp}</span>` : ""}.
      Se foi voc&ecirc;, clique no bot&atilde;o abaixo:
    </p>
    <div class="bw"><a href="${link}" class="btn">Criar nova senha &rarr;</a></div>
    <p class="note">
      &#9888;&#65039;&nbsp; Este link &eacute; v&aacute;lido por <strong>1 hora</strong>
      e pode ser usado apenas uma vez.
    </p>
    <hr/>
    <p class="note">Se o bot&atilde;o n&atilde;o funcionar, copie e cole o endere&ccedil;o abaixo no navegador:</p>
    <div class="urlbox">${link}</div>
    <hr/>
    <p class="note">
      Se voc&ecirc; n&atilde;o solicitou a redefini&ccedil;&atilde;o de senha,
      sua conta permanece segura &mdash; ignore este e-mail.
    </p>`;
  return baseLayout(paroquia || "Portal do Servidor", body, siteUrl);
}

function tMfaAdminCode(nome: string, paroquia: string, code: string, siteUrl: string): string {
  const sn = htmlSafe(nome) || "Administrador";
  const sp = htmlSafe(paroquia);
  const body = `
    <h1>C&oacute;digo de verifica&ccedil;&atilde;o</h1>
    <p>Ol&aacute;, <span class="hi">${sn}</span>!</p>
    <p>
      Use o c&oacute;digo abaixo para concluir seu acesso ao painel da
      <span class="hi">${sp || "pastoral"}</span>.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <div style="display:inline-block;background:#f7f6f2;border:2px solid #e4e3dd;border-radius:12px;
                  padding:16px 36px;font-size:36px;font-weight:900;letter-spacing:0.28em;
                  color:#1a1a2e;font-family:'Courier New',monospace;">
        ${htmlSafe(code)}
      </div>
    </div>
    <p class="note" style="text-align:center;">
      &#9888;&#65039;&nbsp; Este c&oacute;digo &eacute; v&aacute;lido por <strong>10 minutos</strong>
      e pode ser usado apenas uma vez.
    </p>
    <hr/>
    <p class="note">
      Se voc&ecirc; n&atilde;o solicitou este c&oacute;digo, sua conta pode estar em risco.
      Altere sua senha imediatamente e entre em contato com o administrador do sistema.
    </p>`;
  return baseLayout(paroquia || "Lumen Pastoral", body, siteUrl);
}

function tBoasVindas(nome: string, paroquia: string, siteUrl: string): string {
  const sn = htmlSafe(nome);
  const sp = htmlSafe(paroquia);
  const portalUrl = `${siteUrl}/portal-membro/home`;
  const body = `
    <h1>Bem-vindo(a) ao portal! &#128591;</h1>
    <p>Ol&aacute;, <span class="hi">${sn}</span>!</p>
    <p>
      Seu cadastro na <span class="hi">${sp}</span> foi conclu&iacute;do com sucesso.
      Voc&ecirc; j&aacute; pode acessar o Portal do Servidor.
    </p>
    <div class="bw"><a href="${portalUrl}" class="btn">Acessar o portal &rarr;</a></div>
    <p>No portal voc&ecirc; pode:</p>
    <ul class="feat">
      <li>Verificar e confirmar suas escalas de servi&ccedil;o</li>
      <li>Registrar indisponibilidades com anteced&ecirc;ncia</li>
      <li>Acompanhar comunicados da coordena&ccedil;&atilde;o</li>
      <li>Atualizar seus dados de contato</li>
    </ul>
    <p class="note">Em caso de d&uacute;vidas, entre em contato com a coordena&ccedil;&atilde;o da ${sp}.</p>`;
  return baseLayout(paroquia, body, siteUrl);
}

// ─── Resend API ────────────────────────────────────────────────────────────────

interface SendOpts { apiKey: string; from: string; to: string; subject: string; html: string; }

async function sendViaResend(o: SendOpts): Promise<{ ok: boolean; id?: string; error?: string }> {
  // TextEncoder garante UTF-8 explícito: evita encoding incorreto no Deno fetch
  const payload = new TextEncoder().encode(
    JSON.stringify({ from: o.from, to: [o.to], subject: o.subject, html: o.html }),
  );
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${o.apiKey}`,
      "Content-Type":  "application/json; charset=utf-8",
      "Accept":        "application/json",
    },
    body: payload,
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${err}` };
  }
  const data = await res.json() as { id?: string };
  return { ok: true, id: data.id };
}

// ─── Log de envio (não bloqueia delivery em caso de falha) ──────────────────────

// deno-lint-ignore no-explicit-any
async function logEmail(admin: any, entry: {
  tipo: string; destinatario: string; assunto: string;
  status: "enviado" | "erro"; provider: string;
  provider_id?: string; erro?: string; paroquia?: string; requesterId?: string | null;
}) {
  try {
    await admin.from("email_logs").insert({
      tipo:               entry.tipo,
      destinatario:       entry.destinatario,
      assunto:            entry.assunto,
      status:             entry.status,
      provider:           entry.provider,
      provider_id:        entry.provider_id       ?? null,
      erro:               entry.erro              ?? null,
      paroquia:           entry.paroquia          ?? null,
      requester_user_id:  entry.requesterId       ?? null,
    });
  } catch { /* falha no log nunca deve bloquear o envio */ }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const siteUrl   = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const emailFrom = Deno.env.get("EMAIL_FROM") ?? "Lumen Pastoral <noreply@lumenpastoral.com.br>";

    if (!resendKey) return json({ ok: false, error: "RESEND_API_KEY not configured" },   503);
    if (!siteUrl)   return json({ ok: false, error: "SITE_URL not configured" },          503);
    if (!req.headers.get("Authorization")) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Identifica o usuário autenticado (para rate limiting por conta)
    const authToken = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    let requesterId: string | null = null;
    try {
      const { data: { user } } = await admin.auth.getUser(authToken);
      requesterId = user?.id ?? null;
    } catch { /* não-fatal — rate limit por destinatário ainda se aplica */ }

    const body = await req.json() as { template: string; to: string; nome?: string; paroquia?: string; code?: string };
    const { template, to, nome = "", paroquia = "Pastoral", code = "" } = body;

    if (!template || !to) return json({ ok: false, error: "Missing fields: template, to" }, 400);

    // ── Rate limiting ──────────────────────────────────────────────────────────
    const { data: rateCheck } = await admin.rpc("check_email_rate_limit", {
      p_destinatario: to,
      p_tipo:         template,
      p_requester_id: requesterId,
    });
    if (rateCheck && !rateCheck.allowed) {
      await logEmail(admin, {
        tipo: template, destinatario: to, assunto: `[BLOQUEADO] ${template}`,
        status: "erro", provider: "rate_limit", erro: rateCheck.reason, paroquia,
      });
      return json({ ok: false, error: rateCheck.reason ?? "Rate limit excedido" }, 429);
    }

    let subject = "", html = "";

    // ── Templates com magic link ─────────────────────────────────────────────
    if (template === "ativacao_conta" || template === "reenvio_ativacao") {
      const { data: ld, error: le } = await admin.auth.admin.generateLink({
        type:    "magiclink",
        email:   to,
        options: { redirectTo: `${siteUrl}/membro/ativar-conta` },
      });
      if (le || !ld?.properties?.action_link)
        return json({ ok: false, error: le?.message ?? "Failed to generate activation link" }, 500);

      if (template === "ativacao_conta") {
        // — = em dash; acento no assunto via Unicode escape (encoding-safe)
        subject = `${paroquia} — Sua conta foi aprovada!`;
        html    = tAtivacaoConta(nome, paroquia, ld.properties.action_link, siteUrl);
      } else {
        subject = `${paroquia} — Novo link de ativação`;
        html    = tReenvioAtivacao(nome, paroquia, ld.properties.action_link, siteUrl);
      }

    // ── Reset de senha ───────────────────────────────────────────────────────
    } else if (template === "reset_senha") {
      const fp = new URL(req.url).searchParams.get("from") ?? "membro";
      const { data: ld, error: le } = await admin.auth.admin.generateLink({
        type:    "recovery",
        email:   to,
        options: { redirectTo: `${siteUrl}/reset-senha?from=${fp}` },
      });
      if (le || !ld?.properties?.action_link)
        return json({ ok: false, error: le?.message ?? "Failed to generate reset link" }, 500);

      subject = `${paroquia || "Portal"} — Redefinição de senha`;
      html    = tResetSenha(nome, paroquia, ld.properties.action_link, siteUrl);

    // ── MFA Admin — gera código, armazena hash, envia ────────────────────────
    } else if (template === "mfa_admin_code") {
      // Geração do código e hash acontece aqui (nunca no cliente)
      const mfaCode     = generateMfaCode();
      const mfaCodeHash = await sha256hex(mfaCode);

      // Armazena hash no banco via service role (nunca o código plaintext)
      const { error: storeErr } = await admin.rpc("store_admin_mfa_code", {
        p_user_email: to,
        p_code_hash:  mfaCodeHash,
      });
      if (storeErr) return json({ ok: false, error: storeErr.message }, 500);

      subject = `${paroquia || "Lumen Pastoral"} — Código de verificação`;
      html    = tMfaAdminCode(nome, paroquia, mfaCode, siteUrl);

    // ── Boas-vindas ──────────────────────────────────────────────────────────
    } else if (template === "boas_vindas") {
      subject = `${paroquia} — Bem-vindo(a) ao portal!`;
      html    = tBoasVindas(nome, paroquia, siteUrl);

    } else {
      return json({ ok: false, error: `Unknown template: ${template}` }, 400);
    }

    const result = await sendViaResend({ apiKey: resendKey, from: emailFrom, to, subject, html });

    await logEmail(admin, {
      tipo:         template,
      destinatario: to,
      assunto:      subject,
      status:       result.ok ? "enviado" : "erro",
      provider:     "resend",
      provider_id:  result.id,
      erro:         result.error,
      paroquia,
      requesterId,
    });

    return json(result, result.ok ? 200 : 502);

  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
