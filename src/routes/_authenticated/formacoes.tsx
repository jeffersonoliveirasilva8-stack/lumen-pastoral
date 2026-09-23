import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Plus, ChevronLeft, ChevronRight, Users, CheckCircle2, Clock, Calendar,
  Loader2, Pencil, Trash2, X, MapPin, BookOpen, Bell, UserPlus, Search,
  CheckCheck, XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/formacoes")({
  component: RouteComponent,
});

const TIPOS_EVENTO = [
  { value: "formacao",    label: "Formação",            cor: "#3b82f6" },
  { value: "reuniao",     label: "Reunião",             cor: "#64748b" },
  { value: "retiro",      label: "Retiro",              cor: "#8b5cf6" },
  { value: "adoracao",    label: "Adoração",            cor: "#f59e0b" },
  { value: "ensaio",      label: "Ensaio",              cor: "#10b981" },
  { value: "encontro",    label: "Encontro",            cor: "#06b6d4" },
  { value: "compromisso", label: "Compromisso pastoral",cor: "#f43f5e" },
  { value: "evento",      label: "Evento especial",     cor: "#a855f7" },
];

type Evento = {
  id: string;
  titulo: string;
  tipo: string;
  data_inicio: string;
  data_fim: string | null;
  local: string | null;
  descricao: string | null;
  observacoes: string | null;
  obrigatorio: boolean;
  pontuacao: number;
  total_membros: number;
  total_confirmados: number;
  total_presencas: number;
  total_ausentes: number;
  escala_id: string | null;
};

type FormEvento = {
  titulo: string;
  tipo: string;
  data_inicio: string;
  hora_inicio: string;
  local: string;
  descricao: string;
  obrigatorio: boolean;
};

type MembroSimples = { id: string; nome: string; email: string | null; ministerio_ids: string[] };
type Ministerio = { id: string; nome: string; categoria: string | null };
type ModoConvite = "todos" | "categoria" | "especificos";

const FORM_EMPTY: FormEvento = {
  titulo: "", tipo: "formacao", data_inicio: "", hora_inicio: "19:00",
  local: "", descricao: "", obrigatorio: false,
};

