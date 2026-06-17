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
    relative flex-shrink-0 inline-flex items-center gap-1.5
    px-3.5 py-2 text-sm font-medium transition-all duration-150
    whitespace-nowrap rounded-lg select-none
    ${tab.disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "cursor-pointer"}
    ${tab.isActive
      ? "text-primary bg-primary/8 font-semibold"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
    }
  `;

  const indicator = tab.isActive ? (
    <span className="absolute bottom-0 inset-x-3 h-0.5 rounded-t-full bg-primary" />
  ) : null;

  const content = (
    <>
      {tab.icon && (
        <tab.icon className={`h-3.5 w-3.5 shrink-0 ${tab.isActive ? "text-primary" : "text-muted-foreground"}`} />
      )}
      <span>{tab.label}</span>
      {(tab.badge ?? 0) > 0 && (
        <span className={`inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[9px] font-bold leading-none ${
          tab.isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted-foreground/20 text-muted-foreground"
        }`}>
          {(tab.badge ?? 0) > 99 ? "99+" : tab.badge}
        </span>
      )}
      {indicator}
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
    <div className="relative mb-6">
      <div className="flex gap-0.5 border-b border-border overflow-x-auto no-scrollbar -mx-1 px-1">
        {tabs.map((tab) => (
          <TabItem key={tab.label} tab={tab} />
        ))}
      </div>
    </div>
  );
}
