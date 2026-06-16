import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent",
        className
      )}
      {...props}
    />
  );
}

// Skeleton pré-montado para card de escala
function SkeletonEscalaCard() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex gap-4">
        <Skeleton className="h-14 w-14 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-3 w-1/2 rounded" />
          <Skeleton className="h-3 w-1/3 rounded" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full shrink-0 self-start" />
      </div>
    </div>
  );
}

// Skeleton para linha de lista
function SkeletonListItem() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/3 rounded" />
        <Skeleton className="h-3 w-1/3 rounded" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full shrink-0" />
    </div>
  );
}

// Skeleton para card de métrica do dashboard
function SkeletonMetricCard() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <Skeleton className="h-9 w-9 rounded-xl" />
      <Skeleton className="h-8 w-16 rounded" />
      <Skeleton className="h-3 w-24 rounded" />
    </div>
  );
}

export { Skeleton, SkeletonEscalaCard, SkeletonListItem, SkeletonMetricCard };
