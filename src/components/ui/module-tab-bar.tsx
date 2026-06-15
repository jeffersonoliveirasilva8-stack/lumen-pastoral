import { Link } from "@tanstack/react-router";

export interface ModuleTab {
  label: string;
  to?: string;
  onClick?: () => void;
  isActive: boolean;
}

function TabItem({ tab }: { tab: ModuleTab }) {
  const cls = `relative flex-shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
    tab.isActive
      ? "text-primary"
      : "text-muted-foreground hover:text-foreground"
  }`;

  const indicator = tab.isActive ? (
    <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-primary" />
  ) : null;

  if (tab.to) {
    return (
      <Link to={tab.to} className={cls}>
        {tab.label}
        {indicator}
      </Link>
    );
  }

  return (
    <button type="button" onClick={tab.onClick} className={cls}>
      {tab.label}
      {indicator}
    </button>
  );
}

export function ModuleTabBar({ tabs }: { tabs: ModuleTab[] }) {
  return (
    <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-none">
      {tabs.map((tab) => (
        <TabItem key={tab.label} tab={tab} />
      ))}
    </div>
  );
}
