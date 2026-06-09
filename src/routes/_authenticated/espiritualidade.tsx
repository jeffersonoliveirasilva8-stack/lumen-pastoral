import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BookOpen, Music, Play, RefreshCw,
  Loader2, AlertCircle, ChevronDown, ChevronUp, CalendarDays, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useLiturgiaHoje, useLiturgiaProximos, refLeitura1, refSalmo, refLeitura2, refEvangelho } from "@/hooks/use-liturgia";
import { useHomiliaRecente } from "@/hooks/use-homilia";
import type { LiturgiaRow } from "@/hooks/use-liturgia";

export const Route = createFileRoute("/_authenticated/espiritualidade")({
  component: EspiritualidadePage,
  head: () => ({ meta: [{ title: "Liturgia e Homilia — Painel Pastoral" }] }),
});

// ── Constantes ────────────────────────────────────────────────────────────────

const COR_HEX: Record<string, string> = {
  verde: "#16a34a", roxo: "#9333ea", branco: "#d1d5db",
  vermelho: "#dc2626", rosa: "#ec4899", preto: "#374151", dourado: "#f59e0b",
};
const TEMPO_LABEL: Record<string, string> = {
  advento: "Advento", natal: "Natal", quaresma: "Quaresma",
  triduo: "Tríduo Pascal", pascoa: "Tempo Pascal", comum: "Tempo Comum",
};
const TEMPO_CLS: Record<string, string> = {
  advento:  "bg-purple-100 text-purple-800 border-purple-200",
  natal:    "bg-amber-100  text-amber-800  border-amber-200",
  quaresma: "bg-violet-100 text-violet-800 border-violet-200",
  triduo:   "bg-red-100    text-red-800    border-red-200",
  pascoa:   "bg-yellow-100 text-yellow-900 border-yellow-200",
  comum:    "bg-green-100  text-green-800  border-green-200",
};
const GRAU_LABEL: Record<string, string> = {
  solenidade: "Solenidade", festa: "Festa", memorial: "Memorial",
  memorial_facultativo: "Mem. Facultativo", comemoracao: "Comemoração",
};

// ── Bloco de leitura expansível ───────────────────────────────────────────────

