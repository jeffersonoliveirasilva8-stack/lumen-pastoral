import { type ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;          // texto pequeno acima (ex: "Portal do Servidor")
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, subtitle, actions, className = "" }: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="font-serif text-2xl font-normal tracking-tight leading-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1 leading-snug">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 mt-0.5">{actions}</div>
      )}
    </div>
  );
}
