import { Download, RefreshCw, X } from "lucide-react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { usePWAUpdate } from "@/hooks/usePWAUpdate";
import { Button } from "@/components/ui/button";

export function PWABanners() {
  const { canInstall, install, dismiss: dismissInstall } = usePWAInstall();
  const { hasUpdate, applyUpdate, dismiss: dismissUpdate } = usePWAUpdate();

  if (!canInstall && !hasUpdate) return null;

  return (
    <div className="fixed top-safe-top left-0 right-0 z-[60] flex flex-col gap-1 px-3 pt-3 pointer-events-none">
      {hasUpdate && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-lg px-3 py-2 text-sm">
          <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 text-foreground">Nova versão disponível</span>
          <Button size="sm" className="h-7 text-xs" onClick={applyUpdate}>
            Atualizar
          </Button>
          <button onClick={dismissUpdate} className="p-1 rounded opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {canInstall && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-lg px-3 py-2 text-sm">
          <Download className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 text-foreground">Instalar Lumen no celular</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={install}>
            Instalar
          </Button>
          <button onClick={dismissInstall} className="p-1 rounded opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
