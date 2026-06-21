import { createFileRoute } from "@tanstack/react-router";
import { useSetPageTabs } from "@/contexts/page-tabs";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Plus, Pencil, Trash2, Loader2, CalendarRange, MapPin,
  Users, CheckCircle2, XCircle, ChevronDown, ChevronUp, Clock,
  UserCheck, Search, Mail, X as XIcon,
  BookOpen, Link2, FileText, Video, ClipboardList, Eye, EyeOff,
  GripVertical, PlusCircle, Download, FileSpreadsheet, NotebookPen,
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
  head: () => ({ meta: [{ title: "Agenda Pastoral â€” Lumen Pastoral" }] }),
});

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TIPOS: { value: string; label: string; cor: string }[] = [
  { value: "formacao",    label: "Formação",              cor: "bg-blue-500/10 text-blue-700 border-blue-200" },
  { value: "reuniao",     label: "Reunião",               cor: "bg-slate-500/10 text-slate-700 border-slate-200" },
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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function tipoBadge(tipo: string) {
  const t = TIPOS.find((x) => x.value === tipo);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${t?.cor ?? "bg-muted text-muted-foreground border-border"}`}>
      {t?.label ?? tipo}
    </span>
  );
}

// â”€â”€ Formações: tipos e constantes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Material = {
  id: string;
  titulo: string;
  tipo: "pauta" | "documento" | "video" | "artigo" | "link";
  descricao: string | null;
  url: string | null;
  conteudo: string | null;
  itens: { texto: string; concluido: boolean }[] | null;
  data_reuniao: string | null;
  publicado: boolean;
  ordem: number;
  evento_id: string | null;
  created_at: string;
};

type MaterialForm = {
  titulo: string;
  tipo: Material["tipo"];
  descricao: string;
  url: string;
  conteudo: string;
  itens: { texto: string; concluido: boolean }[];
  data_reuniao: string;
  publicado: boolean;
};

const MATERIAL_TIPOS: { value: Material["tipo"]; label: string; icon: React.ReactNode; cor: string }[] = [
  { value: "pauta",     label: "Pauta de Reunião", icon: <ClipboardList className="h-4 w-4" />, cor: "bg-slate-500/10 text-slate-700 border-slate-200 dark:text-slate-300 dark:border-slate-700" },
  { value: "documento", label: "Documento / PDF",  icon: <FileText      className="h-4 w-4" />, cor: "bg-red-500/10 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800"           },
  { value: "video",     label: "Vídeo",            icon: <Video         className="h-4 w-4" />, cor: "bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800"       },
  { value: "artigo",    label: "Artigo / Texto",   icon: <BookOpen      className="h-4 w-4" />, cor: "bg-green-500/10 text-green-700 border-green-200 dark:text-green-400 dark:border-green-800"  },
  { value: "link",      label: "Link Externo",     icon: <Link2         className="h-4 w-4" />, cor: "bg-purple-500/10 text-purple-700 border-purple-200 dark:text-purple-400 dark:border-purple-800" },
];

const MATERIAL_EMPTY: MaterialForm = {
  titulo: "", tipo: "pauta", descricao: "", url: "", conteudo: "",
  itens: [{ texto: "", concluido: false }], data_reuniao: "", publicado: false,
};

function tipoInfo(tipo: Material["tipo"]) {
  return MATERIAL_TIPOS.find((t) => t.value === tipo) ?? MATERIAL_TIPOS[0];
}

function MateriaisSection({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [editTarget, setEditTarget]     = useState<Material | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [filtroTipo, setFiltroTipo]     = useState<string>("todos");

  const { data: materiais = [], isLoading } = useQuery<Material[]>({
    queryKey: ["formacoes_materiais", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("formacoes_materiais")
        .select("*")
        .eq("paroquia_id", paroquiaId)
        .is("evento_id", null)
        .order("data_reuniao", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Material[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (form: MaterialForm & { id?: string }) => {
      const payload = {
        paroquia_id: paroquiaId,
        titulo: form.titulo.trim(),
        tipo: form.tipo,
        descricao: form.descricao.trim() || null,
        url: form.url.trim() || null,
        conteudo: form.conteudo.trim() || null,
        itens: form.tipo === "pauta" ? form.itens.filter((i) => i.texto.trim()) : null,
        data_reuniao: form.tipo === "pauta" && form.data_reuniao ? form.data_reuniao : null,
        publicado: form.publicado,
      };
      if (form.id) {
        const { error } = await anyDb.from("formacoes_materiais").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb.from("formacoes_materiais").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["formacoes_materiais", paroquiaId] });
      toast.success(editTarget ? "Material atualizado." : "Material adicionado.");
      setSheetOpen(false); setEditTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const togglePublicado = useMutation({
    mutationFn: async ({ id, publicado }: { id: string; publicado: boolean }) => {
      const { error } = await anyDb.from("formacoes_materiais").update({ publicado }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["formacoes_materiais", paroquiaId] }),
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("formacoes_materiais").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["formacoes_materiais", paroquiaId] });
      toast.success("Removido."); setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const filtered = filtroTipo === "todos" ? materiais : materiais.filter((m) => m.tipo === filtroTipo);

  function openNew() { setEditTarget(null); setSheetOpen(true); }
  function openEdit(m: Material) { setEditTarget(m); setSheetOpen(true); }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl">Formações e Pautas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pautas de reunião, materiais formativos e conteúdo para os membros.
          </p>
        </div>
        <Button size="sm" className="rounded-xl shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[{ value: "todos", label: "Todos" }, ...MATERIAL_TIPOS.map((t) => ({ value: t.value, label: t.label }))].map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFiltroTipo(f.value)}
            className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-all ${
              filtroTipo === f.value
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-border/50 hover:border-border hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-14 text-center">
          <BookOpen className="h-9 w-9 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium text-foreground/70">Nenhum material ainda</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Adicione pautas de reunião, documentos ou Vídeos formativos.
          </p>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Adicionar primeiro material
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              onEdit={() => openEdit(m)}
              onDelete={() => setDeleteTarget(m)}
              onTogglePublicado={(pub) => togglePublicado.mutate({ id: m.id, publicado: pub })}
            />
          ))}
        </div>
      )}

      <MaterialSheet
        open={sheetOpen}
        initial={editTarget}
        saving={saveMut.isPending}
        onClose={() => { setSheetOpen(false); setEditTarget(null); }}
        onSave={(form) => saveMut.mutate(editTarget ? { ...form, id: editTarget.id } : form)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover material?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.titulo}" será excluído permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MaterialCard({
  material: m, onEdit, onDelete, onTogglePublicado,
}: {
  material: Material;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublicado: (pub: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const info = tipoInfo(m.tipo);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border ${info.cor}`}>
          {info.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold leading-tight truncate">{m.titulo}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${info.cor}`}>
              {info.label}
            </span>
          </div>
          {m.tipo === "pauta" && m.data_reuniao && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {format(new Date(m.data_reuniao + "T12:00:00"), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          )}
          {m.tipo !== "pauta" && m.descricao && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{m.descricao}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={m.publicado ? "Publicado â€” clique para ocultar" : "Rascunho â€” clique para publicar"}
            onClick={() => onTogglePublicado(!m.publicado)}
            className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
              m.publicado ? "text-green-600 hover:bg-green-50" : "text-muted-foreground/40 hover:bg-muted"
            }`}
          >
            {m.publicado ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {m.url && (
            <a
              href={m.url} target="_blank" rel="noopener noreferrer"
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              title="Abrir link"
            >
              <Link2 className="h-3.5 w-3.5" />
            </a>
          )}
          {(m.tipo === "pauta" || m.conteudo || (m.itens && m.itens.length > 0)) && (
            <button
              type="button"
              onClick={() => setExpanded((p) => !p)}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button" onClick={onEdit}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" onClick={onDelete}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/80 hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border/50 px-4 py-4 bg-muted/20">
          {m.tipo === "pauta" && m.itens && m.itens.length > 0 && (
            <ul className="space-y-1.5">
              {m.itens.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 text-[10px] font-bold ${
                    item.concluido ? "bg-green-500 border-green-500 text-white" : "border-border"
                  }`}>
                    {item.concluido ? "âœ“" : ""}
                  </span>
                  <span className={item.concluido ? "line-through text-muted-foreground" : ""}>{item.texto}</span>
                </li>
              ))}
            </ul>
          )}
          {m.tipo === "artigo" && m.conteudo && (
            <p className="text-sm text-foreground/80 whitespace-pre-line leading-relaxed">{m.conteudo}</p>
          )}
          {m.tipo !== "pauta" && m.tipo !== "artigo" && m.descricao && (
            <p className="text-sm text-foreground/80 leading-relaxed">{m.descricao}</p>
          )}
        </div>
      )}
    </div>
  );
}

