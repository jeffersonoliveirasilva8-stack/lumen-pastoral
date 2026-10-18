import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

// VAPID public key — deve corresponder ao secret VAPID_PUBLIC_KEY configurado
// na Edge Function. Substitua após gerar as chaves.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Remove aspas, espaços e newlines que podem vir da variável de ambiente
  const clean = base64String.replace(/['"]/g, "").trim();
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from({ length: raw.length }, (_, i) => raw.charCodeAt(i));
}

export type PushStatus =
  | "unsupported"   // browser não suporta (ou iOS fora de standalone)
  | "denied"        // usuário bloqueou
  | "granted"       // inscrito
  | "idle"          // suportado, não solicitado ainda
  | "loading"
  | "error";        // falha ao inscrever (VAPID ausente, RPC erro, etc.)

export function usePushNotification(paroquiaId: string | null | undefined) {
  const { user } = useAuth();
  const [status, setStatus] = useState<PushStatus>("idle");

  // Detecta suporte (inclui requisito iOS: standalone obrigatório)
  const isSupported = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    // iOS 16.4+: só permite push se instalado na Tela de Início
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (isIOS && !window.matchMedia("(display-mode: standalone)").matches) return false;
    return true;
  }, []);

  // Verifica estado inicial
  useEffect(() => {
    if (!isSupported()) { setStatus("unsupported"); return; }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    if (Notification.permission === "granted") {
      // Verifica se há inscrição ativa
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => {
          setStatus(sub ? "granted" : "idle");
        })
      ).catch(() => setStatus("idle"));
    }
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported() || !user || !paroquiaId) return false;
    if (!VAPID_PUBLIC_KEY) {
      console.warn("VITE_VAPID_PUBLIC_KEY não configurado");
      return false;
    }
    const vapidKey = VAPID_PUBLIC_KEY?.replace(/['"]/g, "").trim();
    if (!vapidKey || vapidKey === "undefined") {
      toast.error("Notificações não configuradas", { description: "VITE_VAPID_PUBLIC_KEY ausente no build." });
      return false;
    }
    setStatus("loading");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setStatus(perm === "denied" ? "denied" : "idle"); return false; }

      const reg = await navigator.serviceWorker.ready;
      // Remove inscrição anterior (chave VAPID pode ter mudado)
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => {});
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
      });

      const keys = sub.toJSON().keys as { p256dh: string; auth: string };
      const { error } = await (supabase as any).rpc("upsert_push_subscription", {
        p_paroquia_id: paroquiaId,
        p_endpoint:    sub.endpoint,
        p_p256dh:      keys.p256dh,
        p_auth_key:    keys.auth,
        p_user_agent:  navigator.userAgent.slice(0, 200),
      });

      if (error) throw error;
      setStatus("granted");
      // Push de boas-vindas via notificar-whatsapp (que tem acesso ao send-push)
      setTimeout(() => {
        (supabase as any).functions.invoke("notificar-whatsapp", {
          body: {
            evento: "teste_push",
            paroquia_id: paroquiaId,
            dados: { user_id: user.id },
          },
        }).catch(() => {});
      }, 2000);
      return true;
    } catch (err) {
      console.error("[push] subscribe error:", err);
      const msg =
        err instanceof Error
          ? err.message
          : (err as any)?.message ?? JSON.stringify(err);
      toast.error("Falha ao ativar notificações", { description: msg });
      setStatus("error");
      return false;
    }
  }, [isSupported, user, paroquiaId]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isSupported()) return;
    setStatus("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await (supabase as any).rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setStatus("idle");
    } catch {
      setStatus("idle");
    }
  }, [isSupported]);

  const sendTestPush = useCallback(async (): Promise<void> => {
    if (!user || !paroquiaId) return;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Tempo esgotado (20s)")), 20000)
    );
    try {
      const result = await Promise.race([
        (supabase as any).functions.invoke("notificar-whatsapp", {
          body: { evento: "teste_push", paroquia_id: paroquiaId, dados: { user_id: user.id } },
        }),
        timeoutPromise,
      ]) as { data: unknown; error: unknown };
      const { data, error } = result;
      if (error) {
        toast.error("Erro ao enviar notificação de teste", { description: JSON.stringify(error) });
      } else {
        const p = (data as any)?.push;
        const detail = (typeof p?.sent === "number")
          ? `sent:${p.sent} failed:${p.failed} removed:${p.removed}`
          : JSON.stringify(data).slice(0, 200);
        toast.success("send-push →", { description: detail, duration: 15000 });
      }
    } catch (e) {
      toast.error("Erro ao enviar teste", { description: e instanceof Error ? e.message : String(e) });
    }
  }, [user, paroquiaId]);

  return { status, isSupported: isSupported(), subscribe, unsubscribe, sendTestPush };
}
