import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Calendar, ArrowLeftRight, User, CheckCircle2,
  CalendarOff, Bell, ChevronRight, Sparkles, HelpCircle,
} from "lucide-react";

const STORAGE_KEY = "lumen_welcome_seen_v1";

type Step = {
  icon: React.FC<{ className?: string }>;
  color: string;
  title: string;
  text: string;
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    color: "bg-amber-100 text-amber-600",
    title: "Bem-vindo ao Portal do Servidor!",
    text: "Este é o seu espaço para acompanhar escalas, confirmar presenças e se manter conectado com a pastoral. Veja um rápido resumo do que você pode fazer aqui.",
  },
  {
    icon: Calendar,
    color: "bg-blue-100 text-blue-600",
    title: "Escalas",
    text: "Veja todas as missas em que você está escalado. Confirme ou recuse sua presença — faça isso logo após receber a notificação para facilitar o planejamento da coordenação.",
  },
  {
    icon: CalendarOff,
    color: "bg-violet-100 text-violet-600",
    title: "Registre indisponibilidades",
    text: "Se você tiver uma viagem ou compromisso fixo, registre como indisponibilidade. O sistema leva isso em conta ao gerar novas escalas automaticamente.",
  },
  {
    icon: ArrowLeftRight,
    color: "bg-teal-100 text-teal-600",
    title: "Substituições",
    text: "Surgiu um imprevisto? Peça uma substituição pela aba Substituições. Outro membro disponível será notificado e pode aceitar no lugar de você.",
  },
  {
    icon: Bell,
    color: "bg-rose-100 text-rose-600",
    title: "Avisos e notificações",
    text: "A coordenação pode enviar avisos para toda a equipe. Fique de olho no sino no topo da tela para não perder nada importante.",
  },
  {
    icon: User,
    color: "bg-emerald-100 text-emerald-600",
    title: "Mantenha seu perfil atualizado",
    text: "Acesse Perfil para atualizar telefone, foto e dados pessoais. Em 'Disponibilidade semanal' você define quais dias nunca pode ser escalado.",
  },
];

export function WelcomeGuide() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      // pequeno delay para não conflitar com animação de entrada da página
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  function handleClose() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleClose();
    }
  }

  function handleHelp() {
    handleClose();
    navigate({ to: "/portal-membro/ajuda" });
  }

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Guia de boas-vindas</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center text-center gap-4 pt-2">
          {/* Ícone */}
          <div className={`h-16 w-16 rounded-2xl flex items-center justify-center ${current.color}`}>
            <Icon className="h-8 w-8" />
          </div>

          {/* Conteúdo */}
          <div className="space-y-2 px-2">
            <h2 className="font-serif text-xl leading-snug">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{current.text}</p>
          </div>

          {/* Dots de progresso */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          {/* Ações */}
          <div className="w-full space-y-2 pt-1">
            <Button className="w-full gap-1.5" onClick={handleNext}>
              {isLast ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Entendido, vamos começar!
                </>
              ) : (
                <>
                  Próximo
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>

            {isLast && (
              <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={handleHelp}>
                <HelpCircle className="h-3.5 w-3.5" />
                Ver guia completo de ajuda
              </Button>
            )}

            {!isLast && (
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={handleClose}>
                Pular introdução
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