function MaterialSheet({
  open, initial, saving, onClose, onSave,
}: {
  open: boolean;
  initial: Material | null;
  saving: boolean;
  onClose: () => void;
  onSave: (form: MaterialForm) => void;
}) {
  const [form, setForm] = useState<MaterialForm>(MATERIAL_EMPTY);

  useEffect(() => {
    if (open) {
      setForm(initial
        ? {
            titulo:       initial.titulo,
            tipo:         initial.tipo,
            descricao:    initial.descricao ?? "",
            url:          initial.url ?? "",
            conteudo:     initial.conteudo ?? "",
            itens:        initial.itens ?? [{ texto: "", concluido: false }],
            data_reuniao: initial.data_reuniao ?? "",
            publicado:    initial.publicado,
          }
        : MATERIAL_EMPTY
      );
    }
  }, [open, initial]);

  function set<K extends keyof MaterialForm>(k: K, v: MaterialForm[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function addItem() { set("itens", [...form.itens, { texto: "", concluido: false }]); }
  function removeItem(i: number) { set("itens", form.itens.filter((_, j) => j !== i)); }
  function updateItem(i: number, texto: string) {
    set("itens", form.itens.map((it, j) => j === i ? { ...it, texto } : it));
  }
  function toggleItem(i: number) {
    set("itens", form.itens.map((it, j) => j === i ? { ...it, concluido: !it.concluido } : it));
  }

  function handleSave() {
    if (!form.titulo.trim()) { toast.error("Título obrigatório."); return; }
    if (form.tipo === "pauta" && !form.data_reuniao) { toast.error("Informe a data da reunião."); return; }
    onSave(form);
  }

  const info = tipoInfo(form.tipo);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-5 border-b border-border/60">
          <SheetTitle className="font-serif text-xl">
            {initial ? "Editar material" : "Novo material"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pt-5 pb-24">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MATERIAL_TIPOS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set("tipo", t.value)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                    form.tipo === t.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Título</Label>
            <Input
              value={form.titulo}
              onChange={(e) => set("titulo", e.target.value)}
              placeholder={form.tipo === "pauta" ? "Ex: Reunião mensal de coordenação" : "Título do material"}
            />
          </div>

          {form.tipo === "pauta" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data da reunião</Label>
              <Input type="date" value={form.data_reuniao} onChange={(e) => set("data_reuniao", e.target.value)} />
            </div>
          )}

          {["documento", "video", "link"].includes(form.tipo) && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {form.tipo === "video" ? "Link do Vídeo (YouTube, Driveâ€¦)" : "URL do arquivo ou página"}
              </Label>
              <Input type="url" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://â€¦" />
            </div>
          )}

          {["documento", "video", "link"].includes(form.tipo) && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição (opcional)</Label>
              <Textarea rows={3} value={form.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="Breve descrição do conteúdoâ€¦" />
            </div>
          )}

          {form.tipo === "artigo" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">conteúdo</Label>
              <Textarea
                rows={8}
                value={form.conteudo}
                onChange={(e) => set("conteudo", e.target.value)}
                placeholder="Escreva o conteúdo formativo aquiâ€¦"
                className="font-mono text-sm leading-relaxed"
              />
            </div>
          )}

          {form.tipo === "pauta" && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Itens da pauta</Label>
              <div className="space-y-1.5">
                {form.itens.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    <button
                      type="button"
                      onClick={() => toggleItem(i)}
                      className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        item.concluido ? "bg-green-500 border-green-500 text-white" : "border-border hover:border-foreground"
                      }`}
                    >
                      {item.concluido && <CheckCircle2 className="h-3 w-3" />}
                    </button>
                    <Input
                      value={item.texto}
                      onChange={(e) => updateItem(i, e.target.value)}
                      placeholder={`Item ${i + 1}`}
                      className={`flex-1 h-8 text-sm ${item.concluido ? "line-through text-muted-foreground" : ""}`}
                    />
                    <button
                      type="button" onClick={() => removeItem(i)}
                      className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors shrink-0"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addItem}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
                >
                  <PlusCircle className="h-3.5 w-3.5" /> Adicionar item
                </button>
              </div>
              <div className="space-y-1.5 mt-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Anotações / ata (opcional)</Label>
                <Textarea
                  rows={4}
                  value={form.conteudo}
                  onChange={(e) => set("conteudo", e.target.value)}
                  placeholder="Decisões tomadas, encaminhamentos, observaçõesâ€¦"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Publicar para membros</p>
              <p className="text-xs text-muted-foreground">
                {form.publicado ? "Visível no portal do membro." : "Apenas visível para coordenação."}
              </p>
            </div>
            <Switch checked={form.publicado} onCheckedChange={(v) => set("publicado", v)} />
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-border/60 bg-background px-6 py-4 flex gap-2">
          <Button className="flex-1 rounded-xl" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (initial ? "Salvar alterações" : "Adicionar")}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AgendaPastoralPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;
  const qc = useQueryClient();

  const [view, setView]                 = useState<"eventos" | "formacoes">("eventos");
  const [formOpen, setFormOpen]         = useState(false);
  const [editTarget, setEditTarget]     = useState<Evento | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Evento | null>(null);
  const [presencaEvento, setPresencaEvento] = useState<Evento | null>(null);
  const [conteudoEvento, setConteudoEvento] = useState<Evento | null>(null);
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
      // datetime-local value is local time without timezone â€” convert to UTC ISO string
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

  useSetPageTabs([
    { label: "Eventos",   onClick: () => setView("eventos"),   isActive: view === "eventos",   badge: eventos.length > 0 ? eventos.length : undefined },
    { label: "Formações", onClick: () => setView("formacoes"), isActive: view === "formacoes" },
  ]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24 lg:pb-10">
        <PageSkeleton cards={4} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6 pb-24 lg:pb-10">

      {/* â”€â”€ Eventos â”€â”€ */}
      {view === "eventos" && (<>
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-header-title">Agenda Pastoral</h1>
            <p className="page-header-sub">
              Reuniões, retiros, ensaios, encontros e compromissos.
            </p>
          </div>
          <Button onClick={() => { setEditTarget(null); setFormOpen(true); }} className="shrink-0 h-9 rounded-xl">
            <Plus className="h-4 w-4 mr-1" /> Novo evento
          </Button>
        </div>

        {/* Tipo filter chips */}
        {eventos.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {tipoOptions.map((t) => (
              <button
                key={t.value}
                onClick={() => setTipoFilter(t.value)}
                className={`filter-chip shrink-0 ${tipoFilter === t.value ? "filter-chip-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {eventos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <CalendarRange className="h-5 w-5" />
            </div>
            <p className="empty-state-title">Nenhum evento cadastrado</p>
            <p className="empty-state-desc">
              Registre reuniões, formações, retiros, ensaios e compromissos pastorais.
            </p>
            <Button className="mt-2 rounded-xl" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Criar primeiro evento
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">Nenhum evento nesta categoria</p>
            <p className="empty-state-desc">Tente outro filtro de tipo.</p>
            <button
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() => setTipoFilter("todos")}
            >Limpar filtro</button>
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
                onConteudo={setConteudoEvento}
              />
            )}
            {passados.length > 0 && (
              <EventoSection
                titulo="Realizados"
                eventos={passados}
                onEdit={(e) => { setEditTarget(e); setFormOpen(true); }}
                onDelete={setDeleteTarget}
                onPresenca={setPresencaEvento}
                onConteudo={setConteudoEvento}
              />
            )}
          </div>
        )}
      </>)}

      {/* â”€â”€ Formações â”€â”€ */}
      {view === "formacoes" && (
        <MateriaisSection paroquiaId={pid ?? ""} />
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

      {/* Ata & Conteúdo Sheet */}
      {conteudoEvento && pid && (
        <EventoConteudoSheet
          evento={conteudoEvento}
          paroquiaId={pid}
          onClose={() => setConteudoEvento(null)}
        />
      )}
    </div>
  );
}

