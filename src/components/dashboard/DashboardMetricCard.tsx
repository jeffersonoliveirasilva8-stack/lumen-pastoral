import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardMetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  href: string;
  variant?: "default" | "soft";
}

export function DashboardMetricCard({
  icon: Icon,
  label,
  value,
  hint,
  href,
  variant = "default",
}: DashboardMetricCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        "group block rounded-[1.5rem] sm:rounded-[2rem] border border-border bg-card p-4 sm:p-6 shadow-altar transition active:scale-[0.98] hover:-translate-y-0.5 hover:shadow-gold",
        variant === "soft" && "bg-muted/70"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.28em] text-muted-foreground leading-none">{label}</p>
          <p className="mt-2.5 sm:mt-4 text-3xl sm:text-4xl font-serif text-foreground leading-none tabular-nums">{value}</p>
        </div>
        <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-2xl sm:rounded-3xl bg-primary/10 text-primary transition duration-200 group-hover:bg-primary/15 shrink-0">
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </div>
      <p className="mt-3 sm:mt-5 text-xs sm:text-sm text-muted-foreground leading-relaxed">{hint}</p>
    </Link>
  );
}
