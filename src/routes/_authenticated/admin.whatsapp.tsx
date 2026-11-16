import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  MessageCircle, Users, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Loader2, Send, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/admin/whatsapp")({
  component: AdminWhatsAppPage,
  head: () => ({ meta: [{ title: "WhatsApp — Lumen" }] }),
});

// ── Tipos ─────────────────────────────────────────────────────────────────────

type EscalaItem = {
  data_escala:  string;
  hora_escala?: string;
  celebracao?:  string;
  ministerio:   string;
  local?:       string;
};

type MensagemPrevia = {
  membro_id:     string;
  nome_completo: string;
  escalas_count: number;
  context: {
    nome_membro:   string;
    paroquia_nome: string;
    escalas:       EscalaItem[];
    operacao_id:   string;
  };
};

type PreviewResult = {
  operacao_id:                      string;
  paroquia_id:                      string;
  paroquia_nome:                    string;
  total_membros:                    number;
  elegiveis:                        number;
  sem_consentimento_ou_telefone:    number;
  total_mensagens:                  number;
  mensagens:                        MensagemPrevia[];
};

type DisparoResult = {
  enfileiradas: number;
  duplicadas:   number;
  ignoradas:    number;
};

// ── Componente mensagem individual ────────────────────────────────────────────

function MensagemCard({ msg }: { msg: MensagemPrevia }) {
  const [expanded, setExpanded] = useState(false);

  const texto = renderMensagem(msg.context);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{msg.nome_completo}</span>
          <span className="text-xs bg-blue-100 text-blue-800 rounded-full px-2 py-0.5">
            {msg.escalas_count} escala{msg.escalas_count !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t bg-muted/20">
          <pre className="text-xs whitespace-pre-wrap font-mono mt-3 bg-background border rounded p-3 leading-relaxed">
            {texto}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Renderização local da mensagem (espelha whatsapp-contracts.ts) ────────────

function renderMensagem(ctx: MensagemPrevia["context"]): string {
  const linhas: string[] = [
    `Paz e bem, ${ctx.nome_membro}! 🙏`,
    "",
    `Aqui estão as suas próximas escalas de serviço na *${ctx.paroquia_nome}*:`,
    "",
  ];

  ctx.escalas.forEach((e, i) => {
    linhas.push(`📅 *${i + 1}. ${e.data_escala}*${e.hora_escala ? ` às ${e.hora_escala}` : ""}`);
    if (e.celebracao) linhas.push(`   Celebração: ${e.celebracao}`);
    linhas.push(`   Ministério: ${e.ministerio}`);
    if (e.local) linhas.push(`   Local: ${e.local}`);
    linhas.push("");
  });

  linhas.push("Que o Senhor abençoe o seu serviço! 🙌");

  return linhas.join("\n");
}

// ── Página principal ──────────────────────────────────────────────────────────

function AdminWhatsAppPage() {
  const { profile, isAdmin, isCoordenador, isSuperAdmin } = useAuth();
  const podeDisparar = isAdmin || isCoordenador || isSuperAdmin;
  const paroquiaId = profile?.paroquia_id;

  const [preview, setPreview]           = useState<PreviewResult | null>(null);
  const [confirmarOpen, setConfirmarOpen] = useState(false);
  const [disparoResult, setDisparoResult] = useState<DisparoResult | null>(null);

  // ── Prévia ──────────────────────────────────────────────────────────────────

  const previewMutation = useMutation<PreviewResult, Error>({
    mutationFn: async () => {
      if (!paroquiaId) throw new Error("Perfil sem paróquia");
      const { data, error } = await anyDb.rpc("wa_preview_escalas_consolidadas", {
        p_paroquia_id: paroquiaId,
      });
      if (error) throw error;
      return data as PreviewResult;
    },
    onSuccess: (data) => {
      setPreview(data);
      setDisparoResult(null);
    },
    onError: (err) => {
      toast.error("Erro ao gerar prévia", { description: err.message });
    },
  });

  // ── Disparo ─────────────────────────────────────────────────────────────────

  const disparoMutation = useMutation<DisparoResult, Error>({
    mutationFn: async () => {
      if (!paroquiaId || !preview?.operacao_id) throw new Error("Dados ausentes");
      const { data, error } = await anyDb.rpc("wa_disparar_escalas_consolidadas", {
        p_paroquia_id: paroquiaId,
        p_operacao_id: preview.operacao_id,
      });
      if (error) throw error;
      // RPC retorna TABLE — Supabase retorna array de 1 linha
      const row = Array.isArray(data) ? data[0] : data;
      return row as DisparoResult;
    },
    onSuccess: (result) => {
      setConfirmarOpen(false);
      setDisparoResult(result);
      toast.success("Disparo enfileirado!", {
        description: `${result.enfileiradas} mensagen${result.enfileiradas !== 1 ? "s" : ""} enfileirada${result.enfileiradas !== 1 ? "s" : ""}`,
      });
    },
    onError: (err) => {
      setConfirmarOpen(false);
      toast.error("Erro no disparo", { description: err.message });
    },
  });

  // ── Guard ───────────────────────────────────────────────────────────────────

  if (!podeDisparar) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <MessageCircle className="h-7 w-7 text-green-600" />
        <div>
          <h1 className="text-2xl font-semibold">Disparo consolidado de escalas</h1>
          <p className="text-sm text-muted-foreground">
            Envia uma mensagem por membro com todas as suas próximas escalas publicadas.
          </p>
        </div>
      </div>

      {/* Aviso operacional */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          O disparo enfileira mensagens para processamento pelo worker. O modo de envio (simulação ou produção) é definido pela configuração do servidor — confirme com o administrador técnico antes de disparar em produção.
        </span>
      </div>

      {/* Resultado de um disparo anterior */}
      {disparoResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium text-green-800">
            <CheckCircle2 className="h-4 w-4" />
            Disparo concluído — operação {preview?.operacao_id?.slice(0, 8)}…
          </div>
          <ul className="ml-6 list-disc text-green-700 space-y-0.5">
            <li>{disparoResult.enfileiradas} mensagem(ns) enfileirada(s)</li>
            {disparoResult.duplicadas > 0 && <li>{disparoResult.duplicadas} duplicata(s) ignorada(s) — idempotente</li>}
            {disparoResult.ignoradas  > 0 && <li>{disparoResult.ignoradas} membro(s) sem escalas no momento da consulta</li>}
          </ul>
        </div>
      )}

      {/* Botão gerar prévia */}
      <div className="flex gap-3">
        <Button
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
          variant="outline"
          className="gap-2"
        >
          {previewMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Eye className="h-4 w-4" />}
          Gerar prévia
        </Button>
      </div>

      {/* Resultado da prévia */}
      {preview && (
        <div className="space-y-6">

          {/* Sumário */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total membros"       value={preview.total_membros} />
            <StatCard label="Elegíveis"            value={preview.elegiveis} accent="green" />
            <StatCard label="Sem consentimento"    value={preview.sem_consentimento_ou_telefone} accent="amber" />
            <StatCard label="Mensagens a enviar"   value={preview.total_mensagens} accent="blue" />
          </div>

          <p className="text-xs text-muted-foreground">
            Operação: <code className="font-mono">{preview.operacao_id}</code>
          </p>

          {/* Lista de mensagens */}
          {preview.mensagens.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Prévia das mensagens ({preview.mensagens.length})
              </h2>
              {preview.mensagens.map(msg => (
                <MensagemCard key={msg.membro_id} msg={msg} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum membro elegível encontrado para esta paróquia.
            </p>
          )}

          {/* Botão confirmar disparo — oculto após disparo concluído desta prévia */}
          {preview.elegiveis > 0 && !disparoResult && (
            <div className="pt-2">
              <Button
                onClick={() => setConfirmarOpen(true)}
                disabled={disparoMutation.isPending}
                className="gap-2 bg-green-600 hover:bg-green-700 text-white"
              >
                <Send className="h-4 w-4" />
                Confirmar disparo ({preview.elegiveis} mensagem{preview.elegiveis !== 1 ? "s" : ""})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Dialog de confirmação */}
      <AlertDialog open={confirmarOpen} onOpenChange={setConfirmarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar disparo consolidado</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Esta ação enfileirará <strong>{preview?.elegiveis}</strong> mensagem
                  {preview?.elegiveis !== 1 ? "s" : ""} WhatsApp — uma por membro elegível
                  com todas as suas próximas escalas publicadas.
                </p>
                <p>
                  Operação: <code className="font-mono text-xs">{preview?.operacao_id}</code>
                </p>
                <p className="text-amber-700">
                  A operação é idempotente: redespachar o mesmo ID não criará duplicatas.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disparoMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disparoMutation.mutate()}
              disabled={disparoMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {disparoMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enfileirando…</>
                : "Confirmar disparo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

// ── Stat card helper ──────────────────────────────────────────────────────────

function StatCard({
  label, value, accent = "default",
}: {
  label: string;
  value: number;
  accent?: "green" | "amber" | "blue" | "default";
}) {
  const colors = {
    default: "bg-muted/40",
    green:   "bg-green-50 text-green-800",
    amber:   "bg-amber-50 text-amber-800",
    blue:    "bg-blue-50 text-blue-800",
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[accent]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