function BlocoLeitura({
  icone: Icone, label, referencia, texto, hex, abertoPadrao = false,
}: {
  icone: React.ElementType;
  label: string;
  referencia: string | null;
  texto: string | null;
  hex: string;
  abertoPadrao?: boolean;
}) {
  const [aberto, setAberto] = useState(abertoPadrao);
  const paragrafos = texto
    ? texto.split(/\n{2,}|\r\n\r\n/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean)
    : [];

  if (!referencia) return null;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={abertoPadrao ? { borderColor: hex + "40", backgroundColor: hex + "06" } : undefined}
    >
      <button
        type="button"
        onClick={() => paragrafos.length > 0 && setAberto((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition ${
          paragrafos.length > 0 ? "hover:bg-black/5 cursor-pointer" : "cursor-default"
        }`}
      >
        <div
          className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: hex + "20", color: hex }}
        >
          <Icone className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">{label}</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: abertoPadrao ? hex : undefined }}>
            {referencia}
          </p>
        </div>
        {paragrafos.length > 0 && (
          <span className="text-muted-foreground shrink-0">
            {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        )}
      </button>
      {aberto && paragrafos.length > 0 && (
        <div className="px-4 pb-5 border-t border-current/10 space-y-3">
          <div className="h-3" />
          {paragrafos.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-foreground/90">{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card compacto: próximo dia ────────────────────────────────────────────────

function ProximoDiaCard({ row }: { row: LiturgiaRow }) {
  const cor  = row.cor ?? "verde";
  const hex  = COR_HEX[cor] ?? COR_HEX.verde;
  const ev   = refEvangelho(row);
  const d    = new Date(row.data + "T12:00:00");
  return (
    <div className="rounded-[1.5rem] border border-border bg-card overflow-hidden">
      <div className="h-1 w-full" style={{ backgroundColor: hex }} />
      <div className="p-4 space-y-1.5">
        <p className="text-[10px] text-muted-foreground capitalize font-medium">
          {format(d, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </p>
        <p className="font-serif text-sm leading-snug text-foreground line-clamp-2">{row.titulo}</p>
        {ev && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <BookOpen className="h-3 w-3 shrink-0" style={{ color: hex }} />
            <span className="font-medium" style={{ color: hex }}>Ev</span> {ev}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

function EspiritualidadePage() {
  const { data: liturgia, isLoading: loadingL, isError } = useLiturgiaHoje();
  const { data: proximos = [] }                           = useLiturgiaProximos(3);
  const { data: homilia,  isLoading: loadingH }           = useHomiliaRecente();
  const [playerAberto, setPlayerAberto]                   = useState(false);
  const hoje = format(new Date(), "yyyy-MM-dd");
  const homiliaEHoje = homilia?.data === hoje;

  const qc = useQueryClient();
  const sincronizarMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("homilia-diaria");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homilia-recente"] });
      qc.invalidateQueries({ queryKey: ["homilia-hoje"] });
      toast.success("Homilia sincronizada com sucesso.");
    },
    onError: (e: Error) => toast.error("Erro ao sincronizar: " + e.message),
  });

  const cor  = liturgia?.cor ?? "verde";
  const hex  = COR_HEX[cor] ?? COR_HEX.verde;
  const tempo = liturgia?.tempo_liturgico ?? "comum";

  const proximosDias = proximos.filter((l) => l.data !== format(new Date(), "yyyy-MM-dd"));

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6 pb-24">

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Espiritualidade</p>
          <h1 className="mt-2 font-serif text-2xl sm:text-4xl text-foreground">
            Liturgia e Homilia do Dia
          </h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
      </div>

      {isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4 flex items-center gap-3 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Não foi possível carregar a liturgia do dia.</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">

        {/* ── Coluna principal: leituras ── */}
        <div className="space-y-5">

          {loadingL ? (
            <div className="rounded-[2rem] border border-border bg-card p-6 space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <div className="flex gap-2"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div>
              {[1,2,3,4].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
            </div>
          ) : liturgia ? (
            <div
              className="rounded-[2rem] border overflow-hidden shadow-altar"
              style={{ borderTopColor: hex, borderTopWidth: 4 }}
            >
              <div className="p-6 space-y-5 bg-card">
                {/* Identidade */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-serif text-2xl sm:text-3xl leading-snug text-foreground">
                      {liturgia.titulo}
                    </h2>
                    {liturgia.subtitulo && (
                      <p className="text-sm text-muted-foreground mt-0.5">{liturgia.subtitulo}</p>
                    )}
                    {liturgia.santo && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{liturgia.santo}</p>
                    )}
                  </div>
                  <div
                    className="h-7 w-7 rounded-full border-2 border-white shadow shrink-0 mt-1"
                    style={{ backgroundColor: hex }}
                  />
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  {tempo && (
                    <span className={`text-xs px-3 py-1 rounded-full border font-medium ${TEMPO_CLS[tempo] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {TEMPO_LABEL[tempo] ?? tempo}
                    </span>
                  )}
                  {liturgia.grau && GRAU_LABEL[liturgia.grau] && (
                    <span className="text-xs px-3 py-1 rounded-full border bg-muted text-muted-foreground border-border font-medium">
                      {GRAU_LABEL[liturgia.grau]}
                    </span>
                  )}
                  {liturgia.e_dia_preceito && (
                    <span className="text-xs px-3 py-1 rounded-full border bg-red-100 text-red-800 border-red-200 font-medium">
                      Dia de Preceito
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border bg-muted/60 text-muted-foreground border-border/60 font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex }} />
                    Cor {liturgia.cor ? liturgia.cor.charAt(0).toUpperCase() + liturgia.cor.slice(1) : "—"}
                  </span>
                </div>

                {/* Leituras */}
                <div className="space-y-2 pt-4 border-t border-border">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold flex items-center gap-1.5">
                    <BookOpen className="h-3 w-3" /> Leituras do Dia
                  </p>
                  <BlocoLeitura icone={BookOpen} label="Primeira Leitura"  referencia={refLeitura1(liturgia)}  texto={liturgia.leitura_1_texto}  hex={hex} />
                  <BlocoLeitura icone={Music}    label="Salmo Responsorial" referencia={refSalmo(liturgia)}     texto={liturgia.salmo_texto}      hex={hex} />
                  {refLeitura2(liturgia) && (
                    <BlocoLeitura icone={BookOpen} label="Segunda Leitura" referencia={refLeitura2(liturgia)} texto={liturgia.leitura_2_texto} hex={hex} />
                  )}
                  <BlocoLeitura icone={BookOpen} label="Evangelho"         referencia={refEvangelho(liturgia)} texto={liturgia.evangelho_texto}  hex={hex} abertoPadrao />
                </div>
              </div>
            </div>
          ) : (
            !isError && (
              <div className="rounded-[2rem] border border-dashed border-border bg-card p-10 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Liturgia de hoje ainda não sincronizada.</p>
              </div>
            )
          )}
        </div>

        {/* ── Coluna lateral: homilia + próximos dias ── */}
        <div className="space-y-4">

          {/* Homilia */}
          <div className="rounded-[1.75rem] border border-border bg-card overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Play className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground font-semibold flex-1">
                  {homiliaEHoje ? "Homilia do Dia" : "Homilia Recente"}
                </p>
                {homilia && !homiliaEHoje && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    {format(new Date(homilia.data + "T12:00:00"), "d/MM", { locale: ptBR })}
                  </span>
                )}
                <button
                  onClick={() => sincronizarMutation.mutate()}
                  disabled={sincronizarMutation.isPending}
                  title="Sincronizar homilia do dia"
                  className="ml-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  {sincronizarMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />
                  }
                </button>
              </div>

              {loadingH ? (
                <div className="space-y-3">
                  <Skeleton className="aspect-video w-full rounded-xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : homilia ? (
                <>
                  {/* Player inline — thumbnail → clique → iframe */}
                  <div className="rounded-xl overflow-hidden mb-3 bg-black relative aspect-video">
                    {playerAberto ? (
                      <iframe
                        src={`https://www.youtube.com/embed/${homilia.video_id}?autoplay=1&rel=0&modestbranding=1`}
                        title={homilia.titulo}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="absolute inset-0 w-full h-full"
                        loading="lazy"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPlayerAberto(true)}
                        className="absolute inset-0 w-full h-full group"
                      >
                        {homilia.thumbnail_url && (
                          <img src={homilia.thumbnail_url} alt={homilia.titulo} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/40 transition">
                          <div className="h-12 w-12 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                            <Play className="h-5 w-5 text-white ml-0.5" />
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-semibold leading-snug line-clamp-3 text-foreground">
                    {homilia.titulo}
                  </p>
                  {homilia.autor && (
                    <p className="text-xs text-muted-foreground mt-1">{homilia.autor}</p>
                  )}
                  {homilia.descricao && (
                    <p className="text-xs text-muted-foreground/80 mt-2 line-clamp-3 leading-relaxed">
                      {homilia.descricao}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic py-2 text-center">
                  Homilia ainda não disponível para hoje.
                </p>
              )}
            </div>
          </div>

          {/* Próximos dias */}
          {proximosDias.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground font-semibold px-1">
                Próximos Dias
              </p>
              {proximosDias.map((row) => (
                <ProximoDiaCard key={row.data} row={row} />
              ))}
            </div>
          )}

          {/* Calendário Litúrgico */}
          <Link
            to="/calendario"
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-sm font-semibold text-foreground transition hover:bg-muted/60 hover:border-primary/30 group"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarDays className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Calendário Litúrgico</p>
                <p className="text-[11px] text-muted-foreground font-normal mt-0.5">Solenidades, festas e memoriais</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          </Link>
        </div>
      </div>
    </div>
  );
}
