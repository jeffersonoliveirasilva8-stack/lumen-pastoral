// Edge Function — homilia-diaria v2
// Busca a homilia do dia no canal do Padre Paulo Ricardo via YouTube RSS
// e persiste em homilias_diarias.
//
// Chamada: GET /functions/v1/homilia-diaria?date=YYYY-MM-DD
// Sem parâmetros → data de hoje
//
// Env vars opcionais:
//   YOUTUBE_CHANNEL_USER  (padrão: PadrePauloRicardo)
//   YOUTUBE_CHANNEL_ID    (quando fornecido, usa channel_id= no feed)

// @ts-ignore — import de URL válido no runtime Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_USER = "PadrePauloRicardo";

// ── RSS feed ──────────────────────────────────────────────────────────────────
async function fetchRss(param: string, byId: boolean): Promise<string> {
  const key = byId ? `channel_id=${param}` : `user=${param}`;
  const url  = `https://www.youtube.com/feeds/videos.xml?${key}`;
  const res  = await fetch(url, {
    headers: { "User-Agent": "PortalPastoral/2.0" },
    signal:  AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} for ${url}`);
  return res.text();
}

// Tenta múltiplas estratégias de RSS, retorna o conjunto de entradas maior
async function fetchEntriesRobust(channelUser: string, channelId: string): Promise<ReturnType<typeof parseEntries>> {
  const strategies: Array<() => Promise<string>> = [];

  // Estratégia 1: channel_id (mais confiável se fornecido)
  if (channelId) strategies.push(() => fetchRss(channelId, true));
  // Estratégia 2: user= (padrão legado)
  strategies.push(() => fetchRss(channelUser, false));

  let best: ReturnType<typeof parseEntries> = [];
  const errors: string[] = [];

  for (const fn of strategies) {
    try {
      const xml     = await fn();
      const entries = parseEntries(xml);
      if (entries.length > best.length) best = entries;
      if (best.length >= 5) break; // suficiente
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (best.length === 0 && errors.length > 0) {
    throw new Error(`Todas as tentativas de RSS falharam: ${errors.join(" | ")}`);
  }

  return best;
}

// ── Parser XML minimalista ────────────────────────────────────────────────────
function parseEntries(xml: string): Array<{
  videoId:     string;
  titulo:      string;
  descricao:   string;
  publishedAt: string;
  thumbnail:   string;
  url:         string;
}> {
  const entries: ReturnType<typeof parseEntries> = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;

  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];

    const videoId = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ?? [])[1] ?? "";
    const titulo  = strip((block.match(/<title>([^<]+)<\/title>/) ?? [])[1] ?? "");
    const desc    = strip((block.match(/<media:description>([\s\S]*?)<\/media:description>/) ?? [])[1] ?? "");
    const pub     = (block.match(/<published>([^<]+)<\/published>/) ?? [])[1] ?? "";
    const thumb   = (block.match(/url="([^"]+hqdefault[^"]*)"/) ?? block.match(/url="([^"]+)"/) ?? [])[1]
                    ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");

    if (videoId) {
      entries.push({
        videoId,
        titulo,
        descricao:   desc.slice(0, 500),
        publishedAt: pub.slice(0, 10), // YYYY-MM-DD
        thumbnail:   thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url:         `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  }

  return entries;
}

