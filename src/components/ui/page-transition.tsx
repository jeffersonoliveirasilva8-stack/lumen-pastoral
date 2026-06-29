import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Envolve o conteúdo de uma rota e aplica fade+slide suave a cada troca de pathname.
 * Uso: <PageTransition><Outlet /></PageTransition>
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [key, setKey] = useState(pathname);
  const [visible, setVisible] = useState(true);
  const prev = useRef(pathname);

  useEffect(() => {
    if (pathname === prev.current) return;
    prev.current = pathname;
    setVisible(false);
    const t = setTimeout(() => { setKey(pathname); setVisible(true); }, 60);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div
      key={key}
      style={{
        opacity: visible ? 1 : 0,
        transition: visible
          ? "opacity 200ms cubic-bezier(0.25,0.46,0.45,0.94)"
          : "none",
      }}
    >
      {children}
    </div>
  );
}
