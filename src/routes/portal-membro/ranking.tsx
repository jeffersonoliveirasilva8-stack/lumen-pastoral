import { createFileRoute } from "@tanstack/react-router";
import { ListSkeleton } from "@/components/ui/page-skeleton";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Star, Lock, History, TrendingUp, Calendar } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { useRankingFull, useRankingPos, type RankingEntryFull } from "@/lib/ranking";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/ranking")({
  component: PortalMembroRanking,
  head: () => ({ meta: [{ title: "Ranking — Portal do Servidor" }] }),
});

type HistoricoItem = {
  id: string;
  pontos: number;
  titulo: string;
  data: string;
  tipo_evento: string;
};

function PortalMembroRanking() {
  const { membro } = useMembroAuth();
  const qc = useQueryClient();
  const { data: membros = [], isLoading } = useRankingFull(membro?.paroquia_id);
  const { data: rankingPos } = useRankingPos(membro?.paroquia_id, membro?.id);

  const { data: historico = [], isLoading: loadingHistorico } = useQuery<HistoricoItem[]>({
    queryKey: ["ranking-historico", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("historico_participacoes")
        .select("id, pontos, tipo_evento, descricao, data, escalas(titulo, data)")
        .eq("membro_id", membro!.id)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        pontos: r.pontos ?? 0,
        tipo_evento: r.tipo_evento ?? "escala",
        titulo: r.escalas?.titulo ?? r.descricao ?? "Participação",
        data: r.escalas?.data ?? r.data ?? "",
      }));
    },
  });

  // ── Realtime: atualiza quando score muda ou historico é inserido ──
  useEffect(() => {
    if (!membro?.paroquia_id) return;
    const channel = supabase
      .channel("ranking-rt")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "membros",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-full"] });
        qc.invalidateQueries({ queryKey: ["ranking-top"] });
        qc.invalidateQueries({ queryKey: ["ranking-pos"] });
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "historico_participacoes",
        filter: `membro_id=eq.${membro.id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-historico", membro.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [membro?.paroquia_id, membro?.id, qc]);

  if (!membro) return null;

  const maxScore = membros[0]?.score ?? 1;
  const myPos = rankingPos ?? (membros.findIndex((m) => m.id === membro.id) + 1 || null);
  const myScore = membro.score ?? 0;
  const myPct = maxScore > 0 ? Math.min(100, Math.round((myScore / maxScore) * 100)) : 0;
  const top3 = membros.slice(0, 3);

  // Pontos ganhos no mês atual
  const inicioMes = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const pontosEsteMes = historico
    .filter((h) => h.data >= inicioMes)
    .reduce((acc, h) => acc + h.pontos, 0);

  // Só exibe pódio e posição se houver membros com score > 0
  const top3ComScore = top3.filter((m) => m.score > 0);
  const hasScores    = myScore > 0 || top3ComScore.length > 0;

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-5 pb-24">

      {/* Header */}
      <div>
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
        <h1 className="mt-1.5 font-serif text-3xl">Ranking</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Servidores ordenados por pontuação acumulada.
        </p>
      </div>

      {/* Se não há pontuação ainda — empty state encorajador */}
      {!hasScores && !isLoading && (
        <div className="rounded-2xl border border-dashed border-border bg-background p-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
            <Star className="h-5 w-5 text-amber-500" />
          </div>
          <p className="font-semibold text-foreground">Nenhuma pontuação ainda</p>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Confirme presença nas escalas para começar a acumular pontos e aparecer no ranking.
          </p>
          <Link
            to="/portal-membro/escalas"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mt-1"
          >
            <Calendar className="h-4 w-4" />
            Ver minhas escalas
          </Link>
        </div>
      )}

      {/* Minha posição — só quando há score */}
      {hasScores && myScore > 0 && myPos && (
        <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-12 w-12 rounded-2xl bg-sidebar-accent/50 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-gold">
                {myPos === 1 ? "🥇" : myPos === 2 ? "🥈" : myPos === 3 ? "🥉" : `${myPos}º`}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/60">Sua posição</p>
              <p className="font-serif text-2xl leading-none mt-0.5">{myPos}º lugar</p>
              <p className="text-sm text-sidebar-foreground/70 mt-0.5">{myScore} pontos acumulados</p>
            </div>
            {pontosEsteMes > 0 && (
              <div className="shrink-0 text-right">
                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1">
                  <TrendingUp className="h-3 w-3 text-emerald-400" />
                  <span className="text-[11px] font-semibold text-emerald-400">+{pontosEsteMes}</span>
                </div>
                <p className="text-[9px] text-sidebar-foreground/40 mt-0.5 text-center">este mês</p>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-sidebar-foreground/50 mb-1.5">
              <span>0 pts</span>
              <span className="font-medium text-sidebar-foreground/70">{myPct}% do líder</span>
              <span>{maxScore} pts</span>
            </div>
            <div className="h-2 rounded-full bg-sidebar-accent/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${myPct}%`, background: "var(--gold, #f59e0b)" }}
              />
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : hasScores && top3ComScore.length >= 2 ? (
        /* Pódio — só exibe quando há membros com score */
        <div className="rounded-2xl border border-border bg-card p-4 pb-0 overflow-hidden">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Pódio — identidades ocultas
            </p>
          </div>
          <div className="flex items-end justify-center gap-2">
            {top3[1] && <MysteryPillar score={top3[1].score} position={2} isMe={top3[1].id === membro.id} />}
            {top3[0] && <MysteryPillar score={top3[0].score} position={1} isMe={top3[0].id === membro.id} />}
            {top3[2] ? <MysteryPillar score={top3[2].score} position={3} isMe={top3[2].id === membro.id} /> : <div className="flex-1" />}
          </div>
        </div>
      ) : null}

      {/* Histórico com tags de resultado */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Histórico de pontuação</h2>
        </div>
        {loadingHistorico ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : historico.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma participação registrada ainda.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border/50">
            {historico.map((h) => {
              const ganhou = h.pontos > 0;
              const perdeu = h.pontos < 0;
              const neutro = h.pontos === 0;
              const tipoLabel: Record<string, string> = {
                escala: "Missa", solene: "Missa solene", bispo: "Missa c/ Bispo",
                formacao: "Formação", reuniao: "Reunião", retiro: "Retiro",
                adoracao: "Adoração", ensaio: "Ensaio", encontro: "Encontro",
                compromisso: "Compromisso", evento: "Evento",
              };
              return (
                <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{h.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tipoLabel[h.tipo_evento] ?? h.tipo_evento}
                      {h.data ? ` · ${format(new Date(h.data + "T12:00:00"), "d 'de' MMMM", { locale: ptBR })}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Tag de resultado */}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      ganhou ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                      : perdeu ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                      : "bg-muted text-muted-foreground"
                    }`}>
                      {ganhou ? "Recebido" : perdeu ? "Descontado" : "Pendente"}
                    </span>
                    {/* Valor */}
                    <span className={`text-sm font-bold tabular-nums ${
                      ganhou ? "text-emerald-600 dark:text-emerald-400"
                      : perdeu ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                    }`}>
                      {ganhou ? `+${h.pontos}` : neutro ? "—" : `${h.pontos}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MysteryPillar ─────────────────────────────────────────────────────

const PODIUM_HEIGHTS: Record<1 | 2 | 3, string> = { 1: "h-24", 2: "h-16", 3: "h-10" };
const PODIUM_COLORS: Record<1 | 2 | 3, string> = { 1: "#f59e0b", 2: "#9ca3af", 3: "#b45309" };
const MEDALS: Record<1 | 2 | 3, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function MysteryPillar({
  score, position, isMe,
}: {
  score: number;
  position: 1 | 2 | 3;
  isMe: boolean;
}) {
  const color = PODIUM_COLORS[position];

  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      <span className="text-lg mb-1">{MEDALS[position]}</span>

      {/* Avatar — blurred, mystery */}
      <div
        className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 select-none"
        style={{
          backgroundColor: isMe ? color + "55" : "#9CA3AF55",
          border: `2px solid ${color}66`,
          filter: isMe ? "none" : "blur(4px)",
        }}
      >
        {isMe
          ? <span className="text-xs font-bold" style={{ color }}>Eu</span>
          : <span className="text-xs text-muted-foreground">?</span>
        }
      </div>

      {/* Name — blurred/hidden */}
      <p
        className="text-[10px] mt-1 font-medium text-center truncate max-w-full px-1 select-none"
        style={isMe ? { color, fontWeight: 700 } : { filter: "blur(5px)", color: "#9CA3AF" }}
      >
        {isMe ? "Você" : "Servidor"}
      </p>

      {/* Score — always visible */}
      <div className="flex items-center gap-0.5 mb-1.5">
        <Star className="h-2.5 w-2.5" style={{ color }} />
        <span className="text-[11px] font-medium" style={{ color }}>{score}</span>
      </div>

      {/* Podium bar */}
      <div
        className={`w-full ${PODIUM_HEIGHTS[position]} rounded-t-xl flex items-center justify-center`}
        style={{ backgroundColor: color + "33", borderTop: `2px solid ${color}66` }}
      >
        <span className="text-sm font-bold" style={{ color }}>{position}º</span>
      </div>
    </div>
  );
}

// Keep type exported for type-only usage (suppress unused warning)
export type { RankingEntryFull };
