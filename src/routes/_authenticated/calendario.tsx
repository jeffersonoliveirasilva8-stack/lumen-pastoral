import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addMonths, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, BookOpen, RefreshCw, Sparkles, Clock3, Star, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { resolveMonth } from "@/lib/liturgia/priority-engine";
import type { LiturgicalResolution } from "@/biblioteca/liturgia/types";
import { SEASON_LABEL, SEASON_COLOR_CLASS } from "@/biblioteca/liturgia/constants/seasons";
import { RANK_WEIGHT } from "@/biblioteca/liturgia/constants/ranks";
import { getLiturgicalSeason } from "@/biblioteca/liturgia/engine/seasons";
import { easterDate } from "@/biblioteca/liturgia/engine/easter";
import { LiturgicalCalendarGrid } from "@/components/liturgia/LiturgicalCalendarGrid";
import { LiturgicalDayModal } from "@/components/liturgia/LiturgicalDayModal";
import { LiturgicalCelebrationCard } from "@/components/liturgia/LiturgicalCelebrationCard";
import { SeasonBadge } from "@/components/liturgia/LiturgicalBadge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendario")({
  component: CalendarioPage,
  head: () => ({ meta: [{ title: "Calendário Litúrgico — Lumen Pastoral" }] }),
});

function CalendarioPage() {
  const { profile } = useAuth();
  const [month, setMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const year = month.getFullYear();
  const monthNum = month.getMonth() + 1;
  const paroquiaId = profile?.paroquia_id ?? undefined;

  // ── Query: resolve o mês inteiro via priority engine ──────────────────────
  const { data: resolutionMap, isLoading, refetch } = useQuery({
    queryKey: ["liturgia-month", year, monthNum, paroquiaId],
    queryFn: () => resolveMonth(year, monthNum, paroquiaId),
    staleTime: 10 * 60 * 1000, // 10 min
    placeholderData: (prev) => prev,
  });

  const resolutions: Map<string, LiturgicalResolution> = resolutionMap ?? new Map();

  // ── Data selecionada ──────────────────────────────────────────────────────
  const selectedDateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const selectedResolution = selectedDateStr ? (resolutions.get(selectedDateStr) ?? null) : null;

  const handleSelectDate = useCallback((date: Date) => {
    setSelectedDate(date);
    setModalOpen(true);
  }, []);

  // ── Tempo litúrgico atual ─────────────────────────────────────────────────
  const currentSeason = useMemo(
    () => getLiturgicalSeason(month, year),
    [month, year]
  );

  // ── Datas-chave do ano ────────────────────────────────────────────────────
  const easter = useMemo(() => easterDate(year), [year]);
  const keyDates = useMemo(() => [
    { label: "Cinzas", date: new Date(easter.getTime() - 46 * 86400000) },
    { label: "Páscoa", date: easter },
    { label: "Pentecostes", date: new Date(easter.getTime() + 49 * 86400000) },
    { label: "Corpus Christi", date: new Date(easter.getTime() + 60 * 86400000) },
  ], [easter]);

  // ── Celebrações do mês em lista ───────────────────────────────────────────
  const today = new Date();
  const monthCelebrations = useMemo(() => {
    const result: { date: Date; resolution: LiturgicalResolution }[] = [];
    for (const [dateStr, res] of resolutions) {
      if (res.celebration.grau !== "comemoracao") {
        result.push({ date: new Date(dateStr + "T12:00:00"), resolution: res });
      }
    }
    return result.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [resolutions]);

  const monthName = format(month, "MMMM", { locale: ptBR });
  const totalCelebrations = monthCelebrations.length;
  const upcomingCelebrations = useMemo(
    () => monthCelebrations.filter((item) => item.date >= today).slice(0, 3),
    [monthCelebrations, today]
  );
  const todayResolution = useMemo(
    () => resolutions.get(format(today, "yyyy-MM-dd")) ?? null,
    [resolutions, today]
  );
  const displayDate = selectedDate ?? today;
  const displayResolution = selectedResolution ?? todayResolution;

  // ── Solenidades do mês (para destaque) ───────────────────────────────────
  const solenidades = useMemo(
    () => monthCelebrations.filter(
      (c) => (RANK_WEIGHT[c.resolution.celebration.grau] ?? 0) >= RANK_WEIGHT["solenidade"]
    ),
    [monthCelebrations]
  );

  return (
    <>
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto pb-24 lg:pb-10">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Calendário</p>
          <h1 className="mt-1 font-serif text-2xl sm:text-3xl lg:text-4xl">
            Calendário Litúrgico {year}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SeasonBadge season={currentSeason} />
            <span className="text-xs text-muted-foreground">Rito Romano</span>
          </div>
        </div>

        {/* Datas-chave */}
        <div className="flex flex-wrap gap-2">
          {keyDates.map((k) => (
            <button
              key={k.label}
              onClick={() => {
                if (k.date.getFullYear() === year || k.date.getMonth() + 1 !== monthNum) {
                  setMonth(k.date);
                }
                handleSelectDate(k.date);
              }}
              className="text-xs bg-muted hover:bg-muted/80 rounded-full px-3 py-1 flex items-center gap-1 transition"
            >
              <span className="font-medium">{k.label}</span>
              <span className="text-muted-foreground">{format(k.date, "d/MM")}</span>
            </button>
          ))}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} title="Atualizar">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Tempo litúrgico</p>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-3xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">{SEASON_LABEL[currentSeason]}</p>
              <p className="mt-1 text-xs text-muted-foreground capitalize">{currentSeason}</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Celebrações no mês</p>
          <div className="mt-4 flex items-end gap-4">
            <p className="text-3xl font-semibold">{totalCelebrations}</p>
            <span className="text-xs text-muted-foreground capitalize">{monthName}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Solenidades, festas e memoriais com destaque litúrgico.</p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Próxima data-chave</p>
              <p className="mt-3 text-sm font-semibold">{format(keyDates[0].date, "d 'de' MMMM", { locale: ptBR })}</p>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-3xl bg-secondary/10 text-secondary">
              <Clock3 className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{keyDates[0].label} permanece uma referência para o ano litúrgico.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        {/* ── Calendário principal ── */}
        <div>
          {/* Navegação de mês */}
          <div className="flex items-center justify-between mb-3">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(subMonths(month, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center">
              <h2 className="font-serif text-lg sm:text-xl capitalize">
                {format(month, "MMMM yyyy", { locale: ptBR })}
              </h2>
              <p className={cn("text-[10px] mt-0.5 font-medium", SEASON_COLOR_CLASS[currentSeason], "px-2 py-0.5 rounded-full inline-block")}>
                {SEASON_LABEL[currentSeason]}
              </p>
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-[420px] sm:h-[520px] w-full rounded-2xl" />
          ) : (
            <LiturgicalCalendarGrid
              month={month}
              resolutions={resolutions}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
            />
          )}

          {/* Legenda */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(["solenidade", "festa", "memorial"] as const).map((r) => (
              <span key={r} className="flex items-center gap-1.5 text-muted-foreground capitalize">
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  r === "solenidade" ? "bg-amber-500" : r === "festa" ? "bg-blue-500" : "bg-slate-400"
                )} />
                {r}
              </span>
            ))}
          </div>
        </div>

        {/* ── Painel lateral ── */}
        <aside className="space-y-4">
          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Visão do dia</p>
                <h3 className="mt-2 text-lg font-semibold">{format(displayDate, "d 'de' MMMM", { locale: ptBR })}</h3>
                <p className="mt-1 text-xs text-muted-foreground">Selecione um dia no calendário para ver detalhes.</p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMonth(today);
                    handleSelectDate(today);
                  }}
                >
                  Hoje
                </Button>
                <Link
                  to="/espiritualidade"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-semibold"
                >
                  <ExternalLink className="h-3 w-3" />
                  Leituras do dia
                </Link>
              </div>
            </div>
            <div className="mt-5">
              {displayResolution ? (
                <LiturgicalCelebrationCard
                  date={displayDate}
                  resolution={displayResolution}
                  horizontal
                  className="shadow-sm"
                />
              ) : (
                <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
                  Nenhuma celebração especial encontrada para este dia.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Star className="h-4 w-4 text-amber-500" />
              <span>Próximas celebrações</span>
            </div>
            <div className="mt-4 space-y-3">
              {upcomingCelebrations.length > 0 ? (
                upcomingCelebrations.map(({ date, resolution }) => (
                  <LiturgicalCelebrationCard
                    key={format(date, "yyyy-MM-dd")}
                    date={date}
                    resolution={resolution}
                    horizontal
                    onClick={() => handleSelectDate(date)}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Sem celebrações adicionais para os próximos dias.</p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-gold" />
              <span>Datas-chave</span>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {keyDates.map((k) => (
                <button
                  key={k.label}
                  onClick={() => {
                    if (k.date.getFullYear() === year || k.date.getMonth() + 1 !== monthNum) {
                      setMonth(k.date);
                    }
                    handleSelectDate(k.date);
                  }}
                  className="w-full text-left rounded-2xl border border-border p-3 transition hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{k.label}</span>
                    <span className="text-xs text-muted-foreground">{format(k.date, "d/MM")}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Clique para navegar direto ao dia.</p>
                </button>
              ))}
            </div>
          </div>
        </aside>
          {solenidades.length > 0 && (
            <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
              <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
                <span className="text-amber-500">★</span>
                Solenidades em {format(month, "MMMM", { locale: ptBR })}
              </h3>
              <div className="space-y-2">
                {solenidades.map(({ date, resolution }) => (
                  <LiturgicalCelebrationCard
                    key={format(date, "yyyy-MM-dd")}
                    date={date}
                    resolution={resolution}
                    horizontal
                    onClick={() => handleSelectDate(date)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Lista completa do mês */}
          <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
            <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-gold" />
              Celebrações de {format(month, "MMMM", { locale: ptBR })}
              <span className="ml-auto text-xs text-muted-foreground">{monthCelebrations.length}</span>
            </h3>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : monthCelebrations.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Sem celebrações especiais.</p>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                {monthCelebrations.map(({ date, resolution }) => (
                  <button
                    key={format(date, "yyyy-MM-dd")}
                    className="w-full text-left flex items-start gap-3 hover:bg-muted/30 rounded-lg p-2 transition"
                    onClick={() => handleSelectDate(date)}
                  >
                    <span className="text-xs font-mono font-semibold text-muted-foreground mt-0.5 shrink-0 w-8">
                      {format(date, "d/MM")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-snug truncate">
                        {resolution.celebration.titulo}
                      </p>
                      <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
                        {resolution.celebration.grau}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de dia selecionado */}
      <LiturgicalDayModal
        date={selectedDate}
        resolution={selectedResolution}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
