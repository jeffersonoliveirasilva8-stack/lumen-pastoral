import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function EmptyState({ icon: Icon, title, description, action, className, size = "md" }: EmptyStateProps) {
  const sizes = {
    sm: { icon: "h-8 w-8", iconWrap: "h-12 w-12 rounded-xl", title: "text-sm", desc: "text-xs", pad: "py-6 px-4" },
    md: { icon: "h-10 w-10", iconWrap: "h-16 w-16 rounded-2xl", title: "text-base", desc: "text-sm", pad: "py-10 px-6" },
    lg: { icon: "h-12 w-12", iconWrap: "h-20 w-20 rounded-2xl", title: "text-lg", desc: "text-sm", pad: "py-16 px-8" },
  };
  const s = sizes[size];

  return (
    <div className={cn("flex flex-col items-center justify-center text-center", s.pad, className)}>
      <div className={cn("flex items-center justify-center bg-muted/60 text-muted-foreground/50 mb-4", s.iconWrap)}>
        <Icon className={cn(s.icon)} />
      </div>
      <p className={cn("font-semibold text-foreground", s.title)}>{title}</p>
      {description && (
        <p className={cn("mt-1.5 text-muted-foreground max-w-xs leading-relaxed", s.desc)}>{description}</p>
      )}
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  );
}
