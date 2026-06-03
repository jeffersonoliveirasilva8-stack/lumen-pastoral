// Edge Function — homilia-diaria
// Busca a homilia do dia no canal do Padre Paulo Ricardo via YouTube RSS
// e persiste em homilias_diarias.
//
// Chamada: GET /functions/v1/homilia-diaria?date=YYYY-MM-DD
// Sem parâmetros → data de hoje
//
// Configuração opcional via env:
//   YOUTUBE_CHANNEL_USER  (padrão: PadrePauloRicardo)
//   YOUTUBE_CHANNEL_ID    (alternativa, usa channel_id= no feed)

// @ts-ignore — import de URL válido no runtime Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_USER = "PadrePauloRicardo";

// ── RSS feed ──────────────────────────────────────────────────────────────────
async function fetchRss(userOrId: string, byId: boolean): Promise<string> {
  const param = byId ? `channel_id=${userOrId}` : `user=${userOrId}`;
  const url   = `https://www.youtube.com/feeds/videos.xml?${param}`;
  const res   = await fetch(url, {
    headers: { "User-Agent": "PortalPastoral/2.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  return res.text();
}

// ── Parser XML minimalista (sem dependência externa) ──────────────────────────
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
        descricao: desc.slice(0, 500),
        publishedAt: pub.slice(0, 10), // YYYY-MM-DD
        thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
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
function isHomilia(titulo: string): boolean {
  const t = titulo.toLowerCase();
  return t.includes("homilia") || t.includes("homília");
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

  const urlParams = new URL(req.url).searchParams;
  const targetDate = urlParams.get("date") ?? new Date().toISOString().split("T")[0];

  // Configuração do canal (env ou padrão)
  const channelId   = Deno.env.get("YOUTUBE_CHANNEL_ID")   ?? "";
  const channelUser = Deno.env.get("YOUTUBE_CHANNEL_USER") ?? DEFAULT_USER;
  const byId        = channelId.length > 0;

  try {
    const xml     = await fetchRss(byId ? channelId : channelUser, byId);
    const entries = parseEntries(xml);

    // Procura homilia: mesmo dia → ±1 dia (publicações podem ser às 00h UTC)
    const candidatos = entries.filter((e) => {
      if (!isHomilia(e.titulo)) return false;
      const diff = Math.abs(
        new Date(e.publishedAt).getTime() - new Date(targetDate).getTime()
      );
      return diff <= 86_400_000 * 2; // ≤ 2 dias de diferença
    });

    if (candidatos.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, motivo: "Nenhuma homilia encontrada no RSS para esta data" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Prefere o vídeo publicado mais próximo da data alvo
    candidatos.sort((a, b) =>
      Math.abs(new Date(a.publishedAt).getTime() - new Date(targetDate).getTime()) -
      Math.abs(new Date(b.publishedAt).getTime() - new Date(targetDate).getTime())
    );

    const best = candidatos[0];

    await anyDb
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

    return new Response(
      JSON.stringify({ ok: true, data: targetDate, videoId: best.videoId, titulo: best.titulo }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, erro: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
