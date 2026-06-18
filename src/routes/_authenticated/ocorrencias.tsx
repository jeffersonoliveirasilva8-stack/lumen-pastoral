import { createFileRoute } from "@tanstack/react-router";
import { useSetPageTabs } from "@/contexts/page-tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2, MessageSquare, Clock, CheckCircle2, AlertTriangle, X,
  ChevronDown, ChevronUp, Send, User, CalendarDays, Tag,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/ocorrencias")({
  component: OcorrenciasPage,
  head: () => ({ meta: [{ title: "Ocorrências — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Ocorrencia = {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  status: string;
  resposta: string | null;
  created_at: string;
  updated_at: string;
  membro: { nome: string } | null;
  // campos vindos do RPC get_ocorrencias_paroquia
  membro_nome?: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  problema_pastoral:   "Problema pastoral",
  dificuldade_pessoal: "Dificuldade pessoal",
  ausencia_futura:     "Ausência futura",
  situacao_urgente:    "Situação urgente",
};

const TIPO_ICONS: Record<string, string> = {
  problema_pastoral:   "⚠️",
  dificuldade_pessoal: "🙏",
  ausencia_futura:     "⏳",
  situacao_urgente:    "🚨",
};

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  icon: React.ReactNode;
}> = {
  aberta:     { label: "Aberta",     color: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800",   icon: <Clock className="h-3 w-3" /> },
  em_analise: { label: "Em análise", color: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",        icon: <AlertTriangle className="h-3 w-3" /> },
  resolvida:  { label: "Resolvida",  color: "text-green-700 bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800",    icon: <CheckCircle2 className="h-3 w-3" /> },
  arquivada:  { label: "Arquivada",  color: "text-muted-foreground bg-muted border-border",                                              icon: <X className="h-3 w-3" /> },
};

const STATUS_FLOW: Record<string, string[]> = {
  aberta:     ["em_analise", "resolvida", "arquivada"],
  em_analise: ["resolvida", "arquivada"],
  resolvida:  ["arquivada"],
  arquivada:  [],
};

// ── Main Component ─────────────────────────────────────────────────────────────

function OcorrenciasPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;
  const qc = useQueryClient();

  const [statusFiltro, setStatusFiltro] = useState("aberta");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: ocorrencias = [], isLoading } = useQuery<Ocorrencia[]>({
    queryKey: ["adm-ocorrencias", pid, statusFiltro],
    enabled: !!pid,
    queryFn: async () => {
      // SECURITY DEFINER RPC: bypassa RLS, verifica acesso internamente
      const { data, error } = await anyDb.rpc("get_ocorrencias_paroquia", {
        p_paroquia_id: pid,
        p_status: statusFiltro,
      });
      if (error) throw error;
      // Normaliza: RPC retorna membro_nome flat, componentes esperam membro.nome
      return ((data ?? []) as (Ocorrencia & { membro_nome?: string | null })[]).map((row) => ({
        ...row,
        membro: row.membro_nome ? { nome: row.membro_nome } : null,
      }));
    },
  });

  useSetPageTabs([
    { label: "Eventos",     to: "/formacoes",   isActive: false },
    { label: "Formações",   to: "/formacoes",   isActive: false },
    { label: "Ocorrências", to: "/ocorrencias", isActive: true  },
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto space-y-6 pb-24 lg:pb-10">

      {/* Header */}
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl">Ocorrências</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Comunicações enviadas pelos servidores à coordenação.
        </p>
      </div>

      {/* Filtro por status */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
        {[
          { value: "todas",     label: "Todas" },
          { value: "aberta",    label: "Abertas" },
          { value: "em_analise", label: "Em análise" },
          { value: "resolvida", label: "Resolvidas" },
          { value: "arquivada", label: "Arquivadas" },
        ].map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFiltro(f.value)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              statusFiltro === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : ocorrencias.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium text-foreground/70">Nenhuma ocorrência</p>
          <p className="text-sm text-muted-foreground mt-1">
            {statusFiltro === "todas"
              ? "Nenhuma ocorrência registrada ainda."
              : `Nenhuma ocorrência com status "${STATUS_CONFIG[statusFiltro]?.label ?? statusFiltro}".`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ocorrencias.map((oc) => (
            <OcorrenciaCard
              key={oc.id}
              oc={oc}
              expanded={expandedId === oc.id}
              onToggle={() => setExpandedId(expandedId === oc.id ? null : oc.id)}
              onUpdate={() => {
                qc.invalidateQueries({ queryKey: ["adm-ocorrencias", pid] });
                setExpandedId(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── OcorrenciaCard ─────────────────────────────────────────────────────────────

function OcorrenciaCard({
  oc,
  expanded,
  onToggle,
  onUpdate,
}: {
  oc: Ocorrencia;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: () => void;
}) {
  const statusCfg = STATUS_CONFIG[oc.status] ?? STATUS_CONFIG.aberta;
  const tipo = TIPO_LABELS[oc.tipo] ?? oc.tipo;
  const tipoIcon = TIPO_ICONS[oc.tipo] ?? "📋";
  const nextStatuses = STATUS_FLOW[oc.status] ?? [];

  const [resposta, setResposta] = useState(oc.resposta ?? "");
  const [novoStatus, setNovoStatus] = useState(oc.status);
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setSaving(true);
    try {
      const { error } = await anyDb
        .from("ocorrencias_membros")
        .update({
          resposta: resposta.trim() || null,
          status: novoStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", oc.id);
      if (error) throw error;
      toast.success("Ocorrência atualizada.");
      onUpdate();
    } catch (e) {
      toast.error("Erro ao salvar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const hasChanges =
    resposta.trim() !== (oc.resposta ?? "").trim() || novoStatus !== oc.status;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-altar overflow-hidden">
      {/* Cabeçalho clicável */}
      <button
        className="w-full text-left px-5 py-4"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm">{tipoIcon}</span>
              <span className="text-xs text-muted-foreground">{tipo}</span>
            </div>
            <p className="text-sm font-semibold leading-snug">{oc.titulo}</p>

            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {oc.membro?.nome && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <User className="h-3 w-3" />
                  {oc.membro.nome}
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {format(new Date(oc.created_at), "d 'de' MMM 'de' yyyy", { locale: ptBR })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusCfg.color}`}
            >
              {statusCfg.icon}
              {statusCfg.label}
            </span>
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            }
          </div>
        </div>
      </button>

      {/* Painel de detalhes e resposta */}
      {expanded && (
        <div className="border-t border-border/50 px-5 py-5 space-y-5">

          {/* Descrição do membro */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Descrição
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">{oc.descricao}</p>
          </div>

          {/* Histórico de datas */}
          <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Tag className="h-3 w-3 shrink-0" />
              <span>Criada em {format(new Date(oc.created_at), "d/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
            </div>
            {oc.updated_at !== oc.created_at && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Tag className="h-3 w-3 shrink-0 opacity-0" />
                <span>Atualizada em {format(new Date(oc.updated_at), "d/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
              </div>
            )}
          </div>

          {/* Resposta da coordenação */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Resposta da coordenação
            </Label>
            <textarea
              rows={4}
              placeholder="Escreva uma resposta para o servidor…"
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring resize-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Alterar status */}
          {nextStatuses.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Alterar status
              </Label>
              <Select value={novoStatus} onValueChange={setNovoStatus}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={oc.status}>
                    {STATUS_CONFIG[oc.status]?.label ?? oc.status} (atual)
                  </SelectItem>
                  {nextStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_CONFIG[s]?.label ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={!hasChanges || saving}
              onClick={salvar}
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Send className="h-3.5 w-3.5" />
              }
              Salvar resposta
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggle}
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
