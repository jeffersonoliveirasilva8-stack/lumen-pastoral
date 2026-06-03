import { useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
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
    staleTime: 60 * 60 * 1_000, // 1h
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

// ── Hook: homilias dos próximos N dias ────────────────────────────────────────

export function useHomiliaProximos(days = 3) {
  const today = format(new Date(), "yyyy-MM-dd");
  const end   = format(addDays(new Date(), days - 1), "yyyy-MM-dd");

  return useQuery<HomiliaRow[]>({
    queryKey: ["homilia-proximos", today, days],
    staleTime: 60 * 60 * 1_000,
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
