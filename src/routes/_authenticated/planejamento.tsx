import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Calendar, ChevronLeft, ChevronRight, CalendarRange, Church,
  GraduationCap, Loader2, MapPin, Clock,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths, parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/planejamento")({
  component: PlanejamentoPastoralPage,
  head: () => ({ meta: [{ title: "Planejamento Pastoral — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type EventoCalendario = {
  id: string;
  titulo: string;
  data: string;
  hora: string | null;
  local: string | null;
  tipo: "escala" | "formacao";
  subtipo?: string;
  cor: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPO_COR: Record<string, string> = {
  formacao:    "#3b82f6",
  reuniao:     "#6366f1",
  retiro:      "#8b5cf6",
  evento:      "#f97316",
  ensaio:      "#22c55e",
  encontro:    "#06b6d4",
  compromisso: "#f43f5e",
  adoracao:    "#eab308",
  outro:       "#6B7280",
  escala:      "#ec4899",
};

const TIPO_LABEL: Record<string, string> = {
  formacao: "Formação", reuniao: "Reunião", retiro: "Retiro",
  evento: "Evento", ensaio: "Ensaio", encontro: "Encontro",
  compromisso: "Compromisso Pastoral", adoracao: "Adoração",
  outro: "Outro", escala: "Escala",
};

// ── Main Component ─────────────────────────────────────────────────────────────

function PlanejamentoPastoralPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selected, setSelected] = useState<EventoCalendario | null>(null);
  const [view, setView] = useState<"mes" | "lista">("mes");

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  const { data: escalas = [], isLoading: loadEscalas } = useQuery({
    queryKey: ["plan-escalas", pid, format(monthStart, "yyyy-MM")],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await supabase
        .from("escalas")
        .select("id,titulo,data,hora_inicio,local,solene")
        .eq("paroquia_id", pid!)
        .gte("data", format(monthStart, "yyyy-MM-dd"))
        .lte("data", format(monthEnd, "yyyy-MM-dd"))
        .neq("status", "arquivada")
        .order("data").order("hora_inicio");
      return (data ?? []) as { id: string; titulo: string; data: string; hora_inicio: string | null; local: string | null; solene: boolean }[];
    },
  });

  const { data: formacoes = [], isLoading: loadFormacoes } = useQuery({
    queryKey: ["plan-formacoes", pid, format(monthStart, "yyyy-MM")],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await anyDb
        .from("formacoes_eventos")
        .select("id,titulo,data_inicio,local,tipo")
        .eq("paroquia_id", pid)
        .eq("ativo", true)
        .gte("data_inicio", monthStart.toISOString())
        .lte("data_inicio", monthEnd.toISOString())
        .order("data_inicio");
      return (data ?? []) as { id: string; titulo: string; data_inicio: string; local: string | null; tipo: string }[];
    },
  });

  const eventos: EventoCalendario[] = useMemo(() => [
    ...escalas.map((e) => ({
      id: e.id,
      titulo: e.titulo,
      data: e.data,
      hora: e.hora_inicio,
      local: e.local,
      tipo: "escala" as const,
      cor: e.solene ? "#f59e0b" : TIPO_COR.escala,
    })),
    ...formacoes.map((f) => ({
      id: f.id,
      titulo: f.titulo,
      data: f.data_inicio.slice(0, 10),
      hora: f.data_inicio.slice(11, 16),
      local: f.local,
      tipo: "formacao" as const,
      subtipo: f.tipo,
      cor: TIPO_COR[f.tipo] ?? TIPO_COR.outro,
    })),
  ], [escalas, formacoes]);

  const isLoading = loadEscalas || loadFormacoes;

  const eventosByDate = useMemo(() => {
    const map = new Map<string, EventoCalendario[]>();
    for (const e of eventos) {
      const key = e.data.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [eventos]);

  // Weeks for calendar grid
  const calendarDays = useMemo(() => {
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [monthStart, monthEnd]);

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-6 pb-24 lg:pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Gestão Pastoral</p>
          <h1 className="page-header-title">Planejamento Pastoral</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visão consolidada de missas, formações, retiros e eventos.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant={view === "mes" ? "default" : "outline"}
            onClick={() => setView("mes")}
          >
            <CalendarRange className="h-4 w-4 mr-1" /> Mês
          </Button>
          <Button
            size="sm"
            variant={view === "lista" ? "default" : "outline"}
            onClick={() => setView("lista")}
          >
            <Calendar className="h-4 w-4 mr-1" /> Lista
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-serif text-xl capitalize flex-1 text-center">
          {format(currentDate, "MMMM yyyy", { locale: ptBR })}
        </h2>
        <Button variant="outline" size="icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-pink-500" /> Missa
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Missa Solene
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Formação
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> Retiro
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Ensaio
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Evento
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === "mes" ? (
        <CalendarioMes
          calendarDays={calendarDays}
          currentDate={currentDate}
          eventosByDate={eventosByDate}
          onSelect={setSelected}
        />
      ) : (
        <ListaMensal eventos={eventos} onSelect={setSelected} />
      )}

      {/* Detalhe do evento */}
      {selected && (
        <Sheet open onOpenChange={(o) => !o && setSelected(null)}>
          <SheetContent className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="font-serif">{selected.titulo}</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl grid place-items-center shrink-0"
                  style={{ backgroundColor: selected.cor + "20" }}>
                  {selected.tipo === "escala"
                    ? <Church className="h-5 w-5" style={{ color: selected.cor }} />
                    : <GraduationCap className="h-5 w-5" style={{ color: selected.cor }} />
                  }
                </div>
                <div>
                  <Badge
                    className="text-xs border"
                    style={{ backgroundColor: selected.cor + "20", color: selected.cor, borderColor: selected.cor + "40" }}
                  >
                    {selected.tipo === "escala" ? "Missa / Escala" : TIPO_LABEL[selected.subtipo ?? "outro"]}
                  </Badge>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {format(parseISO(selected.data + "T00:00:00"), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                </div>
              </div>
              {selected.hora && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {selected.hora.slice(0, 5)}
                </div>
              )}
              {selected.local && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {selected.local}
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

// ── CalendarioMes ─────────────────────────────────────────────────────────────

function CalendarioMes({
  calendarDays, currentDate, eventosByDate, onSelect,
}: {
  calendarDays: Date[];
  currentDate: Date;
  eventosByDate: Map<string, EventoCalendario[]>;
  onSelect: (e: EventoCalendario) => void;
}) {
  const today = new Date();
  const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header dos dias */}
      <div className="grid grid-cols-7 border-b border-border">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventosByDate.get(key) ?? [];
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isToday = isSameDay(day, today);

          return (
            <div
              key={i}
              className={`min-h-[80px] lg:min-h-[100px] p-1.5 border-r border-b border-border/50 ${
                !isCurrentMonth ? "bg-muted/20" : ""
              } ${i % 7 === 6 ? "border-r-0" : ""}`}
            >
              <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                isToday
                  ? "bg-primary text-primary-foreground"
                  : isCurrentMonth
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}>
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect(e)}
                    className="w-full text-left text-[10px] leading-tight rounded px-1 py-0.5 truncate font-medium transition hover:opacity-80"
                    style={{ backgroundColor: e.cor + "20", color: e.cor }}
                  >
                    {e.hora ? e.hora.slice(0, 5) + " " : ""}{e.titulo}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[9px] text-muted-foreground pl-1">+{dayEvents.length - 3} mais</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ListaMensal ───────────────────────────────────────────────────────────────

function ListaMensal({
  eventos, onSelect,
}: {
  eventos: EventoCalendario[];
  onSelect: (e: EventoCalendario) => void;
}) {
  if (eventos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-16 text-center">
        <CalendarRange className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum evento neste mês.</p>
      </div>
    );
  }

  const sorted = [...eventos].sort((a, b) => {
    const da = a.data + (a.hora ?? "00:00");
    const db = b.data + (b.hora ?? "00:00");
    return da.localeCompare(db);
  });

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
      {sorted.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onSelect(e)}
          className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition text-left"
        >
          <div className="shrink-0 w-12 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase">
              {format(parseISO(e.data + "T00:00:00"), "MMM", { locale: ptBR })}
            </p>
            <p className="text-xl font-serif leading-none">
              {format(parseISO(e.data + "T00:00:00"), "d")}
            </p>
          </div>
          <div
            className="h-8 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: e.cor }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{e.titulo}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              {e.hora && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />{e.hora.slice(0, 5)}
                </span>
              )}
              {e.local && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3" />{e.local}
                </span>
              )}
            </div>
          </div>
          <Badge
            className="text-xs shrink-0 border"
            style={{
              backgroundColor: e.cor + "15",
              color: e.cor,
              borderColor: e.cor + "40",
            }}
          >
            {e.tipo === "escala" ? "Missa" : TIPO_LABEL[e.subtipo ?? "outro"]}
          </Badge>
        </button>
      ))}
    </div>
  );
}