function strip(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

// ── Verifica se um título corresponde a uma homilia ───────────────────────────
// Aceita variações comuns de título que o Padre Paulo Ricardo usa.
function isHomilia(titulo: string, targetDate: string): boolean {
  const t = titulo.toLowerCase();

  // Padrão: "homilia" ou "homília"
  if (t.includes("homilia") || t.includes("homília")) return true;

  // Comentário / reflexão / meditação sobre o evangelho
  if (t.includes("comentário ao evangelho") || t.includes("comentario ao evangelho")) return true;
  if (t.includes("reflexão do evangelho")   || t.includes("reflexao do evangelho"))   return true;
  if (t.includes("meditação do dia")        || t.includes("meditacao do dia"))        return true;
  if (t.includes("palavra do dia"))                                                    return true;
  if (t.includes("evangelho do dia"))                                                  return true;

  // Domingo: aceita títulos de Missa Dominical
  const dow = new Date(targetDate + "T12:00:00Z").getUTCDay(); // 0 = domingo
  if (dow === 0) {
    return (
      t.includes("missa dominical")  ||
      t.includes("missa do domingo") ||
      t.includes("domingo de")       ||
      (t.includes("domingo") && (
        t.includes("missa")       ||
        t.includes("festa")       ||
        t.includes("solenidade")  ||
        t.includes("solene")
      ))
    );
  }

  return false;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = supabase as any;

  const urlParams  = new URL(req.url).searchParams;
  const targetDate = urlParams.get("date") ?? new Date().toISOString().split("T")[0];

  const channelId   = Deno.env.get("YOUTUBE_CHANNEL_ID")   ?? "";
  const channelUser = Deno.env.get("YOUTUBE_CHANNEL_USER") ?? DEFAULT_USER;

  try {
    const entries = await fetchEntriesRobust(channelUser, channelId);

    console.log(`[homilia-diaria] RSS ok: ${entries.length} vídeos para data alvo ${targetDate}`);

    // Procura homilia: aceita vídeos publicados em até ±3 dias da data alvo
    // (cobre publicações antecipadas de até 3 dias e o delay de horário UTC)
    const candidatos = entries.filter((e) => {
      if (!isHomilia(e.titulo, targetDate)) return false;
      const diff = Math.abs(
        new Date(e.publishedAt + "T12:00:00Z").getTime() -
        new Date(targetDate    + "T12:00:00Z").getTime()
      );
      return diff <= 86_400_000 * 3; // ≤ 3 dias
    });

    if (candidatos.length === 0) {
      const titulos = entries.slice(0, 5).map((e) => `"${e.titulo}" (${e.publishedAt})`).join(", ");
      console.warn(`[homilia-diaria] 0 candidatos para ${targetDate}. Primeiros títulos no feed: ${titulos}`);
      return new Response(
        JSON.stringify({
          ok:     false,
          motivo: "Nenhuma homilia encontrada no RSS para esta data",
          data:   targetDate,
          feed_entries: entries.length,
          sample_titles: entries.slice(0, 5).map((e) => e.titulo),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Prefere o vídeo publicado mais próximo da data alvo
    candidatos.sort((a, b) =>
      Math.abs(new Date(a.publishedAt + "T12:00:00Z").getTime() - new Date(targetDate + "T12:00:00Z").getTime()) -
      Math.abs(new Date(b.publishedAt + "T12:00:00Z").getTime() - new Date(targetDate + "T12:00:00Z").getTime())
    );

    const best = candidatos[0];

    const { error: upsertErr } = await anyDb
      .from("homilias_diarias")
      .upsert({
        data:          targetDate,
        titulo:        best.titulo,
        descricao:     best.descricao || null,
        youtube_url:   best.url,
        video_id:      best.videoId,
        thumbnail_url: best.thumbnail,
        autor:         "Padre Paulo Ricardo",
      }, { onConflict: "data" });

    if (upsertErr) {
      console.error("[homilia-diaria] Erro ao salvar no banco:", upsertErr);
      return new Response(
        JSON.stringify({ ok: false, erro: upsertErr.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    console.log(`[homilia-diaria] Salvo: ${best.titulo} (${best.publishedAt}) → data ${targetDate}`);

    return new Response(
      JSON.stringify({
        ok:          true,
        data:        targetDate,
        videoId:     best.videoId,
        titulo:      best.titulo,
        publishedAt: best.publishedAt,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[homilia-diaria] Erro geral:", err);
    return new Response(
      JSON.stringify({ ok: false, erro: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
