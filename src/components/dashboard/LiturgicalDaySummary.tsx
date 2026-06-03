import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Star, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LiturgicalDay, LiturgicalSeason, LiturgicalColor } from "@/biblioteca/liturgical-calendar";
import { Link } from "@tanstack/react-router";

const VESTMENT_HEX: Record<LiturgicalColor, string> = {
  branco:   "#d1d5db",
  roxo:     "#9333ea",
  vermelho: "#dc2626",
  verde:    "#16a34a",
  preto:    "#374151",
  dourado:  "#f59e0b",
  rosa:     "#ec4899",
};

const VESTMENT_BG: Record<LiturgicalColor, string> = {
  branco:   "rgba(243,244,246,0.4)",
  roxo:     "rgba(147,51,234,0.05)",
  vermelho: "rgba(220,38,38,0.05)",
  verde:    "rgba(22,163,74,0.05)",
  preto:    "rgba(55,65,81,0.05)",
  dourado:  "rgba(245,158,11,0.07)",
  rosa:     "rgba(236,72,153,0.05)",
};

const VESTMENT_LABEL: Record<LiturgicalColor, string> = {
  branco: "Branco", roxo: "Roxo", vermelho: "Vermelho",
  verde: "Verde", preto: "Preto", dourado: "Dourado", rosa: "Rosa",
};

const SEASON_LABEL: Record<LiturgicalSeason, string> = {
  advento: "Advento", natal: "Natal", comum: "Tempo Comum",
  quaresma: "Quaresma", triduo: "Tríduo", pascoa: "Páscoa",
};

const RANK_LABEL: Record<string, string> = {
  solenidade: "Solenidade",
  festa: "Festa",
  memorial: "Memorial",
  comemoracao: "Comemoração",
};

interface LiturgicalDaySummaryProps {
  today: Date;
  celebrations: LiturgicalDay[];
  season: LiturgicalSeason;
  color: LiturgicalColor;
}

export function LiturgicalDaySummary({
  today,
  celebrations,
  season,
  color,
}: LiturgicalDaySummaryProps) {
  const primary = celebrations[0];
  const secondary = celebrations.slice(1);
  const colorHex = VESTMENT_HEX[color];
  const colorBg  = VESTMENT_BG[color];

  return (
    <section
      className="rounded-[2rem] border border-border bg-card shadow-altar overflow-hidden"
      style={{ borderLeft: `4px solid ${colorHex}` }}
    >
      <div className="p-6 sm:p-8" style={{ background: colorBg }}>

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Liturgia do Dia
            </p>
            <h2 className="mt-2 text-2xl font-serif text-foreground capitalize">
              {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </h2>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card/80 px-3 py-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: colorHex }}
            />
            <span className="text-xs text-muted-foreground">
              {VESTMENT_LABEL[color]} · {SEASON_LABEL[season]}
            </span>
          </div>
        </div>

        <div className="mt-4 h-px bg-border/60" />

        {/* Primary celebration */}
        <div className="mt-4">
          {primary ? (
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      {RANK_LABEL[primary.rank] ?? primary.rank}
                    </span>
                    {primary.rank === "solenidade" && (
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                    )}
                    {primary.obligation && (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        Obrigatória
                      </Badge>
                    )}
                  </div>
                  <p className="text-lg font-semibold leading-snug text-foreground">
                    {primary.name}
                  </p>
                </div>
                {/* Liturgical color swatch */}
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white text-xs font-bold"
                  style={{ background: colorHex }}
                >
                  {primary.rank === "solenidade" ? "★★★" :
                   primary.rank === "festa"      ? "★★" :
                   primary.rank === "memorial"   ? "★" : "◦"}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-border bg-card p-5 text-center">
              <p className="text-sm text-muted-foreground">
                Feria — sem celebração especial registrada.
              </p>
            </div>
          )}
        </div>

        {/* Secondary celebrations */}
        {secondary.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Também hoje
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {secondary.slice(0, 4).map((item) => (
                <div
                  key={item.name}
                  className="rounded-2xl border border-border bg-card px-4 py-2.5"
                >
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-[11px] capitalize text-muted-foreground">
                    {RANK_LABEL[item.rank] ?? item.rank}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.15em]">
              {VESTMENT_LABEL[color]}
            </Badge>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.15em]">
              {SEASON_LABEL[season]}
            </Badge>
            {primary?.rank && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-[0.15em]">
                {RANK_LABEL[primary.rank]}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/calendario" className="flex items-center gap-1.5 text-xs">
              <BookOpen className="h-3.5 w-3.5" />
              Calendário completo
            </Link>
          </Button>
        </div>

      </div>
    </section>
  );
}
