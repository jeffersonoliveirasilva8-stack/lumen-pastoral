import { Link } from "@tanstack/react-router";
import type { ElementType } from "react";

export interface ModuleTab {
  label: string;
  to?: string;
  onClick?: () => void;
  isActive: boolean;
  icon?: ElementType;
  badge?: number;
  disabled?: boolean;
}

function TabItem({ tab }: { tab: ModuleTab }) {
  const cls = `
    inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
    whitespace-nowrap border transition-all duration-150 select-none
    ${tab.disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "cursor-pointer"}
    ${tab.isActive
      ? "bg-muted/70 text-foreground border-border/80"
      : "bg-transparent text-muted-foreground border-border/50 hover:bg-muted/40 hover:text-foreground hover:border-border"
    }
  `;

  const content = (
    <>
      {tab.icon && (
        <tab.icon className={`h-3.5 w-3.5 shrink-0 ${tab.isActive ? "text-foreground" : "text-muted-foreground"}`} />
      )}
      <span>{tab.label}</span>
      {(tab.badge ?? 0) > 0 && (
        <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[9px] font-bold leading-none ${
          tab.isActive
            ? "bg-foreground text-background"
            : "bg-border text-muted-foreground"
        }`}>
          {(tab.badge ?? 0) > 99 ? "99+" : tab.badge}
        </span>
      )}
    </>
  );

  if (tab.to && !tab.disabled) {
    return <Link to={tab.to} className={cls}>{content}</Link>;
  }

  return (
    <button type="button" onClick={tab.onClick} className={cls} disabled={tab.disabled}>
      {content}
    </button>
  );
}

export function ModuleTabBar({ tabs }: { tabs: ModuleTab[] }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 bg-background/95 backdrop-blur-sm border-b border-border/40 mb-6">
      <div className="flex flex-wrap gap-1.5 py-3">
        {tabs.map((tab) => (
          <TabItem key={tab.label} tab={tab} />
        ))}
      </div>
    </div>
  );
}
