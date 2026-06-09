// @ts-nocheck
// Edge Function — homilia-diaria v3 (Deno runtime — Supabase Edge Functions)
// Busca a homilia do dia no canal do Padre Paulo Ricardo via YouTube RSS
// e persiste em homilias_diarias.
//
// Chamada: POST /functions/v1/homilia-diaria          (sem parâmetro → hoje)
//          GET  /functions/v1/homilia-diaria?date=YYYY-MM-DD
//          POST /functions/v1/homilia-diaria  body: { "date": "YYYY-MM-DD" }
//
// Env vars:
//   YOUTUBE_CHANNEL_USER  (padrão: PadrePauloRicardo)
//   YOUTUBE_CHANNEL_ID    (ID UCxxxx — preferido se fornecido)
//   HOMILIA_WINDOW_DAYS   (padrão: 7 — dias antes/depois da data alvo)

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_USER   = "PadrePauloRicardo";
const DEFAULT_WINDOW = 7; // dias ±

// ── RSS ───────────────────────────────────────────────────────────────────────

async function fetchRss(param: string, byId: boolean): Promise<string> {
  const key = byId ? `channel_id=${param}` : `user=${param}`;
  const url  = `https://www.youtube.com/feeds/videos.xml?${key}`;
  const res  = await fetch(url, {
    headers: { "User-Agent": "LumenPastoral/3.0" },
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RSS ${res.status} → ${url}`);
  return res.text();
}

async function fetchEntriesRobust(
  channelUser: string,
  channelId:   string,
): Promise<ReturnType<typeof parseEntries>> {
  const strategies: Array<() => Promise<string>> = [];
  if (channelId) strategies.push(() => fetchRss(channelId, true));
  strategies.push(() => fetchRss(channelUser, false));

  let best: ReturnType<typeof parseEntries> = [];
  const errors: string[] = [];

  for (const fn of strategies) {
    try {
      const entries = parseEntries(await fn());
      if (entries.length > best.length) best = entries;
      if (best.length >= 5) break;
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (best.length === 0 && errors.length > 0) {
    throw new Error(`Todas as tentativas RSS falharam: ${errors.join(" | ")}`);
  }
  return best;
}

// ── Parser XML ────────────────────────────────────────────────────────────────

type Entry = {
  videoId:     string;
  titulo:      string;
  descricao:   string;
  publishedAt: string;   // YYYY-MM-DD
  thumbnail:   string;
  url:         string;
};

function parseEntries(xml: string): Entry[] {
  const entries: Entry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;

  while ((m = entryRegex.exec(xml)) !== null) {
    const b = m[1];
    const videoId = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ?? [])[1] ?? "";
    if (!videoId) continue;

    const titulo = strip((b.match(/<title>([^<]+)<\/title>/) ?? [])[1] ?? "");
    const desc   = strip((b.match(/<media:description>([\s\S]*?)<\/media:description>/) ?? [])[1] ?? "");
    const pub    = (b.match(/<published>([^<]+)<\/published>/) ?? [])[1] ?? "";
    const thumb  = (
      b.match(/url="([^"]+hqdefault[^"]*)"/) ??
      b.match(/url="([^"]+mqdefault[^"]*)"/) ??
      b.match(/url="([^"]+)"/)
    )?.[1] ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    entries.push({
      videoId,
      titulo,
      descricao:   desc.slice(0, 500),
      publishedAt: pub.slice(0, 10),
      thumbnail:   thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url:         `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return entries;
}

function strip(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

// ── Detecção de homilia ───────────────────────────────────────────────────────

function isHomilia(titulo: string, targetDate: string): boolean {
  const t = titulo.toLowerCase();

  // Palavras-chave primárias
  if (t.includes("homilia") || t.includes("homília")) return true;
  if (t.includes("comentário ao evangelho") || t.includes("comentario ao evangelho")) return true;
  if (t.includes("reflexão do evangelho")   || t.includes("reflexao do evangelho"))   return true;
  if (t.includes("meditação do dia")        || t.includes("meditacao do dia"))        return true;
  if (t.includes("palavra do dia"))                                                    return true;
  if (t.includes("evangelho do dia"))                                                  return true;
  if (t.includes("leitura do dia"))                                                    return true;
  if (t.includes("liturgia do dia"))                                                   return true;

  // Domingo: aceita Missa Dominical
  const dow = new Date(targetDate + "T12:00:00Z").getUTCDay();
  if (dow === 0) {
    return (
      t.includes("missa dominical")  ||
      t.includes("missa do domingo") ||
      t.includes("domingo de")       ||
      (t.includes("domingo") && (t.includes("missa") || t.includes("solenidade") || t.includes("festa")))
    );
  }

  return false;
}

// Qualquer vídeo que possivelmente seja conteúdo pastoral diário (fallback)
function isPossibleHomilia(titulo: string): boolean {
  const t = titulo.toLowerCase();
  return (
    isHomilia(titulo, new Date().toISOString().slice(0, 10)) ||
    t.includes("missa") ||
    t.includes("liturgia") ||
    t.includes("catequese") ||
    t.includes("reflexão") ||
    t.includes("reflexao")
  );
}

// ── Distância em dias entre duas datas YYYY-MM-DD ─────────────────────────────
function diffDays(a: string, b: string): number {
  return Math.abs(
    new Date(a + "T12:00:00Z").getTime() -
    new Date(b + "T12:00:00Z").getTime()
  ) / 86_400_000;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // @ts-ignore
  const anyDb = supabase as any;

  // Data alvo: parâmetro GET ou body JSON ou hoje
  let targetDate = new Date().toISOString().split("T")[0];
  try {
    const urlParam = new URL(req.url).searchParams.get("date");
    if (urlParam) {
      targetDate = urlParam;
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.date) targetDate = body.date;
    }
  } catch { /* usa hoje */ }

  const windowDays = parseInt(Deno.env.get("HOMILIA_WINDOW_DAYS") ?? String(DEFAULT_WINDOW), 10);
  const channelId   = Deno.env.get("YOUTUBE_CHANNEL_ID")   ?? "";
  const channelUser = Deno.env.get("YOUTUBE_CHANNEL_USER") ?? DEFAULT_USER;

  console.log(`[homilia-diaria] Iniciando para data=${targetDate}, window=±${windowDays}d`);

  try {
    const entries = await fetchEntriesRobust(channelUser, channelId);
    console.log(`[homilia-diaria] RSS: ${entries.length} vídeos`);

    // ── Estratégia 1: homilia no janela ±windowDays ───────────────────────────
    const candidatos = entries
      .filter((e) => isHomilia(e.titulo, targetDate) && diffDays(e.publishedAt, targetDate) <= windowDays)
      .sort((a, b) => diffDays(a.publishedAt, targetDate) - diffDays(b.publishedAt, targetDate));

    // ── Estratégia 2: qualquer homilia no feed (sem restrição de data) ────────
    const fallbackCandidatos = entries
      .filter((e) => isHomilia(e.titulo, targetDate))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    // ── Estratégia 3: conteúdo pastoral genérico mais recente ─────────────────
    const genericCandidatos = entries
      .filter((e) => isPossibleHomilia(e.titulo))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const best     = candidatos[0] ?? fallbackCandidatos[0] ?? genericCandidatos[0];
    const strategy = candidatos[0]      ? "janela_exata"
                   : fallbackCandidatos[0] ? "fallback_homilia_recente"
                   : genericCandidatos[0]  ? "fallback_conteudo_pastoral"
                   : null;

    if (!best) {
      const sample = entries.slice(0, 5).map((e) => `"${e.titulo}" (${e.publishedAt})`).join(", ");
      console.warn(`[homilia-diaria] Sem candidatos para ${targetDate}. Títulos: ${sample}`);
      return new Response(JSON.stringify({
        ok:           false,
        motivo:       "Nenhum vídeo adequado encontrado no RSS",
        data:         targetDate,
        feed_total:   entries.length,
        sample_titles: entries.slice(0, 5).map((e) => e.titulo),
      }), { headers: { "Content-Type": "application/json" } });
    }

    const upsertData = {
      data:          targetDate,
      titulo:        best.titulo,
      descricao:     best.descricao || null,
      youtube_url:   best.url,
      video_id:      best.videoId,
      thumbnail_url: best.thumbnail,
      autor:         "Padre Paulo Ricardo",
    };

    const { error: upsertErr } = await anyDb
      .from("homilias_diarias")
      .upsert(upsertData, { onConflict: "data" });

    if (upsertErr) {
      console.error("[homilia-diaria] Erro upsert:", upsertErr);
      return new Response(JSON.stringify({ ok: false, erro: upsertErr.message }),
        { status: 500, headers: { "Content-Type": "application/json" } });
    }

    console.log(`[homilia-diaria] OK — estratégia=${strategy} título="${best.titulo}" publicado=${best.publishedAt}`);

    return new Response(JSON.stringify({
      ok:          true,
      strategy,
      data:        targetDate,
      videoId:     best.videoId,
      titulo:      best.titulo,
      publishedAt: best.publishedAt,
      url:         best.url,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[homilia-diaria] Erro geral:", err);
    return new Response(JSON.stringify({ ok: false, erro: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
