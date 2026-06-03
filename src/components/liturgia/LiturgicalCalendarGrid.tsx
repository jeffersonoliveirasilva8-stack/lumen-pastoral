import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LiturgicalResolution } from '@/biblioteca/liturgia/types';
import { RANK_WEIGHT } from '@/biblioteca/liturgia/constants/ranks';
import { LITURGICAL_COLOR_CLASS } from '@/biblioteca/liturgia/constants/colors';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface LiturgicalCalendarGridProps {
  month: Date;
  /** Mapa date string (YYYY-MM-DD) → resolução litúrgica */
  resolutions: Map<string, LiturgicalResolution>;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  today?: Date;
}

export function LiturgicalCalendarGrid({
  month,
  resolutions,
  selectedDate,
  onSelectDate,
  today = new Date(),
}: LiturgicalCalendarGridProps) {
  const { days, offset } = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    return { days: eachDayOfInterval({ start, end }), offset: getDay(start) };
  }, [month]);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Cabeçalho dias da semana */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/20">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className="py-2 text-center text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase">
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
          </div>
        ))}
      </div>

      {/* Grade */}
      <div className="grid grid-cols-7">
        {/* Células vazias do início */}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`e-${i}`} className="min-h-[60px] sm:min-h-[80px] border-b border-r border-border bg-muted/5" />
        ))}

        {days.map((day, i) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const resolution = resolutions.get(dateStr);
          const cel = resolution?.celebration;
          const col = (i + offset) % 7;
          const isSunday = col === 0;
          const isSat = col === 6;
          const isToday = isSameDay(day, today);
          const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
          const isSolene = cel ? (RANK_WEIGHT[cel.grau] ?? 0) >= RANK_WEIGHT['solenidade'] : false;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(day)}
              className={cn(
                'min-h-[60px] sm:min-h-[80px] p-1 sm:p-1.5 text-left border-b border-r border-border transition-colors',
                isSat && 'border-r-0',
                isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-muted/30',
                cel && !isSelected && 'bg-amber-50/20 dark:bg-amber-900/5',
                isSolene && !isSelected && 'bg-amber-50/50 dark:bg-amber-900/10',
              )}
            >
              {/* Número do dia */}
              <p className={cn(
                'text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full leading-none',
                isToday ? 'bg-primary text-primary-foreground' : isSunday ? 'text-red-600 font-bold' : 'text-foreground'
              )}>
                {format(day, 'd')}
              </p>

              {/* Mobile: dots de cor */}
              {cel && (
                <div className="flex gap-0.5 flex-wrap sm:hidden">
                  <span className={cn('h-1.5 w-1.5 rounded-full', LITURGICAL_COLOR_CLASS[cel.cor])} />
                  {isSolene && <span className="text-[8px] text-amber-600 leading-none">★</span>}
                </div>
              )}

              {/* Desktop: chip com nome */}
              {cel && (
                <div className="hidden sm:block">
                  <div className={cn(
                    'flex items-center gap-1 text-[9px] leading-tight px-1 py-0.5 rounded truncate',
                    isSolene
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                      : 'bg-muted/60 text-muted-foreground'
                  )}>
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', LITURGICAL_COLOR_CLASS[cel.cor])} />
                    <span className="truncate">{cel.titulo.split(',')[0].split('–')[0].trim()}</span>
                  </div>
                  {(resolution?.displaced.length ?? 0) > 0 && (
                    <p className="text-[9px] text-muted-foreground px-1 mt-0.5">
                      +{resolution!.displaced.length}
                    </p>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
