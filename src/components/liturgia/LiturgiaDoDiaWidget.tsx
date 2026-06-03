/**
 * LiturgiaDoDiaWidget
 * Componente universal de Liturgia + Homilia do Dia.
 * Usado em todos os painéis: admin, portal membro, sacristia.
 *
 * Props:
 *   linkTo        — rota de destino ao clicar em "Ver completo"
 *   compact       — exibe versão reduzida (sem evangelho longo)
 *   showHomilia   — exibe card da homilia (padrão: true)
 */

import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BookOpen, Play, ExternalLink, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiturgiaHoje, refEvangelho } from "@/hooks/use-liturgia";
import { useHomiliaHoje } from "@/hooks/use-homilia";

// ── Constantes de estilo ──────────────────────────────────────────────────────

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

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  linkTo?: string;
  compact?: boolean;
  showHomilia?: boolean;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function LiturgiaDoDiaWidget({
  linkTo = "/portal-membro/liturgia",
  compact = false,
  showHomilia = true,
}: Props) {
  const { data: liturgia, isLoading: loadingL } = useLiturgiaHoje();
  const { data: homilia, isLoading: loadingH }  = useHomiliaHoje();

  const hex    = liturgia ? (COR_HEX[liturgia.cor ?? ""] ?? COR_HEX.verde) : COR_HEX.verde;
  const tempo  = liturgia?.tempo_liturgico ?? "comum";
  const evRef  = liturgia ? refEvangelho(liturgia) : null;
  const hoje   = format(new Date(), "d 'de' MMMM", { locale: ptBR });

  return (
    <div className="space-y-3">
      {/* ── Card principal: liturgia ── */}
      <div
        className="rounded-[1.75rem] border bg-card overflow-hidden shadow-altar"
        style={{ borderTopColor: hex, borderTopWidth: 3 }}
      >
        <div className="p-4">
          {/* Título da seção */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground font-semibold">
                Liturgia do Dia
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground">{hoje}</span>
          </div>

          {/* Conteúdo */}
          {loadingL ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : liturgia ? (
            <>
              {/* Celebração */}
              <p className="font-serif text-lg leading-snug text-foreground">
                {liturgia.titulo}
              </p>
              {liturgia.subtitulo && (
                <p className="text-xs text-muted-foreground mt-0.5">{liturgia.subtitulo}</p>
              )}

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {tempo && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TEMPO_CLS[tempo] ?? "bg-muted text-muted-foreground border-border"}`}>
                    {TEMPO_LABEL[tempo] ?? tempo}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: hex }}
                  />
                  {liturgia.cor ?? "—"}
                </span>
              </div>

              {/* Evangelho */}
              {!compact && evRef && (
                <div
                  className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
                  style={{ backgroundColor: hex + "15", color: hex }}
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-muted-foreground font-normal mr-1">Evangelho</span>
                  {evRef}
                </div>
              )}

              {/* Link */}
              <Link
                to={linkTo}
                className="mt-3 flex items-center justify-center gap-1.5 w-full rounded-xl border border-border bg-background/60 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Ver Liturgia Completa
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic py-2">
              Liturgia de hoje ainda não disponível.
            </p>
          )}
        </div>
      </div>

      {/* ── Card: homilia ── */}
      {showHomilia && (
        <div className="rounded-[1.75rem] border border-border bg-card overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Play className="h-3.5 w-3.5 text-red-500" />
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground font-semibold">
                Homilia do Dia
              </p>
            </div>

            {loadingH ? (
              <div className="flex gap-3">
                <Skeleton className="h-16 w-28 rounded-lg shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ) : homilia ? (
              <>
                <div className="flex gap-3">
                  {/* Thumbnail */}
                  {homilia.thumbnail_url && (
                    <img
                      src={homilia.thumbnail_url}
                      alt="Thumbnail"
                      className="h-16 w-28 rounded-lg object-cover shrink-0 bg-muted"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug line-clamp-2 text-foreground">
                      {homilia.titulo}
                    </p>
                    {homilia.autor && (
                      <p className="text-xs text-muted-foreground mt-1">{homilia.autor}</p>
                    )}
                  </div>
                </div>

                <a
                  href={homilia.youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center justify-center gap-1.5 w-full rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 transition"
                >
                  <Play className="h-3.5 w-3.5" />
                  Assistir no YouTube
                  <ExternalLink className="h-3 w-3 ml-0.5" />
                </a>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                Homilia ainda não disponível para hoje.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
