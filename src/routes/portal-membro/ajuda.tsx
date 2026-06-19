import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  HelpCircle, Calendar, ArrowLeftRight, User, Bell,
  Trophy, BookOpen, CalendarDays, MessageSquare, ChevronDown,
  ChevronUp, Smartphone, KeyRound, CheckCircle2, CalendarOff,
  Star, Lightbulb, CalendarRange,
} from "lucide-react";

export const Route = createFileRoute("/portal-membro/ajuda")({
  component: AjudaMembroPage,
  head: () => ({ meta: [{ title: "Ajuda — Portal do Servidor" }] }),
});

type Section = {
  id: string;
  icon: React.FC<{ className?: string }>;
  title: string;
  color: string;
  steps: { title: string; text: string }[];
  tip?: string;
};

const SECTIONS: Section[] = [
  {
    id: "conta",
    icon: KeyRound,
    title: "Ativar sua conta",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    steps: [
      {
        title: "Receba o link de acesso",
        text: "O coordenador envia um e-mail ou mensagem de WhatsApp com o link para ativar sua conta. Esse link é exclusivo para você e expira em 7 dias.",
      },
      {
        title: "Crie sua senha",
        text: "Ao abrir o link, você será levado para uma tela onde define uma senha pessoal. A senha deve ter pelo menos 8 caracteres. Confirme a senha e clique em Ativar conta.",
      },
      {
        title: "Acesso liberado",
        text: "Pronto! Agora você pode entrar pelo link do portal a qualquer momento usando seu e-mail e a senha criada.",
      },
    ],
    tip: "Se o link expirou, fale com o coordenador para reenviar o convite.",
  },
  {
    id: "escalas",
    icon: Calendar,
    title: "Escalas",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    steps: [
      {
        title: "Ver suas escalas",
        text: "Na aba Escalas você vê todas as missas e celebrações em que está escalado. As próximas aparecem em destaque no topo.",
      },
      {
        title: "Confirmar presença",
        text: 'Ao lado de cada escala haverá um botão "Confirmar" ou "Recusar". Confirme o quanto antes para que o coordenador saiba com quem pode contar. Você pode confirmar ou recusar até a véspera da missa.',
      },
      {
        title: "Registrar indisponibilidade",
        text: 'Na aba "Indisponibilidades" dentro de Escalas, você pode bloquear datas específicas em que não estará disponível. Clique em "Nova indisponibilidade", escolha a data e informe o motivo.',
      },
      {
        title: "Ver histórico",
        text: 'A aba "Histórico" mostra todas as escalas passadas, com status de presença. Use para acompanhar sua participação.',
      },
    ],
    tip: "Manter suas indisponibilidades atualizadas ajuda muito o coordenador a criar escalas sem conflitos.",
  },
  {
    id: "substituicoes",
    icon: ArrowLeftRight,
    title: "Substituições",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    steps: [
      {
        title: "Pedir substituição",
        text: 'Se você não puder comparecer a uma escala já confirmada, vá em Substituições → "Pedir substituição". Selecione a escala, informe o motivo e envie. O sistema notifica outro membro disponível.',
      },
      {
        title: "Aceitar uma substituição",
        text: 'Quando outro membro precisar de substituto, você receberá uma notificação. Em Substituições → "Pedidos abertos", você pode aceitar a missão.',
      },
      {
        title: "Acompanhar o status",
        text: "Após enviar um pedido, ele fica com status Pendente até alguém aceitar ou o coordenador resolver. Você será notificado quando houver resposta.",
      },
    ],
    tip: "Sempre avise com antecedência. Substituições de última hora são mais difíceis de resolver.",
  },
  {
    id: "perfil",
    icon: User,
    title: "Perfil",
    color: "text-teal-600 bg-teal-50 border-teal-200",
    steps: [
      {
        title: "Manter dados atualizados",
        text: "Acesse Perfil para atualizar telefone, e-mail, data de nascimento e foto. Dados corretos facilitam o contato da coordenação com você.",
      },
      {
        title: "Dias de restrição",
        text: 'Em Perfil → "Disponibilidade semanal", marque os dias da semana em que você nunca pode ser escalado. O sistema considera isso automaticamente ao gerar novas escalas.',
      },
      {
        title: "Alterar senha",
        text: 'Em Perfil → "Segurança", você pode alterar sua senha a qualquer momento.',
      },
    ],
    tip: "Uma foto de perfil ajuda a coordenação a identificar você mais facilmente na lista de membros.",
  },
  {
    id: "notificacoes",
    icon: Bell,
    title: "Avisos e Notificações",
    color: "text-rose-600 bg-rose-50 border-rose-200",
    steps: [
      {
        title: "Receber avisos",
        text: "O coordenador pode enviar avisos para todos os membros. Eles aparecem na aba Avisos com data e horário.",
      },
      {
        title: "Notificações do sistema",
        text: "Quando você for escalado, quando alguém aceitar sua substituição ou quando houver uma novidade, uma notificação aparece no sino no topo da tela.",
      },
    ],
  },
  {
    id: "ranking",
    icon: Trophy,
    title: "Ranking",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    steps: [
      {
        title: "O que é o ranking",
        text: "O ranking mostra a posição de cada membro com base na pontuação acumulada ao longo do tempo. Participações confirmadas, presenças e engajamento geram pontos.",
      },
      {
        title: "Como subir no ranking",
        text: "Confirme presenças, evite faltas injustificadas e participe com regularidade. Faltas sem aviso reduzem a pontuação.",
      },
    ],
    tip: "O ranking é para motivação — não é usado para punir membros.",
  },
  {
    id: "liturgia",
    icon: BookOpen,
    title: "Liturgia Diária",
    color: "text-purple-600 bg-purple-50 border-purple-200",
    steps: [
      {
        title: "Leituras do dia",
        text: "Na aba Liturgia você encontra as leituras litúrgicas do dia: primeira leitura, salmo, segunda leitura (quando houver) e Evangelho, com o tempo litúrgico em destaque.",
      },
      {
        title: "Homilia",
        text: "Quando disponível, a homilia do dia aparece logo abaixo das leituras.",
      },
    ],
  },
  {
    id: "agenda",
    icon: CalendarDays,
    title: "Agenda",
    color: "text-sky-600 bg-sky-50 border-sky-200",
    steps: [
      {
        title: "Próximos eventos",
        text: "A Agenda mostra os eventos cadastrados pela coordenação: retiros, encontros de formação, reuniões e datas especiais da comunidade.",
      },
    ],
  },
  {
    id: "ocorrencias",
    icon: MessageSquare,
    title: "Ocorrências",
    color: "text-orange-600 bg-orange-50 border-orange-200",
    steps: [
      {
        title: "Registrar uma ocorrência",
        text: 'Em Ocorrências, você pode registrar eventos que aconteceram durante uma missa ou celebração: atraso, ausência, problema com equipamento, etc. Clique em "Nova ocorrência", selecione a escala, informe o que aconteceu.',
      },
      {
        title: "Para que serve",
        text: "As ocorrências são vistas pela coordenação e ajudam a entender o que está acontecendo nas celebrações para melhorar continuamente.",
      },
    ],
  },
  {
    id: "calendario",
    icon: CalendarRange,
    title: "Calendário",
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
    steps: [
      {
        title: "Visualização mensal",
        text: "O Calendário mostra uma visão mensal com todos os seus compromissos: escalas, eventos e indisponibilidades registradas. Toque em um dia para ver os detalhes.",
      },
    ],
  },
];

function AccordionSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className={`rounded-xl p-2 border shrink-0 ${section.color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="flex-1 font-semibold text-sm">{section.title}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          <ol className="space-y-3">
            {section.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>

          {section.tip && (
            <div className="flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
              <Lightbulb className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{section.tip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AjudaMembroPage() {
  return (
    <div className="px-4 py-6 max-w-2xl mx-auto pb-24">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-2xl p-3 bg-primary/10 text-primary">
          <HelpCircle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-serif text-2xl">Central de Ajuda</h1>
          <p className="text-sm text-muted-foreground">Como usar o Portal do Servidor</p>
        </div>
      </div>

      {/* Dicas rápidas */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-transparent p-4 mb-6 space-y-2">
        <p className="text-xs font-bold tracking-wide uppercase text-primary mb-3">Dicas rápidas</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { icon: Smartphone, text: "Adicione o portal à tela inicial do seu celular para acesso rápido." },
            { icon: CheckCircle2, text: "Confirme ou recuse escalas o quanto antes após receber a notificação." },
            { icon: CalendarOff, text: "Registre indisponibilidades antes de viajar ou se ausentar." },
            { icon: Star, text: "Mantenha seu perfil atualizado para receber avisos da coordenação." },
          ].map(({ icon: Ic, text }, i) => (
            <div key={i} className="flex gap-2 items-start">
              <Ic className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Seções */}
      <div className="space-y-2">
        {SECTIONS.map((s) => (
          <AccordionSection key={s.id} section={s} />
        ))}
      </div>

      {/* Rodapé */}
      <div className="mt-8 text-center">
        <p className="text-xs text-muted-foreground">
          Ainda com dúvidas? Fale com o coordenador da sua pastoral.
        </p>
      </div>

    </div>
  );
}
