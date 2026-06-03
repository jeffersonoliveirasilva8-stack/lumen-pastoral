import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LiturgicalResolution } from '@/biblioteca/liturgia/types';
import { LITURGICAL_COLOR_CLASS, LITURGICAL_COLOR_BG } from '@/biblioteca/liturgia/constants/colors';
import { RANK_LABEL, RANK_WEIGHT } from '@/biblioteca/liturgia/constants/ranks';
import { cn } from '@/lib/utils';
import { Star, CalendarDays } from 'lucide-react';

interface LiturgicalCelebrationCardProps {
  date: Date;
  resolution: LiturgicalResolution;
  onClick?: () => void;
  /** Layout horizontal compacto (para listas) */
  horizontal?: boolean;
  className?: string;
}

export function LiturgicalCelebrationCard({
  date,
  resolution,
  onClick,
  horizontal = false,
  className,
}: LiturgicalCelebrationCardProps) {
  const cel = resolution.celebration;
  const isSolene = (RANK_WEIGHT[cel.grau] ?? 0) >= RANK_WEIGHT['solenidade'];
  const isFesta = (RANK_WEIGHT[cel.grau] ?? 0) >= RANK_WEIGHT['festa'];

  if (horizontal) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'w-full flex items-start gap-3 rounded-lg border p-3 text-left transition hover:shadow-sm',
          LITURGICAL_COLOR_BG[cel.cor],
          onClick && 'cursor-pointer',
          className
        )}
      >
        {/* Data */}
        <div className="shrink-0 w-10 text-center">
          <p className="text-lg font-bold leading-none">{format(date, 'd')}</p>
          <p className="text-[10px] text-muted-foreground capitalize">
            {format(date, 'MMM', { locale: ptBR })}
          </p>
        </div>

        {/* Separador colorido */}
        <div className={cn('w-1 self-stretch rounded-full shrink-0', LITURGICAL_COLOR_CLASS[cel.cor])} />

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug truncate">
              {cel.titulo}
              {isSolene && <Star className="inline ml-1 h-3 w-3 text-amber-500 fill-amber-500" />}
            </p>
            <span className="text-[10px] text-muted-foreground shrink-0 capitalize">
              {RANK_LABEL[cel.grau]}
            </span>
          </div>
          {cel.subtitulo && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{cel.subtitulo}</p>
          )}
          <div className="mt-1 flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', LITURGICAL_COLOR_CLASS[cel.cor])} />
            <span className="text-[10px] text-muted-foreground capitalize">{cel.cor}</span>
            {cel.e_dia_preceito && (
              <span className="text-[10px] px-1 bg-red-100 text-red-700 rounded">Preceito</span>
            )}
            {cel.e_padroeiro && (
              <span className="text-[10px] px-1 bg-amber-100 text-amber-700 rounded">Padroeiro</span>
            )}
          </div>
        </div>
      </button>
    );
  }

  // Card vertical (padrão)
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition',
        LITURGICAL_COLOR_BG[cel.cor],
        isSolene && 'ring-1 ring-amber-300',
        onClick && 'hover:shadow-md hover:-translate-y-0.5',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          <span className="capitalize">{format(date, "d 'de' MMMM", { locale: ptBR })}</span>
        </div>
        <span className={cn(
          'text-[10px] px-1.5 py-0.5 rounded border font-medium',
          isSolene ? 'bg-amber-100 text-amber-900 border-amber-300'
          : isFesta ? 'bg-blue-100 text-blue-900 border-blue-200'
          : 'bg-muted text-muted-foreground border-border'
        )}>
          {RANK_LABEL[cel.grau]}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <span className={cn('mt-1 h-2.5 w-2.5 rounded-full shrink-0', LITURGICAL_COLOR_CLASS[cel.cor])} />
        <div>
          <p className="font-semibold text-sm leading-snug">
            {cel.titulo}
            {isSolene && <Star className="inline ml-1 h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
          </p>
          {cel.subtitulo && (
            <p className="text-xs text-muted-foreground mt-0.5">{cel.subtitulo}</p>
          )}
        </div>
      </div>
    </button>
  );
}
