import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLiturgicalDays } from "@/lib/liturgical-calendar";
import type { LiturgicalDay } from "@/biblioteca/liturgical-calendar";

export const Route = createFileRoute("/portal-membro/calendario")({
  component: PortalMembroCalendario,
  head: () => ({ meta: [{ title: "Calendário Litúrgico — Portal do Servidor" }] }),
});

const COLOR_HEX: Record<string, string> = {
  branco: "#d1d5db", roxo: "#9333ea", vermelho: "#dc2626",
  verde: "#16a34a", preto: "#374151", dourado: "#f59e0b", rosa: "#ec4899",
};
const COLOR_LABEL: Record<string, string> = {
  branco: "Branco", roxo: "Roxo", vermelho: "Vermelho",
  verde: "Verde", preto: "Preto", dourado: "Dourado", rosa: "Rosa",
};
const SEASON_LABEL: Record<string, string> = {
  advento: "Advento", natal: "Natal", comum: "Tempo Comum",
  quaresma: "Quaresma", triduo: "Tríduo", pascoa: "Páscoa",
};
const RANK_LABEL: Record<string, string> = {
  solenidade: "Solenidade", festa: "Festa", memorial: "Memorial", comemoracao: "Comemoração",
};
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function PortalMembroCalendario() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selected, setSelected] = useState<LiturgicalDay | null>(null);
  const year = currentMonth.getFullYear();

  const liturgicalDays = useMemo(() => getLiturgicalDays(year), [year]);
  const liturgyMap = useMemo(() => {
    const map: Record<string, LiturgicalDay> = {};
    liturgicalDays.forEach((d) => {
      map[format(d.date, "yyyy-MM-dd")] = d;
    });
    return map;
  }, [liturgicalDays]);

  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const startWeekday = getDay(startOfMonth(currentMonth));

  // Celebrações do mês para lista lateral
  const celebrations = useMemo(() => {
    return days
      .map((d) => ({ day: d, liturgy: liturgyMap[format(d, "yyyy-MM-dd")] }))
      .filter((x) => x.liturgy && (x.liturgy.rank === "solenidade" || x.liturgy.rank === "festa"))
      .map((x) => x);
  }, [days, liturgyMap]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 pb-24">
      <div>
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
        <h1 className="mt-1.5 font-serif text-3xl">Calendário Litúrgico</h1>
        <p className="mt-1 text-sm text-muted-foreground">Celebrações e tempo litúrgico do ano.</p>
      </div>

      {/* Navegação do mês */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          className="p-2 rounded-lg border border-border hover:bg-muted transition"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="font-serif text-lg capitalize">
          {format(currentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
        </h2>
        <button
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className="p-2 rounded-lg border border-border hover:bg-muted transition"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Grid do calendário */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Cabeçalho dos dias da semana */}
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="py-2 text-center text-[10px] font-semibold uppercase text-muted-foreground">
              {wd}
            </div>
          ))}
        </div>

        {/* Células dos dias */}
        <div className="grid grid-cols-7">
          {/* Células em branco antes do primeiro dia */}
          {Array.from({ length: startWeekday }).map((_, i) => (
            <div key={`empty-${i}`} className="border-b border-r border-border/40 aspect-square sm:aspect-auto sm:min-h-[72px]" />
          ))}

          {days.map((day, idx) => {
            const key = format(day, "yyyy-MM-dd");
            const liturgy = liturgyMap[key];
            const isSelected = selected && format(selected.date, "yyyy-MM-dd") === key;
            const today = isToday(day);
            const col = (startWeekday + idx) % 7;
            const isLastCol = col === 6;
            const isLastRow = startWeekday + idx >= days.length + startWeekday - 7;

            return (
              <button
                key={key}
                onClick={() => setSelected(liturgy ?? null)}
                className={`relative flex flex-col items-start p-1.5 sm:p-2 aspect-square sm:aspect-auto sm:min-h-[72px] border-b border-border/40 transition ${
                  isLastCol ? "" : "border-r border-border/40"
                } ${isLastRow ? "border-b-0" : ""} ${
                  isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-muted/40"
                }`}
              >
                {/* Número do dia */}
                <span
                  className={`text-xs font-medium h-5 w-5 rounded-full flex items-center justify-center ${
                    today
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground"
                  }`}
                >
                  {format(day, "d")}
                </span>

                {/* Indicador litúrgico */}
                {liturgy && (
                  <div className="mt-1 flex items-center gap-1 min-w-0 w-full">
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: COLOR_HEX[liturgy.color] ?? "#6B7280" }}
                    />
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground truncate leading-tight hidden sm:block">
                      {liturgy.name.split(" ").slice(0, 3).join(" ")}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detalhe do dia selecionado */}
      {selected && (
        <div
          className="rounded-2xl border bg-card p-4 space-y-2 shadow-altar"
          style={{ borderLeftWidth: "4px", borderLeftColor: COLOR_HEX[selected.color] ?? "#6B7280" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: COLOR_HEX[selected.color] }}
            />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {COLOR_LABEL[selected.color]} · {SEASON_LABEL[(selected.season as string) ?? "comum"]}
            </p>
          </div>
          <p className="font-serif text-xl">{selected.name}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50">
              {RANK_LABEL[selected.rank] ?? selected.rank}
            </span>
            {selected.obligation && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700">
                Obrigatória
              </span>
            )}
            {selected.saint && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700">
                Santo(a)
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {format(selected.date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
      )}

      {/* Solenidades e festas do mês */}
      {celebrations.length > 0 && (
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Solenidades e Festas do mês
          </p>
          <div className="space-y-2">
            {celebrations.map(({ day, liturgy }) => (
              <button
                key={format(day, "yyyy-MM-dd")}
                onClick={() => setSelected(liturgy)}
                className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted/40 transition text-left"
              >
                <div
                  className="h-9 w-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
                  style={{ backgroundColor: COLOR_HEX[liturgy.color] ?? "#6B7280" }}
                >
                  {format(day, "d")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{liturgy.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {RANK_LABEL[liturgy.rank]} · {format(day, "EEEE", { locale: ptBR })}
                  </p>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                  style={{ backgroundColor: COLOR_HEX[liturgy.color] + "25", color: COLOR_HEX[liturgy.color] }}
                >
                  {COLOR_LABEL[liturgy.color]}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
