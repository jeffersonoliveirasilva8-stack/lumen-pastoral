import { useQuery } from "@tanstack/react-query";
import { format, addDays, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

// ── Tipo ──────────────────────────────────────────────────────────────────────

export type HomiliaRow = {
  id:            string;
  data:          string;   // "YYYY-MM-DD"
  titulo:        string;
  descricao:     string | null;
  youtube_url:   string;
  video_id:      string;
  thumbnail_url: string | null;
  autor:         string | null;
  created_at:    string;
};

const FIELDS = "id, data, titulo, descricao, youtube_url, video_id, thumbnail_url, autor, created_at";

// ── Hook: homilia de hoje ────────────────────────────────────────────────────

export function useHomiliaHoje() {
  const today = format(new Date(), "yyyy-MM-dd");
  return useQuery<HomiliaRow | null>({
    queryKey: ["homilia-hoje", today],
    staleTime: 15 * 60 * 1_000, // 15 min — cron roda às 03:30 UTC
    queryFn: async () => {
      const { data } = await anyDb
        .from("homilias_diarias")
        .select(FIELDS)
        .eq("data", today)
        .maybeSingle();
      return data ?? null;
    },
  });
}

// ── Hook: homilia mais recente (hoje ou último disponível em até 7 dias) ─────
// Fallback: se hoje não tem, mostra o mais recente da semana anterior.

export function useHomiliaRecente() {
  const today   = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

  return useQuery<HomiliaRow | null>({
    queryKey: ["homilia-recente", today],
    staleTime: 15 * 60 * 1_000,
    queryFn: async () => {
      const { data } = await anyDb
        .from("homilias_diarias")
        .select(FIELDS)
        .lte("data", today)    // até hoje (não mostra futuro)
        .gte("data", weekAgo)  // últimos 7 dias
        .order("data", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });
}

// ── Hook: homilias dos próximos N dias ────────────────────────────────────────

export function useHomiliaProximos(days = 3) {
  const today = format(new Date(), "yyyy-MM-dd");
  const end   = format(addDays(new Date(), days - 1), "yyyy-MM-dd");

  return useQuery<HomiliaRow[]>({
    queryKey: ["homilia-proximos", today, days],
    staleTime: 15 * 60 * 1_000,
    queryFn: async () => {
      const { data } = await anyDb
        .from("homilias_diarias")
        .select(FIELDS)
        .gte("data", today)
        .lte("data", end)
        .order("data");
      return (data ?? []) as HomiliaRow[];
    },
  });
}
