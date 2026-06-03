// Edge Function — liturgia-diaria v3
// Busca leituras do dia via API Liturgia Diária (CNBB) e persiste em liturgia_base.
//
// Chamada: GET /functions/v1/liturgia-diaria?date=YYYY-MM-DD&days=N (1-7)
// Sem parâmetros → data de hoje, days=1

// @ts-ignore — import de URL válido no runtime Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE = "https://liturgia.up.railway.app/v2/";

// ── Tipos da API ──────────────────────────────────────────────────────────────

interface ApiLeitura {
  referencia: string;
  titulo:     string;
  texto:      string;
}
interface ApiSalmo {
  referencia: string;
  refrao:     string;
  texto:      string;
}
interface ApiResponse {
  data:     string;   // "DD/MM/YYYY"
  liturgia: string;
  cor:      string;
  leituras: {
    primeiraLeitura: ApiLeitura[];
    segundaLeitura:  ApiLeitura[];
    salmo:           ApiSalmo[];
    evangelho:       ApiLeitura[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COR_MAP: Record<string, string> = {
  Verde:    "verde",
  Vermelho: "vermelho",
  Roxo:     "roxo",
  Branco:   "branco",
  Rosa:     "rosa",
  Preto:    "preto",
  Dourado:  "dourado",
};

function mapCor(cor: string): string {
  return COR_MAP[cor] ?? cor.toLowerCase();
}

function mapTempo(liturgia: string): string {
  const l = liturgia.toLowerCase();
  if (l.includes("advento"))                                     return "advento";
  if (l.includes("natal"))                                       return "natal";
  if (l.includes("quaresma"))                                    return "quaresma";
  if (l.includes("tríduo") || l.includes("triduo"))             return "triduo";
  if (l.includes("pascal") || l.includes("páscoa") || l.includes("pascoa")) return "pascoa";
  if (l.includes("pentecostes"))                                 return "pascoa";
  return "comum";
}

function mapGrau(liturgia: string): string | null {
  const l = liturgia.toLowerCase();
  if (l.startsWith("solenidade"))                                           return "solenidade";
  if (l.startsWith("festa"))                                                return "festa";
  if (l.includes("memória facultativa") || l.includes("memoria facultativa")) return "memorial_facultativo";
  if (l.startsWith("memória") || l.startsWith("memoria"))                  return "memorial";
  if (l.startsWith("comemoração") || l.startsWith("comemoracao"))          return "comemoracao";
  return null;
}

/**
 * Formata o salmo com refrão (R.) e estrofes em parágrafos separados.
 * Estrutura compatível com parseSalmo() do frontend.
 *
 * Resultado:
 *   R. {refrao}
 *
 *   {estrofe 1}
 *
 *   R.
 *
 *   {estrofe 2}
 *
 *   R.
 */
function formatSalmo(refrao: string, texto: string): string {
  const estrofes = texto
    .split("\n")
    .map((l) => l.replace(/^[–—\-]\s*/, "").trim())
    .filter(Boolean);

  const partes: string[] = [`R. ${refrao.trim()}`];
  for (const e of estrofes) {
    partes.push(e);
    partes.push("R.");
  }
  return partes.join("\n\n");
}

function clean(s: string | undefined): string | null {
  if (!s) return null;
  const r = s.replace(/\s+/g, " ").trim();
  return r || null;
}

async function fetchLiturgia(dia: number, mes: number, ano: number): Promise<ApiResponse | null> {
  const url = `${API_BASE}?dia=${dia}&mes=${mes}&ano=${ano}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PortalPastoral/3.0" },
      signal:  AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as ApiResponse & { erro?: string };
    if (json.erro) return null;
    return json;
  } catch {
    return null;
  }
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
  const startIso  = urlParams.get("date") ?? new Date().toISOString().split("T")[0];
  const days      = Math.min(Math.max(parseInt(urlParams.get("days") ?? "1"), 1), 7);

  const resultados: Array<{
    data:       string;
    status:     "ok" | "skipped" | "erro";
    celebracao?: string;
    motivo?:    string;
  }> = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(`${startIso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);

    const iso = d.toISOString().split("T")[0];
    const dia = d.getUTCDate();
    const mes = d.getUTCMonth() + 1;
    const ano = d.getUTCFullYear();

    try {
      const api = await fetchLiturgia(dia, mes, ano);

      if (!api) {
        resultados.push({ data: iso, status: "skipped", motivo: "API sem resposta" });
        continue;
      }

      const lr1 = api.leituras.primeiraLeitura?.[0];
      const lr2 = api.leituras.segundaLeitura?.[0];
      const sal = api.leituras.salmo?.[0];
      const ev  = api.leituras.evangelho?.[0];

      const updatePayload = {
        titulo:  api.liturgia,
        cor:     mapCor(api.cor),
        grau:    mapGrau(api.liturgia),
        origem:  "cnbb",

        tempo_liturgico: mapTempo(api.liturgia),
        subtitulo:       null,
        santo:           null,

        // Campos legados
        leitura_1: clean(lr1?.referencia),
        leitura_2: clean(lr2?.referencia),
        salmo:     clean(sal?.referencia),
        evangelho: clean(ev?.referencia),

        // Campos expandidos — textos já limpos (sem HTML)
        leitura_1_referencia: clean(lr1?.referencia),
        leitura_1_texto:      clean(lr1?.texto) ?? null,
        salmo_referencia:     clean(sal?.referencia),
        salmo_texto:          sal ? formatSalmo(sal.refrao, sal.texto) : null,
        leitura_2_referencia: clean(lr2?.referencia),
        leitura_2_texto:      clean(lr2?.texto) ?? null,
        evangelho_referencia: clean(ev?.referencia),
        evangelho_texto:      clean(ev?.texto) ?? null,
      };

      const { data: existente } = await anyDb
        .from("liturgia_base")
        .select("id")
        .eq("data", iso)
        .maybeSingle();

      if (existente) {
        await anyDb.from("liturgia_base").update(updatePayload).eq("id", existente.id);
      } else {
        await anyDb.from("liturgia_base").insert({
          data: iso,
          ano,
          ...updatePayload,
        });
      }

      resultados.push({ data: iso, status: "ok", celebracao: api.liturgia });
    } catch (err) {
      resultados.push({ data: iso, status: "erro", motivo: String(err) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processados: resultados.length, resultados }),
    { headers: { "Content-Type": "application/json" } },
  );
});