// â”€â”€ EventoSection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EventoSection({
  titulo, eventos, onEdit, onDelete, onPresenca, onConteudo,
}: {
  titulo: string;
  eventos: Evento[];
  onEdit: (e: Evento) => void;
  onDelete: (e: Evento) => void;
  onPresenca: (e: Evento) => void;
  onConteudo: (e: Evento) => void;
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
                    <Badge variant="destructive" className="text-xs">obrigatório</Badge>
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
                    {e.data_fim && ` â€“ ${format(parseISO(e.data_fim), "HH:mm")}`}
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
                onClick={() => onConteudo(e)}
                className="text-xs h-8"
              >
                <NotebookPen className="h-3.5 w-3.5 mr-1" />
                <span className="hidden sm:inline">Ata & </span>Conteúdo
              </Button>
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

// â”€â”€ EventoFormSheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
                  <SelectValue placeholder="Selecione a comunidadeâ€¦" />
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
                  placeholder="Descreva o localâ€¦"
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
                      placeholder="Buscar membroâ€¦"
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
                placeholder="Pauta, objetivos, detalhes do eventoâ€¦"
              />
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <Label>Observações internas</Label>
              <Textarea
                rows={2}
                value={form.observacoes}
                onChange={(e) => f("observacoes", e.target.value)}
                placeholder="Instruções, lembretes, informações adicionaisâ€¦"
              />
            </div>

            {/* obrigatório */}
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

// â”€â”€ PresencaSheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        membro_nome: r.membros?.nome ?? "â€”",
      }));
    },
  });

  const presencaMap = new Map(presencas.map((p) => [p.membro_id, p]));

  const marcarMutation = useMutation({
    mutationFn: async ({ membroId, presente }: { membroId: string; presente: boolean | null }) => {
      // RPC atÍ´mica: atualiza presencas_eventos + historico_participacoes
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

  function exportCSV() {
    const dataFormatada = format(parseISO(evento.data_inicio), "d 'de' MMMM 'de' yyyy", { locale: ptBR });
    const pct = total > 0 ? Math.round((presentes / total) * 100) : 0;

    const rows: string[][] = [
      ["Relatório de Presença — " + evento.titulo],
      ["Data", dataFormatada],
      ["Tipo", TIPOS.find((t) => t.value === evento.tipo)?.label ?? evento.tipo],
      ["Total de membros", String(total)],
      ["Presentes", String(presentes)],
      ["Ausentes", String(ausentes)],
      ["Sem registro", String(total - presencas.length)],
      ["Taxa de presença", pct + "%"],
      [],
      ["Nome", "Status", "Justificativa", "Observações"],
    ];

    for (const m of membros) {
      const p = presencaMap.get(m.id);
      const status = p?.presente === true ? "Presente"
        : p?.presente === false ? "Ausente"
        : p ? "Confirmado (portal)"
        : "Sem registro";
      rows.push([m.nome, status, p?.justificativa ?? "", p?.observacoes ?? ""]);
    }

    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `presenca_${evento.titulo.replace(/\s+/g, "_")}_${evento.data_inicio.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex-row items-center justify-between pr-8">
          <SheetTitle>Registro de Presença</SheetTitle>
          <Button size="sm" variant="outline" onClick={exportCSV} className="h-8 text-xs gap-1.5 shrink-0">
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Button>
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
            {total > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Taxa de presença</span>
                  <span className="font-semibold">{Math.round((presentes / total) * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.round((presentes / total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
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

// â”€â”€ JustificativaRow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        placeholder="Justificativa de ausênciaâ€¦"
        value={just}
        onChange={(e) => setJust(e.target.value)}
      />
      <div className="flex gap-2">
        <Input
          className="h-8 text-sm flex-1"
          placeholder="Observações internasâ€¦"
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

// ── EventoConteudoSheet ────────────────────────────────────────────────────────

function EventoConteudoSheet({
  evento, paroquiaId, onClose,
}: {
  evento: Evento;
  paroquiaId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);

  const qKey = ["formacoes_materiais_evento", evento.id];

  const { data: materiais = [], isLoading } = useQuery<Material[]>({
    queryKey: qKey,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("formacoes_materiais")
        .select("*")
        .eq("paroquia_id", paroquiaId)
        .eq("evento_id", evento.id)
        .order("ordem")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Material[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (form: MaterialForm & { id?: string }) => {
      const payload = {
        paroquia_id: paroquiaId,
        evento_id: evento.id,
        titulo: form.titulo.trim(),
        tipo: form.tipo,
        descricao: form.descricao.trim() || null,
        url: form.url.trim() || null,
        conteudo: form.conteudo.trim() || null,
        itens: form.tipo === "pauta" ? form.itens.filter((i) => i.texto.trim()) : null,
        data_reuniao: form.tipo === "pauta" && form.data_reuniao ? form.data_reuniao : evento.data_inicio.slice(0, 10),
        publicado: form.publicado,
      };
      if (form.id) {
        const { error } = await anyDb.from("formacoes_materiais").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb.from("formacoes_materiais").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast.success(editTarget ? "Material atualizado." : "Conteúdo adicionado.");
      setSheetOpen(false);
      setEditTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const togglePublicado = useMutation({
    mutationFn: async ({ id, publicado }: { id: string; publicado: boolean }) => {
      const { error } = await anyDb.from("formacoes_materiais").update({ publicado }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qKey }),
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("formacoes_materiais").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast.success("Removido.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const pautas = materiais.filter((m) => m.tipo === "pauta");
  const outros = materiais.filter((m) => m.tipo !== "pauta");

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/60">
            <div className="flex items-center gap-2">
              <NotebookPen className="h-4 w-4 text-muted-foreground shrink-0" />
              <SheetTitle className="font-serif text-lg leading-tight">Ata & Conteúdo</SheetTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {evento.titulo} · {format(parseISO(evento.data_inicio), "d 'de' MMMM", { locale: ptBR })}
            </p>
          </SheetHeader>

          <div className="mt-4 space-y-5 pb-24">
            {/* Pauta / ata */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Pauta & Ata do encontro
                </p>
                {pautas.length === 0 && (
                  <button
                    type="button"
                    onClick={() => { setEditTarget(null); setSheetOpen(true); }}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <PlusCircle className="h-3 w-3" /> Registrar
                  </button>
                )}
              </div>
              {isLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : pautas.length === 0 ? (
                <button
                  type="button"
                  onClick={() => { setEditTarget(null); setSheetOpen(true); }}
                  className="w-full rounded-xl border border-dashed border-border p-6 text-center hover:bg-muted/30 transition group"
                >
                  <ClipboardList className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2 group-hover:text-muted-foreground/50 transition" />
                  <p className="text-sm text-muted-foreground">Nenhuma pauta registrada</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Clique para adicionar a pauta e a ata do encontro</p>
                </button>
              ) : (
                <div className="space-y-2">
                  {pautas.map((m) => (
                    <MaterialCard
                      key={m.id}
                      material={m}
                      onEdit={() => { setEditTarget(m); setSheetOpen(true); }}
                      onDelete={() => setDeleteTarget(m)}
                      onTogglePublicado={(pub) => togglePublicado.mutate({ id: m.id, publicado: pub })}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => { setEditTarget(null); setSheetOpen(true); }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition mt-1"
                  >
                    <PlusCircle className="h-3 w-3" /> Adicionar outra pauta
                  </button>
                </div>
              )}
            </div>

            {/* Materiais de apoio */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Materiais & conteúdo
                </p>
                <button
                  type="button"
                  onClick={() => { setEditTarget(null); setSheetOpen(true); }}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <PlusCircle className="h-3 w-3" /> Adicionar
                </button>
              </div>
              {outros.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Nenhum material vinculado — documentos, vídeos e links aparecerão aqui.
                </p>
              ) : (
                <div className="space-y-2">
                  {outros.map((m) => (
                    <MaterialCard
                      key={m.id}
                      material={m}
                      onEdit={() => { setEditTarget(m); setSheetOpen(true); }}
                      onDelete={() => setDeleteTarget(m)}
                      onTogglePublicado={(pub) => togglePublicado.mutate({ id: m.id, publicado: pub })}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
              <Eye className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Materiais com <strong>Publicado</strong> ativo ficam visíveis para os membros no portal, na aba Agenda.</span>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 border-t border-border/60 bg-background px-5 py-4">
            <Button
              className="w-full rounded-xl"
              onClick={() => { setEditTarget(null); setSheetOpen(true); }}
            >
              <PlusCircle className="h-4 w-4 mr-1.5" />
              Adicionar conteúdo ao encontro
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sub-sheet para criar/editar material */}
      <MaterialSheet
        open={sheetOpen}
        initial={editTarget}
        saving={saveMut.isPending}
        onClose={() => { setSheetOpen(false); setEditTarget(null); }}
        onSave={(form) => saveMut.mutate(editTarget ? { ...form, id: editTarget.id } : form)}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover material?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.titulo}</strong> será removido deste encontro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

