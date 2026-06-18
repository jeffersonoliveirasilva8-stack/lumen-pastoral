import {
  createContext, useContext, useState, useLayoutEffect, useRef,
  useCallback, type ReactNode,
} from "react";
import type { ModuleTab } from "@/components/ui/module-tab-bar";

type PageTabsCtx = { tabs: ModuleTab[]; setTabs: (t: ModuleTab[]) => void };

const Ctx = createContext<PageTabsCtx>({ tabs: [], setTabs: () => {} });

export function PageTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabsRaw] = useState<ModuleTab[]>([]);
  const setTabs = useCallback((t: ModuleTab[]) => setTabsRaw(t), []);
  return <Ctx.Provider value={{ tabs, setTabs }}>{children}</Ctx.Provider>;
}

export function usePageTabs() {
  return useContext(Ctx).tabs;
}

/** Chame direto no corpo do componente (sem JSX). Limpa automaticamente ao desmontar. */
export function useSetPageTabs(tabs: ModuleTab[]) {
  const { setTabs } = useContext(Ctx);
  const sig = useRef("");

  useLayoutEffect(() => {
    const next = JSON.stringify(tabs.map((t) => ({ l: t.label, a: t.isActive, b: t.badge })));
    if (sig.current !== next) {
      sig.current = next;
      setTabs(tabs);
    }
  });

  useLayoutEffect(() => () => { sig.current = ""; setTabs([]); }, [setTabs]);
}
