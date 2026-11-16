import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Bell, Calendar, AlertCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const SNOOZE_DAYS = 7;
const SNOOZE_KEY = (membroId: string) => `wpp_optin_snooze_${membroId}`;

function isSnoozed(membroId: string): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY(membroId));
    if (!raw) return false;
    return Date.now() < parseInt(raw, 10);
  } catch {
    return false;
  }
}

function snooze(membroId: string): void {
  try {
    const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(SNOOZE_KEY(membroId), String(until));
  } catch {
    // localStorage indisponível (modo privado restrito)
  }
}

type Props = { membroId: string };

export function WhatsAppOptInBanner({ membroId }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // "ativar" → não snooze; "snooze" → já tratado; null → ainda aberto
  const closeReasonRef = useRef<"ativar" | "snooze" | null>(null);

  const { data: optIn, isLoading } = useQuery<boolean | null>({
    queryKey: ["wpp-optin-check", membroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membros")
        .select("whatsapp_opt_in")
        .eq("id", membroId)
        .single();
      if (error) return null;
      return (data as { whatsapp_opt_in: boolean | null })?.whatsapp_opt_in ?? false;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (isLoading || optIn === null || optIn === undefined) return;
    if (optIn === true) return;       // já autorizou
    if (isSnoozed(membroId)) return;  // adiou recentemente
    setOpen(true);
  }, [isLoading, optIn, membroId]);

  function handleAtivar() {
    closeReasonRef.current = "ativar";
    setOpen(false);
    navigate({ to: "/portal-membro/perfil", search: { ativar_whatsapp: true } });
  }

  function handleAgora() {
    if (closeReasonRef.current === "snooze") return; // já tratado
    closeReasonRef.current = "snooze";
    snooze(membroId);
    setOpen(false);
  }

  function handleOpenChange(v: boolean) {
    if (!v && closeReasonRef.current === null) {
      // Escape ou clique fora (bloqueado por onInteractOutside) → "agora não"
      handleAgora();
    }
    if (!v) closeReasonRef.current = null; // reset para próxima abertura
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-sm mx-auto rounded-2xl p-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby="wpp-banner-desc"
      >
        {/* Cabeçalho verde */}
        <div className="bg-green-600 px-6 pt-6 pb-5 text-white relative">
          <button
            onClick={handleAgora}
            aria-label="Fechar — lembrar depois"
            className="absolute top-3 right-3 rounded-full p-1.5 text-white/70 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-full bg-white/15 p-2.5" aria-hidden="true">
              <MessageCircle className="h-5 w-5" />
            </div>
            <DialogTitle className="text-base font-semibold leading-tight text-white">
              Receba avisos pelo WhatsApp
            </DialogTitle>
          </div>
          <DialogDescription id="wpp-banner-desc" className="text-sm text-white/80 leading-relaxed">
            Fique por dentro das suas escalas e comunicados da paróquia diretamente no WhatsApp.
          </DialogDescription>
        </div>

        {/* Benefícios */}
        <div className="px-6 py-5 space-y-3">
          <ul className="space-y-2.5" aria-label="Benefícios das notificações">
            {BENEFICIOS.map(({ icon: Icon, texto }) => (
              <li key={texto} className="flex items-start gap-3 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
                <span>{texto}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground/60 pt-1">
            Você pode revogar o consentimento a qualquer momento no seu perfil.
          </p>

          {/* Ações */}
          <div className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={handleAtivar}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Continuar para ativar
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground text-sm"
              onClick={handleAgora}
            >
              Agora não
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const BENEFICIOS = [
  { icon: Calendar,    texto: "Lembrete das suas próximas escalas de serviço" },
  { icon: AlertCircle, texto: "Avisos de alterações ou substituições de última hora" },
  { icon: Bell,        texto: "Comunicados pastorais e avisos importantes" },
];
