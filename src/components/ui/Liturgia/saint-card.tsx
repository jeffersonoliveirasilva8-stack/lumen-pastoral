import { cn } from '@/lib/utils';

interface SaintCardProps {
  name: string;
  feast?: string;
  description?: string;
  isPatron?: boolean;
  className?: string;
}

export function SaintCard({ name, feast, description, isPatron, className }: SaintCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-3 flex items-start gap-3', className)}>
      <div className="shrink-0 h-10 w-10 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-xl">
        ✝
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold leading-tight">{name}</p>
          {isPatron && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded font-medium">
              Padroeiro
            </span>
          )}
        </div>
        {feast && <p className="text-xs text-muted-foreground mt-0.5">{feast}</p>}
        {description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>}
      </div>
    </div>
  );
}