function corTipo(tipo: string) {
  return TIPOS_EVENTO.find((t) => t.value === tipo)?.cor ?? "#64748b";
}
function labelTipo(tipo: string) {
  return TIPOS_EVENTO.find((t) => t.value === tipo)?.label ?? tipo;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

function RouteComponent() {
  const { profile, roles } = useAuth();
  const qc = useQueryClient();
  const pid = profile?.paroquia_id;
  const isAdmin = roles.some((r) => ["admin_paroquial", "super_admin", "coordenador"].includes(r));

  const [mes, setMes] = useState(() => startOfMonth(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [presencaEvento, setPresencaEvento] = useState<Evento | null>(null);
  const [form, setForm] = useState<FormEvento>(FORM_EMPTY);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Seleção de membros ao criar evento
  const [convidarAtCriar, setConvidarAtCriar] = useState(true);
  const [modoConvite, setModoConvite] = useState<ModoConvite>("todos");
  const [categoriaConvite, setCategoriaConvite] = useState<string>("");
  const [especificos, setEspecificos] = useState<MembroSimples[]>([]);
  const [buscaEspecificos, setBuscaEspecificos] = useState("");

  const mesStr = format(mes, "MMMM yyyy", { locale: ptBR });
  const inicioMes = format(mes, "yyyy-MM-dd") + "T00:00:00";
  const fimMes    = format(endOfMonth(mes), "yyyy-MM-dd") + "T23:59:59";

  const { data: eventos = [], isLoading } = useQuery<Evento[]>({
    queryKey: ["formacoes-eventos", pid, format(mes, "yyyy-MM")],
    enabled: !!pid,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("formacoes_eventos")
        .select(`
          id, titulo, tipo, data_inicio, data_fim, local,
          descricao, observacoes, obrigatorio, pontuacao, escala_id,
          presencas_eventos(id, presente, confirmado_pelo_membro)
        `)
        .eq("paroquia_id", pid!)
        .eq("ativo", true)
        .gte("data_inicio", inicioMes)
        .lte("data_inicio", fimMes)
        .order("data_inicio");
      if (error) throw error;
      return (data ?? []).map((ev: any) => ({
        id: ev.id,
        titulo: ev.titulo,
        tipo: ev.tipo,
        data_inicio: ev.data_inicio,
        data_fim: ev.data_fim,
        local: ev.local,
        descricao: ev.descricao,
        observacoes: ev.observacoes,
        obrigatorio: ev.obrigatorio,
        pontuacao: ev.pontuacao,
        escala_id: ev.escala_id,
        total_membros:    (ev.presencas_eventos ?? []).length,
        total_confirmados:(ev.presencas_eventos ?? []).filter((p: any) => p.confirmado_pelo_membro === true).length,
        total_presencas:  (ev.presencas_eventos ?? []).filter((p: any) => p.presente === true).length,
        total_ausentes:   (ev.presencas_eventos ?? []).filter((p: any) => p.presente === false).length,
      }));
    },
  });

  // Membros ativos da paróquia
  const { data: paroquiaNome = "" } = useQuery<string>({
    queryKey: ["paroquia-nome", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await anyDb.from("paroquias").select("nome").eq("id", pid!).single();
      return (data?.nome ?? "") as string;
    },
  });

  const { data: membrosAtivos = [] } = useQuery<MembroSimples[]>({
    queryKey: ["membros-ativos-formacao", pid],
    enabled: !!pid && formOpen,
    queryFn: async () => {
      const { data } = await anyDb
        .from("membros")
        .select("id, nome, email, membro_ministerios(ministerio_id)")
        .eq("paroquia_id", pid!)
        .eq("ativo", true)
        .order("nome");
      return (data ?? []).map((m: any) => ({
        id: m.id,
        nome: m.nome,
        email: m.email ?? null,
        ministerio_ids: (m.membro_ministerios ?? []).map((mm: any) => mm.ministerio_id),
      }));
    },
  });

  // Ministérios com categoria para filtro
  const { data: ministerios = [] } = useQuery<Ministerio[]>({
    queryKey: ["ministerios-formacao", pid],
    enabled: !!pid && formOpen,
    queryFn: async () => {
      const { data } = await anyDb
        .from("ministerios")
        .select("id, nome, categoria")
        .eq("paroquia_id", pid!)
        .eq("ativo", true)
        .order("nome");
      return data ?? [];
    },
  });

  // Categorias únicas disponíveis (ex: Acólito, Cerimoniário)
  const categoriasDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const m of ministerios) {
      if (m.categoria) set.add(m.categoria);
    }
    return Array.from(set).sort();
  }, [ministerios]);

  // Membros que serão convidados conforme seleção
  const membrosParaConvidar = useMemo(() => {
    if (!convidarAtCriar) return [];
    if (modoConvite === "todos") return membrosAtivos;
    if (modoConvite === "especificos") return especificos;
    if (modoConvite === "categoria" && categoriaConvite) {
      const idsNaCategoria = new Set(
        ministerios.filter((m) => m.categoria === categoriaConvite).map((m) => m.id)
      );
      return membrosAtivos.filter((m) =>
        m.ministerio_ids.some((mid) => idsNaCategoria.has(mid))
      );
    }
    return [];
  }, [convidarAtCriar, modoConvite, categoriaConvite, especificos, membrosAtivos, ministerios]);

  // Membros disponíveis para seleção individual (exclui já selecionados)
  const membrosDisponiveisEspecificos = useMemo(() => {
    const selecionadosIds = new Set(especificos.map((m) => m.id));
    const termo = buscaEspecificos.toLowerCase().trim();
    return membrosAtivos
      .filter((m) => !selecionadosIds.has(m.id))
      .filter((m) => !termo || m.nome.toLowerCase().includes(termo));
  }, [membrosAtivos, especificos, buscaEspecificos]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const dataHora = `${form.data_inicio}T${form.hora_inicio}:00`;
      const payload = {
        paroquia_id: pid!,
        titulo:      form.titulo.trim(),
        tipo:        form.tipo,
        data_inicio: dataHora,
        local:       form.local.trim() || null,
        descricao:   form.descricao.trim() || null,
        obrigatorio: form.obrigatorio,
        criado_por:  profile!.id,
      };
      if (editId) {
        const { error } = await supabase.from("formacoes_eventos").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("formacoes_eventos")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;

        // Adiciona membros selecionados ao evento
        if (membrosParaConvidar.length > 0) {
          const presencas = membrosParaConvidar.map((m) => ({
            evento_id: data.id,
            membro_id: m.id,
            presente: null,
            confirmado_pelo_membro: false,
          }));
          await anyDb.from("presencas_eventos").insert(presencas);

          // Notificação push (in-app)
          const dataEvento = `${payload.data_inicio.slice(0, 10)}`;
          const horaEvento = payload.data_inicio.slice(11, 16);
          const notifs = membrosParaConvidar.map((m) => ({
            paroquia_id: pid,
            membro_id: m.id,
            titulo: `📅 ${payload.titulo}`,
            mensagem: `Você foi convidado para: ${payload.titulo}${payload.local ? ` — ${payload.local}` : ""}. Data: ${format(parseISO(dataEvento), "dd/MM/yyyy", { locale: ptBR })}${horaEvento && horaEvento !== "00:00" ? ` às ${horaEvento}` : ""}.`,
            tipo: "info",
            lida: false,
            apenas_admin: false,
            link_referencia: "/portal-membro/eventos",
          }));
          await anyDb.from("notificacoes").insert(notifs);

          // Emails com rate limit
          for (let i = 0; i < membrosParaConvidar.length; i++) {
            const m = membrosParaConvidar[i];
            if (!m.email) continue;
            if (i > 0) await new Promise((r) => setTimeout(r, 400));
            await supabase.functions.invoke("send-email", {
              body: {
                template: "evento_convite",
                to: m.email,
                nome: m.nome,
                paroquia: paroquiaNome,
                escalaTitulo: payload.titulo,
                escalaData: dataEvento,
                escalaHora: horaEvento,
              },
            });
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["formacoes-eventos", pid, format(mes, "yyyy-MM")] });
      const msg = editId
        ? "Evento atualizado."
        : membrosParaConvidar.length > 0
          ? `Evento criado. ${membrosParaConvidar.length} membro(s) convidado(s).`
          : "Evento criado.";
      toast.success(msg);
      setFormOpen(false);
      setEditId(null);
      setForm(FORM_EMPTY);
      setConvidarAtCriar(true);
      setModoConvite("todos");
      setCategoriaConvite("");
      setEspecificos([]);
      setBuscaEspecificos("");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("formacoes_eventos")
        .update({ ativo: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["formacoes-eventos", pid, format(mes, "yyyy-MM")] });
      toast.success("Evento removido.");
      setDeleteId(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openNew() {
    setEditId(null);
    setForm({ ...FORM_EMPTY, data_inicio: format(new Date(), "yyyy-MM-dd") });
    setConvidarAtCriar(true);
    setModoConvite("todos");
    setCategoriaConvite("");
    setEspecificos([]);
    setBuscaEspecificos("");
    setFormOpen(true);
  }

  function openEdit(ev: Evento) {
    setEditId(ev.id);
    const [dataPart, timePart] = ev.data_inicio.split("T");
    setForm({
      titulo: ev.titulo,
      tipo: ev.tipo,
      data_inicio: dataPart,
      hora_inicio: timePart?.slice(0, 5) ?? "19:00",
      local: ev.local ?? "",
      descricao: ev.descricao ?? "",
      obrigatorio: ev.obrigatorio,
    });
    setConvidarAtCriar(false);
    setModoConvite("todos");
    setCategoriaConvite("");
    setEspecificos([]);
    setBuscaEspecificos("");
    setFormOpen(true);
  }

  // Agrupa por data
  const grouped = useMemo(() => {
    const map = new Map<string, Evento[]>();
    for (const ev of eventos) {
      const dia = ev.data_inicio.slice(0, 10);
      const arr = map.get(dia) ?? [];
      arr.push(ev);
      map.set(dia, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [eventos]);

  const totalPresencas = eventos.reduce((s, e) => s + e.total_confirmados, 0);
  const totalEventos   = eventos.length;

  return (
    <div className="space-y-5 pb-20">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Formações e Eventos</h1>
          <p className="text-xs text-muted-foreground capitalize">{mesStr}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl"
            onClick={() => setMes((m) => startOfMonth(subMonths(m, 1)))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl"
            onClick={() => setMes(startOfMonth(new Date()))}>
            <Calendar className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl"
            onClick={() => setMes((m) => startOfMonth(addMonths(m, 1)))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button size="sm" className="rounded-xl ml-2" onClick={openNew}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Novo evento
            </Button>
          )}
        </div>
      </div>

      {/* Resumo do mês */}
      {totalEventos > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Eventos</p>
              <p className="text-xl font-bold tabular-nums">{totalEventos}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Presenças confirmadas</p>
              <p className="text-xl font-bold tabular-nums">{totalPresencas}</p>
            </div>
          </div>
        </div>
      )}

      {/* Lista */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {!isLoading && grouped.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Calendar className="h-10 w-10 opacity-30" />
          <div>
            <p className="font-medium">Nenhum evento em {mesStr}</p>
            {isAdmin && (
              <p className="text-sm mt-1">Clique em <strong>Novo evento</strong> para adicionar.</p>
            )}
          </div>
        </div>
      )}
      {grouped.map(([dia, evs]) => (
        <div key={dia}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {format(parseISO(dia), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
          <div className="space-y-2">
            {evs.map((ev) => (
              <EventoCard
                key={ev.id}
                evento={ev}
                isAdmin={!!isAdmin}
                onEdit={() => openEdit(ev)}
                onDelete={() => setDeleteId(ev.id)}
                onVerPresencas={() => setPresencaEvento(ev)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Dialog criar/editar */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditId(null); setForm(FORM_EMPTY); } }}>
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar evento" : "Novo evento"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Nome do evento" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS_EVENTO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Hora</Label>
                <Input type="time" value={form.hora_inicio} onChange={(e) => setForm((f) => ({ ...f, hora_inicio: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Data *</Label>
              <Input type="date" value={form.data_inicio} onChange={(e) => setForm((f) => ({ ...f, data_inicio: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Local</Label>
              <Input value={form.local} onChange={(e) => setForm((f) => ({ ...f, local: e.target.value }))} placeholder="Salão paroquial, online…" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea rows={3} value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} placeholder="Pauta, tema ou instruções…" />
            </div>

            {/* Seção de convite — só ao criar */}
            {!editId && (
              <div className="rounded-xl border border-border p-3 space-y-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="convidar-ao-criar"
                    checked={convidarAtCriar}
                    onCheckedChange={(v) => setConvidarAtCriar(!!v)}
                  />
                  <Label htmlFor="convidar-ao-criar" className="cursor-pointer font-normal">
                    Convidar membros ao criar
                  </Label>
                </div>

                {convidarAtCriar && (
                  <div className="space-y-3 pl-1">
                    {/* Chips de seleção */}
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setModoConvite("todos")}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          modoConvite === "todos"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border bg-background hover:bg-accent"
                        }`}
                      >
                        Todos
                      </button>
                      {categoriasDisponiveis.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => { setModoConvite("categoria"); setCategoriaConvite(cat); }}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                            modoConvite === "categoria" && categoriaConvite === cat
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border bg-background hover:bg-accent"
                          }`}
                        >
                          {cat}s
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setModoConvite("especificos")}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          modoConvite === "especificos"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border bg-background hover:bg-accent"
                        }`}
                      >
                        Específicos
                      </button>
                    </div>

                    {/* Seleção individual */}
                    {modoConvite === "especificos" && (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            className="pl-7 h-8 text-sm rounded-lg"
                            placeholder="Buscar membro…"
                            value={buscaEspecificos}
                            onChange={(e) => setBuscaEspecificos(e.target.value)}
                          />
                        </div>
                        {/* Lista de resultados */}
                        {buscaEspecificos.trim().length >= 1 && membrosDisponiveisEspecificos.length > 0 && (
                          <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card space-y-0.5 p-1">
                            {membrosDisponiveisEspecificos.slice(0, 10).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center justify-between"
                                onClick={() => { setEspecificos((prev) => [...prev, m]); setBuscaEspecificos(""); }}
                              >
                                <span>{m.nome}</span>
                                <Plus className="h-3 w-3 text-muted-foreground" />
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Selecionados */}
                        {especificos.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {especificos.map((m) => (
                              <span
                                key={m.id}
                                className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5"
                              >
                                {m.nome}
                                <button
                                  type="button"
                                  onClick={() => setEspecificos((prev) => prev.filter((x) => x.id !== m.id))}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      {membrosParaConvidar.length} membro(s) serão convidados
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button
              disabled={!form.titulo.trim() || !form.data_inicio || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {editId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet de presenças */}
      <PresencaSheet
        evento={presencaEvento}
        paroquiaId={pid ?? ""}
        paroquiaNome={paroquiaNome}
        onClose={() => {
          setPresencaEvento(null);
          qc.invalidateQueries({ queryKey: ["formacoes-eventos", pid, format(mes, "yyyy-MM")] });
        }}
      />

      {/* Confirmar delete */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover evento?</AlertDialogTitle>
            <AlertDialogDescription>O evento será ocultado da agenda. As presenças já registradas serão mantidas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── PresencaSheet ─────────────────────────────────────────────────────────

type PresencaRow = {
  id: string;
  membro_id: string;
  nome: string;
  email: string | null;
  presente: boolean | null;
  confirmado: boolean;
};

type MembroPicker = { id: string; nome: string };

function PresencaSheet({
  evento, paroquiaId, paroquiaNome, onClose,
}: {
  evento: Evento | null;
  paroquiaId: string;
  paroquiaNome: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [adicionandoMembros, setAdicionandoMembros] = useState(false);
  const [membrosBuscados, setMembrosBuscados] = useState<MembroPicker[]>([]);
  const [notificando, setNotificando] = useState(false);

  const { data: lista = [], isLoading, refetch } = useQuery<PresencaRow[]>({
    queryKey: ["presencas-evento-detalhe", evento?.id],
    enabled: !!evento?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("presencas_eventos")
        .select("id, membro_id, presente, confirmado_pelo_membro, membros(nome, email)")
        .eq("evento_id", evento!.id)
        .order("confirmado_pelo_membro", { ascending: false })
        .order("presente", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        membro_id: r.membro_id,
        nome: r.membros?.nome ?? "—",
        email: r.membros?.email ?? null,
        presente: r.presente,
        confirmado: r.confirmado_pelo_membro === true,
      }));
    },
  });

  const confirmados = lista.filter((r) => r.confirmado && r.presente !== false);
  const presentes   = lista.filter((r) => r.presente === true);
  const semResposta = lista.filter((r) => !r.confirmado && r.presente === null);
  const ausentes    = lista.filter((r) => r.presente === false);

  // Marcação de presença pelo admin (sacristia)
  async function marcarPresenca(presencaId: string, presente: boolean | null) {
    await anyDb
      .from("presencas_eventos")
      .update({ presente })
      .eq("id", presencaId);
    refetch();
  }

  // Adicionar membros ao evento
  async function buscarMembros(termo: string) {
    if (termo.length < 2) { setMembrosBuscados([]); return; }
    const jaConvidados = new Set(lista.map((r) => r.membro_id));
    const { data } = await anyDb
      .from("membros")
      .select("id, nome")
      .eq("paroquia_id", paroquiaId)
      .eq("ativo", true)
      .ilike("nome", `%${termo}%`)
      .limit(20);
    setMembrosBuscados(
      ((data ?? []) as MembroPicker[]).filter((m) => !jaConvidados.has(m.id))
    );
  }

  async function adicionarMembro(membro: MembroPicker) {
    await anyDb.from("presencas_eventos").insert({
      evento_id: evento!.id,
      membro_id: membro.id,
      presente: null,
      confirmado_pelo_membro: false,
    });
    setMembrosBuscados((prev) => prev.filter((m) => m.id !== membro.id));
    setBusca("");
    refetch();
    toast.success(`${membro.nome} adicionado.`);
  }

  // Notificar todos os convidados (push + email)
  async function notificarMembros() {
    if (!evento || lista.length === 0) return;
    setNotificando(true);
    try {
      const dataEvento = evento.data_inicio.slice(0, 10);
      const hora = evento.data_inicio.slice(11, 16);
      // Push notifications
      const notifs = lista.map((r) => ({
        paroquia_id: paroquiaId,
        membro_id: r.membro_id,
        titulo: `📅 ${evento.titulo}`,
        mensagem: `Você foi convidado para: ${evento.titulo}${evento.local ? ` — ${evento.local}` : ""}. Data: ${format(parseISO(dataEvento), "dd/MM/yyyy")}${hora && hora !== "00:00" ? ` às ${hora}` : ""}.`,
        tipo: "info",
        lida: false,
        apenas_admin: false,
        link_referencia: "/portal-membro/eventos",
      }));
      await anyDb.from("notificacoes").insert(notifs);
      // Emails com rate limit
      let emailsEnviados = 0;
      for (let i = 0; i < lista.length; i++) {
        const r = lista[i];
        if (!r.email) continue;
        if (emailsEnviados > 0) await new Promise((res) => setTimeout(res, 400));
        await supabase.functions.invoke("send-email", {
          body: {
            template: "evento_convite",
            to: r.email,
            nome: r.nome,
            paroquia: paroquiaNome,
            escalaTitulo: evento.titulo,
            escalaData: dataEvento,
            escalaHora: hora,
          },
        });
        emailsEnviados++;
      }
      toast.success(`Notificação enviada para ${lista.length} membro(s).`);
    } catch (e) {
      toast.error(supabaseErrorMessage(e));
    } finally {
      setNotificando(false);
    }
  }

  // Reset ao fechar
  function handleClose() {
    setBusca("");
    setAdicionandoMembros(false);
    setMembrosBuscados([]);
    onClose();
  }

  return (
    <Sheet open={!!evento} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-5 pb-3 border-b border-border">
          <SheetTitle className="truncate text-base">{evento?.titulo}</SheetTitle>
          {evento && (
            <p className="text-xs text-muted-foreground">
              {format(parseISO(evento.data_inicio.slice(0, 10)), "d 'de' MMMM", { locale: ptBR })}
              {evento.data_inicio.slice(11, 16) !== "00:00" && ` · ${evento.data_inicio.slice(11, 16)}`}
              {evento.local && ` · ${evento.local}`}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {/* Resumo numérico */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { value: confirmados.length, label: "confirmados", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" },
                  { value: semResposta.length, label: "sem resposta", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
                  { value: presentes.length,   label: "presentes",   color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
                  { value: ausentes.length,    label: "ausentes",    color: "text-red-600 bg-red-50 dark:bg-red-950/30" },
                ].map(({ value, label, color }) => (
                  <div key={label} className={`rounded-xl px-2 py-2.5 text-center ${color}`}>
                    <p className="text-lg font-bold tabular-nums">{value}</p>
                    <p className="text-[10px] leading-tight">{label}</p>
                  </div>
                ))}
              </div>

              {/* Ações admin */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs h-8 gap-1.5"
                  onClick={() => setAdicionandoMembros((v) => !v)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Adicionar membros
                </Button>
                {lista.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs h-8 gap-1.5"
                    disabled={notificando}
                    onClick={notificarMembros}
                  >
                    {notificando
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Bell className="h-3.5 w-3.5" />}
                    Notificar convidados
                  </Button>
                )}
              </div>

              {/* Busca de membros para adicionar */}
              {adicionandoMembros && (
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="pl-7 h-8 text-sm rounded-lg"
                      placeholder="Buscar membro pelo nome…"
                      value={busca}
                      onChange={(e) => {
                        setBusca(e.target.value);
                        buscarMembros(e.target.value);
                      }}
                    />
                  </div>
                  {membrosBuscados.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {membrosBuscados.map((m) => (
                        <button
                          key={m.id}
                          className="w-full text-left text-sm px-3 py-1.5 rounded-lg hover:bg-accent flex items-center justify-between gap-2"
                          onClick={() => adicionarMembro(m)}
                        >
                          <span>{m.nome}</span>
                          <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {busca.length >= 2 && membrosBuscados.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-1">Nenhum resultado</p>
                  )}
                </div>
              )}

              {/* Lista completa de membros com marcação de presença */}
              {lista.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">Nenhum membro convidado ainda.</p>
                  <p className="text-xs text-muted-foreground mt-1">Use o botão acima para adicionar.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Confirmados */}
                  {confirmados.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-2">Confirmados</p>
                      <div className="space-y-1.5">
                        {confirmados.map((r) => (
                          <PresencaItem key={r.id} row={r} onMarcar={marcarPresenca} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sem resposta */}
                  {semResposta.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2">Sem resposta</p>
                      <div className="space-y-1.5">
                        {semResposta.map((r) => (
                          <PresencaItem key={r.id} row={r} onMarcar={marcarPresenca} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Presentes (sacristia) */}
                  {presentes.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-2">Presentes — sacristia</p>
                      <div className="space-y-1.5">
                        {presentes.map((r) => (
                          <PresencaItem key={r.id} row={r} onMarcar={marcarPresenca} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ausentes */}
                  {ausentes.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-2">Ausentes</p>
                      <div className="space-y-1.5">
                        {ausentes.map((r) => (
                          <PresencaItem key={r.id} row={r} onMarcar={marcarPresenca} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── PresencaItem ──────────────────────────────────────────────────────────

function PresencaItem({
  row,
  onMarcar,
}: {
  row: PresencaRow;
  onMarcar: (id: string, presente: boolean | null) => void;
}) {
  const icon = row.presente === true
    ? <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
    : row.presente === false
      ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
      : row.confirmado
        ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        : <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {icon}
      <span className="text-sm flex-1 min-w-0 truncate">{row.nome}</span>
      {/* Botões de marcação de presença (sacristia) */}
      <div className="flex gap-1 shrink-0">
        <button
          title="Marcar presente"
          className={`h-6 w-6 rounded-md flex items-center justify-center transition-colors ${
            row.presente === true
              ? "bg-blue-500 text-white"
              : "hover:bg-blue-100 dark:hover:bg-blue-950/40 text-muted-foreground"
          }`}
          onClick={() => onMarcar(row.id, row.presente === true ? null : true)}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
        <button
          title="Marcar ausente"
          className={`h-6 w-6 rounded-md flex items-center justify-center transition-colors ${
            row.presente === false
              ? "bg-red-500 text-white"
              : "hover:bg-red-100 dark:hover:bg-red-950/40 text-muted-foreground"
          }`}
          onClick={() => onMarcar(row.id, row.presente === false ? null : false)}
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── EventoCard ─────────────────────────────────────────────────────────────

function EventoCard({ evento, isAdmin, onEdit, onDelete, onVerPresencas }: {
  evento: Evento; isAdmin: boolean; onEdit: () => void; onDelete: () => void; onVerPresencas: () => void;
}) {
  const hora  = evento.data_inicio.slice(11, 16);
  const cor   = corTipo(evento.tipo);
  const label = labelTipo(evento.tipo);
  const taxaPresenca = evento.total_membros > 0
    ? Math.round((evento.total_confirmados / evento.total_membros) * 100)
    : null;
  const isAutoEscala = !!evento.escala_id;

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 flex gap-3">
      <div className="w-1 rounded-full shrink-0 self-stretch" style={{ backgroundColor: cor }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 justify-between">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{evento.titulo}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 rounded-full" style={{ borderColor: cor, color: cor }}>
                {label}
              </Badge>
              {isAutoEscala && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 rounded-full text-amber-600 border-amber-300">
                  Solenidade
                </Badge>
              )}
              {evento.obrigatorio && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 rounded-full text-rose-600 border-rose-300">
                  Obrigatório
                </Badge>
              )}
            </div>
          </div>
          {isAdmin && !isAutoEscala && (
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
          {hora && hora !== "00:00" && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {hora}
            </span>
          )}
          {evento.local && (
            <span className="flex items-center gap-1 truncate max-w-[180px]">
              <MapPin className="h-3 w-3 shrink-0" /> {evento.local}
            </span>
          )}
          <button
            className="flex items-center gap-1 ml-auto hover:underline underline-offset-2 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onVerPresencas(); }}
            title="Ver lista de presenças"
          >
            <Users className="h-3 w-3" />
            {evento.total_membros > 0
              ? <>
                  {evento.total_confirmados}/{evento.total_membros}
                  {taxaPresenca !== null && (
                    <span className={taxaPresenca >= 75 ? "text-emerald-600" : taxaPresenca >= 50 ? "text-amber-600" : "text-red-600"}>
                      ({taxaPresenca}%)
                    </span>
                  )}
                </>
              : <span className="text-muted-foreground">Gerenciar</span>
            }
          </button>
        </div>
        {isAutoEscala && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Criado automaticamente ao publicar a escala. Acesse a sacristia para registrar presenças.
          </p>
        )}
      </div>
    </div>
  );
}
