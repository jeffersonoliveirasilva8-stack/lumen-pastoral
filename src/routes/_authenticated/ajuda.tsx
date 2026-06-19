import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  HelpCircle, Users, Calendar, ArrowLeftRight, Settings,
  BarChart2, BookOpen, ChevronDown, ChevronUp, Lightbulb,
  UserCheck, Shield, ClipboardList, MessageSquare, Bell,
  Zap, FileText, Star,
} from "lucide-react";
import { useSetPageTabs } from "@/contexts/page-tabs";

export const Route = createFileRoute("/_authenticated/ajuda")({
  component: AjudaAdminPage,
  head: () => ({ meta: [{ title: "Ajuda — Lumen Pastoral" }] }),
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
    id: "membros",
    icon: Users,
    title: "Membros",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    steps: [
      {
        title: "Cadastrar um novo membro",
        text: 'Acesse Membros → clique em "Novo membro". Preencha nome, e-mail e telefone. O membro ainda não terá acesso ao portal até você enviar o link de ativação.',
      },
      {
        title: "Enviar acesso digital",
        text: 'No card do membro, clique no menu (⋮) → "Enviar acesso". O sistema envia um e-mail com link de ativação. O membro define a própria senha.',
      },
      {
        title: "Importar planilha",
        text: 'Para cadastrar muitos membros de uma vez, use Membros → "Importar planilha". Baixe o modelo, preencha e envie. O sistema verifica duplicatas automaticamente.',
      },
      {
        title: "Gerenciar acesso de coordenadores",
        text: 'Em Configurações → Coordenação, você pode promover membros a Vice-Coordenador ou Secretário. Cada cargo tem permissões diferentes.',
      },
      {
        title: "Aprovar solicitações",
        text: 'Quando alguém se inscreve pelo formulário público, a solicitação aparece em Membros → aba "Solicitações". Você pode Aprovar (o membro entra na lista) ou Rejeitar.',
      },
    ],
    tip: "Mantenha os e-mails dos membros atualizados. Eles são usados para enviar escalas e avisos.",
  },
  {
    id: "escalas",
    icon: Calendar,
    title: "Escalas",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    steps: [
      {
        title: "Criar uma nova escala",
        text: 'Em Escalas → "Nova escala", informe o título, data, horário e a missa de referência. Em seguida, adicione os membros por função (ministério).',
      },
      {
        title: "Publicar a escala",
        text: 'Com a escala montada, clique em "Publicar". Os membros escalados recebem notificação e passam a ver a escala no portal. Escalas em rascunho não ficam visíveis para os membros.',
      },
      {
        title: "Motor automático",
        text: 'Use Escalas → "Sugerir escala" para deixar o sistema distribuir automaticamente os membros com base em disponibilidade, pontuação e regras configuradas. Você pode editar antes de publicar.',
      },
      {
        title: "Registrar presença (Sacristia)",
        text: 'Em Presença (aba dentro de Escalas), o sacristão ou coordenador marca quem compareceu. Isso atualiza a pontuação dos membros automaticamente.',
      },
      {
        title: "Configurar indisponibilidades",
        text: 'Membros podem registrar as próprias indisponibilidades no portal. Você também pode adicionar por conta de um membro em Membros → perfil do membro.',
      },
    ],
    tip: "Configure as regras do motor em Configurações → Motor para que o sistema respeite limites de escalas por mês e prioridades.",
  },
  {
    id: "substituicoes",
    icon: ArrowLeftRight,
    title: "Substituições",
    color: "text-teal-600 bg-teal-50 border-teal-200",
    steps: [
      {
        title: "Ver pedidos abertos",
        text: "Em Substituições você vê todos os pedidos de substituição: quem pediu, para qual escala, e se já foi resolvido.",
      },
      {
        title: "Resolver manualmente",
        text: "Se nenhum membro aceitou a substituição, você pode designar um substituto manualmente clicando no pedido e escolhendo um membro disponível.",
      },
      {
        title: "Relatório de equilíbrio",
        text: 'Em Relatório (aba em Escalas), você vê a distribuição de escalas por membro para detectar quem está sobrecarregado e equilibrar melhor a escala.',
      },
    ],
  },
  {
    id: "formacoes",
    icon: BookOpen,
    title: "Formações",
    color: "text-purple-600 bg-purple-50 border-purple-200",
    steps: [
      {
        title: "Criar uma pauta de reunião",
        text: 'Em Formações → clique em "+". Escolha o tipo "Pauta de Reunião", informe a data da reunião e adicione os itens da pauta. Publique para que os membros possam consultar.',
      },
      {
        title: "Adicionar materiais formativos",
        text: 'Além de pautas, você pode adicionar Documentos (com link), Vídeos (YouTube, etc.), Artigos (texto livre) e Links úteis. Tudo fica organizado na aba Formações do portal do membro.',
      },
      {
        title: "Controlar visibilidade",
        text: 'Cada material tem um botão de publicação (olho). Rascunhos ficam visíveis apenas para coordenadores; materiais publicados aparecem para todos os membros.',
      },
    ],
    tip: "Use a aba Formações para centralizar tudo: atas de reunião, vídeos de capacitação, documentos do bispado.",
  },
  {
    id: "notificacoes",
    icon: Bell,
    title: "Avisos e Notificações",
    color: "text-rose-600 bg-rose-50 border-rose-200",
    steps: [
      {
        title: "Enviar aviso a todos os membros",
        text: 'Em Notificações → "Novo aviso", escreva a mensagem. Ela será entregue como notificação para todos os membros ativos no portal.',
      },
      {
        title: "Notificações automáticas",
        text: "O sistema envia automaticamente: confirmação de escala publicada, lembrete 24h antes da missa, resultado de pedido de substituição.",
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
        title: "Ver ocorrências registradas",
        text: "Em Ocorrências você vê todos os registros feitos por membros durante as celebrações: atrasos, ausências, problemas. Filtre por período ou por membro.",
      },
      {
        title: "Marcar como resolvida",
        text: "Clique em uma ocorrência para ver os detalhes e marcá-la como resolvida quando o problema for tratado.",
      },
    ],
  },
  {
    id: "relatorios",
    icon: BarChart2,
    title: "Relatórios",
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
    steps: [
      {
        title: "Ranking de membros",
        text: "Em Ranking você vê a pontuação acumulada de todos os membros, com filtros por período. Use para identificar os mais engajados e os que precisam de atenção.",
      },
      {
        title: "Equilíbrio de escalas",
        text: "O Relatório de Equilíbrio mostra quantas escalas cada membro cumpriu, recusou e faltou. Identifica desequilíbrios antes de montar a próxima escala.",
      },
      {
        title: "Auditoria de acesso",
        text: "Em Membros → Auditoria você vê quais membros ainda não ativaram a conta e pode reenviar o link em lote.",
      },
    ],
  },
  {
    id: "configuracoes",
    icon: Settings,
    title: "Configurações",
    color: "text-slate-600 bg-slate-50 border-slate-200",
    steps: [
      {
        title: "Dados da paróquia",
        text: "Em Configurações → Geral, atualize nome, endereço, logo e dados de contato da paróquia. Essas informações aparecem nos e-mails enviados aos membros.",
      },
      {
        title: "Motor de escalas",
        text: "Em Configurações → Motor, defina as regras: máximo de escalas por membro por mês, intervalo mínimo entre escalas, quais ministérios são obrigatórios por tipo de missa.",
      },
      {
        title: "Ministérios e atuações",
        text: "Em Ministérios você cadastra as funções disponíveis na pastoral (Leitor, Coroinha, Monitor, etc.). Em Atuações você define as especialidades dos membros.",
      },
    ],
    tip: "Configure bem o Motor antes de usar o gerador automático de escalas. As regras afetam diretamente a qualidade das sugestões.",
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

function AjudaAdminPage() {
  useSetPageTabs([]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto pb-24">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-2xl p-3 bg-primary/10 text-primary">
          <HelpCircle className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold">Suporte</p>
          <h1 className="page-header-title">Central de Ajuda</h1>
          <p className="text-sm text-muted-foreground">Guia para coordenadores e administradores</p>
        </div>
      </div>

      {/* Cards de acesso rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { icon: UserCheck, label: "Ativar membros", desc: "Enviar acesso em lote", color: "text-blue-600 bg-blue-50" },
          { icon: Zap,       label: "Motor de escalas", desc: "Geração automática", color: "text-violet-600 bg-violet-50" },
          { icon: FileText,  label: "Importar planilha", desc: "Cadastro em massa", color: "text-teal-600 bg-teal-50" },
          { icon: Star,      label: "Ranking & Pontos", desc: "Acompanhar engajamento", color: "text-amber-600 bg-amber-50" },
        ].map(({ icon: Ic, label, desc, color }) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-3 flex flex-col gap-2">
            <div className={`rounded-xl p-2 w-fit ${color}`}>
              <Ic className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold">{label}</p>
              <p className="text-[10px] text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Seções */}
      <div className="space-y-2">
        {SECTIONS.map((s) => (
          <AccordionSection key={s.id} section={s} />
        ))}
      </div>

      {/* Rodapé */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-4 text-center space-y-1">
        <p className="text-sm font-semibold">Precisa de suporte técnico?</p>
        <p className="text-xs text-muted-foreground">
          Entre em contato com o desenvolvedor do sistema para dúvidas técnicas ou erros não resolvidos por este guia.
        </p>
      </div>

    </div>
  );
}
