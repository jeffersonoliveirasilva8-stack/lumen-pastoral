import { createFileRoute } from "@tanstack/react-router";
import { ListSkeleton } from "@/components/ui/page-skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2, Calendar, MapPin, Star, CheckCircle2, XCircle, Clock,
  GraduationCap, ChevronDown, ChevronUp,
} from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/eventos")({
  component: PortalMembroEventos,
  head: () => ({ meta: [{ title: "Eventos — Portal do Servidor" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Evento = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: string;
  data_inicio: string;
  data_fim: string | null;
  local: string | null;
  pontuacao: number;
  obrigatorio: boolean;
};

type MinhaPresenca = {
  id: string;
  evento_id: string;
  presente: boolean | null;
  justificativa: string | null;
  pontuacao_recebida: number | null;
};

const TIPOS: Record<string, { label: string; cor: string }> = {
  formacao:    { label: "Formação",             cor: "bg-blue-500/10 text-blue-700 border-blue-200" },
  reuniao:     { label: "Reunião",              cor: "bg-slate-500/10 text-slate-700 border-slate-200" },
  retiro:      { label: "Retiro",               cor: "bg-purple-500/10 text-purple-700 border-purple-200" },
  evento:      { label: "Evento",               cor: "bg-amber-500/10 text-amber-700 border-amber-200" },
  ensaio:      { label: "Ensaio",               cor: "bg-green-500/10 text-green-700 border-green-200" },
  encontro:    { label: "Encontro",             cor: "bg-cyan-500/10 text-cyan-700 border-cyan-200" },
  compromisso: { label: "Compromisso Pastoral", cor: "bg-rose-500/10 text-rose-700 border-rose-200" },
  adoracao:    { label: "Adoração",             cor: "bg-yellow-500/10 text-yellow-700 border-yellow-200" },
  outro:       { label: "Outro",                cor: "bg-gray-500/10 text-gray-700 border-gray-200" },
};

// ── Main Component ─────────────────────────────────────────────────────────────

function PortalMembroEventos() {
  const { membro } = useMembroAuth();
  const qc = useQueryClient();
  const [expandedJust, setExpandedJust] = useState<string | null>(null);

  const { data: eventos = [], isLoading } = useQuery<Evento[]>({
    queryKey: ["portal-eventos", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("formacoes_eventos")
        .select("id,titulo,descricao,tipo,data_inicio,data_fim,local,pontuacao,obrigatorio")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .order("data_inicio", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Evento[];
    },
  });

  const { data: minhasPresencas = [], isLoading: loadingPresencas } = useQuery<MinhaPresenca[]>({
    queryKey: ["portal-minhas-presencas", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("presencas_eventos")
        .select("id,evento_id,presente,justificativa,pontuacao_recebida")
        .eq("membro_id", membro!.id);
      if (error) throw error;
      return (data ?? []) as MinhaPresenca[];
    },
  });

  const presencaMap = new Map(minhasPresencas.map((p) => [p.evento_id, p]));

  const confirmarMutation = useMutation({
    mutationFn: async (eventoId: string) => {
      const existing = presencaMap.get(eventoId);
      if (existing) {
        const { error } = await anyDb
          .from("presencas_eventos")
          .update({ presente: null, justificativa: null })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb
          .from("presencas_eventos")
          .insert({ evento_id: eventoId, membro_id: membro!.id, presente: null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-minhas-presencas", membro?.id] });
      toast.success("Presença confirmada!");
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const declinarMutation = useMutation({
    mutationFn: async ({ eventoId, justificativa }: { eventoId: string; justificativa: string }) => {
      if (!justificativa.trim()) throw new Error("Justificativa obrigatória.");
      const existing = presencaMap.get(eventoId);
      if (existing) {
        const { error } = await anyDb
          .from("presencas_eventos")
          .update({ presente: false, justificativa })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb
          .from("presencas_eventos")
          .insert({
            evento_id: eventoId,
            membro_id: membro!.id,
            presente: false,
            justificativa,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-minhas-presencas", membro?.id] });
      setExpandedJust(null);
      toast.success("Ausência registrada.");
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  if (!membro) return null;

  const proximos = eventos.filter((e) => !isPast(parseISO(e.data_inicio)));
  const passados = eventos.filter((e) => isPast(parseISO(e.data_inicio)));

  const loading = isLoading || loadingPresencas;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6 pb-24">
      <div>
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
        <h1 className="mt-1.5 font-serif text-3xl">Eventos e Formações</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Confirme sua presença ou registre ausência com justificativa.
        </p>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : eventos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <GraduationCap className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium text-foreground">Nenhum evento disponível</p>
          <p className="text-sm text-muted-foreground mt-1">
            Em breve novos eventos serão publicados.
          </p>
        </div>
      ) : (
        <>
          {proximos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Próximos eventos
              </h2>
              <div className="space-y-3">
                {proximos.map((evento) => (
                  <EventoCard
                    key={evento.id}
                    evento={evento}
                    presenca={presencaMap.get(evento.id)}
                    expandedJust={expandedJust}
                    onExpandJust={setExpandedJust}
                    onConfirmar={() => confirmarMutation.mutate(evento.id)}
                    onDeclinar={(just) => declinarMutation.mutate({ eventoId: evento.id, justificativa: just })}
                    isPast={false}
                    mutationPending={confirmarMutation.isPending || declinarMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {passados.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Eventos realizados
              </h2>
              <div className="space-y-3">
                {passados.map((evento) => (
                  <EventoCard
                    key={evento.id}
                    evento={evento}
                    presenca={presencaMap.get(evento.id)}
                    expandedJust={expandedJust}
                    onExpandJust={setExpandedJust}
                    onConfirmar={() => confirmarMutation.mutate(evento.id)}
                    onDeclinar={(just) => declinarMutation.mutate({ eventoId: evento.id, justificativa: just })}
                    isPast={true}
                    mutationPending={confirmarMutation.isPending || declinarMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── EventoCard ─────────────────────────────────────────────────────────────────

function EventoCard({
  evento,
  presenca,
  expandedJust,
  onExpandJust,
  onConfirmar,
  onDeclinar,
  isPast,
  mutationPending,
}: {
  evento: Evento;
  presenca: MinhaPresenca | undefined;
  expandedJust: string | null;
  onExpandJust: (id: string | null) => void;
  onConfirmar: () => void;
  onDeclinar: (just: string) => void;
  isPast: boolean;
  mutationPending: boolean;
}) {
  const [just, setJust] = useState("");
  const tipo = TIPOS[evento.tipo] ?? TIPOS.outro;

  const dataFormatada = format(parseISO(evento.data_inicio), "d 'de' MMMM, HH:mm", { locale: ptBR });
  const isJustExpanded = expandedJust === evento.id;

  // Determine my status
  const status: "confirmado" | "ausente" | "sem_resposta" | "presente" | "falta" =
    isPast && presenca?.presente === true ? "presente" :
    isPast && presenca?.presente === false ? "falta" :
    !isPast && presenca !== undefined && presenca.presente === null ? "confirmado" :
    !isPast && presenca?.presente === false ? "ausente" :
    "sem_resposta";

  const statusUI = {
    confirmado:   { label: "Confirmado", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-300" },
    ausente:      { label: "Ausência registrada", cls: "bg-red-500/10 text-red-700 border-red-300" },
    sem_resposta: { label: "Aguardando resposta", cls: "bg-muted text-muted-foreground border-border" },
    presente:     { label: `Presente · +${presenca?.pontuacao_recebida ?? 0} pts`, cls: "bg-emerald-500/10 text-emerald-700 border-emerald-300" },
    falta:        { label: "Ausente", cls: "bg-red-500/10 text-red-700 border-red-300" },
  };

  return (
    <div className={`rounded-2xl border bg-card overflow-hidden transition ${isPast ? "opacity-75" : ""}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Date block */}
          <div className="shrink-0 w-12 text-center pt-0.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase">
              {format(parseISO(evento.data_inicio), "MMM", { locale: ptBR })}
            </p>
            <p className="text-2xl font-serif leading-tight">
              {format(parseISO(evento.data_inicio), "d")}
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${tipo.cor}`}
              >
                {tipo.label}
              </span>
              {evento.obrigatorio && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/25 font-medium">
                  Obrigatório
                </span>
              )}
              {evento.pontuacao > 0 && (
                <span className="text-[10px] flex items-center gap-0.5 text-amber-600 font-medium">
                  <Star className="h-3 w-3" />+{evento.pontuacao} pts
                </span>
              )}
            </div>

            <p className="font-semibold text-sm leading-snug">{evento.titulo}</p>

            <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />{dataFormatada}
              </span>
              {evento.local && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{evento.local}
                </span>
              )}
            </div>

            {evento.descricao && (
              <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{evento.descricao}</p>
            )}
          </div>
        </div>

        {/* Status / Actions */}
        <div className="mt-3 pt-3 border-t border-border/50">
          {isPast ? (
            /* Past event — show result */
            <div className="flex items-center gap-2">
              {status === "presente" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : status === "falta" ? (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={`text-xs px-2 py-1 rounded-lg border font-medium ${statusUI[status].cls}`}>
                {statusUI[status].label}
              </span>
              {status === "falta" && presenca?.justificativa && (
                <span className="text-xs text-muted-foreground truncate">{presenca.justificativa}</span>
              )}
            </div>
          ) : status === "confirmado" ? (
            /* Confirmed upcoming */
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="text-xs px-2 py-1 rounded-lg border font-medium bg-emerald-500/10 text-emerald-700 border-emerald-300">
                Confirmado
              </span>
              <button
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => onExpandJust(isJustExpanded ? null : evento.id)}
              >
                Cancelar
              </button>
            </div>
          ) : status === "ausente" ? (
            /* Pre-declined upcoming */
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              <span className="text-xs px-2 py-1 rounded-lg border font-medium bg-red-500/10 text-red-700 border-red-300">
                Ausência justificada
              </span>
              {presenca?.justificativa && (
                <span className="text-xs text-muted-foreground truncate flex-1">— {presenca.justificativa}</span>
              )}
              <button
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                onClick={() => onConfirmar()}
              >
                Desfazer
              </button>
            </div>
          ) : (
            /* No response yet */
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                className="flex-1 text-xs"
                onClick={onConfirmar}
                disabled={mutationPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Vou participar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => onExpandJust(isJustExpanded ? null : evento.id)}
                disabled={mutationPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Não poderei
                {isJustExpanded ? (
                  <ChevronUp className="h-3 w-3 ml-1" />
                ) : (
                  <ChevronDown className="h-3 w-3 ml-1" />
                )}
              </Button>
            </div>
          )}

          {/* Justification form — expanded */}
          {isJustExpanded && !isPast && (
            <div className="mt-3 space-y-2">
              <Textarea
                className="text-sm resize-none"
                rows={2}
                placeholder="Justificativa obrigatória…"
                value={just}
                onChange={(e) => setJust(e.target.value)}
                maxLength={300}
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground text-right">{just.length}/300</p>
              {!just.trim() && (
                <p className="text-[11px] text-destructive">A justificativa é obrigatória para registrar ausência.</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 text-xs"
                  disabled={!just.trim()}
                  onClick={() => onDeclinar(just)}
                >
                  Confirmar ausência
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { onExpandJust(null); setJust(""); }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
