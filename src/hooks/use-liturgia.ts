import { useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { stripHtml, sanitizeLiturgicalText } from "@/lib/strip-html";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

// ── Tipo completo do registro em liturgia_base ────────────────────────────────

export type LiturgiaRow = {
  id: string;
  data: string;               // "YYYY-MM-DD"
  titulo: string;
  subtitulo: string | null;
  cor: string | null;
  tempo_liturgico: string | null;
  grau: string | null;
  santo: string | null;

  // Campos legados (referência — manter por compatibilidade)
  leitura_1: string | null;
  leitura_2: string | null;
  salmo:     string | null;
  evangelho: string | null;

  // Novos campos separados (referência + texto completo)
  leitura_1_referencia: string | null;
  leitura_1_texto:      string | null;
  salmo_referencia:     string | null;
  salmo_texto:          string | null;
  leitura_2_referencia: string | null;
  leitura_2_texto:      string | null;
  evangelho_referencia: string | null;
  evangelho_texto:      string | null;

  e_dia_preceito: boolean | null;
  e_solene:       boolean | null;
  origem:         string | null;
};

const FIELDS = [
  "id, data, titulo, subtitulo, cor, tempo_liturgico, grau, santo",
  "leitura_1, leitura_2, salmo, evangelho",
  "leitura_1_referencia, leitura_1_texto",
  "salmo_referencia, salmo_texto",
  "leitura_2_referencia, leitura_2_texto",
  "evangelho_referencia, evangelho_texto",
  "e_dia_preceito, e_solene, origem",
].join(", ");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Retorna a referência: novo campo tem prioridade; cai para legado se vazio. */
export function refLeitura1(r: LiturgiaRow)  { return r.leitura_1_referencia ?? r.leitura_1; }
export function refSalmo(r: LiturgiaRow)     { return r.salmo_referencia     ?? r.salmo; }
export function refLeitura2(r: LiturgiaRow)  { return r.leitura_2_referencia ?? r.leitura_2; }
export function refEvangelho(r: LiturgiaRow) { return r.evangelho_referencia ?? r.evangelho; }

function sanitize(row: LiturgiaRow): LiturgiaRow {
  // Referências (curtas): stripHtml simples
  // Textos completos: sanitizeLiturgicalText (remove rodapés/propaganda)
  return {
    ...row,
    titulo:               stripHtml(row.titulo),
    subtitulo:            row.subtitulo            ? stripHtml(row.subtitulo)                     : null,
    santo:                row.santo                ? stripHtml(row.santo)                         : null,
    leitura_1:            row.leitura_1            ? stripHtml(row.leitura_1)                     : null,
    leitura_2:            row.leitura_2            ? stripHtml(row.leitura_2)                     : null,
    salmo:                row.salmo                ? stripHtml(row.salmo)                         : null,
    evangelho:            row.evangelho            ? stripHtml(row.evangelho)                     : null,
    leitura_1_referencia: row.leitura_1_referencia ? stripHtml(row.leitura_1_referencia)           : null,
    leitura_1_texto:      row.leitura_1_texto      ? sanitizeLiturgicalText(row.leitura_1_texto)   : null,
    salmo_referencia:     row.salmo_referencia     ? stripHtml(row.salmo_referencia)               : null,
    salmo_texto:          row.salmo_texto          ? sanitizeLiturgicalText(row.salmo_texto)       : null,
    leitura_2_referencia: row.leitura_2_referencia ? stripHtml(row.leitura_2_referencia)           : null,
    leitura_2_texto:      row.leitura_2_texto      ? sanitizeLiturgicalText(row.leitura_2_texto)  : null,
    evangelho_referencia: row.evangelho_referencia ? stripHtml(row.evangelho_referencia)          : null,
    evangelho_texto:      row.evangelho_texto      ? sanitizeLiturgicalText(row.evangelho_texto)  : null,
  };
}

// ── Hook: liturgia de hoje ────────────────────────────────────────────────────

export function useLiturgiaHoje() {
  const today = format(new Date(), "yyyy-MM-dd");
  return useQuery<LiturgiaRow | null>({
    queryKey: ["liturgia-hoje", today],
    staleTime: 60 * 60 * 1_000,
    queryFn: async () => {
      const { data } = await anyDb
        .from("liturgia_base")
        .select(FIELDS)
        .eq("data", today)
        .order("e_solene",       { ascending: false })
        .order("e_dia_preceito", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? sanitize(data) : null;
    },
  });
}

// ── Hook: liturgia dos próximos N dias (inclui hoje) ─────────────────────────

export function useLiturgiaProximos(days = 3) {
  const today = format(new Date(), "yyyy-MM-dd");
  const end   = format(addDays(new Date(), days - 1), "yyyy-MM-dd");

  return useQuery<LiturgiaRow[]>({
    queryKey: ["liturgia-proximos", today, days],
    staleTime: 60 * 60 * 1_000,
    queryFn: async () => {
      const { data } = await anyDb
        .from("liturgia_base")
        .select(FIELDS)
        .gte("data", today)
        .lte("data", end)
        .order("data")
        .order("e_solene",       { ascending: false })
        .order("e_dia_preceito", { ascending: false });

      if (!data) return [];
      const byDay = new Map<string, LiturgiaRow>();
      for (const row of data as LiturgiaRow[]) {
        if (!byDay.has(row.data)) byDay.set(row.data, sanitize(row));
      }
      return Array.from(byDay.values());
    },
  });
}
