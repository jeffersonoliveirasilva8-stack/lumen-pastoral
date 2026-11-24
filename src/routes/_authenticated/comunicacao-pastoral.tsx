import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import {
  MessageSquare, Send, Clock, Users, User, CalendarRange,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp,
  Loader2, ShieldOff, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/comunicacao-pastoral")({
  component: ComunicacaoPastoralPage,
  head: () => ({ meta: [{ title: "Comunicação Pastoral — Lumen Pastoral" }] }),
});

type Mensagem = {
  id: string;
  mensagem: string;
  total_destinatarios: number;
  total_enviados: number;
  total_falhas: number;
  criado_em: string;
  remetente_nome: string;
  destinatario_tipo: "individual" | "ministerio" | "escala" | "atuacao" | "todos";
  destinatario_label: string;
};

type Ministerio = { id: string; nome: string };
type Atuacao = { id: string; nome: string };
type Escala     = { id: string; titulo: string; data: string };
type Membro     = { id: string; nome: string };

type SegmentoTipo = "todos" | "membro" | "ministerio" | "escala" | "atuacao";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ enviados, falhas, total }: { enviados: number; falhas: number; total: number }) {
  if (total === 0) return <Badge variant="outline" className="text-xs">0 destinatários</Badge>;
  if (falhas > 0 && enviados < total)
    return <Badge variant="destructive" className="text-xs gap-1"><AlertCircle className="w-3 h-3" />{enviados}/{total} enviados</Badge>;
  if (enviados >= total)
    return <Badge className="bg-green-600 text-xs gap-1"><CheckCircle2 className="w-3 h-3" />{enviados} enviados</Badge>;
  return <Badge variant="secondary" className="text-xs"><Clock className="w-3 h-3 mr-1" />Aguardando</Badge>;
}

// ── Ícone do segmento ─────────────────────────────────────────────────────────

function SegmentoIcon({ tipo }: { tipo: string }) {
  if (tipo === "individual") return <User className="w-3.5 h-3.5 text-muted-foreground" />;
  if (tipo === "ministerio") return <Users className="w-3.5 h-3.5 text-muted-foreground" />;
  if (tipo === "escala")     return <CalendarRange className="w-3.5 h-3.5 text-muted-foreground" />;
  if (tipo === "atuacao")    return <Users className="w-3.5 h-3.5 text-muted-foreground" />;
  return <Users className="w-3.5 h-3.5 text-muted-foreground" />;
}

// ── Formulário de envio ───────────────────────────────────────────────────────

