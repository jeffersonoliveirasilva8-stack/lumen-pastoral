import type { LiturgicalDayRecord } from '@/biblioteca/liturgia/types';
import { LITURGICAL_COLOR_BG } from '@/biblioteca/liturgia/constants/colors';
import { RANK_WEIGHT } from '@/biblioteca/liturgia/constants/ranks';
import { LiturgicalBadge, SeasonBadge, LiturgicalColorDot } from './LiturgicalBadge';
import { BookOpen, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LiturgicalCardProps {
  record: LiturgicalDayRecord;
  /** Mostrar leituras (evangelho, etc.) */
  showReadings?: boolean;
  /** Compacto para uso em listas */
  compact?: boolean;
  onClick?: () => void;
  className?: string;
}

export function LiturgicalCard({
  record,
  showReadings = false,
  compact = false,
  onClick,
  className,
}: LiturgicalCardProps) {
  const isSolene = (RANK_WEIGHT[record.grau] ?? 0) >= RANK_WEIGHT['solenidade'];
  const hasReadings = record.evangelho || record.leitura_1;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl border transition-all',
        LITURGICAL_COLOR_BG[record.cor],
        onClick && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5',
        compact ? 'p-3' : 'p-4',
        className
      )}
    >
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <LiturgicalColorDot color={record.cor} size="md" className="mt-1 shrink-0" />
          <div className="min-w-0">
            <p className={cn('font-semibold leading-snug', compact ? 'text-sm' : 'text-base')}>
              {record.titulo}
              {isSolene && (
                <Star className="inline ml-1 h-3.5 w-3.5 text-amber-500 fill-amber-500" />
              )}
            </p>
            {record.subtitulo && (
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{record.subtitulo}</p>
            )}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <LiturgicalBadge rank={record.grau} color={record.cor} showColor={false} />
        {!compact && <SeasonBadge season={record.tempo_liturgico} />}
        {record.e_dia_preceito && (
          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 border border-red-200 rounded font-medium">
            Preceito
          </span>
        )}
        {record.e_padroeiro && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded font-medium">
            Padroeiro
          </span>
        )}
        {record.origem !== 'romano' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded capitalize">
            {record.origem}
          </span>
        )}
      </div>

      {/* Leituras */}
      {showReadings && hasReadings && (
        <div className="mt-3 pt-3 border-t border-current/10 space-y-1">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1">
            <BookOpen className="h-3 w-3" />
            Leituras
          </div>
          {record.leitura_1 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">1ª Leitura:</span> {record.leitura_1}
            </p>
          )}
          {record.salmo && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Salmo:</span> {record.salmo}
            </p>
          )}
          {record.leitura_2 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">2ª Leitura:</span> {record.leitura_2}
            </p>
          )}
          {record.evangelho && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Evangelho:</span> {record.evangelho}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
