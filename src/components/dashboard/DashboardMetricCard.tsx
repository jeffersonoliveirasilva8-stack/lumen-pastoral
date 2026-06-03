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
        "group block rounded-[2rem] border border-border bg-card p-6 shadow-altar transition hover:-translate-y-0.5 hover:shadow-gold",
        variant === "soft" && "bg-muted/70"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{label}</p>
          <p className="mt-4 text-4xl font-serif text-foreground leading-none">{value}</p>
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/10 text-primary transition duration-200 group-hover:bg-primary/15">
          <Icon className="h-6 w-6" />
        </div>
      </div>
      <p className="mt-5 text-sm text-muted-foreground leading-relaxed">{hint}</p>
    </Link>
  );
}