function FormularioEnvio({ paroquiaId, remetenteNome }: { paroquiaId: string; remetenteNome: string }) {
  const qc = useQueryClient();
  const [mensagem, setMensagem]         = useState("");
  const [segmento, setSegmento]         = useState<SegmentoTipo>("todos");
  const [membroId, setMembroId]         = useState<string>("");
  const [ministerioId, setMinisterioId] = useState<string>("");
  const [escalaId, setEscalaId]         = useState<string>("");
  const [atuacaoId, setAtuacaoId]       = useState<string>("");
  const [confirming, setConfirming]     = useState(false);
  const [showPreview, setShowPreview]   = useState(false);
  const sendingRef                      = useRef(false);

  const { data: membros = [] } = useQuery<Membro[]>({
    queryKey: ["cp-membros", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("membros")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .eq("whatsapp_opt_in", true)
        .order("nome");
      return data ?? [];
    },
    enabled: segmento === "membro",
  });

  const { data: ministerios = [] } = useQuery<Ministerio[]>({
    queryKey: ["cp-ministerios", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("ministerios")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return data ?? [];
    },
    enabled: segmento === "ministerio",
  });

  const { data: escalas = [] } = useQuery<Escala[]>({
    queryKey: ["cp-escalas", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("escalas")
        .select("id, titulo, data")
        .eq("paroquia_id", paroquiaId)
        .eq("status", "publicada")
        .gte("data", new Date().toISOString().slice(0, 10))
        .order("data")
        .limit(30);
      return data ?? [];
    },
    enabled: segmento === "escala",
  });

  const { data: atuacoes = [] } = useQuery<Atuacao[]>({
    queryKey: ["cp-atuacoes", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
    enabled: segmento === "atuacao",
  });

  const enviarMutation = useMutation({
    mutationFn: async () => {
      if (sendingRef.current) throw new Error("Envio já em andamento");
      sendingRef.current = true;
      try {
        const { data, error } = await anyDb.rpc("coord_enviar_aviso_pastoral", {
          p_paroquia_id:                paroquiaId,
          p_mensagem:                   mensagem.trim(),
          p_destinatario_membro_id:     segmento === "membro"     ? membroId     : null,
          p_destinatario_ministerio_id: segmento === "ministerio" ? ministerioId : null,
          p_destinatario_escala_id:     segmento === "escala"     ? escalaId     : null,
          p_destinatario_atuacao_id:    segmento === "atuacao"    ? atuacaoId    : null,
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error ?? "Erro desconhecido");
        return data;
      } finally {
        sendingRef.current = false;
      }
    },
    onSuccess: (data) => {
      toast.success(`Aviso encaminhado para processamento: ${data.total} destinatário(s).`);
      setMensagem("");
      setSegmento("todos");
      setMembroId("");
      setMinisterioId("");
      setEscalaId("");
      setAtuacaoId("");
      qc.invalidateQueries({ queryKey: ["cp-historico", paroquiaId] });
    },
    onError: (err: any) => {
      toast.error(`Erro ao enviar: ${err.message}`);
    },
  });

  const podeEnviar =
    mensagem.trim().length > 0 &&
    (segmento === "todos" ||
      (segmento === "membro"     && membroId)     ||
      (segmento === "ministerio" && ministerioId) ||
      (segmento === "escala"     && escalaId)     ||
      (segmento === "atuacao"    && atuacaoId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          Novo Aviso Pastoral
        </CardTitle>
        <CardDescription>
          Envie uma mensagem via WhatsApp para membros com consentimento ativo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Segmento */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Destinatários</label>
          <Select value={segmento} onValueChange={(v) => setSegmento(v as SegmentoTipo)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os membros com WhatsApp</SelectItem>
              <SelectItem value="membro">Membro específico</SelectItem>
              <SelectItem value="ministerio">Por função</SelectItem>
              <SelectItem value="escala">Por escala</SelectItem>
              <SelectItem value="atuacao">Por atuação</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {segmento === "membro" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Membro</label>
            <Select value={membroId} onValueChange={setMembroId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o membro…" />
              </SelectTrigger>
              <SelectContent>
                {membros.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {segmento === "ministerio" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ministério</label>
            <Select value={ministerioId} onValueChange={setMinisterioId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o ministério…" />
              </SelectTrigger>
              <SelectContent>
                {ministerios.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {segmento === "escala" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Escala</label>
            <Select value={escalaId} onValueChange={setEscalaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a escala…" />
              </SelectTrigger>
              <SelectContent>
                {escalas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.titulo} — {format(new Date(e.data + "T00:00:00"), "dd/MM/yyyy")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {segmento === "atuacao" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Atuação pastoral</label>
            <Select value={atuacaoId} onValueChange={setAtuacaoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a atuação…" />
              </SelectTrigger>
              <SelectContent>
                {atuacoes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {atuacoes.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma atuação ativa cadastrada nesta paróquia.</p>
            )}
          </div>
        )}

        {/* Mensagem */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Mensagem</label>
          <Textarea
            placeholder="Escreva seu aviso pastoral aqui…"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={5}
            maxLength={1000}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground text-right">
            {mensagem.length}/1000 caracteres
          </p>
        </div>

        {/* Prévia da mensagem WhatsApp */}
        {showPreview && mensagem.trim() && (
          <div className="rounded-lg border bg-[#dcf8c6] dark:bg-[#1a4731] p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-1">Prévia da mensagem</p>
            <p className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
              {`Paz e bem, ${segmento === "membro" && membros.find(m => m.id === membroId)?.nome || "Membro"}! 🙏\n\n${mensagem.trim()}\n\n— ${remetenteNome}`}
            </p>
            <p className="text-xs text-muted-foreground">*Formato ilustrativo. A mensagem real inclui saudação e assinatura completa.*</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={!mensagem.trim()}
            onClick={() => setShowPreview((v) => !v)}
          >
            <Eye className="w-3.5 h-3.5" />
            {showPreview ? "Ocultar prévia" : "Ver prévia"}
          </Button>

          <Button
            className="flex-1 gap-2"
            disabled={!podeEnviar || enviarMutation.isPending}
            onClick={() => setConfirming(true)}
          >
            {enviarMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando…</>
              : <><Send className="w-4 h-4" /> Enviar via WhatsApp</>}
          </Button>
        </div>

        {/* AlertDialog de confirmação */}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar envio</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    <strong>Destinatários:</strong>{" "}
                    {segmento === "todos"       && "Todos os membros com WhatsApp ativo"}
                    {segmento === "membro"      && (membros.find(m => m.id === membroId)?.nome ?? "Membro selecionado")}
                    {segmento === "ministerio"  && (ministerios.find(m => m.id === ministerioId)?.nome ?? "Função selecionada")}
                    {segmento === "escala"      && (escalas.find(e => e.id === escalaId)?.titulo ?? "Escala selecionada")}
                    {segmento === "atuacao"     && (atuacoes.find(a => a.id === atuacaoId)?.nome ?? "Atuação selecionada")}
                  </p>
                  <p><strong>Mensagem:</strong></p>
                  <p className="rounded bg-muted px-3 py-2 text-foreground whitespace-pre-wrap">{mensagem.trim()}</p>
                  <p className="text-destructive font-medium">
                    Esta ação é irreversível. Os membros receberão o aviso imediatamente.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirming(false);
                  enviarMutation.mutate();
                }}
              >
                Confirmar envio
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// ── Card de mensagem do histórico ─────────────────────────────────────────────

function MensagemCard({ msg }: { msg: Mensagem }) {
  const [open, setOpen] = useState(false);
  const { data: destinatarios = [], isLoading } = useQuery({
    queryKey: ["cp-destinatarios", msg.id],
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunicacao_pastoral_destinatarios")
        .select("id, membro_id, status, motivo, membros(nome)")
        .eq("mensagem_id", msg.id)
        .order("criado_em");
      return (data ?? []) as Array<{ id: string; membro_id: string; status: string; motivo: string | null; membros: { nome: string } | null }>;
    },
    enabled: open,
  });

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg select-none">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusBadge
                    enviados={msg.total_enviados}
                    falhas={msg.total_falhas}
                    total={msg.total_destinatarios}
                  />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <SegmentoIcon tipo={msg.destinatario_tipo} />
                    {msg.destinatario_label}
                  </span>
                </div>
                <p className="text-sm line-clamp-2 text-foreground">{msg.mensagem}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {msg.remetente_nome} · {format(new Date(msg.criado_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </p>
              </div>
              {open
                ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="border-t pt-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Destinatários
              </p>
              {isLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!isLoading && destinatarios.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-sm py-0.5">
                  {d.status === "enviado"  && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                  {d.status === "falha"    && <XCircle      className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  {d.status === "pulado"   && <AlertCircle  className="w-3.5 h-3.5 text-yellow-500 shrink-0" />}
                  {d.status === "pending"  && <Clock        className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="flex-1 truncate">{d.membros?.nome ?? d.membro_id}</span>
                  {d.motivo && (
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">{d.motivo}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const PERFIS_AUTORIZADOS = ["coordenador", "admin_paroquial", "super_admin"];

function ComunicacaoPastoralPage() {
  const { profile, roles } = useAuth();
  const paroquiaId = profile?.paroquia_id ?? undefined;
  const remetenteNome = profile?.nome_completo ?? "";
  const temPermissao = roles.some((role) => PERFIS_AUTORIZADOS.includes(role));

  const { data: historico = [], isLoading } = useQuery<Mensagem[]>({
    queryKey: ["cp-historico", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunicacao_pastoral_mensagens")
        .select(`
          id,
          mensagem,
          total_destinatarios,
          total_enviados,
          total_falhas,
          criado_em,
          remetente:membros!remetente_id(nome),
          destinatario_membro_id,
          destinatario_ministerio_id,
          destinatario_escala_id,
          destinatario_atuacao_id,
          membro_dest:membros!destinatario_membro_id(nome),
          min_dest:ministerios!destinatario_ministerio_id(nome),
          esc_dest:escalas!destinatario_escala_id(titulo, data),
          atuacao_dest:atuacoes_pastorais!destinatario_atuacao_id(nome)
        `)
        .eq("paroquia_id", paroquiaId!)
        .order("criado_em", { ascending: false })
        .limit(50);

      return (data ?? []).map((row: any) => ({
        id:                   row.id,
        mensagem:             row.mensagem,
        total_destinatarios:  row.total_destinatarios,
        total_enviados:       row.total_enviados,
        total_falhas:         row.total_falhas,
        criado_em:            row.criado_em,
        remetente_nome:       row.remetente?.nome ?? "—",
        destinatario_tipo:    row.destinatario_membro_id
          ? "individual"
          : row.destinatario_ministerio_id
          ? "ministerio"
          : row.destinatario_escala_id
          ? "escala"
          : row.destinatario_atuacao_id
          ? "atuacao"
          : "todos",
        destinatario_label:   row.destinatario_membro_id
          ? (row.membro_dest?.nome ?? "Membro")
          : row.destinatario_ministerio_id
          ? (row.min_dest?.nome ?? "Ministério")
          : row.destinatario_escala_id
          ? `${row.esc_dest?.titulo ?? "Escala"} — ${row.esc_dest?.data ? format(new Date(row.esc_dest.data + "T00:00:00"), "dd/MM") : ""}`
          : row.destinatario_atuacao_id
          ? (row.atuacao_dest?.nome ?? "Atuação")
          : "Todos os membros",
      }));
    },
    enabled: !!paroquiaId,
  });

  if (!paroquiaId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="font-medium">Paróquia não identificada</p>
            <p className="text-sm text-muted-foreground">Não foi possível carregar os dados da sua paróquia. Atualize a página; se o problema persistir, procure o administrador do sistema.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Comunicação Pastoral</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Envie avisos pastorais via WhatsApp para membros da comunidade.
        </p>
      </div>

      {!temPermissao ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ShieldOff className="w-10 h-10 text-muted-foreground" />
            <p className="font-medium">Acesso restrito</p>
            <p className="text-sm text-muted-foreground">
              Apenas coordenadores e administradores podem enviar comunicados pastorais.
            </p>
          </CardContent>
        </Card>
      ) : (
        <FormularioEnvio paroquiaId={paroquiaId} remetenteNome={remetenteNome} />
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          Histórico de envios
        </h2>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && historico.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              Nenhum aviso pastoral enviado ainda.
            </CardContent>
          </Card>
        )}

        {!isLoading && historico.map((msg) => (
          <MensagemCard key={msg.id} msg={msg} />
        ))}
      </div>
    </div>
  );
}

