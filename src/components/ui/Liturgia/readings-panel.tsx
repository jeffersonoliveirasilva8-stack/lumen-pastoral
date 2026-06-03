import type { LiturgicalDayRecord } from '@/biblioteca/liturgia/types';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReadingsPanelProps {
  record: LiturgicalDayRecord;
  className?: string;
}

export function ReadingsPanel({ record, className }: ReadingsPanelProps) {
  const readings = [
    { label: '1ª Leitura', value: record.leitura_1 },
    { label: 'Salmo', value: record.salmo },
    { label: '2ª Leitura', value: record.leitura_2 },
    { label: 'Evangelho', value: record.evangelho },
  ].filter((r) => r.value);

  if (readings.length === 0) {
    return (
      <div className={cn('rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground', className)}>
        Leituras não cadastradas para este dia.
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card p-4 space-y-3', className)}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <BookOpen className="h-3.5 w-3.5" />
        Leituras do dia
      </div>
      <div className="space-y-2">
        {readings.map((r) => (
          <div key={r.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</p>
            <p className="text-sm mt-0.5">{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
