import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";

type KpiCardProps = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  sub?: ReactNode;
  loading?: boolean;
  accent?: string;   // ex: "text-blue-600"
  onClick?: () => void;
};

export function KpiCard({ label, value, icon, sub, loading, accent, onClick }: KpiCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(onClick ? { onClick, type: "button" } : {}) as any}
      className={`rounded-2xl border border-border bg-card px-5 py-4 flex flex-col gap-1 w-full text-left transition-shadow ${
        onClick ? "hover:shadow-md cursor-pointer active:scale-[0.98]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        {icon && <span className={`shrink-0 ${accent ?? "text-muted-foreground"}`}>{icon}</span>}
      </div>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground my-1" />
      ) : (
        <p className={`text-2xl font-bold tabular-nums leading-tight ${accent ?? "text-foreground"}`}>
          {value}
        </p>
      )}
      {sub && <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>}
    </Tag>
  );
}
