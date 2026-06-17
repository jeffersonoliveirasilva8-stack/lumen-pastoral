import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton genérico para topo de página com título + cards */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Cabeçalho */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 rounded-xl" />
        <Skeleton className="h-4 w-72 rounded-lg" />
      </div>
      {/* Filtros / tabs */}
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      {/* Cards */}
      <div className="space-y-3">
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} delay={i * 60} />
        ))}
      </div>
    </div>
  );
}

/** Skeleton de card individual */
export function CardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-2/3 rounded-lg" />
          <Skeleton className="h-3 w-1/3 rounded-lg" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full shrink-0" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full rounded-lg" />
        <Skeleton className="h-3 w-4/5 rounded-lg" />
      </div>
    </div>
  );
}

/** Skeleton para lista de membros / ranking */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-fade-in">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40 rounded-lg" />
            <Skeleton className="h-3 w-24 rounded-lg" />
          </div>
          <Skeleton className="h-6 w-12 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton para painel / dashboard */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <Skeleton className="h-8 w-8 rounded-xl" />
            <Skeleton className="h-6 w-12 rounded-lg" />
            <Skeleton className="h-3 w-20 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <Skeleton className="h-5 w-32 rounded-lg" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <Skeleton className="h-5 w-32 rounded-lg" />
          <ListSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
