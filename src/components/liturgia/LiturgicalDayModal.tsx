import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LiturgicalResolution } from '@/biblioteca/liturgia/types';
import { SEASON_LABEL } from '@/biblioteca/liturgia/constants/seasons';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LiturgicalCard } from './LiturgicalCard';
import { SeasonBadge, LiturgicalColorDot } from './LiturgicalBadge';
import { BookOpen, ChevronDown, Info } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface LiturgicalDayModalProps {
  date: Date | null;
  resolution: LiturgicalResolution | null;
  open: boolean;
  onClose: () => void;
}

export function LiturgicalDayModal({ date, resolution, open, onClose }: LiturgicalDayModalProps) {
  const [showDisplaced, setShowDisplaced] = useState(false);

  if (!date) return null;

  const cel = resolution?.celebration;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-0">
          <p className="text-xs font-medium tracking-[0.18em] uppercase text-muted-foreground">
            {format(date, "EEEE", { locale: ptBR })}
          </p>
          <SheetTitle className="font-serif text-2xl">
            {format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </SheetTitle>
          {cel && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <SeasonBadge season={cel.tempo_liturgico} />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LiturgicalColorDot color={cel.cor} />
                <span className="capitalize">{cel.cor}</span>
              </div>
            </div>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {!cel ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Feria — {date && SEASON_LABEL[resolution?.celebration.tempo_liturgico ?? 'comum']}
            </div>
          ) : (
            <>
              {/* Celebração principal */}
              <LiturgicalCard record={cel} showReadings compact={false} />

              {/* Santo do dia */}
              {cel.santo && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center gap-3">
                  <span className="text-2xl">✝</span>
                  <div>
                    <p className="text-xs text-muted-foreground">Santo do dia</p>
                    <p className="text-sm font-medium">{cel.santo}</p>
                  </div>
                </div>
              )}

              {/* Informações litúrgicas */}
              <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  Informações litúrgicas
                </div>
                <Separator />
                <InfoRow label="Grau" value={cel.grau} capitalize />
                <InfoRow label="Cor" value={cel.cor} capitalize />
                <InfoRow label="Tempo" value={SEASON_LABEL[cel.tempo_liturgico]} />
                <InfoRow label="Origem" value={cel.origem} capitalize />
                {cel.e_dia_preceito && <InfoRow label="Dia de preceito" value="Sim" />}
                {cel.e_solene && <InfoRow label="Missa solene" value="Sim" />}
              </div>

              {/* Celebrações deslocadas */}
              {resolution && resolution.displaced.length > 0 && (
                <div>
                  <button
                    className="w-full flex items-center justify-between text-xs text-muted-foreground py-2 hover:text-foreground transition"
                    onClick={() => setShowDisplaced((p) => !p)}
                  >
                    <span>+{resolution.displaced.length} celebração(ões) neste dia</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 transition', showDisplaced && 'rotate-180')} />
                  </button>
                  {showDisplaced && (
                    <div className="space-y-2">
                      {resolution.displaced.map((d, i) => (
                        <LiturgicalCard key={i} record={d} compact />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium', capitalize && 'capitalize')}>{value}</span>
    </div>
  );
}
