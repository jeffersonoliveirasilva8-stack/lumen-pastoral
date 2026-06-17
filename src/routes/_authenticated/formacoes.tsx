import { createFileRoute } from "@tanstack/react-router";
import { ModuleTabBar } from "@/components/ui/module-tab-bar";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Plus, Pencil, Trash2, Loader2, CalendarRange, MapPin,
  Users, CheckCircle2, XCircle, ChevronDown, ChevronUp, Clock,
  UserCheck, Search, Mail, X as XIcon,
} from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/formacoes")({
  component: AgendaPastoralPage,
  head: () => ({ meta: [{ title: "Agenda Pastoral — Lumen Pastoral" }] }),
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
  ativo: boolean;
  observacoes?: string | null;
  responsaveis_nomes?: string | null;
  comunidade?: string | null;
  publico_alvo?: string | null;
};

type Presenca = {
  id: string;
  membro_id: string;
  presente: boolean | null;
  justificativa: string | null;
  pontuacao_recebida: number | null;
  observacoes: string | null;
  membro_nome: string;
};

type MembroBase = { id: string; nome: string };

type EventoForm = {
  titulo: string;
  descricao: string;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  local: string;
  obrigatorio: boolean;
  pontuacao: number;
  observacoes: string;
  responsaveis_nomes: string;
  comunidade: string;
  publico_alvo: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPOS: { value: string; label: string; cor: string }[] = [
  { value: "formacao",    label: "Formação",             cor: "bg-blue-500/10 text-blue-700 border-blue-200" },
  { value: "reuniao",     label: "Reunião",              cor: "bg-slate-500/10 text-slate-700 border-slate-200" },
  { value: "retiro",      label: "Retiro",               cor: "bg-purple-500/10 text-purple-700 border-purple-200" },
  { value: "ensaio",      label: "Ensaio",               cor: "bg-green-500/10 text-green-700 border-green-200" },
  { value: "evento",      label: "Evento",               cor: "bg-amber-500/10 text-amber-700 border-amber-200" },
  { value: "encontro",    label: "Encontro",             cor: "bg-cyan-500/10 text-cyan-700 border-cyan-200" },
  { value: "compromisso", label: "Compromisso Pastoral", cor: "bg-rose-500/10 text-rose-700 border-rose-200" },
  { value: "adoracao",    label: "Adoração",             cor: "bg-yellow-500/10 text-yellow-700 border-yellow-200" },
  { value: "outro",       label: "Outro",                cor: "bg-gray-500/10 text-gray-700 border-gray-200" },
];


const EMPTY_FORM: EventoForm = {
  titulo: "", descricao: "", tipo: "formacao",
  data_inicio: "", data_fim: "", local: "",
  obrigatorio: false, pontuacao: 0,
  observacoes: "", responsaveis_nomes: "", comunidade: "", publico_alvo: "todos",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function tipoBadge(tipo: string) {
  const t = TIPOS.find((x) => x.value === tipo);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${t?.cor ?? "bg-muted text-muted-foreground border-border"}`}>
      {t?.label ?? tipo}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

function AgendaPastoralPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;
  const qc = useQueryClient();

  const [view, setView]                 = useState<"agenda" | "formacoes">("agenda");
  const [formOpen, setFormOpen]         = useState(false);
  const [editTarget, setEditTarget]     = useState<Evento | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Evento | null>(null);
  const [presencaEvento, setPresencaEvento] = useState<Evento | null>(null);
  const [tipoFilter, setTipoFilter]     = useState<string>("todos");
  const [pendingEmailOpts, setPendingEmailOpts] = useState<SaveOpts & { titulo: string; data_inicio: string } | null>(null);

  const { data: eventos = [], isLoading } = useQuery<Evento[]>({
    queryKey: ["formacoes_eventos", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("formacoes_eventos")
        .select("*")
        .eq("paroquia_id", pid)
        .eq("ativo", true)
        .order("data_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Evento[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (form: EventoForm & { id?: string }) => {
      // datetime-local value is local time without timezone — convert to UTC ISO string
      // so Supabase (timestamptz) stores it correctly and displays right across timezones
      const toUtcIso = (local: string) => local ? new Date(local).toISOString() : null;
      const payload: Record<string, unknown> = {
        paroquia_id: pid,
        titulo: form.titulo,
        descricao: form.descricao || null,
        tipo: form.tipo,
        data_inicio: toUtcIso(form.data_inicio),
        data_fim: toUtcIso(form.data_fim),
        local: form.local || null,
        obrigatorio: form.obrigatorio,
        pontuacao: form.pontuacao ?? 0,
        observacoes: form.observacoes || null,
        responsaveis_nomes: form.responsaveis_nomes || null,
        comunidade: form.comunidade || null,
        publico_alvo: form.publico_alvo || "todos",
      };
      if (form.id) {
        const { error } = await anyDb.from("formacoes_eventos").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb.from("formacoes_eventos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["formacoes_eventos", pid] });
      toast.success(editTarget ? "Evento atualizado." : "Evento criado.");
      setFormOpen(false); setEditTarget(null);

      const opts = pendingEmailOpts;
      setPendingEmailOpts(null);
      if (opts?.notificar && pid) {
        // Resolve member emails
        let membroIds: string[] = opts.selectedMembroIds;
        if (membroIds.length === 0) {
          // All active members of the parish
          const { data: all } = await anyDb.from("membros").select("id").eq("paroquia_id", pid).eq("ativo", true);
          membroIds = (all ?? []).map((m: { id: string }) => m.id);
        }
        const { data: membersWithEmail } = await anyDb
          .from("membros")
          .select("id, nome, email, paroquias!inner(nome)")
          .in("id", membroIds)
          .not("email", "is", null);
        const members = (membersWithEmail ?? []) as { nome: string; email: string; paroquias: { nome: string } }[];
        if (members.length === 0) return;

        const dataFormatada = opts.data_inicio.slice(0, 10);
        const hora = opts.data_inicio.length >= 16 ? opts.data_inicio.slice(11, 16) : "";
        const paroqNome = members[0]?.paroquias?.nome ?? "Pastoral";

        let enviados = 0;
        for (const m of members) {
          try {
            const { data: r } = await anyDb.functions.invoke("send-email", {
              body: { template: "evento_convite", to: m.email, nome: m.nome, paroquia: paroqNome, escalaTitulo: opts.titulo, escalaData: dataFormatada, escalaHora: hora },
            });
            if (r?.ok) enviados++;
          } catch { /* non-fatal */ }
        }
        if (enviados > 0) toast.success(`${enviados} membro(s) notificado(s) por e-mail.`);
      }
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("formacoes_eventos").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["formacoes_eventos", pid] });
      toast.success("Evento removido."); setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const tipoOptions = [
    { value: "todos", label: `Todos (${eventos.length})` },
    ...TIPOS
      .filter((t) => eventos.some((e) => e.tipo === t.value))
      .map((t) => ({
        value: t.value,
        label: `${t.label} (${eventos.filter((e) => e.tipo === t.value).length})`,
      })),
  ];

  const filtered = tipoFilter === "todos" ? eventos : eventos.filter((e) => e.tipo === tipoFilter);
  const proximos = filtered.filter((e) => !isPast(parseISO(e.data_inicio)));
  const passados = filtered.filter((e) => isPast(parseISO(e.data_inicio)));

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24 lg:pb-10">
        <PageSkeleton cards={4} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6 pb-24 lg:pb-10">
      {/* Abas do módulo Pastoral */}
      <ModuleTabBar tabs={[
        { label: "Agenda",      onClick: () => setView("agenda"),    isActive: view === "agenda" || view === "formacoes" },
        { label: "Ocorrências", to: "/ocorrencias",                  isActive: false },
      ]} />
      {/* Sub-abas dentro de Agenda */}
      {(view === "agenda" || view === "formacoes") && (
        <div className="flex gap-1 border-b border-border/60 mb-4 -mt-4 overflow-x-auto scrollbar-none">
          {[
            { id: "agenda",    label: "Eventos" },
            { id: "formacoes", label: "Formações" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id as "agenda" | "formacoes")}
              className={`relative flex-shrink-0 px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                view === t.id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {view === t.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-primary/60" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Agenda Pastoral ── */}
      {view === "agenda" && (<>
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">Agenda Pastoral</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reuniões, formações, retiros, ensaios, encontros e compromissos.
            </p>
          </div>
          <Button onClick={() => { setEditTarget(null); setFormOpen(true); }} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" /> Novo evento
          </Button>
        </div>

        {/* Tipo filter chips */}
        {eventos.length > 0 && (
          <div className="overflow-x-auto -mx-6 px-6 pb-1 lg:-mx-10 lg:px-10">
            <div className="flex gap-2 min-w-max">
              {tipoOptions.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTipoFilter(t.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium whitespace-nowrap transition ${
                    tipoFilter === t.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        {eventos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-16 text-center">
            <CalendarRange className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium">Nenhum evento cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Registre reuniões, formações, retiros, ensaios, encontros e compromissos pastorais.
            </p>
            <Button className="mt-4" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Criar primeiro evento
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhum evento deste tipo cadastrado.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {proximos.length > 0 && (
              <EventoSection
                titulo="Próximos"
                eventos={proximos}
                onEdit={(e) => { setEditTarget(e); setFormOpen(true); }}
                onDelete={setDeleteTarget}
                onPresenca={setPresencaEvento}
              />
            )}
            {passados.length > 0 && (
              <EventoSection
                titulo="Realizados"
                eventos={passados}
                onEdit={(e) => { setEditTarget(e); setFormOpen(true); }}
                onDelete={setDeleteTarget}
                onPresenca={setPresencaEvento}
              />
            )}
          </div>
        )}
      </>)}

      {/* ── Formações (prévia visual) ── */}
      {view === "formacoes" && (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl">Formações</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Trilhas de formação, materiais e acompanhamento de progresso.
              </p>
            </div>
            <span className="mt-2 text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium shrink-0">Em breve</span>
          </div>

          <div className="rounded-2xl border border-dashed border-border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
            Prévia do módulo — sem dados reais ainda
          </div>

          {/* Trilhas de formação (simulado) */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground font-semibold px-1">Trilhas</p>
            {[
              { tipo: "PDF",    cor: "bg-red-500/10 text-red-700 border-red-200",    titulo: "Manual do Ministério da Eucaristia", desc: "18 páginas · Atualizado em 2025", icon: "📄" },
              { tipo: "Vídeo", cor: "bg-blue-500/10 text-blue-700 border-blue-200",  titulo: "Formação de Coroinhas — Módulo 1",   desc: "32 min · Pe. Carlos Mendes",       icon: "▶️" },
              { tipo: "Vídeo", cor: "bg-blue-500/10 text-blue-700 border-blue-200",  titulo: "Liturgia das Horas — Introdução",    desc: "45 min · Série Oração",            icon: "▶️" },
              { tipo: "Artigo", cor: "bg-green-500/10 text-green-700 border-green-200", titulo: "A Missão do Leitor na Missa",     desc: "Leitura estimada: 8 min",          icon: "📝" },
              { tipo: "PDF",    cor: "bg-red-500/10 text-red-700 border-red-200",    titulo: "Guia de Canto Gregoriano",           desc: "6 páginas · Coro Paroquial",       icon: "📄" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3.5 opacity-70 cursor-not-allowed select-none">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shrink-0 text-lg">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{item.titulo}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${item.cor}`}>
                  {item.tipo}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 text-center space-y-2">
            <p className="font-semibold text-sm">Este módulo está em desenvolvimento</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Trilhas de formação com materiais em PDF, vídeo e artigo, com acompanhamento individual de progresso dos ministros.
            </p>
          </div>
        </div>
      )}

      {/* Form Sheet */}
      <EventoFormSheet
        open={formOpen}
        initial={editTarget}
        saving={saveMutation.isPending}
        paroquiaId={pid ?? ""}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        onSave={(data, opts) => {
          setPendingEmailOpts({ ...opts, titulo: data.titulo, data_inicio: data.data_inicio });
          saveMutation.mutate(editTarget ? { ...data, id: editTarget.id } : data);
        }}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover evento?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.titulo}</strong> será removido da agenda. As presenças registradas serão mantidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Presença Sheet */}
      {presencaEvento && pid && (
        <PresencaSheet
          evento={presencaEvento}
          paroquiaId={pid}
          onClose={() => setPresencaEvento(null)}
        />
      )}
    </div>
  );
}

// ── EventoSection ─────────────────────────────────────────────────────────────

function EventoSection({
  titulo, eventos, onEdit, onDelete, onPresenca,
}: {
  titulo: string;
  eventos: Evento[];
  onEdit: (e: Evento) => void;
  onDelete: (e: Evento) => void;
  onPresenca: (e: Evento) => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{titulo}</h2>
      <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
        {eventos.map((e) => (
          <div key={e.id} className="p-4 sm:p-5">
            <div className="flex gap-4">
              {/* Date block */}
              <div className="shrink-0 w-12 text-center pt-0.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">
                  {format(parseISO(e.data_inicio), "MMM", { locale: ptBR })}
                </p>
                <p className="text-2xl font-serif leading-none">
                  {format(parseISO(e.data_inicio), "d")}
                </p>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {tipoBadge(e.tipo)}
                  {e.obrigatorio && (
                    <Badge variant="destructive" className="text-xs">Obrigatório</Badge>
                  )}
                  {e.publico_alvo && e.publico_alvo !== "todos" && (
                    <span className="text-xs text-muted-foreground/70 border border-border rounded-full px-2 py-0.5">
                      {e.publico_alvo}
                    </span>
                  )}
                </div>

                <p className="font-semibold text-sm mt-1.5">{e.titulo}</p>

                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(parseISO(e.data_inicio), "HH:mm")}
                    {e.data_fim && ` – ${format(parseISO(e.data_fim), "HH:mm")}`}
                  </span>
                  {e.local && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{e.local}
                    </span>
                  )}
                  {e.comunidade && (
                    <span>{e.comunidade}</span>
                  )}
                </div>

                {e.responsaveis_nomes && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Users className="h-3 w-3 shrink-0" />
                    {e.responsaveis_nomes}
                  </p>
                )}

                {e.descricao && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{e.descricao}</p>
                )}
              </div>
            </div>

            {/* Action row */}
            <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border/50">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPresenca(e)}
                className="text-xs h-8"
              >
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                <span className="hidden sm:inline">Registro de </span>Presença
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(e)} title="Editar">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onDelete(e)} title="Remover">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── EventoFormSheet ───────────────────────────────────────────────────────────

type Comunidade = { id: string; nome: string; endereco: string | null };
type AtuacaoPastoral = { id: string; nome: string; cor: string | null };

type SaveOpts = { notificar: boolean; selectedMembroIds: string[] };

function EventoFormSheet({
  open, initial, saving, paroquiaId, onClose, onSave,
}: {
  open: boolean;
  initial: Evento | null;
  saving: boolean;
  paroquiaId: string;
  onClose: () => void;
  onSave: (data: EventoForm, opts: SaveOpts) => void;
}) {
  const [form, setForm] = useState<EventoForm>(EMPTY_FORM);
  const [comunidadeId, setComunidadeId] = useState<string>("");
  const [localCustom, setLocalCustom] = useState("");
  const [selectedAtuacoes, setSelectedAtuacoes] = useState<string[]>([]);
  const [selectedMembroIds, setSelectedMembroIds] = useState<string[]>([]);
  const [membroSearch, setMembroSearch] = useState("");
  const [notificarEmail, setNotificarEmail] = useState(false);

  const { data: comunidades = [] } = useQuery<Comunidade[]>({
    queryKey: ["comunidades", paroquiaId],
    enabled: !!paroquiaId && open,
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunidades")
        .select("id, nome, endereco")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return (data ?? []) as Comunidade[];
    },
  });

  const { data: atuacoes = [] } = useQuery<AtuacaoPastoral[]>({
    queryKey: ["atuacoes_pastorais", paroquiaId],
    enabled: !!paroquiaId && open,
    queryFn: async () => {
      const { data } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome, cor")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("ordem");
      return (data ?? []) as AtuacaoPastoral[];
    },
  });

  const { data: todosMembros = [] } = useQuery<MembroBase[]>({
    queryKey: ["membros-base", paroquiaId],
    enabled: !!paroquiaId && open,
    queryFn: async () => {
      const { data } = await anyDb
        .from("membros")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return (data ?? []) as MembroBase[];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (initial) {
      // Convert UTC ISO from DB back to local datetime string for datetime-local input
      const toLocalInput = (iso: string | null) => {
        if (!iso) return "";
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      };
      setForm({
        titulo: initial.titulo,
        descricao: initial.descricao ?? "",
        tipo: initial.tipo,
        data_inicio: toLocalInput(initial.data_inicio),
        data_fim: toLocalInput(initial.data_fim ?? null),
        local: initial.local ?? "",
        obrigatorio: initial.obrigatorio,
        pontuacao: initial.pontuacao ?? 0,
        observacoes: initial.observacoes ?? "",
        responsaveis_nomes: initial.responsaveis_nomes ?? "",
        comunidade: initial.comunidade ?? "",
        publico_alvo: initial.publico_alvo ?? "todos",
      });
      const matched = comunidades.find((c) => c.nome === initial.comunidade);
      if (matched) {
        setComunidadeId(matched.id);
        setLocalCustom("");
      } else {
        setComunidadeId(initial.comunidade ? "outro" : "");
        setLocalCustom(initial.local ?? "");
      }
      setSelectedAtuacoes([]);
      setSelectedMembroIds([]);
      setMembroSearch("");
      setNotificarEmail(false);
    } else {
      setForm(EMPTY_FORM);
      setComunidadeId("");
      setLocalCustom("");
      setSelectedAtuacoes([]);
      setSelectedMembroIds([]);
      setMembroSearch("");
      setNotificarEmail(false);
    }
  }, [initial, open, comunidades]);

  function f<K extends keyof EventoForm>(key: K, value: EventoForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleAtuacao(nome: string) {
    setSelectedAtuacoes((prev) =>
      prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome],
    );
  }

  function handleComunidadeChange(val: string) {
    setComunidadeId(val);
    if (val !== "outro") {
      const com = comunidades.find((c) => c.id === val);
      setLocalCustom(com?.endereco ?? "");
    }
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form.titulo.trim() || !form.data_inicio) return;

    const com = comunidades.find((c) => c.id === comunidadeId);
    const finalComunidade = comunidadeId === "outro" ? "" : (com?.nome ?? "");
    const finalLocal = comunidadeId === "outro" ? localCustom : (com?.endereco ?? com?.nome ?? "");
    const membroNomes = todosMembros.filter((m) => selectedMembroIds.includes(m.id)).map((m) => m.nome);
    const finalPublicoAlvo =
      [...selectedAtuacoes, ...membroNomes].filter(Boolean).join(", ") || "todos";

    onSave(
      { ...form, comunidade: finalComunidade, local: finalLocal, publico_alvo: finalPublicoAlvo },
      { notificar: notificarEmail && !initial, selectedMembroIds },
    );
  }

  const canSave = !!form.titulo.trim() && !!form.data_inicio;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle>{initial ? "Editar evento" : "Novo evento"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={submit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">

            {/* Tipo */}
            <div className="space-y-1.5">
              <Label>Tipo de evento</Label>
              <Select value={form.tipo} onValueChange={(v) => f("tipo", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Título */}
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                required
                value={form.titulo}
                onChange={(e) => f("titulo", e.target.value)}
                placeholder="Ex: Formação de Ministros da Eucaristia"
              />
            </div>

            {/* Datas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data e hora de início *</Label>
                <Input
                  required type="datetime-local"
                  value={form.data_inicio}
                  onChange={(e) => f("data_inicio", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data e hora de término</Label>
                <Input
                  type="datetime-local"
                  value={form.data_fim}
                  onChange={(e) => f("data_fim", e.target.value)}
                />
              </div>
            </div>

            {/* Pontuação */}
            <div className="space-y-1.5">
              <Label>Pontuação por presença</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="w-32"
                  value={form.pontuacao}
                  onChange={(e) => f("pontuacao", Math.max(0, parseInt(e.target.value, 10) || 0))}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">pontos</span>
              </div>
            </div>

            {/* Comunidade / Local */}
            <div className="space-y-1.5">
              <Label>Local / Comunidade</Label>
              <Select value={comunidadeId} onValueChange={handleComunidadeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a comunidade…" />
                </SelectTrigger>
                <SelectContent>
                  {comunidades.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                  <SelectItem value="outro">Outro (digitar)</SelectItem>
                </SelectContent>
              </Select>
              {comunidadeId === "outro" && (
                <Input
                  className="mt-2"
                  value={localCustom}
                  onChange={(e) => setLocalCustom(e.target.value)}
                  placeholder="Descreva o local…"
                />
              )}
            </div>

            {/* Responsáveis */}
            <div className="space-y-1.5">
              <Label>Responsáveis</Label>
              <Input
                value={form.responsaveis_nomes}
                onChange={(e) => f("responsaveis_nomes", e.target.value)}
                placeholder="Ex: Pe. João Silva, Maria Oliveira"
              />
            </div>

            {/* Público-alvo: atuações + membros manuais */}
            <div className="space-y-2">
              <Label>Público-alvo</Label>
              {atuacoes.length > 0 ? (
                <div className="rounded-xl border border-border divide-y divide-border">
                  {atuacoes.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition"
                    >
                      <Checkbox
                        checked={selectedAtuacoes.includes(a.nome)}
                        onCheckedChange={() => toggleAtuacao(a.nome)}
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {a.cor && (
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: a.cor }}
                          />
                        )}
                        <span className="text-sm truncate">{a.nome}</span>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nenhuma atuação pastoral cadastrada.
                </p>
              )}
              {/* Seleção de membros específicos (P1.7) */}
              {todosMembros.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs text-muted-foreground">Membros específicos</p>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input bg-card text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/20"
                      placeholder="Buscar membro…"
                      value={membroSearch}
                      onChange={(e) => setMembroSearch(e.target.value)}
                    />
                  </div>
                  {selectedMembroIds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {todosMembros.filter((m) => selectedMembroIds.includes(m.id)).map((m) => (
                        <span key={m.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          {m.nome.split(" ")[0]}
                          <button type="button" onClick={() => setSelectedMembroIds((p) => p.filter((id) => id !== m.id))}>
                            <XIcon className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {membroSearch.length > 0 && (
                    <div className="max-h-36 overflow-y-auto rounded-xl border border-border divide-y divide-border bg-card">
                      {todosMembros
                        .filter((m) => m.nome.toLowerCase().includes(membroSearch.toLowerCase()) && !selectedMembroIds.includes(m.id))
                        .slice(0, 8)
                        .map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 transition"
                            onClick={() => { setSelectedMembroIds((p) => [...p, m.id]); setMembroSearch(""); }}
                          >
                            {m.nome}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                rows={3}
                value={form.descricao}
                onChange={(e) => f("descricao", e.target.value)}
                placeholder="Pauta, objetivos, detalhes do evento…"
              />
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <Label>Observações internas</Label>
              <Textarea
                rows={2}
                value={form.observacoes}
                onChange={(e) => f("observacoes", e.target.value)}
                placeholder="Instruções, lembretes, informações adicionais…"
              />
            </div>

            {/* Obrigatório */}
            <div className="flex items-center gap-3 pt-1">
              <Switch
                id="obrig-switch"
                checked={form.obrigatorio}
                onCheckedChange={(v) => f("obrigatorio", v)}
              />
              <Label htmlFor="obrig-switch">Evento obrigatório</Label>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-8 pt-4 space-y-3 border-t border-border">
            {!initial && (
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <Switch
                  id="notif-email-switch"
                  checked={notificarEmail}
                  onCheckedChange={setNotificarEmail}
                />
                <span className="flex items-center gap-1.5 text-sm">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  Notificar membros por e-mail ao criar
                </span>
              </label>
            )}
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saving || !canSave}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Salvar
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── PresencaSheet ─────────────────────────────────────────────────────────────

function PresencaSheet({
  evento, paroquiaId, onClose,
}: {
  evento: Evento;
  paroquiaId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: membros = [] } = useQuery<MembroBase[]>({
    queryKey: ["membros-base", paroquiaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("membros")
        .select("id,nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return (data ?? []) as MembroBase[];
    },
  });

  const { data: presencas = [], isLoading } = useQuery<Presenca[]>({
    queryKey: ["presencas", evento.id],
    queryFn: async () => {
      const { data } = await anyDb
        .from("presencas_eventos")
        .select("id,membro_id,presente,justificativa,pontuacao_recebida,observacoes,membros(nome)")
        .eq("evento_id", evento.id);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        membro_id: r.membro_id,
        presente: r.presente,
        justificativa: r.justificativa,
        pontuacao_recebida: r.pontuacao_recebida,
        observacoes: r.observacoes,
        membro_nome: r.membros?.nome ?? "—",
      }));
    },
  });

  const presencaMap = new Map(presencas.map((p) => [p.membro_id, p]));

  const marcarMutation = useMutation({
    mutationFn: async ({ membroId, presente }: { membroId: string; presente: boolean | null }) => {
      // RPC atômica: atualiza presencas_eventos + historico_participacoes
      // O trigger on_historico_score_recalc cuida de membros.score automaticamente.
      const { error } = await supabase.rpc("marcar_presenca_evento" as never, {
        p_paroquia_id: paroquiaId,
        p_evento_id:   evento.id,
        p_membro_id:   membroId,
        p_tipo:        evento.tipo,
        p_data:        evento.data_inicio.slice(0, 10),
        p_titulo:      evento.titulo,
        p_presente:    presente,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["presencas", evento.id] });
      qc.invalidateQueries({ queryKey: ["portal-ranking"] });
      qc.invalidateQueries({ queryKey: ["membros-base", paroquiaId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const total = membros.length;
  const presentes = presencas.filter((p) => p.presente === true).length;
  const ausentes = presencas.filter((p) => p.presente === false).length;
  const confirmados = presencas.filter((p) => p.presente === null).length;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Registro de Presença</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Evento summary */}
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="font-medium text-sm">{evento.titulo}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(parseISO(evento.data_inicio), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
            </p>
            <div className="flex gap-4 mt-3 text-xs flex-wrap">
              <span className="text-emerald-600 font-medium">{presentes} presentes</span>
              <span className="text-red-500 font-medium">{ausentes} ausentes</span>
              {confirmados > 0 && (
                <span className="text-blue-600 font-medium">{confirmados} confirmados via portal</span>
              )}
              <span className="text-muted-foreground">{total - presencas.length} sem registro</span>
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : membros.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum membro cadastrado.</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
              {membros.map((m) => {
                const p = presencaMap.get(m.id);
                const isOpen = expanded === m.id;
                return (
                  <div key={m.id}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.nome}</p>
                        {p?.justificativa && (
                          <p className="text-xs text-muted-foreground truncate">{p.justificativa}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => marcarMutation.mutate({ membroId: m.id, presente: true })}
                          className={`h-8 w-8 rounded-full grid place-items-center transition ${
                            p?.presente === true
                              ? "bg-emerald-500 text-white"
                              : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                          }`}
                          title="Marcar presente"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => marcarMutation.mutate({ membroId: m.id, presente: false })}
                          className={`h-8 w-8 rounded-full grid place-items-center transition ${
                            p?.presente === false
                              ? "bg-red-500 text-white"
                              : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"
                          }`}
                          title="Marcar ausente"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : m.id)}
                          className="h-8 w-8 rounded-full grid place-items-center text-muted-foreground hover:bg-muted transition"
                          title="Justificativa / observações"
                        >
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <JustificativaRow
                        presenca={p}
                        membroId={m.id}
                        eventoId={evento.id}
                        onSaved={() => {
                          qc.invalidateQueries({ queryKey: ["presencas", evento.id] });
                          setExpanded(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── JustificativaRow ──────────────────────────────────────────────────────────

function JustificativaRow({
  presenca, membroId, eventoId, onSaved,
}: {
  presenca: Presenca | undefined;
  membroId: string;
  eventoId: string;
  onSaved: () => void;
}) {
  const [just, setJust] = useState(presenca?.justificativa ?? "");
  const [obs, setObs] = useState(presenca?.observacoes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    if (presenca) {
      await anyDb
        .from("presencas_eventos")
        .update({ justificativa: just || null, observacoes: obs || null })
        .eq("id", presenca.id);
    } else {
      await anyDb.from("presencas_eventos").insert({
        evento_id: eventoId,
        membro_id: membroId,
        justificativa: just || null,
        observacoes: obs || null,
      });
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div className="px-4 pb-3 bg-muted/20 space-y-2 border-t border-border">
      <Input
        className="h-8 text-sm mt-2"
        placeholder="Justificativa de ausência…"
        value={just}
        onChange={(e) => setJust(e.target.value)}
      />
      <div className="flex gap-2">
        <Input
          className="h-8 text-sm flex-1"
          placeholder="Observações internas…"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
        />
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
