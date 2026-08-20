import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Plus, ChevronLeft, ChevronRight, Users, CheckCircle2, Clock, Calendar,
  Loader2, Pencil, Trash2, X, MapPin, BookOpen,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  total_presencas: number;
  total_membros: number;
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

function RouteComponent() {
  const { profile, roles } = useAuth();
  const qc = useQueryClient();
  const pid = profile?.paroquia_id;
  const isAdmin = roles.some((r) => ["admin_paroquial", "super_admin", "coordenador"].includes(r));

  const [mes, setMes] = useState(() => startOfMonth(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormEvento>(FORM_EMPTY);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
          presencas_eventos(id, presente)
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
        total_membros: (ev.presencas_eventos ?? []).length,
        total_presencas: (ev.presencas_eventos ?? []).filter((p: any) => p.presente === true).length,
      }));
    },
  });

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
        const { error } = await supabase.from("formacoes_eventos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["formacoes-eventos", pid, format(mes, "yyyy-MM")] });
      toast.success(editId ? "Evento atualizado." : "Evento criado.");
      setFormOpen(false);
      setEditId(null);
      setForm(FORM_EMPTY);
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

  const totalPresencas = eventos.reduce((s, e) => s + e.total_presencas, 0);
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
              />
            ))}
          </div>
        </div>
      ))}

      {/* Dialog criar/editar */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditId(null); setForm(FORM_EMPTY); } }}>
        <DialogContent className="max-w-md">
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

function EventoCard({ evento, isAdmin, onEdit, onDelete }: {
  evento: Evento; isAdmin: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const hora  = evento.data_inicio.slice(11, 16);
  const cor   = corTipo(evento.tipo);
  const label = labelTipo(evento.tipo);
  const taxaPresenca = evento.total_membros > 0
    ? Math.round((evento.total_presencas / evento.total_membros) * 100)
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
          {evento.total_membros > 0 && (
            <span className="flex items-center gap-1 ml-auto">
              <Users className="h-3 w-3" />
              {evento.total_presencas}/{evento.total_membros}
              {taxaPresenca !== null && (
                <span className={taxaPresenca >= 75 ? "text-emerald-600" : taxaPresenca >= 50 ? "text-amber-600" : "text-red-600"}>
                  ({taxaPresenca}%)
                </span>
              )}
            </span>
          )}
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
