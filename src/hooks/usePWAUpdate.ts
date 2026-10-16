import { useEffect, useState } from "react";

export function usePWAUpdate() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const reg = navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      const checkWaiting = () => {
        if (reg.waiting) setWaitingWorker(reg.waiting);
      };

      checkWaiting();
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker);
          }
        });
      });
    });

    // Recarrega a página quando o SW novo assumir o controle
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    return () => { void reg; };
  }, []);

  const applyUpdate = () => {
    if (!waitingWorker) return;
    waitingWorker.postMessage("SKIP_WAITING");
  };

  const dismiss = () => setWaitingWorker(null);

  return { hasUpdate: !!waitingWorker, applyUpdate, dismiss };
}
