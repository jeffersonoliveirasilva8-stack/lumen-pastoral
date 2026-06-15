import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Star, Trophy, History, X, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useRankingFull, type RankingEntryFull } from "@/lib/ranking";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/ranking")({
  component: AdminRanking,
  head: () => ({ meta: [{ title: "Ranking — Painel Pastoral" }] }),
});

type HistoricoItem = {
  id: string;
  pontos: number;
  tipo_evento: string;
  escala_titulo: string;
  escala_data: string;
};

const TIPO_LABELS: Record<string, string> = {
  escala: "Missa",
  solene: "Missa solene",
  bispo: "Missa com bispo",
  formacao: "Formação",
  reuniao: "Reunião",
  retiro: "Retiro",
  adoracao: "Adoração",
  ensaio: "Ensaio",
  encontro: "Encontro",
  compromisso: "Compromisso pastoral",
  evento: "Evento especial",
};

function AdminRanking() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: membros = [], isLoading } = useRankingFull(profile?.paroquia_id ?? undefined);
  const [selectedMembro, setSelectedMembro] = useState<RankingEntryFull | null>(null);

  const maxScore = membros[0]?.score ?? 1;
  const top3 = membros.slice(0, 3);

  // ── Realtime: atualiza ranking quando score muda ──
  useEffect(() => {
    if (!profile?.paroquia_id) return;
    const channel = supabase
      .channel("admin-ranking-rt")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "membros",
        filter: `paroquia_id=eq.${profile.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-full"] });
        qc.invalidateQueries({ queryKey: ["ranking-top"] });
        qc.invalidateQueries({ queryKey: ["ranking-pos"] });
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "historico_participacoes",
      }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-full"] });
        qc.invalidateQueries({ queryKey: ["admin-ranking-historico"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.paroquia_id, qc]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl">Ranking de Servidores</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Clique em um servidor para ver o histórico de pontuação.
        </p>
      </div>

      {/* Summary */}
      {membros.length > 0 && !isLoading && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-2xl border border-border bg-card px-3 py-3 sm:px-4 text-center">
            <p className="text-xl sm:text-2xl font-serif">{membros.length}</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">servidores</p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-3 py-3 sm:px-4 text-center">
            <p className="text-xl sm:text-2xl font-serif">{membros[0]?.score ?? 0}</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">maior score</p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-3 py-3 sm:px-4 text-center">
            <p className="text-xl sm:text-2xl font-serif">
              {membros.length > 0
                ? Math.round(membros.reduce((s, m) => s + m.score, 0) / membros.length)
                : 0}
            </p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">média</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : membros.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-border p-14 text-center">
          <Trophy className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum membro com pontuação ainda.</p>
        </div>
      ) : (
        <>
          {/* Podium — top 3 */}
          {top3.length >= 2 && (
            <div className="rounded-2xl border border-border bg-card p-4 pb-0 overflow-hidden">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-center mb-4">
                Pódio
              </p>
              <div className="flex items-end justify-center gap-2">
                {top3[1] && (
                  <AdminPodiumPillar
                    member={top3[1]} position={2}
                    onClick={() => setSelectedMembro(top3[1])}
                  />
                )}
                {top3[0] && (
                  <AdminPodiumPillar
                    member={top3[0]} position={1}
                    onClick={() => setSelectedMembro(top3[0])}
                  />
                )}
                {top3[2] ? (
                  <AdminPodiumPillar
                    member={top3[2]} position={3}
                    onClick={() => setSelectedMembro(top3[2])}
                  />
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            </div>
          )}

          {/* Full list — clickable */}
          <div className="space-y-2">
            {membros.map((m, i) => {
              const pos = i + 1;
              const pct = maxScore > 0 ? Math.min(100, Math.round((m.score / maxScore) * 100)) : 0;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMembro(m)}
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/40 transition group"
                >
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-sm text-muted-foreground font-medium w-7 text-center shrink-0">
                      {pos <= 3
                        ? (["🥇", "🥈", "🥉"] as const)[pos - 1]
                        : `${pos}º`}
                    </span>
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                      style={{ backgroundColor: m.ministerios[0]?.cor ?? "#6B7280" }}
                    >
                      {m.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.nome.split(" ").slice(0, 3).join(" ")}
                      </p>
                      {m.ministerios.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {m.ministerios.slice(0, 2).map((min) => (
                            <span
                              key={min.id}
                              className="text-[10px] px-1.5 py-px rounded-full"
                              style={{
                                backgroundColor: (min.cor ?? "#6B7280") + "25",
                                color: min.cor ?? "#6B7280",
                              }}
                            >
                              {min.nome}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Star className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-sm font-semibold">{m.score}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition" />
                    </div>
                  </div>
                  <div className="ml-10 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/50 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Histórico Sheet */}
      <HistoricoSheet
        membro={selectedMembro}
        onClose={() => setSelectedMembro(null)}
      />
    </div>
  );
}

// ── HistoricoSheet ─────────────────────────────────────────────────

function HistoricoSheet({
  membro, onClose,
}: {
  membro: RankingEntryFull | null;
  onClose: () => void;
}) {
  const { data: historico = [], isLoading } = useQuery<HistoricoItem[]>({
    queryKey: ["admin-ranking-historico", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("historico_participacoes")
        .select("id, pontos, tipo_evento, descricao, data, escalas(titulo, data)")
        .eq("membro_id", membro!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        pontos: r.pontos ?? 0,
        tipo_evento: r.tipo_evento ?? "escala",
        escala_titulo: r.escalas?.titulo ?? r.descricao ?? "—",
        escala_data: r.escalas?.data ?? r.data ?? "",
      }));
    },
  });

  const totalPontos = historico.reduce((s, h) => s + h.pontos, 0);

  return (
    <Sheet open={!!membro} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="flex flex-row items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <SheetTitle className="truncate">
              {membro?.nome.split(" ").slice(0, 3).join(" ")}
            </SheetTitle>
            <div className="flex items-center gap-1.5 mt-1">
              <Star className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-sm font-semibold">{membro?.score ?? 0} pts totais</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X className="h-4 w-4" />
          </button>
        </SheetHeader>

        <div className="space-y-4">
          {/* Ministrações */}
          {membro?.ministerios && membro.ministerios.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {membro.ministerios.map((min) => (
                <span
                  key={min.id}
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{
                    backgroundColor: (min.cor ?? "#6B7280") + "25",
                    color: min.cor ?? "#6B7280",
                  }}
                >
                  {min.nome}
                </span>
              ))}
            </div>
          )}

          {/* Histórico header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Histórico de pontuação</span>
            </div>
            {historico.length > 0 && (
              <span className="text-xs text-muted-foreground">{historico.length} registros · {totalPontos} pts</span>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : historico.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma pontuação registrada ainda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historico.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{h.escala_titulo}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {TIPO_LABELS[h.tipo_evento] ?? h.tipo_evento}
                      </span>
                      {h.escala_data && (
                        <>
                          <span className="text-xs text-muted-foreground/40">·</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {format(new Date(h.escala_data + "T12:00:00"), "d 'de' MMM yyyy", { locale: ptBR })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Star className={`h-3.5 w-3.5 ${h.pontos >= 0 ? "text-amber-500" : "text-red-400"}`} />
                    <span className={`text-sm font-semibold ${h.pontos >= 0 ? "text-amber-600" : "text-red-500"}`}>
                      {h.pontos >= 0 ? `+${h.pontos}` : h.pontos}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── AdminPodiumPillar ─────────────────────────────────────────────────

const PODIUM_HEIGHTS: Record<1 | 2 | 3, string> = { 1: "h-24", 2: "h-16", 3: "h-10" };
const PODIUM_COLORS: Record<1 | 2 | 3, string> = { 1: "#f59e0b", 2: "#9ca3af", 3: "#b45309" };
const MEDALS: Record<1 | 2 | 3, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function AdminPodiumPillar({
  member, position, onClick,
}: {
  member: RankingEntryFull;
  position: 1 | 2 | 3;
  onClick: () => void;
}) {
  const color = PODIUM_COLORS[position];
  const avatarColor = member.ministerios[0]?.cor ?? "#6B7280";

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center flex-1 min-w-0 group cursor-pointer"
      title={`Ver histórico de ${member.nome.split(" ")[0]}`}
    >
      <span className="text-lg mb-1">{MEDALS[position]}</span>
      <div
        className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0 transition group-hover:ring-2"
        style={{ backgroundColor: avatarColor, outline: `2px solid ${color}66`, outlineOffset: "2px" }}
      >
        {member.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("")}
      </div>
      <p className="text-xs font-medium text-center mt-1 truncate max-w-full px-1">
        {member.nome.split(" ")[0]}
      </p>
      <div className="flex items-center gap-0.5 mb-1.5">
        <Star className="h-2.5 w-2.5" style={{ color }} />
        <span className="text-[11px] font-medium" style={{ color }}>{member.score}</span>
      </div>
      <div
        className={`w-full ${PODIUM_HEIGHTS[position]} rounded-t-xl flex items-center justify-center`}
        style={{ backgroundColor: color + "33", borderTop: `2px solid ${color}66` }}
      >
        <span className="text-sm font-bold" style={{ color }}>{position}º</span>
      </div>
    </button>
  );
}
