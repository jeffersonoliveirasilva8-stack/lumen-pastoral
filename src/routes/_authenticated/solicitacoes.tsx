import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, UserCheck, UserX, Copy, ExternalLink,
  Clock, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Send, ShieldCheck, AlertCircle, CircleDot,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/solicitacoes")({
  component: SolicitacoesPage,
  head: () => ({ meta: [{ title: "Solicitações — Painel Pastoral" }] }),
});

type Solicitacao = {
  id: string;
  paroquia_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dados_json: Record<string, any>;
  foto_url: string | null;
  status: "pendente" | "aprovado" | "rejeitado";
  aprovado_por: string | null;
  aprovado_em: string | null;
  motivo_rejeicao: string | null;
  created_at: string;
};

const STATUS_CFG = {
  pendente:  { label: "Pendente",  variant: "secondary" as const, icon: Clock },
  aprovado:  { label: "Aprovado",  variant: "default"   as const, icon: CheckCircle2 },
  rejeitado: { label: "Rejeitado", variant: "destructive" as const, icon: XCircle },
} as const;


type MembroStatus = {
  email: string;
  conta_ativada: boolean;
  perfil_completo: boolean;
  ativacao_enviada_em: string | null;
  ativo: boolean;
};

function getStatusMembro(email: string | null, membrosStatus: MembroStatus[]): {
  label: string;
  icon: typeof ShieldCheck;
  classes: string;
} {
  if (!email) return { label: "Ativação pendente", icon: CircleDot, classes: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300" };
  const m = membrosStatus.find((ms) => ms.email?.toLowerCase() === email.toLowerCase());
  if (!m || !m.conta_ativada) return { label: "Ativação pendente", icon: CircleDot, classes: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300" };
  if (!m.perfil_completo) return { label: "Cadastro incompleto", icon: AlertCircle, classes: "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300" };
  return { label: "Ativo", icon: ShieldCheck, classes: "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300" };
}

function SolicitacoesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Solicitacao | null>(null);
  const [motivoRejeicao, setMotivoRejeicao] = useState("");
  const [showMotivo, setShowMotivo] = useState(false);
  const [reenviando, setReenviando]     = useState<string | null>(null);
  const [cooldownMap, setCooldownMap]   = useState<Record<string, number>>({});

  // Decrementa cooldowns ativos a cada segundo
  useEffect(() => {
    const active = Object.values(cooldownMap).some((v) => v > 0);
    if (!active) return;
    const t = setInterval(() => {
      setCooldownMap((prev) => {
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v > 1) next[k] = v - 1;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownMap]);

  // ── Paróquia (para o link de inscrição) ────────────────────────────────
  const { data: paroquia } = useQuery<{ nome: string; slug: string | null; id: string } | null>({
    queryKey: ["paroquia-inscricao-link", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("paroquias")
        .select("id, nome, slug")
        .eq("id", profile!.paroquia_id)
        .maybeSingle();
      return data ?? null;
    },
  });

  const inscricaoUrl = paroquia
    ? `${window.location.origin}/inscricao/${paroquia.slug ?? paroquia.id}`
    : null;

  // ── Listagem de solicitações ───────────────────────────────────────────
  const { data: solicitacoes = [], isLoading } = useQuery<Solicitacao[]>({
    queryKey: ["solicitacoes", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("solicitacoes_membros")
        .select("*")
        .eq("paroquia_id", profile!.paroquia_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const pendentes  = solicitacoes.filter((s) => s.status === "pendente");
  const aprovadas  = solicitacoes.filter((s) => s.status === "aprovado");
  const rejeitadas = solicitacoes.filter((s) => s.status === "rejeitado");

  // ── Status dos membros aprovados (conta_ativada / perfil_completo) ─────
  const { data: membrosStatus = [] } = useQuery<MembroStatus[]>({
    queryKey: ["membros-status", profile?.paroquia_id, aprovadas.map((s) => s.email).join(",")],
    enabled: aprovadas.length > 0,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const emails = aprovadas.map((s) => s.email).filter(Boolean) as string[];
      if (!emails.length) return [];
      const { data } = await anyDb
        .from("membros")
        .select("email, conta_ativada, perfil_completo, ativacao_enviada_em, ativo")
        .in("email", emails);
      return data ?? [];
    },
  });

  // ── Mutation: Aprovar ──────────────────────────────────────────────────
  const aprovarMutation = useMutation({
    mutationFn: async (sol: Solicitacao) => {
      const d = sol.dados_json ?? {};

      // Monta data_ingresso a partir de mês+ano do formulário
      const data_ingresso = d.ingresso_mes && d.ingresso_ano
        ? `${d.ingresso_ano}-${String(d.ingresso_mes).padStart(2, "0")}-01`
        : d.data_ingresso || null;

      // Combina nomes e contatos dos pais
      const nome_pais = [d.nome_mae, d.nome_pai].filter(Boolean).join(" / ") || null;
      const contato_pais = [d.contato_mae, d.contato_pai].filter(Boolean).join(" / ") || null;

      // Condução → deslocamento
      const deslocamento = d.possui_conducao === "sim" ? "Possui condução própria" : null;

      // 1. Cria registro em membros com todos os campos disponíveis
      const { data: novoMembro, error: memberErr } = await anyDb
        .from("membros")
        .insert({
          paroquia_id:     sol.paroquia_id,
          nome:            sol.nome,
          email:           sol.email,
          telefone:        sol.telefone,
          data_nascimento: d.data_nascimento || null,
          data_ingresso,
          tipo_acesso:     "membro",
          ativo:           true,
          score:           0,
          foto_url:        sol.foto_url || null,
          sexo:            d.sexo || null,
          cpf:             d.cpf || null,
          rg:              d.rg || null,
          endereco:        d.endereco || null,
          cidade:          d.cidade || null,
          comunidade_id:   d.comunidade_id || null,
          nome_pais,
          contato_pais,
          deslocamento,
          restricoes_horario: null, // disponibilidade agora é por missa padrão
          observacoes:     [
            d.observacoes,
            d.motivo_indisponibilidade ? `Indisponibilidade: ${d.motivo_indisponibilidade}` : null,
          ].filter(Boolean).join(" | ") || null,
        })
        .select("id, token_acesso")
        .single();
      if (memberErr) throw memberErr;

      // 2. Associa atuações pastorais selecionadas (ex: Acólito, Cerimoniário)
      const atuacao_ids: string[] = Array.isArray(d.atuacao_ids) ? d.atuacao_ids : [];
      if (atuacao_ids.length > 0 && novoMembro?.id) {
        await anyDb
          .from("membro_atuacoes")
          .insert(atuacao_ids.map((aid: string) => ({
            membro_id:   novoMembro.id,
            atuacao_id:  aid,
            paroquia_id: sol.paroquia_id,
          })));
      }

      // 2b. Registra restrições de missas padrão (missas que não consegue servir)
      const missas_nao_pode_ids: string[] = Array.isArray(d.missas_nao_pode_ids) ? d.missas_nao_pode_ids : [];
      if (missas_nao_pode_ids.length > 0 && novoMembro?.id) {
        try {
          await anyDb
            .from("membro_missa_restricoes")
            .insert(missas_nao_pode_ids.map((mid: string) => ({
              membro_id:      novoMembro.id,
              missa_padrao_id: mid,
            })));
        } catch { /* tabela pode não existir — não-fatal */ }
      }

      // 3. Envia e-mail de ativação rico via AccessInvitationService.
      // O link aponta para /membro/primeiro-acesso?token=<token_acesso>.
      if (sol.email && novoMembro?.token_acesso) {
        try {
          const { AccessInvitationService } = await import("@/lib/invitation-service");
          await AccessInvitationService.sendEmail({
            email:       sol.email,
            nome:        sol.nome,
            paroquiaNome: paroquia?.nome ?? "Pastoral",
            tokenAcesso: novoMembro.token_acesso,
            template:    "ativacao_conta",
          });
          await anyDb
            .from("membros")
            .update({ ativacao_enviada_em: new Date().toISOString() })
            .eq("id", novoMembro.id);
        } catch {
          // Não-fatal: coordenador pode reenviar pelo botão "Reenviar ativação"
        }
      }

      // 3. Atualiza status
      const { data: authData } = await supabase.auth.getUser();
      const { error: updErr } = await anyDb
        .from("solicitacoes_membros")
        .update({
          status:       "aprovado",
          aprovado_por: authData.user?.id ?? null,
          aprovado_em:  new Date().toISOString(),
        })
        .eq("id", sol.id);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes", profile?.paroquia_id] });
      qc.invalidateQueries({ queryKey: ["solicitacoes-pendentes-count", profile?.paroquia_id] });
      qc.invalidateQueries({ queryKey: ["membros", profile?.paroquia_id] });
      toast.success("Membro aprovado! Link de acesso enviado por e-mail.");
      setSelected(null);
    },
    onError: (e: Error) => toast.error("Erro ao aprovar: " + e.message),
  });

  // ── Mutation: Rejeitar ─────────────────────────────────────────────────
  const rejeitarMutation = useMutation({
    mutationFn: async ({ sol, motivo }: { sol: Solicitacao; motivo: string }) => {
      const { error } = await anyDb
        .from("solicitacoes_membros")
        .update({
          status:          "rejeitado",
          motivo_rejeicao: motivo.trim() || null,
        })
        .eq("id", sol.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes", profile?.paroquia_id] });
      qc.invalidateQueries({ queryKey: ["solicitacoes-pendentes-count", profile?.paroquia_id] });
      toast.success("Solicitação rejeitada.");
      setSelected(null);
      setShowMotivo(false);
      setMotivoRejeicao("");
    },
    onError: (e: Error) => toast.error("Erro ao rejeitar: " + e.message),
  });

  // ── Reenviar e-mail de ativação ────────────────────────────────────────
  async function reenviarAtivacao(email: string, nome?: string) {
    setReenviando(email);
    try {
      // Busca token_acesso do membro para montar o link /primeiro-acesso?token=
      const { data: memData } = await anyDb
        .from("membros")
        .select("id, token_acesso")
        .eq("email", email)
        .eq("ativo", true)
        .maybeSingle();

      const { AccessInvitationService } = await import("@/lib/invitation-service");

      let ok = false;
      if (memData?.token_acesso) {
        const result = await AccessInvitationService.sendEmail({
          email,
          nome:        nome ?? "",
          paroquiaNome: paroquia?.nome ?? "Pastoral",
          tokenAcesso: memData.token_acesso,
          template:    "reenvio_ativacao",
        });
        ok = result.ok;
        if (!ok) {
          const isRate = (result.error ?? "").toLowerCase().includes("rate");
          toast.error(isRate ? "Aguarde alguns minutos antes de reenviar." : "Erro ao reenviar: " + result.error);
          return;
        }
      } else {
        // Fallback: token_acesso não disponível → envia OTP nativo
        const { error: otpErr } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + "/membro/ativar-conta" },
        });
        if (otpErr) {
          const isRate = otpErr.message.toLowerCase().includes("rate") || otpErr.message.toLowerCase().includes("many");
          toast.error(isRate ? "Aguarde alguns minutos antes de reenviar." : "Erro ao reenviar: " + otpErr.message);
          return;
        }
        ok = true;
      }

      if (ok) {
        await anyDb
          .from("membros")
          .update({ ativacao_enviada_em: new Date().toISOString() })
          .eq("email", email);
        qc.invalidateQueries({ queryKey: ["membros-status", profile?.paroquia_id] });
        setCooldownMap((prev) => ({ ...prev, [email]: 60 }));
        toast.success("E-mail de ativação reenviado!");
      }
    } catch {
      toast.error("Erro de conexão ao reenviar.");
    } finally {
      setReenviando(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Cabeçalho + link de inscrição */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Membros</p>
          <h1 className="font-serif text-3xl mt-1">Solicitações de Cadastro</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analise e aprove pedidos de ingresso na pastoral.
          </p>
        </div>

        {inscricaoUrl && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2 sm:min-w-[280px] sm:max-w-xs shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Link de inscrição
            </p>
            <p className="text-xs text-muted-foreground">
              Compartilhe este link para receber novas inscrições.
            </p>
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2">
              <span className="text-xs text-muted-foreground truncate flex-1 font-mono">{inscricaoUrl}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(inscricaoUrl); toast.success("Link copiado!"); }}
                className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                title="Copiar"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <a
                href={inscricaoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                title="Abrir"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pendentes">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="pendentes" className="gap-1.5">
            Pendentes
            {pendentes.length > 0 && (
              <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-1">
                {pendentes.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="aprovadas">Aprovadas ({aprovadas.length})</TabsTrigger>
          <TabsTrigger value="rejeitadas">Rejeitadas ({rejeitadas.length})</TabsTrigger>
        </TabsList>

        {isLoading ? (
          <div className="flex justify-center py-12 mt-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <TabsContent value="pendentes" className="mt-4">
              <Lista
                itens={pendentes}
                vazio="Nenhuma solicitação pendente. Compartilhe o link de inscrição!"
                onSelecionar={setSelected}
              />
            </TabsContent>
            <TabsContent value="aprovadas" className="mt-4">
              <Lista
                itens={aprovadas}
                vazio="Nenhuma solicitação aprovada ainda."
                onSelecionar={setSelected}
                membrosStatus={membrosStatus}
              />
            </TabsContent>
            <TabsContent value="rejeitadas" className="mt-4">
              <Lista
                itens={rejeitadas}
                vazio="Nenhuma solicitação rejeitada."
                onSelecionar={setSelected}
              />
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* Sheet de detalhe */}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setShowMotivo(false);
            setMotivoRejeicao("");
          }
        }}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle className="font-serif text-xl">Detalhes da Solicitação</SheetTitle>
              </SheetHeader>

              {/* Avatar + dados básicos */}
              <div className="flex items-center gap-4 mb-6">
                {selected.foto_url ? (
                  <img
                    src={selected.foto_url}
                    alt={selected.nome}
                    className="h-16 w-16 rounded-full object-cover border-2 border-border shrink-0"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-2xl font-serif text-muted-foreground shrink-0">
                    {selected.nome.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-lg leading-snug truncate">{selected.nome}</p>
                  {selected.email && (
                    <p className="text-sm text-muted-foreground truncate">{selected.email}</p>
                  )}
                  {selected.telefone && (
                    <p className="text-sm text-muted-foreground">{selected.telefone}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Enviado em {format(new Date(selected.created_at), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                </div>
              </div>

              {/* Seções de dados */}
              <div className="space-y-5">
                <SecaoDados titulo="Dados Pessoais" pares={[
                  { label: "WhatsApp",     value: selected.dados_json?.whatsapp },
                  { label: "Nascimento",   value: selected.dados_json?.data_nascimento
                      ? format(new Date(selected.dados_json.data_nascimento + "T12:00:00"), "d 'de' MMMM 'de' yyyy", { locale: ptBR })
                      : null },
                  { label: "CPF",          value: selected.dados_json?.cpf },
                  { label: "RG",           value: selected.dados_json?.rg },
                  { label: "Endereço",     value: [
                      selected.dados_json?.endereco,
                      selected.dados_json?.bairro,
                      selected.dados_json?.cidade,
                    ].filter(Boolean).join(", ") || null },
                ]} />

                <SecaoDados titulo="Dados Pastorais" pares={[
                  { label: "Comunidade",        value: selected.dados_json?.comunidade },
                  { label: "Com. principal",    value: selected.dados_json?.comunidade_principal },
                  { label: "Atuação",           value: (selected.dados_json?.atuacao_nomes as string[] | undefined)?.join(", ") || null },
                  { label: "Data de ingresso",  value: selected.dados_json?.data_ingresso
                      ? format(new Date(selected.dados_json.data_ingresso + "T12:00:00"), "d 'de' MMMM 'de' yyyy", { locale: ptBR })
                      : null },
                ]} />

                {/* Missas que não consegue servir */}
                {(selected.dados_json?.missas_nao_pode_ids as string[] ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Missas que não consegue servir
                    </p>
                    <p className="text-xs text-foreground">
                      {(selected.dados_json.missas_nao_pode_ids as string[]).length} missa(s) selecionada(s)
                    </p>
                    {selected.dados_json?.motivo_indisponibilidade && (
                      <p className="text-xs text-muted-foreground italic mt-1">{selected.dados_json.motivo_indisponibilidade}</p>
                    )}
                  </div>
                )}

                <SecaoDados titulo="Complementar" pares={[
                  { label: "Responsável",       value: selected.dados_json?.nome_responsavel },
                  { label: "Contato resp.",      value: selected.dados_json?.contato_responsavel },
                  { label: "Condução própria",   value: selected.dados_json?.possui_conducao === "sim" ? "Sim" : selected.dados_json?.possui_conducao === "nao" ? "Não" : null },
                  { label: "Observações",        value: selected.dados_json?.observacoes },
                ]} />

                {/* Ações */}
                {selected.status === "pendente" && (
                  <div className="pt-4 border-t border-border space-y-3">
                    {!showMotivo ? (
                      <div className="flex gap-3">
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl"
                          disabled={aprovarMutation.isPending}
                          onClick={() => aprovarMutation.mutate(selected)}
                        >
                          {aprovarMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <UserCheck className="h-4 w-4" />}
                          Aprovar
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
                          onClick={() => setShowMotivo(true)}
                        >
                          <UserX className="h-4 w-4" />
                          Rejeitar
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-destructive">Rejeitar solicitação</p>
                          <button
                            onClick={() => { setShowMotivo(false); setMotivoRejeicao(""); }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                        </div>
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Motivo (opcional)
                          </label>
                          <textarea
                            rows={3}
                            value={motivoRejeicao}
                            onChange={(e) => setMotivoRejeicao(e.target.value)}
                            placeholder="Ex: dados incompletos, não pertence à pastoral, cadastro duplicado…"
                            className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="flex gap-3">
                          <Button
                            variant="outline"
                            className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/10 rounded-xl"
                            disabled={rejeitarMutation.isPending}
                            onClick={() => rejeitarMutation.mutate({ sol: selected, motivo: motivoRejeicao })}
                          >
                            {rejeitarMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            Confirmar rejeição
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => { setShowMotivo(false); setMotivoRejeicao(""); }}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}

                    {!selected.email && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        ⚠ Este solicitante não informou e-mail. Ao aprovar, o acesso precisará
                        ser enviado manualmente.
                      </p>
                    )}
                  </div>
                )}

                {selected.status === "aprovado" && (() => {
                  const status = getStatusMembro(selected.email, membrosStatus);
                  const mStatus = membrosStatus.find((ms) => ms.email?.toLowerCase() === selected.email?.toLowerCase());
                  const StatusIcon = status.icon;
                  return (
                    <div className="space-y-3 pt-4 border-t border-border">
                      {/* Status da conta */}
                      <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${status.classes}`}>
                        <StatusIcon className="h-4 w-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{status.label}</span>
                          {mStatus?.ativacao_enviada_em && (
                            <span className="block text-xs opacity-70 mt-0.5">
                              Ativação enviada em{" "}
                              {format(new Date(mStatus.ativacao_enviada_em), "d MMM yyyy 'às' HH:mm", { locale: ptBR })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Aprovado em */}
                      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-300">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>
                          Aprovado em{" "}
                          {selected.aprovado_em
                            ? format(new Date(selected.aprovado_em), "d 'de' MMMM 'de' yyyy", { locale: ptBR })
                            : "data desconhecida"}
                        </span>
                      </div>

                      {/* Reenviar ativação — só quando conta não foi ativada */}
                      {selected.email && (!mStatus || !mStatus.conta_ativada) && (() => {
                        const cd = cooldownMap[selected.email] ?? 0;
                        const busy = reenviando === selected.email;
                        return (
                          <Button
                            variant="outline"
                            className="w-full rounded-xl border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                            disabled={busy || cd > 0}
                            onClick={() => reenviarAtivacao(selected.email!, selected.nome)}
                          >
                            {busy
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Send className="h-4 w-4" />}
                            {cd > 0 ? `Reenviar em ${cd}s` : "Reenviar ativação"}
                          </Button>
                        );
                      })()}
                    </div>
                  );
                })()}

                {selected.status === "rejeitado" && (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive space-y-1">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 shrink-0" />
                      <span className="font-medium">Solicitação rejeitada</span>
                    </div>
                    {selected.motivo_rejeicao && (
                      <p className="text-xs opacity-80 ml-6">{selected.motivo_rejeicao}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Lista de solicitações ──────────────────────────────────────────────

function Lista({
  itens, vazio, onSelecionar, membrosStatus = [],
}: {
  itens: Solicitacao[];
  vazio: string;
  onSelecionar: (s: Solicitacao) => void;
  membrosStatus?: MembroStatus[];
}) {
  if (itens.length === 0) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">{vazio}</p>
      </div>
    );
  }

  return (
    <div className="rounded-[1.75rem] border border-border bg-card overflow-hidden divide-y divide-border">
      {itens.map((sol) => {
        const cfg = STATUS_CFG[sol.status];
        return (
          <button
            key={sol.id}
            className="w-full text-left px-4 py-3.5 hover:bg-muted/50 transition flex items-center gap-3"
            onClick={() => onSelecionar(sol)}
          >
            {sol.foto_url ? (
              <img
                src={sol.foto_url}
                alt={sol.nome}
                className="h-10 w-10 rounded-full object-cover border border-border shrink-0"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold shrink-0 text-muted-foreground">
                {sol.nome.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-snug">{sol.nome}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {sol.email && (
                  <span className="text-xs text-muted-foreground truncate">{sol.email}</span>
                )}
                {sol.telefone && (
                  <span className="text-xs text-muted-foreground">{sol.telefone}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {sol.dados_json?.comunidade ? `${sol.dados_json.comunidade} · ` : ""}
                {format(new Date(sol.created_at), "d MMM yyyy", { locale: ptBR })}
              </p>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Badge variant={cfg.variant} className="text-[10px]">
                {cfg.label}
              </Badge>
              {sol.status === "aprovado" && membrosStatus.length > 0 && (() => {
                const ms = getStatusMembro(sol.email, membrosStatus);
                const MsIcon = ms.icon;
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${ms.classes}`}>
                    <MsIcon className="h-2.5 w-2.5 shrink-0" />
                    {ms.label}
                  </span>
                );
              })()}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground rotate-[-90deg]" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Seção de dados no Sheet ────────────────────────────────────────────

function SecaoDados({
  titulo,
  pares,
}: {
  titulo: string;
  pares: { label: string; value: string | null | undefined }[];
}) {
  const visiveis = pares.filter((p) => p.value);
  if (!visiveis.length) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {titulo}
      </p>
      <div className="rounded-xl border border-border bg-background/70 divide-y divide-border overflow-hidden">
        {visiveis.map(({ label, value }) => (
          <div key={label} className="px-3 py-2.5 flex gap-3">
            <span className="text-xs text-muted-foreground shrink-0 w-32">{label}</span>
            <span className="text-xs text-foreground break-words flex-1">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
