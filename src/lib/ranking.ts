import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export type RankingEntry = {
  id: string;
  nome: string;
  score: number;
};

export type RankingEntryFull = RankingEntry & {
  ministerios: { id: string; nome: string; cor: string }[];
};

/** Top N members ordered by score — used in home and sidebar snippets. */
export function useRankingTop(paroquiaId: string | undefined, limit = 5) {
  return useQuery<RankingEntry[]>({
    queryKey: ["ranking-top", paroquiaId, limit],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("membros")
        .select("id, nome, score")
        .eq("paroquia_id", paroquiaId!)
        .eq("ativo", true)
        .order("score", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RankingEntry[];
    },
  });
}

/** Full ranking with ministério info — used in the dedicated ranking page. */
export function useRankingFull(paroquiaId: string | undefined) {
  return useQuery<RankingEntryFull[]>({
    queryKey: ["ranking-full", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("membros")
        .select("id, nome, score, membro_ministerios(ministerios(id, nome, cor))")
        .eq("paroquia_id", paroquiaId!)
        .eq("ativo", true)
        .order("score", { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((m: any) => ({
        id: m.id,
        nome: m.nome,
        score: m.score ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ministerios: (m.membro_ministerios ?? []).map((mm: any) => mm.ministerios).filter(Boolean),
      }));
    },
  });
}

/**
 * 1-based position of the current member.
 * Always fetches the member's current score fresh from DB to avoid stale-cache divergence.
 */
export function useRankingPos(
  paroquiaId: string | undefined,
  membroId: string | undefined,
) {
  return useQuery<number>({
    queryKey: ["ranking-pos", paroquiaId, membroId],
    enabled: !!paroquiaId && !!membroId,
    queryFn: async () => {
      const { data: self } = await anyDb
        .from("membros")
        .select("score")
        .eq("id", membroId!)
        .maybeSingle();
      const score = self?.score ?? 0;
      const { count } = await anyDb
        .from("membros")
        .select("id", { count: "exact", head: true })
        .eq("paroquia_id", paroquiaId!)
        .eq("ativo", true)
        .gt("score", score);
      return (count ?? 0) + 1;
    },
  });
}
