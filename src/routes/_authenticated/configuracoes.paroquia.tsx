import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, GripVertical, Church, Pencil,
  MapPin, Users, Layers, Tag, Copy, BookOpen, ChevronRight, ChevronLeft,
  Settings2, CalendarCheck, Award, FileImage, UserCheck, Gauge,
  ListOrdered, Music2, RotateCcw,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/hooks/use-auth";
import { useSetPageTabs } from "@/contexts/page-tabs";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

function logDbError(context: string, error: unknown) {
  const e = error as Record<string, unknown>;
  console.error(`[DB ERROR] ${context}`, {
    message: e?.message,
    code: e?.code,
    details: e?.details,
    hint: e?.hint,
    full: error,
  });
  return `${context}: ${e?.message ?? String(error)}`;
}

export const Route = createFileRoute("/_authenticated/configuracoes/paroquia")({
  component: PersonalizacaoPage,
  head: () => ({ meta: [{ title: "Geral — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type RegrasEscala = {
  limite_semanal: number | null;
  limite_mensal: number | null;
  impedir_repeticao_consecutiva: boolean;
  // Modo de confirmação
  confirmacao_escala_ativa: boolean;
  // Antecedência mínima para registrar indisponibilidade (dias)
  dias_antecedencia_indisp: number | null;
  // Distribuição de gênero na escala (% masculino)
  distribuicao_masc_pct?: number;
};

type PontuacaoConfig = {
  presenca_missa: number;
  presenca_formacao: number;
  presenca_reuniao: number;
  presenca_retiro: number;
  presenca_adoracao: number;
  presenca_evento_especial: number;
  presenca_missa_solene: number;
  presenca_missa_bispo: number;
  falta_sem_justificativa: number;
  falta_justificada: number;
  atraso: number;
  ocorrencia_grave: number;
};

type Paroquia = {
  id: string;
  nome: string;
  padroeiro: string | null;
  cidade: string | null;
  diocese: string | null;
  endereco: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  slug: string | null;
  usa_tochas: boolean;
  usa_turibulo: boolean;
  usa_naveta: boolean;
  usa_baculifero: boolean;
  usa_mitrifero: boolean;
  regras_escala: RegrasEscala;
  pontuacao_config: PontuacaoConfig | null;
  pdf_cabecalho_url: string | null;
  pdf_rodape_url: string | null;
  allow_magic_link: boolean;
};

type MissaPadrao = {
  id: string;
  nome: string;
  dia_semana: number;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  tipo: string;
  tipo_missa_id: string | null;
  recorrencia: Recorrencia;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
  observacoes: string | null;
  ativo: boolean;
  ordem: number;
};

type Recorrencia = {
  tipo: "semanal" | "quinzenal" | "quinzenal_1_3" | "quinzenal_2_4" | "mensal_1" | "mensal_2" | "mensal_3" | "mensal_4" | "mensal_ultimo" | "esporadico";
  data?: string;
};

type TipoMissa = {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  icone: string | null;
  usa_turibulo: boolean;
  usa_naveta: boolean;
  usa_baculifero: boolean;
  usa_mitrifero: boolean;
  prioridade_liturgica: number;
  ativo: boolean;
  ordem: number;
};

type TipoMissaFuncao = {
  id: string;
  tipo_missa_id: string;
  ministerio_id: string;
  tipo_vinculo: "obrigatoria" | "opcional";
  quantidade_min: number;
  quantidade_max: number;
  prioridade: number;
  ministerio?: { id: string; nome: string; cor: string };
};

type Comunidade = {
  id: string;
  nome: string;
  tipo: string;
  endereco: string | null;
  responsavel: string | null;
  ativo: boolean;
};

type Coordenador = {
  id: string;
  nome: string;
  funcao_pastoral: string | null;
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  atua_como: string | null;
  comunidade: string | null;
  ativo: boolean;
};

type FuncaoLiturgica = {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  categoria: string | null;
  icone: string | null;
  pontuacao_minima: number;
  exigir_experiencia: boolean;
  mostrar_no_portal: boolean;
  quantidade_padrao: number;
  auto_adicionar: boolean;
  ativo: boolean;
  ordem: number;
};

type Atuacao = {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  icone: string | null;
  ativo: boolean;
  ordem: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TIPOS_COMUNIDADE: Record<string, string> = {
  matriz: "Matriz",
  capela: "Capela",
  comunidade: "Comunidade",
  santuario: "Santuário",
};
const CORES = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6B7280",
];
const FUNCOES_PADRAO = [
  { nome: "Acólito", descricao: "Auxilia nas celebrações litúrgicas", cor: "#6366f1", categoria: "Acólito" },
  { nome: "Leitor", descricao: "Proclama a Palavra de Deus", cor: "#8b5cf6", categoria: "Leitor" },
  { nome: "Ministro da Eucaristia", descricao: "Distribui a comunhão", cor: "#22c55e", categoria: "Ministro da Eucaristia" },
  { nome: "Comentador", descricao: "Guia a participação da assembleia", cor: "#3b82f6", categoria: "Comentador" },
  { nome: "Coroinha", descricao: "Auxilia o sacerdote no altar", cor: "#ec4899", categoria: "Acólito" },
  { nome: "Auxiliar", descricao: "Apoio geral às celebrações", cor: "#6B7280", categoria: "Auxiliar" },
];

const EMPTY_MISSA: Omit<MissaPadrao, "id" | "ordem"> = {
  nome: "", dia_semana: 0, hora_inicio: "", hora_fim: null, local: null,
  tipo: "missa", tipo_missa_id: null, recorrencia: { tipo: "semanal" },
  solene: false, tem_adoracao: false, tem_bispo: false, observacoes: null, ativo: true,
};

const RECORRENCIAS: { value: Recorrencia["tipo"]; label: string }[] = [
  { value: "semanal",       label: "Toda semana" },
  { value: "quinzenal",     label: "Quinzenal" },
  { value: "quinzenal_1_3", label: "Quinzenal (1ª e 3ª semanas)" },
  { value: "quinzenal_2_4", label: "Quinzenal (2ª e 4ª semanas)" },
  { value: "mensal_1",      label: "1ª semana do mês" },
  { value: "mensal_2",      label: "2ª semana do mês" },
  { value: "mensal_3",      label: "3ª semana do mês" },
  { value: "mensal_4",      label: "4ª semana do mês" },
  { value: "mensal_ultimo", label: "Última semana do mês" },
  { value: "esporadico",    label: "Data específica" },
];

const DEFAULT_REGRAS: RegrasEscala = {
  limite_semanal: null, limite_mensal: null,
  impedir_repeticao_consecutiva: false,
  confirmacao_escala_ativa: false,
  dias_antecedencia_indisp: 3,
  distribuicao_masc_pct: 50,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function textInput(value: string, onChange: (v: string) => void, placeholder = "") {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
    />
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SaveBtn({ saving, label = "Salvar alterações" }: { saving: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2"
    >
      {saving && <Loader2 className="h-4 w-4 animate-spin" />} {label}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function PersonalizacaoPage() {
  const { profile, loading: authLoading, isAdmin, isCoordenador } = useAuth();
  const isLimitedCoord = isCoordenador && !isAdmin;
  const qc = useQueryClient();

  const { data: paroquia, isPending, error: paroquiaError } = useQuery<Paroquia | null>({
    queryKey: ["paroquia", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paroquias").select("*")
        .eq("id", profile!.paroquia_id!)
        .maybeSingle();
      if (error) throw error;
      return data as Paroquia | null;
    },
  });

  // Hooks must be called before any early returns
  const [activeSection, setActiveSection] = useState("dados");
  const [mobileView, setMobileView] = useState<"list" | "content">("list");

  useSetPageTabs([
    { label: "Geral",       to: "/configuracoes/paroquia",        isActive: true  },
    { label: "Motor",       to: "/configuracoes-escalas",         isActive: false },
    { label: "Coordenação", to: "/configuracoes/administradores", isActive: false },
    { label: "Auditoria",   to: "/auditoria",                     isActive: false },
  ]);

  if (authLoading || isPending) {
    return (
      <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-4">
        <div className="flex gap-2 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-20 rounded-full bg-muted animate-pulse" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-2xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isLimitedCoord) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  if (paroquiaError) {
    return (
      <div className="p-10 text-sm text-destructive">
        Erro ao carregar paróquia: {paroquiaError.message}
      </div>
    );
  }

  if (!paroquia) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Paróquia não encontrada. (paroquia_id: {profile?.paroquia_id ?? "null"})
      </div>
    );
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["paroquia"] });

  const NAV_GROUPS = [
    {
      label: "Paróquia",
      color: "bg-blue-500",
      items: [
        { id: "dados",       label: "Dados da Paróquia",    icon: Church,       desc: "Nome, endereço e contato",  color: "bg-blue-500" },
        { id: "comunidades", label: "Comunidades",          icon: MapPin,       desc: "Grupos e localidades",      color: "bg-teal-500" },
      ],
    },
    {
      label: "Ministérios",
      color: "bg-purple-500",
      items: [
        { id: "atuacoes",    label: "Atuações",             icon: Layers,       desc: "Áreas de ministério",       color: "bg-purple-500" },
        { id: "funcoes",     label: "Funções Litúrgicas",   icon: Music2,       desc: "Funções por ministério",    color: "bg-indigo-500" },
      ],
    },
    {
      label: "Missas",
      color: "bg-amber-500",
      items: [
        { id: "tipos",       label: "Tipos de Missa",       icon: Tag,          desc: "Categorias de celebração",  color: "bg-amber-500" },
        { id: "missas",      label: "Missas Padrão",        icon: CalendarCheck,desc: "Horários regulares",        color: "bg-orange-500" },
      ],
    },
    {
      label: "Escalas",
      color: "bg-green-600",
      items: [
        { id: "coord",       label: "Coordenadores",        icon: UserCheck,    desc: "Responsáveis por escala",   color: "bg-green-600" },
        { id: "prioridades", label: "Prioridades",          icon: ListOrdered,  desc: "Ordem de alocação",         color: "bg-emerald-500" },
      ],
    },
    {
      label: "Avançado",
      color: "bg-slate-600",
      items: [
        { id: "pdf",         label: "Imagens PDF",          icon: FileImage,    desc: "Cabeçalho e rodapé",        color: "bg-slate-600" },
      ],
    },
  ];

  const allItems = NAV_GROUPS.flatMap((g) => g.items);
  const activeItem = allItems.find((i) => i.id === activeSection);

  const ContentPanel = () => (
    <>
      {activeSection === "dados"       && <IdentidadeTab paroquia={paroquia} onSaved={invalidate} />}
      {activeSection === "comunidades" && <ComunidadesTab paroquiaId={paroquia.id} />}
      {activeSection === "atuacoes"    && <AtuacoesSubTab paroquiaId={paroquia.id} />}
      {activeSection === "funcoes"     && <FuncoesLiturgicasTab paroquiaId={paroquia.id} />}
      {activeSection === "tipos"       && <TiposMissaTab paroquiaId={paroquia.id} />}
      {activeSection === "missas"      && <MissasTab paroquiaId={paroquia.id} />}
      {activeSection === "coord"       && <CoordenadesTab paroquiaId={paroquia.id} />}
      {activeSection === "prioridades" && <TiposPrioridadeTab paroquiaId={paroquia.id} />}
      {activeSection === "regras"      && <RegrasEscalaTab paroquia={paroquia} onSaved={invalidate} />}
      {activeSection === "pontuacao"   && <PontuacaoConfigTab paroquia={paroquia} onSaved={invalidate} />}
      {activeSection === "pdf"         && <PDFImagesTab paroquia={paroquia} onSaved={invalidate} />}
    </>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto pb-24">

      {/* ── Mobile: tela de conteúdo com back button ── */}
      {mobileView === "content" && (
        <div className="lg:hidden animate-slide-up">
          <button
            onClick={() => setMobileView("list")}
            className="mb-5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Geral
          </button>
          <div className="mb-5 pb-4 border-b border-border/60">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">{activeItem?.label}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{activeItem?.desc}</p>
          </div>
          <ContentPanel />
        </div>
      )}

      {/* ── Mobile: lista de cards (estilo iPhone Settings) ── */}
      {mobileView === "list" && (
        <div className="lg:hidden">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Configurações</p>
              <h1 className="mt-1.5 font-serif text-2xl">Geral</h1>
            </div>
            <Link
              to="/admin/liturgia"
              className="inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted hover:border-primary/30 hover:text-primary"
            >
              <BookOpen className="h-4 w-4 text-primary shrink-0" />
              Liturgia
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-0.5 shrink-0" />
            </Link>
          </div>
          <div className="space-y-5">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground mb-2 px-1">
                  {group.label}
                </p>
                <div className="rounded-2xl border border-border overflow-hidden">
                  {group.items.map((item, idx) => {
                    const isLast = idx === group.items.length - 1;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveSection(item.id); setMobileView("content"); }}
                        className={`w-full flex items-center gap-3.5 px-4 py-3.5 text-left transition active:scale-[0.98] active:bg-muted/60 hover:bg-muted/30 ${!isLast ? "border-b border-border/50" : ""}`}
                      >
                        <div className={`h-9 w-9 rounded-xl ${item.color} flex items-center justify-center shrink-0 shadow-sm`}>
                          <item.icon className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{item.label}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Desktop: sidebar + content ── */}
      <div className="hidden lg:block">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Configurações</p>
            <h1 className="mt-1.5 font-serif text-3xl">{paroquia.nome}</h1>
            {paroquia.diocese && (
              <p className="text-sm text-muted-foreground mt-0.5">{paroquia.diocese}</p>
            )}
          </div>
          <Link
            to="/admin/liturgia"
            className="inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted hover:border-primary/30 hover:text-primary"
          >
            <BookOpen className="h-4 w-4 text-primary shrink-0" />
            Liturgia &amp; Sync
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-0.5 shrink-0" />
          </Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-1">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground px-3 py-1.5">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition group ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-foreground/70 hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                      <span className="text-sm font-medium truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>
          <div className="min-w-0">
            <div className="mb-5 pb-4 border-b border-border/60">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">{activeItem?.label}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{activeItem?.desc}</p>
            </div>
            <ContentPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Dados da Paróquia ────────────────────────────────────────────────────

type IdentidadeForm = {
  nome: string; padroeiro: string; cidade: string; diocese: string;
  endereco: string; contato_email: string; contato_telefone: string;
  slug: string; allow_magic_link: boolean;
};

function IdentidadeTab({ paroquia, onSaved }: { paroquia: Paroquia; onSaved: () => void }) {
  const [form, setForm] = useState<IdentidadeForm>({
    nome: "", padroeiro: "", cidade: "", diocese: "",
    endereco: "", contato_email: "", contato_telefone: "", slug: "", allow_magic_link: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      nome: paroquia.nome ?? "",
      padroeiro: paroquia.padroeiro ?? "",
      cidade: paroquia.cidade ?? "",
      diocese: paroquia.diocese ?? "",
      endereco: paroquia.endereco ?? "",
      contato_email: paroquia.contato_email ?? "",
      contato_telefone: paroquia.contato_telefone ?? "",
      slug: paroquia.slug ?? "",
      allow_magic_link: paroquia.allow_magic_link ?? false,
    });
  }, [paroquia]);

  const fields: { key: Exclude<keyof IdentidadeForm, "allow_magic_link">; label: string; placeholder?: string }[] = [
    { key: "nome", label: "Nome da paróquia", placeholder: "Ex: Paróquia Nossa Senhora…" },
    { key: "padroeiro", label: "Padroeiro / padroeira", placeholder: "Ex: Nossa Senhora Mãe da Igreja" },
    { key: "cidade", label: "Cidade" },
    { key: "diocese", label: "Diocese" },
    { key: "endereco", label: "Endereço" },
    { key: "contato_email", label: "E-mail de contato" },
    { key: "contato_telefone", label: "Telefone de contato" },
  ];

  async function save(e: React.SyntheticEvent) {
    e.preventDefault();
    setSaving(true);
    const slugValue = form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || null;
    const { error } = await anyDb.from("paroquias").update({
      nome: form.nome,
      padroeiro: form.padroeiro || null,
      cidade: form.cidade || null,
      diocese: form.diocese || null,
      endereco: form.endereco || null,
      contato_email: form.contato_email || null,
      contato_telefone: form.contato_telefone || null,
      slug: slugValue,
      allow_magic_link: form.allow_magic_link,
    }).eq("id", paroquia.id);
    setSaving(false);
    if (error) { toast.error(supabaseErrorMessage(error)); return; }
    toast.success("Dados atualizados.");
    onSaved();
  }

  const portalUrl = form.slug ? `${window.location.origin}/paroquia/${form.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}` : null;

  return (
    <form onSubmit={save}>
      <Card className="space-y-4">
        {fields.map(({ key, label, placeholder }) => (
          <Field key={key} label={label}>
            {textInput(form[key], (v) => setForm({ ...form, [key]: v }), placeholder)}
          </Field>
        ))}

        {/* Portal slug */}
        <Field label="Endereço do portal dos servidores">
          <div className="space-y-2">
            <div className="flex items-center rounded-lg border border-input bg-background overflow-hidden">
              <span className="px-3 py-2 text-sm text-muted-foreground bg-muted border-r border-input whitespace-nowrap shrink-0">
                /paroquia/
              </span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="ns-aparecida"
                className="flex-1 px-3 py-2 text-sm outline-none bg-background"
              />
            </div>
            {portalUrl && (
              <div className="flex items-center gap-2">
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate"
                >
                  {portalUrl}
                </a>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success("Link copiado!"); }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="Copiar link"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </Field>

        {/* Login por link mágico */}
        <Field label="Login por link mágico">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Permite que membros entrem no portal sem senha, via link enviado por e-mail. Desativado por padrão.
            </p>
            <Switch
              checked={form.allow_magic_link}
              onCheckedChange={(v) => setForm({ ...form, allow_magic_link: v })}
            />
          </div>
        </Field>

        <SaveBtn saving={saving} />
      </Card>
    </form>
  );
}

// ── Tab: Comunidades ──────────────────────────────────────────────────────────

function ComunidadesTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Comunidade | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Comunidade | null>(null);

  const { data: comunidades = [], isLoading } = useQuery<Comunidade[]>({
    queryKey: ["comunidades", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("comunidades")
        .select("id, nome, tipo, endereco, responsavel, ativo")
        .eq("paroquia_id", paroquiaId)
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Comunidade[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Omit<Comunidade, "id"> & { id?: string }) => {
      if (payload.id) {
        const { id, ...rest } = payload;
        const { error } = await anyDb.from("comunidades").update(rest).eq("id", id);
        if (error) throw new Error(logDbError("UPDATE comunidades", error));
      } else {
        const { error } = await anyDb.from("comunidades").insert({ ...payload, paroquia_id: paroquiaId });
        if (error) throw new Error(logDbError("INSERT comunidades", error));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comunidades", paroquiaId] });
      toast.success(editTarget ? "Comunidade atualizada." : "Comunidade criada.");
      setDialogOpen(false);
      setEditTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("comunidades").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE comunidades", error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comunidades", paroquiaId] });
      toast.success("Comunidade removida.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(c: Comunidade) { setEditTarget(c); setDialogOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex-1 min-w-0 text-sm text-muted-foreground">
          Matriz, capelas e comunidades vinculadas à paróquia.
        </p>
        <Button size="sm" onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" /> Nova comunidade
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : comunidades.length === 0 ? (
        <Card className="text-center py-10">
          <MapPin className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma comunidade cadastrada.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Cadastrar comunidade
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {comunidades.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{c.nome}</span>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {TIPOS_COMUNIDADE[c.tipo] ?? c.tipo}
                  </Badge>
                  {!c.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">Inativa</Badge>}
                </div>
                {c.responsavel && <p className="text-xs text-muted-foreground mt-0.5">{c.responsavel}</p>}
                {c.endereco && <p className="text-xs text-muted-foreground truncate">{c.endereco}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ComunidadeDialog
        open={dialogOpen}
        initial={editTarget}
        saving={saveMutation.isPending}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        onSave={(data) => saveMutation.mutate(editTarget ? { ...data, id: editTarget.id } : data)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover comunidade?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ComunidadeDialog({
  open, initial, saving, onClose, onSave,
}: {
  open: boolean;
  initial: Comunidade | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: Omit<Comunidade, "id">) => void;
}) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("comunidade");
  const [endereco, setEndereco] = useState("");
  const [responsavel, setResponsavel] = useState("");

  useEffect(() => {
    if (initial) {
      setNome(initial.nome);
      setTipo(initial.tipo);
      setEndereco(initial.endereco ?? "");
      setResponsavel(initial.responsavel ?? "");
    } else {
      setNome(""); setTipo("comunidade"); setEndereco(""); setResponsavel("");
    }
  }, [initial, open]);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    onSave({ nome: nome.trim(), tipo, endereco: endereco || null, responsavel: responsavel || null, ativo: true });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar comunidade" : "Nova comunidade"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Capela São José" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring"
            >
              {Object.entries(TIPOS_COMUNIDADE).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Responsável (opcional)</Label>
            <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Nome do responsável" />
          </div>
          <div className="space-y-1.5">
            <Label>Endereço (opcional)</Label>
            <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || !nome.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: Atuações Pastorais ───────────────────────────────────────────────────

function AtuacoesSubTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Atuacao | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Atuacao | null>(null);

  const { data: atuacoes = [], isLoading } = useQuery<Atuacao[]>({
    queryKey: ["atuacoes_pastorais", paroquiaId],
    queryFn: async () => {
      try {
        const { data, error } = await anyDb
          .from("atuacoes_pastorais")
          .select("id, nome, descricao, cor, icone, ativo, ordem")
          .eq("paroquia_id", paroquiaId)
          .order("ordem")
          .order("nome");
        if (error) throw error;
        return ((data ?? []) as unknown) as Atuacao[];
      } catch {
        return [];
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Omit<Atuacao, "id" | "ordem"> & { id?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { error } = await anyDb.from("atuacoes_pastorais").update(rest).eq("id", id);
        if (error) throw new Error(logDbError("UPDATE atuacoes_pastorais", error));
      } else {
        const { error } = await anyDb.from("atuacoes_pastorais").insert({
          ...rest, paroquia_id: paroquiaId, ordem: atuacoes.length,
        });
        if (error) throw new Error(logDbError("INSERT atuacoes_pastorais", error));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atuacoes_pastorais", paroquiaId] });
      toast.success(editTarget ? "Atuação atualizada." : "Atuação criada.");
      setDialogOpen(false);
      setEditTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("atuacoes_pastorais").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE atuacoes_pastorais", error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atuacoes_pastorais", paroquiaId] });
      toast.success("Atuação removida.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(a: Atuacao) { setEditTarget(a); setDialogOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Atuações pastorais vinculadas aos membros desta paróquia.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Nova atuação
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : atuacoes.length === 0 ? (
        <Card className="text-center py-10">
          <Tag className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma atuação pastoral cadastrada.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Atuações identificam como o membro serve na pastoral, ex: Acólito, Cerimoniário, Coroinha, Filhas de Maria.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Cadastrar atuação
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {atuacoes.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div
                className="mt-0.5 h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: a.cor }}
              >
                {a.icone ? <span className="text-lg">{a.icone}</span> : a.nome.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{a.nome}</span>
                  {!a.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">Inativa</Badge>}
                </div>
                {a.descricao && <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.descricao}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(a)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(a)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AtuacaoDialog
        open={dialogOpen}
        initial={editTarget}
        saving={saveMutation.isPending}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        onSave={(data) => saveMutation.mutate(editTarget ? { ...data, id: editTarget.id } : data)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover atuação pastoral?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removida e todos os membros associados perderão essa atuação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AtuacaoDialog({
  open, initial, saving, onClose, onSave,
}: {
  open: boolean;
  initial: Atuacao | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: Omit<Atuacao, "id" | "ordem">) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState(CORES[0]);
  const [icone, setIcone] = useState("");

  useEffect(() => {
    if (initial) {
      setNome(initial.nome);
      setDescricao(initial.descricao ?? "");
      setCor(initial.cor);
      setIcone(initial.icone ?? "");
    } else {
      setNome(""); setDescricao(""); setCor(CORES[0]); setIcone("");
    }
  }, [initial, open]);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    onSave({ nome: nome.trim(), descricao: descricao || null, cor, icone: icone || null, ativo: true });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar atuação pastoral" : "Nova atuação pastoral"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Acólito, Cerimoniário, Coroinha, Filhas de Maria…" />
            </div>
            <div className="space-y-1.5">
              <Label>Ícone</Label>
              <Input value={icone} onChange={(e) => setIcone(e.target.value)} placeholder="🕊️" className="w-20 text-center text-lg" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="Ex: Jovens que servem no altar como Acólitos, Coroinhas e Cerimoniários" />
          </div>

          <div className="space-y-1.5">
            <Label>Cor de identificação</Label>
            <div className="flex flex-wrap gap-2">
              {CORES.map((c) => (
                <button
                  key={c} type="button"
                  className={`h-7 w-7 rounded-full ring-offset-2 transition ${cor === c ? "ring-2 ring-ring" : ""}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setCor(c)}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || !nome.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-tab: Funções Litúrgicas ───────────────────────────────────────────────

function FuncoesLiturgicasTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FuncaoLiturgica | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FuncaoLiturgica | null>(null);

  const { data: funcoes = [], isLoading } = useQuery<FuncaoLiturgica[]>({
    queryKey: ["ministerios", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("ministerios")
        .select("id, nome, descricao, cor, ativo, ordem, categoria, icone, pontuacao_minima, exigir_experiencia, mostrar_no_portal, quantidade_padrao, auto_adicionar")
        .eq("paroquia_id", paroquiaId)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown[]).map((r: unknown) => {
        const row = r as Partial<FuncaoLiturgica> & { id: string };
        return {
          ...row,
          pontuacao_minima: row.pontuacao_minima ?? 0,
          exigir_experiencia: row.exigir_experiencia ?? false,
          mostrar_no_portal: row.mostrar_no_portal ?? true,
          quantidade_padrao: row.quantidade_padrao ?? 1,
          auto_adicionar: row.auto_adicionar ?? false,
        } as FuncaoLiturgica;
      });
    },
  });

  const { data: contagens = {} } = useQuery<Record<string, number>>({
    queryKey: ["ministerios-contagens", paroquiaId],
    enabled: funcoes.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("membro_ministerios")
        .select("ministerio_id")
        .in("ministerio_id", funcoes.map((f) => f.id));
      const map: Record<string, number> = {};
      (data ?? []).forEach((r) => { map[r.ministerio_id] = (map[r.ministerio_id] ?? 0) + 1; });
      return map;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Omit<FuncaoLiturgica, "id" | "ordem"> & { id?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { error } = await anyDb.from("ministerios").update(rest).eq("id", id);
        if (error) throw new Error(logDbError("UPDATE ministerios", error));
      } else {
        const { error } = await anyDb.from("ministerios").insert({
          ...rest, paroquia_id: paroquiaId, ordem: funcoes.length,
        });
        if (error) throw new Error(logDbError("INSERT ministerios", error));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ministerios"] });
      toast.success(editTarget ? "Função atualizada." : "Função criada.");
      setDialogOpen(false);
      setEditTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("ministerios").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE ministerios", error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ministerios"] });
      qc.invalidateQueries({ queryKey: ["ministerios-contagens"] });
      toast.success("Função removida.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const rows = FUNCOES_PADRAO.map((f, i) => ({
        paroquia_id: paroquiaId, ...f,
        ativo: true, ordem: i,
        pontuacao_minima: 0, exigir_experiencia: false, mostrar_no_portal: true,
        quantidade_padrao: 1, auto_adicionar: false,
      }));
      const { error } = await anyDb.from("ministerios").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ministerios"] });
      toast.success("Funções padrão criadas!");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(f: FuncaoLiturgica) { setEditTarget(f); setDialogOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Funções litúrgicas disponíveis para escalação nesta paróquia.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Nova função
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : funcoes.length === 0 ? (
        <Card className="text-center py-10">
          <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma função litúrgica cadastrada.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              {seedMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar funções padrão
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Criar manualmente
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {funcoes.map((f) => (
            <div key={f.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mt-0.5 h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: f.cor }}>
                {f.icone ? <span className="text-lg">{f.icone}</span> : f.nome.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{f.nome}</span>
                  {f.categoria && <Badge variant="secondary" className="text-xs">{f.categoria}</Badge>}
                  {!f.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">Inativa</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {f.descricao ?? "—"} · {contagens[f.id] ?? 0} membro(s)
                </p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {f.exigir_experiencia && <span className="text-xs text-amber-600">Exige experiência</span>}
                  {f.auto_adicionar && <span className="text-xs text-emerald-600">Auto</span>}
                  {!f.mostrar_no_portal && <span className="text-xs text-muted-foreground">Oculta no portal</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(f)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(f)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FuncaoDialog
        open={dialogOpen}
        initial={editTarget}
        saving={saveMutation.isPending}
        paroquiaId={paroquiaId}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        onSave={(data) => saveMutation.mutate(editTarget ? { ...data, id: editTarget.id } : data)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover função litúrgica?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removida e todos os membros associados perderão essa função.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FuncaoDialog({
  open, initial, saving, paroquiaId, onClose, onSave,
}: {
  open: boolean;
  initial: FuncaoLiturgica | null;
  saving: boolean;
  paroquiaId: string;
  onClose: () => void;
  onSave: (data: Omit<FuncaoLiturgica, "id" | "ordem">) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState(CORES[0]);
  const [categoria, setCategoria] = useState("");
  const [icone, setIcone] = useState("");
  const [pontuacaoMinima, setPontuacaoMinima] = useState(0);
  const [quantidadePadrao, setQuantidadePadrao] = useState(1);
  const [exigirExperiencia, setExigirExperiencia] = useState(false);
  const [mostrarNoPortal, setMostrarNoPortal] = useState(true);
  const [autoAdicionar, setAutoAdicionar] = useState(false);

  const { data: atuacoesDisponiveis = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["atuacoes_pastorais", paroquiaId],
    enabled: open,
    queryFn: async () => {
      const { data } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return ((data ?? []) as unknown) as { id: string; nome: string }[];
    },
  });

  useEffect(() => {
    if (initial) {
      setNome(initial.nome);
      setDescricao(initial.descricao ?? "");
      setCor(initial.cor);
      setCategoria(initial.categoria ?? "");
      setIcone(initial.icone ?? "");
      setPontuacaoMinima(initial.pontuacao_minima);
      setQuantidadePadrao(initial.quantidade_padrao ?? 1);
      setExigirExperiencia(initial.exigir_experiencia);
      setMostrarNoPortal(initial.mostrar_no_portal);
      setAutoAdicionar(initial.auto_adicionar ?? false);
    } else {
      setNome(""); setDescricao(""); setCor(CORES[0]); setCategoria(""); setIcone("");
      setPontuacaoMinima(0); setQuantidadePadrao(1);
      setExigirExperiencia(false); setMostrarNoPortal(true); setAutoAdicionar(false);
    }
  }, [initial, open]);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    onSave({
      nome: nome.trim(),
      descricao: descricao || null,
      cor,
      categoria: categoria || null,
      icone: icone || null,
      pontuacao_minima: pontuacaoMinima,
      quantidade_padrao: quantidadePadrao,
      exigir_experiencia: exigirExperiencia,
      mostrar_no_portal: mostrarNoPortal,
      auto_adicionar: autoAdicionar,
      ativo: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar função litúrgica" : "Nova função litúrgica"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Nome da função *</Label>
              <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Missal, Credência, Cruz Processional, Vela, Turíbulo, Naveta…" />
            </div>
            <div className="space-y-1.5">
              <Label>Ícone</Label>
              <Input value={icone} onChange={(e) => setIcone(e.target.value)} placeholder="⛪" className="w-20 text-center text-lg" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Categoria / Atuação Pastoral</Label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring"
            >
              <option value="">Sem categoria</option>
              {atuacoesDisponiveis.map((a) => <option key={a.id} value={a.nome}>{a.nome}</option>)}
            </select>
            {atuacoesDisponiveis.length === 0 && (
              <p className="text-xs text-muted-foreground">Cadastre Atuações Pastorais para categorizar as funções.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="Breve descrição da função" />
          </div>

          <div className="space-y-1.5">
            <Label>Cor de identificação</Label>
            <div className="flex flex-wrap gap-2">
              {CORES.map((c) => (
                <button
                  key={c} type="button"
                  className={`h-7 w-7 rounded-full ring-offset-2 transition ${cor === c ? "ring-2 ring-ring" : ""}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setCor(c)}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Qtd. padrão por escala</Label>
              <Input
                type="number" min={1} value={quantidadePadrao}
                onChange={(e) => setQuantidadePadrao(Math.max(1, Number(e.target.value)))}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pontuação mínima</Label>
              <Input
                type="number" min={0} value={pontuacaoMinima}
                onChange={(e) => setPontuacaoMinima(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comportamento</p>
            {([
              { id: "exigir", label: "Exigir experiência", desc: "Somente membros com histórico prévio são sugeridos", val: exigirExperiencia, set: setExigirExperiencia },
              { id: "portal", label: "Mostrar no portal público", desc: "Exibe nas escalas visíveis ao público", val: mostrarNoPortal, set: setMostrarNoPortal },
              { id: "auto", label: "Adicionar automaticamente", desc: "Adicionada automaticamente ao gerar escalas", val: autoAdicionar, set: setAutoAdicionar },
            ] as const).map(({ id, label, desc, val, set }) => (
              <div key={id} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch checked={val} onCheckedChange={set} />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || !nome.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-tab: Coordenadores ────────────────────────────────────────────────────

function CoordenadesTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Coordenador | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Coordenador | null>(null);

  const { data: atuacoesList = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["atuacoes_pastorais", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return ((data ?? []) as unknown) as { id: string; nome: string }[];
    },
  });

  const { data: comunidadesList = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["comunidades", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunidades")
        .select("id, nome")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      return ((data ?? []) as unknown) as { id: string; nome: string }[];
    },
  });

  const { data: coordenadores = [], isLoading } = useQuery<Coordenador[]>({
    queryKey: ["coordenadores", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("coordenadores")
        .select("id, nome, funcao_pastoral, email, telefone, observacoes, atua_como, comunidade, ativo")
        .eq("paroquia_id", paroquiaId)
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Coordenador[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Omit<Coordenador, "id"> & { id?: string }) => {
      if (payload.id) {
        const { id, ...rest } = payload;
        const { error } = await anyDb.from("coordenadores").update(rest).eq("id", id);
        if (error) throw new Error(logDbError("UPDATE coordenadores", error));
      } else {
        const { error } = await anyDb.from("coordenadores").insert({ ...payload, paroquia_id: paroquiaId });
        if (error) throw new Error(logDbError("INSERT coordenadores", error));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coordenadores", paroquiaId] });
      toast.success(editTarget ? "Coordenador atualizado." : "Coordenador criado.");
      setDialogOpen(false);
      setEditTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("coordenadores").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE coordenadores", error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coordenadores", paroquiaId] });
      toast.success("Coordenador removido.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(c: Coordenador) { setEditTarget(c); setDialogOpen(true); }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Responsáveis pastorais e líderes de ministério da paróquia.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo coordenador
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : coordenadores.length === 0 ? (
        <Card className="text-center py-10">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum coordenador cadastrado.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Cadastrar coordenador
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {coordenadores.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold uppercase">
                {c.nome.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{c.nome}</span>
                  {!c.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">Inativo</Badge>}
                </div>
                {c.funcao_pastoral && <p className="text-xs text-muted-foreground">{c.funcao_pastoral}</p>}
                {c.atua_como && <p className="text-xs text-muted-foreground">Atua como: {c.atua_como}</p>}
                {c.comunidade && <p className="text-xs text-muted-foreground">Comunidade: {c.comunidade}</p>}
                {(c.email || c.telefone) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {[c.email, c.telefone].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CoordenadorDialog
        open={dialogOpen}
        initial={editTarget}
        saving={saveMutation.isPending}
        atuacoesList={atuacoesList}
        comunidadesList={comunidadesList}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        onSave={(data) => saveMutation.mutate(editTarget ? { ...data, id: editTarget.id } : data)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover coordenador?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CoordenadorDialog({
  open, initial, saving, atuacoesList, comunidadesList, onClose, onSave,
}: {
  open: boolean;
  initial: Coordenador | null;
  saving: boolean;
  atuacoesList: { id: string; nome: string }[];
  comunidadesList: { id: string; nome: string }[];
  onClose: () => void;
  onSave: (data: Omit<Coordenador, "id">) => void;
}) {
  const [nome, setNome] = useState("");
  const [funcao, setFuncao] = useState("");
  const [atuaComo, setAtuaComo] = useState("");
  const [comunidade, setComunidade] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (initial) {
      setNome(initial.nome);
      setFuncao(initial.funcao_pastoral ?? "");
      setAtuaComo(initial.atua_como ?? "");
      setComunidade(initial.comunidade ?? "");
      setEmail(initial.email ?? "");
      setTelefone(initial.telefone ?? "");
      setObservacoes(initial.observacoes ?? "");
    } else {
      setNome(""); setFuncao(""); setAtuaComo(""); setComunidade("");
      setEmail(""); setTelefone(""); setObservacoes("");
    }
  }, [initial, open]);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    onSave({
      nome: nome.trim(),
      funcao_pastoral: funcao || null,
      atua_como: atuaComo || null,
      comunidade: comunidade || null,
      email: email || null,
      telefone: telefone || null,
      observacoes: observacoes || null,
      ativo: true,
    });
  }

  const selectCls = "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar coordenador" : "Novo coordenador"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Nome *</Label>
            <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
          </div>

          <div className="space-y-1.5">
            <Label>Função pastoral (opcional)</Label>
            <Input value={funcao} onChange={(e) => setFuncao(e.target.value)} placeholder="Ex: Coordenador de Acólitos" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Atua como (opcional)</Label>
              {atuacoesList.length > 0 ? (
                <select value={atuaComo} onChange={(e) => setAtuaComo(e.target.value)} className={selectCls}>
                  <option value="">Selecione…</option>
                  {atuacoesList.map((a) => <option key={a.id} value={a.nome}>{a.nome}</option>)}
                </select>
              ) : (
                <Input value={atuaComo} onChange={(e) => setAtuaComo(e.target.value)} placeholder="Ex: Acólito, Leitor…" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Comunidade (opcional)</Label>
              {comunidadesList.length > 0 ? (
                <select value={comunidade} onChange={(e) => setComunidade(e.target.value)} className={selectCls}>
                  <option value="">Selecione…</option>
                  {comunidadesList.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select>
              ) : (
                <Input value={comunidade} onChange={(e) => setComunidade(e.target.value)} placeholder="Ex: Capela São João" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>E-mail (opcional)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone (opcional)</Label>
              <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observações (opcional)</Label>
            <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} placeholder="Informações adicionais sobre este coordenador" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || !nome.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: Tipos de Missa ───────────────────────────────────────────────────────

function TiposMissaTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TipoMissa | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TipoMissa | null>(null);

  const { data: tipos = [], isLoading } = useQuery<TipoMissa[]>({
    queryKey: ["tipos_missa", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("tipos_missa")
        .select("id, nome, descricao, cor, icone, usa_turibulo, usa_naveta, usa_baculifero, usa_mitrifero, prioridade_liturgica, ativo, ordem")
        .eq("paroquia_id", paroquiaId)
        .order("ordem").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as TipoMissa[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("tipos_missa").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE tipos_missa", error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tipos_missa", paroquiaId] });
      toast.success("Tipo removido."); setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">
            Defina os tipos de celebração e as funções geradas automaticamente para cada um.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ex: Missa Comum, Missa Solene, Missa com Bispo, Via Sacra, Adoração.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo tipo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : tipos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Church className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum tipo de missa cadastrado.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Criar primeiro tipo
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tipos.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: t.cor }}>
                  {t.icone ? <span className="text-lg">{t.icone}</span> : t.nome.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{t.nome}</span>
                    {!t.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">Inativo</Badge>}
                  </div>
                  {t.descricao && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.descricao}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {t.usa_turibulo && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Turíbulo</span>}
                    {t.usa_naveta && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Naveta</span>}
                    {t.usa_baculifero && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">Baculífero</span>}
                    {t.usa_mitrifero && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">Mitrífero</span>}
                    <span className="text-xs text-muted-foreground">Prio. {t.prioridade_liturgica}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditTarget(t); setDialogOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(t)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog criar/editar tipo + funções integradas */}
      <TipoMissaDialog
        open={dialogOpen}
        initial={editTarget}
        paroquiaId={paroquiaId}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover tipo de missa?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removido. Missas que usam este tipo perderão a referência.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type FuncaoConfig = {
  checked: boolean;
  tipo_vinculo: "obrigatoria" | "opcional";
  quantidade_min: number;
  quantidade_max: number;
  prioridade: number;
};

function TipoMissaDialog({
  open, initial, paroquiaId, onClose,
}: {
  open: boolean;
  initial: TipoMissa | null;
  paroquiaId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // ── Campos básicos ──────────────────────────────────────────────────────────
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState(CORES[0]);
  const [icone, setIcone] = useState("");
  const [usaTuribulo, setUsaTuribulo] = useState(false);
  const [usaNaveta, setUsaNaveta] = useState(false);
  const [usaBaculifero, setUsaBaculifero] = useState(false);
  const [usaMitrifero, setUsaMitrifero] = useState(false);
  const [prioridade, setPrioridade] = useState(1);

  useEffect(() => {
    if (initial) {
      setNome(initial.nome); setDescricao(initial.descricao ?? ""); setCor(initial.cor);
      setIcone(initial.icone ?? ""); setUsaTuribulo(initial.usa_turibulo);
      setUsaNaveta(initial.usa_naveta); setUsaBaculifero(initial.usa_baculifero);
      setUsaMitrifero(initial.usa_mitrifero); setPrioridade(initial.prioridade_liturgica);
    } else {
      setNome(""); setDescricao(""); setCor(CORES[0]); setIcone("");
      setUsaTuribulo(false); setUsaNaveta(false); setUsaBaculifero(false);
      setUsaMitrifero(false); setPrioridade(1);
    }
  }, [initial, open]);

  // ── Funções disponíveis ─────────────────────────────────────────────────────
  const { data: ministerios = [], isFetched: isMinFetched } = useQuery<{ id: string; nome: string; cor: string }[]>({
    queryKey: ["ministerios", paroquiaId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("ministerios").select("id, nome, cor")
        .eq("paroquia_id", paroquiaId).eq("ativo", true).order("ordem").order("nome");
      return (data ?? []) as { id: string; nome: string; cor: string }[];
    },
  });

  // Funções já associadas (apenas ao editar)
  const { data: funcoes = [], isFetched: isFuncoesFetched } = useQuery<TipoMissaFuncao[]>({
    queryKey: ["tipo_missa_funcoes", initial?.id ?? "new"],
    enabled: open && !!initial?.id,
    queryFn: async () => {
      if (!initial?.id) return [];
      const { data, error } = await anyDb
        .from("tipo_missa_funcoes")
        .select("id, tipo_missa_id, ministerio_id, tipo_vinculo, quantidade_min, quantidade_max, prioridade")
        .eq("tipo_missa_id", initial.id);
      if (error) throw error;
      return (data ?? []) as TipoMissaFuncao[];
    },
  });

  // ── Estado do checklist ─────────────────────────────────────────────────────
  const [configMap, setConfigMap] = useState<Record<string, FuncaoConfig>>({});
  const initialized = useRef(false);

  useEffect(() => {
    if (!open) { initialized.current = false; setConfigMap({}); }
  }, [open]);

  const canInit = open && isMinFetched && (initial ? isFuncoesFetched : true);
  useEffect(() => {
    if (initialized.current || !canInit) return;
    const map: Record<string, FuncaoConfig> = {};
    for (const m of ministerios) {
      const ex = funcoes.find((f) => f.ministerio_id === m.id);
      map[m.id] = ex
        ? { checked: true, tipo_vinculo: ex.tipo_vinculo ?? "obrigatoria", quantidade_min: ex.quantidade_min ?? 1, quantidade_max: ex.quantidade_max ?? 1, prioridade: ex.prioridade ?? 0 }
        : { checked: false, tipo_vinculo: "obrigatoria", quantidade_min: 1, quantidade_max: 1, prioridade: 0 };
    }
    setConfigMap(map);
    initialized.current = true;
  }, [canInit, funcoes, ministerios]);

  // ── Mutation unificada ──────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const basicPayload = {
        nome: nome.trim(), descricao: descricao || null, cor, icone: icone || null,
        usa_turibulo: usaTuribulo, usa_naveta: usaNaveta,
        usa_baculifero: usaBaculifero, usa_mitrifero: usaMitrifero,
        prioridade_liturgica: prioridade, ativo: true,
      };

      let tipoId = initial?.id;
      if (tipoId) {
        const { error } = await anyDb.from("tipos_missa").update(basicPayload).eq("id", tipoId);
        if (error) throw new Error(logDbError("UPDATE tipos_missa", error));
      } else {
        const { data, error } = await anyDb.from("tipos_missa")
          .insert({ ...basicPayload, paroquia_id: paroquiaId, ordem: 0 })
          .select("id").single();
        if (error) throw new Error(logDbError("INSERT tipos_missa", error));
        tipoId = (data as { id: string }).id;
      }

      // Sincronizar funções
      const toUpsert = ministerios
        .filter((m) => configMap[m.id]?.checked)
        .map((m) => ({
          tipo_missa_id: tipoId,
          ministerio_id: m.id,
          tipo_vinculo: configMap[m.id].tipo_vinculo,
          quantidade_min: configMap[m.id].quantidade_min,
          quantidade_max: Math.max(configMap[m.id].quantidade_min, configMap[m.id].quantidade_max),
          prioridade: configMap[m.id].prioridade,
        }));

      if (initial?.id) {
        const toDelete = funcoes.filter((f) => !configMap[f.ministerio_id]?.checked).map((f) => f.id);
        if (toDelete.length > 0) {
          const { error } = await anyDb.from("tipo_missa_funcoes").delete().in("id", toDelete);
          if (error) throw new Error(logDbError("DELETE tipo_missa_funcoes", error));
        }
      }
      if (toUpsert.length > 0) {
        const { error } = await anyDb.from("tipo_missa_funcoes").upsert(toUpsert, { onConflict: "tipo_missa_id,ministerio_id" });
        if (error) throw new Error(logDbError("UPSERT tipo_missa_funcoes", error));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tipos_missa", paroquiaId] });
      qc.invalidateQueries({ queryKey: ["tipo_missa_funcoes"] });
      toast.success(initial ? "Tipo atualizado." : "Tipo criado.");
      onClose();
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function toggleCheck(id: string) {
    setConfigMap((prev) => ({ ...prev, [id]: { ...prev[id], checked: !prev[id]?.checked } }));
  }
  function updateConfig(id: string, patch: Partial<FuncaoConfig>) {
    setConfigMap((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const checkedCount = Object.values(configMap).filter((c) => c.checked).length;
  const loadingFuncoes = !isMinFetched || (!!initial?.id && !isFuncoesFetched);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar tipo de missa" : "Novo tipo de missa"}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[80vh] overflow-y-auto pr-1 space-y-5">

          {/* ── Dados básicos ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Missa Solene, Missa com Bispo, Via Sacra…" />
              </div>
              <div className="space-y-1.5">
                <Label>Ícone</Label>
                <Input value={icone} onChange={(e) => setIcone(e.target.value)} placeholder="⛪" className="w-20 text-center text-lg" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2}
                placeholder="Ex: Missa solene com diácono e rito completo" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Cor de identificação</Label>
                <div className="flex flex-wrap gap-2">
                  {CORES.map((c) => (
                    <button key={c} type="button"
                      className={`h-7 w-7 rounded-full ring-offset-2 transition ${cor === c ? "ring-2 ring-ring" : ""}`}
                      style={{ backgroundColor: c }} onClick={() => setCor(c)} />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Prioridade litúrgica (1 = mais alta)</Label>
                <Input type="number" min={1} max={10} value={prioridade}
                  onChange={(e) => setPrioridade(Math.max(1, Number(e.target.value)))} className="w-28" />
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens litúrgicos especiais</p>
              {([
                { id: "tur", label: "Turíbulo", val: usaTuribulo, set: setUsaTuribulo },
                { id: "nav", label: "Naveta", val: usaNaveta, set: setUsaNaveta },
                { id: "bac", label: "Baculífero (portador do báculo)", val: usaBaculifero, set: setUsaBaculifero },
                { id: "mit", label: "Mitrífero (portador da mitra)", val: usaMitrifero, set: setUsaMitrifero },
              ] as const).map(({ id, label, val, set }) => (
                <div key={id} className="flex items-center justify-between gap-4">
                  <Label className="font-normal">{label}</Label>
                  <Switch checked={val} onCheckedChange={set} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Separador ─────────────────────────────────────────────────── */}
          <div className="border-t border-border" />

          {/* ── Funções litúrgicas vinculadas ─────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Funções litúrgicas</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Marque as funções inseridas automaticamente ao usar este tipo.
                {checkedCount > 0 && (
                  <span className="ml-1 font-medium text-foreground">
                    {checkedCount} selecionada{checkedCount !== 1 ? "s" : ""}.
                  </span>
                )}
              </p>
            </div>

            {loadingFuncoes ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : ministerios.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4 rounded-lg border border-dashed border-border">
                Cadastre Funções Litúrgicas em Geral → Funções primeiro.
              </p>
            ) : (
              <div className="space-y-1.5">
                {ministerios.map((m) => {
                  const cfg = configMap[m.id] ?? { checked: false, tipo_vinculo: "obrigatoria" as const, quantidade_min: 1, quantidade_max: 1, prioridade: 0 };
                  return (
                    <div key={m.id} className={`rounded-lg border transition-colors ${cfg.checked ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none" onClick={() => toggleCheck(m.id)}>
                        <input type="checkbox" checked={cfg.checked} readOnly
                          className="h-4 w-4 rounded border-gray-300 accent-primary pointer-events-none" />
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: m.cor ?? "#6B7280" }} />
                        <span className="flex-1 text-sm font-medium">{m.nome}</span>
                        {cfg.checked && (
                          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${cfg.tipo_vinculo === "obrigatoria" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                            {cfg.tipo_vinculo === "obrigatoria" ? "Obrigatória" : "Opcional"}
                          </span>
                        )}
                      </div>
                      {cfg.checked && (
                        <div className="grid grid-cols-4 gap-2 px-3 pb-3" onClick={(e) => e.stopPropagation()}>
                          <div>
                            <Label className="text-xs">Tipo</Label>
                            <select value={cfg.tipo_vinculo}
                              onChange={(e) => updateConfig(m.id, { tipo_vinculo: e.target.value as "obrigatoria" | "opcional" })}
                              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring">
                              <option value="obrigatoria">Obrigatória</option>
                              <option value="opcional">Opcional</option>
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Qtd. mín.</Label>
                            <Input type="number" min={1} value={cfg.quantidade_min}
                              onChange={(e) => { const v = Math.max(1, Number(e.target.value)); updateConfig(m.id, { quantidade_min: v, quantidade_max: Math.max(v, cfg.quantidade_max) }); }}
                              className="h-8 text-xs" />
                          </div>
                          <div>
                            <Label className="text-xs">Qtd. máx.</Label>
                            <Input type="number" min={cfg.quantidade_min} value={cfg.quantidade_max}
                              onChange={(e) => updateConfig(m.id, { quantidade_max: Math.max(cfg.quantidade_min, Number(e.target.value)) })}
                              className="h-8 text-xs" />
                          </div>
                          <div>
                            <Label className="text-xs">Prioridade</Label>
                            <Input type="number" min={0} value={cfg.prioridade}
                              onChange={(e) => updateConfig(m.id, { prioridade: Math.max(0, Number(e.target.value)) })}
                              className="h-8 text-xs" title="0 = sem prioridade especial" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button disabled={saveMutation.isPending || !nome.trim()} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar tipo
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: Missas Padrão ────────────────────────────────────────────────────────

function MissasTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"create" | "edit" | "duplicate">("create");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<MissaPadrao, "id" | "ordem">>(EMPTY_MISSA);

  const { data: missas = [], isLoading } = useQuery<MissaPadrao[]>({
    queryKey: ["missas_padrao", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("missas_padrao")
        .select("id, nome, dia_semana, hora_inicio, hora_fim, local, tipo, tipo_missa_id, recorrencia, solene, tem_adoracao, tem_bispo, ativo, ordem")
        .eq("paroquia_id", paroquiaId)
        .order("dia_semana").order("ordem");
      return ((data ?? []) as unknown) as MissaPadrao[];
    },
  });

  const { data: comunidades = [] } = useQuery<Comunidade[]>({
    queryKey: ["comunidades", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("comunidades")
        .select("id, nome, tipo, endereco, responsavel, ativo")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Comunidade[];
    },
  });

  const { data: tiposMissa = [] } = useQuery<TipoMissa[]>({
    queryKey: ["tipos_missa", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("tipos_missa")
        .select("id, nome, descricao, cor, icone, usa_turibulo, usa_naveta, usa_baculifero, usa_mitrifero, prioridade_liturgica, ativo, ordem")
        .eq("paroquia_id", paroquiaId)
        .eq("ativo", true)
        .order("ordem");
      return ((data ?? []) as unknown) as TipoMissa[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Omit<MissaPadrao, "id" | "ordem"> & { id?: string }) => {
      const anyDb = supabase as any;
      if (payload.id) {
        const { id, ...rest } = payload;
        const { error } = await anyDb.from("missas_padrao").update(rest).eq("id", id);
        if (error) throw new Error(logDbError("UPDATE missas_padrao", error));
      } else {
        const { error } = await anyDb.from("missas_padrao").insert({
          ...payload, paroquia_id: paroquiaId, ordem: missas.length,
        });
        if (error) throw new Error(logDbError("INSERT missas_padrao", error));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["missas_padrao", paroquiaId] });
      setSheetOpen(false); setEditId(null); setForm(EMPTY_MISSA);
      toast.success("Missa salva.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("missas_padrao").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE missas_padrao", error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["missas_padrao", paroquiaId] });
      toast.success("Missa removida.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const orderMutation = useMutation({
    mutationFn: async (updates: Array<{ id: string; ordem: number }>) => {
      const results = await Promise.all(
        updates.map(({ id, ordem }) =>
          supabase.from("missas_padrao").update({ ordem }).eq("id", id)
        )
      );
      const firstError = results.find((r) => r.error);
      if (firstError?.error) throw new Error(logDbError("UPDATE missas_padrao.ordem", firstError.error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["missas_padrao", paroquiaId] }),
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent, dm: MissaPadrao[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = dm.findIndex((m) => m.id === active.id);
    const newIdx = dm.findIndex((m) => m.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(dm, oldIdx, newIdx);
    orderMutation.mutate(reordered.map((m, i) => ({ id: m.id, ordem: i })));
  }

  function duplicate(m: MissaPadrao) {
    setSheetMode("duplicate");
    setEditId(null);
    setForm({
      nome: `${m.nome} (cópia)`,
      dia_semana: m.dia_semana,
      hora_inicio: m.hora_inicio,
      hora_fim: m.hora_fim,
      local: m.local,
      tipo: m.tipo,
      tipo_missa_id: m.tipo_missa_id,
      recorrencia: m.recorrencia,
      solene: m.solene,
      tem_adoracao: m.tem_adoracao,
      tem_bispo: m.tem_bispo,
      observacoes: m.observacoes ?? null,
      ativo: true,
    });
    setSheetOpen(true);
  }

  function openEdit(m: MissaPadrao) {
    setSheetMode("edit");
    setEditId(m.id);
    setForm({
      nome: m.nome, dia_semana: m.dia_semana,
      hora_inicio: m.hora_inicio ?? "", hora_fim: m.hora_fim,
      local: m.local, tipo: m.tipo,
      tipo_missa_id: m.tipo_missa_id,
      recorrencia: m.recorrencia ?? { tipo: "semanal" },
      solene: m.solene, tem_adoracao: m.tem_adoracao, tem_bispo: m.tem_bispo,
      observacoes: m.observacoes ?? null, ativo: m.ativo,
    });
    setSheetOpen(true);
  }

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const byDay = DIAS.map((dia, idx) => ({ dia, idx, missas: missas.filter((m) => m.dia_semana === idx) }));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Missas Padrão</p>
            <p className="text-xs text-muted-foreground mt-0.5">Templates semanais da paróquia.</p>
          </div>
          <Button size="sm" onClick={() => { setSheetMode("create"); setEditId(null); setForm(EMPTY_MISSA); setSheetOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova missa
          </Button>
        </div>

        {missas.length === 0 ? (
          <div className="p-10 text-center">
            <Church className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma missa padrão cadastrada.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {byDay.map(({ dia, idx, missas: dm }) =>
              dm.length === 0 ? null : (
                <div key={idx}>
                  <div className="px-5 py-2 bg-muted/40">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{dia}</p>
                  </div>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(e, dm)}
                  >
                    <SortableContext items={dm.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                      {dm.map((m) => (
                        <SortableMissaRow
                          key={m.id}
                          m={m}
                          onEdit={openEdit}
                          onDuplicate={duplicate}
                          onDelete={(id: string) => deleteMutation.mutate(id)}
                          deleting={deleteMutation.isPending}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) { setSheetOpen(false); setEditId(null); } }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {sheetMode === "edit" ? "Editar missa" : sheetMode === "duplicate" ? "Duplicar missa" : "Nova missa"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <MissaForm
              form={form} setForm={setForm}
              saving={saveMutation.isPending}
              onSubmit={() => saveMutation.mutate(sheetMode === "edit" && editId ? { ...form, id: editId } : form)}
              onCancel={() => { setSheetOpen(false); setEditId(null); }}
              comunidades={comunidades}
              tiposMissa={tiposMissa}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── SortableMissaRow ──────────────────────────────────────────────────────────

function SortableMissaRow({
  m, onEdit, onDuplicate, onDelete, deleting,
}: {
  m: MissaPadrao;
  onEdit: (m: MissaPadrao) => void;
  onDuplicate: (m: MissaPadrao) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="px-5 py-3 flex items-center gap-3 bg-card">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 p-0.5 touch-none"
        aria-label="Reordenar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{m.nome}</span>
          {m.recorrencia?.tipo && m.recorrencia.tipo !== "semanal" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 leading-none">
              {RECORRENCIAS.find((r) => r.value === m.recorrencia?.tipo)?.label ?? m.recorrencia.tipo}
            </span>
          )}
          {m.solene && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/25">Solene</span>}
          {m.tem_adoracao && <Badge variant="secondary" className="text-xs">Adoração</Badge>}
          {m.tem_bispo && <Badge variant="secondary" className="text-xs">Bispo</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {m.hora_inicio ? m.hora_inicio.slice(0, 5) : ""}
          {m.local ? ` · ${m.local}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Duplicar" onClick={() => onDuplicate(m)}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(m)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => onDelete(m.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

type MissaFormState = Omit<MissaPadrao, "id" | "ordem">;

const inputCls = "mt-1.5 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";
const selectCls2 = "mt-1.5 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring";
function FL({ label }: { label: string }) {
  return <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>;
}

function MissaForm({
  form, setForm, saving, onSubmit, onCancel, comunidades, tiposMissa,
}: {
  form: MissaFormState;
  setForm: (f: MissaFormState) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  comunidades: Comunidade[];
  tiposMissa: TipoMissa[];
}) {
  function f(key: keyof MissaFormState, value: unknown) { setForm({ ...form, [key]: value }); }

  return (
    <div className="space-y-4 pb-4">
      {/* Nome */}
      <div>
        <FL label="Nome" />
        <input value={form.nome} onChange={(e) => f("nome", e.target.value)} placeholder="Ex: Missa Dominical das 8h"
          className={inputCls} />
      </div>

      {/* Dia + Tipo de Missa */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FL label="Dia da semana" />
          <select value={form.dia_semana} onChange={(e) => f("dia_semana", Number(e.target.value))} className={selectCls2}>
            {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <FL label="Tipo de Missa" />
          <select value={form.tipo_missa_id ?? ""} onChange={(e) => f("tipo_missa_id", e.target.value || null)} className={selectCls2}>
            <option value="">Selecione um tipo…</option>
            {tiposMissa.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          {tiposMissa.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Cadastre tipos em "Tipos de Missa".</p>
          )}
        </div>
      </div>

      {/* Horário */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FL label="Início" />
          <input type="time" value={form.hora_inicio ?? ""} onChange={(e) => f("hora_inicio", e.target.value || null)} className={inputCls} />
        </div>
        <div>
          <FL label="Término (opcional)" />
          <input type="time" value={form.hora_fim ?? ""} onChange={(e) => f("hora_fim", e.target.value || null)} className={inputCls} />
        </div>
      </div>

      {/* Local */}
      <div>
        <FL label="Local" />
        {comunidades.length > 0 ? (
          <>
            <select
              value={
                form.local === null || form.local === undefined ? "" :
                comunidades.some((c) => c.nome === form.local) ? form.local : "_outro_"
              }
              onChange={(e) => {
                if (e.target.value === "") f("local", null);
                else if (e.target.value === "_outro_") f("local", "");
                else f("local", e.target.value);
              }}
              className={selectCls2}
            >
              <option value="">Sem local definido</option>
              {comunidades.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              <option value="_outro_">Outro local…</option>
            </select>
            {form.local !== null && !comunidades.some((c) => c.nome === form.local) && (
              <input value={form.local ?? ""} onChange={(e) => f("local", e.target.value)}
                placeholder="Ex: Igreja Matriz, Salão Paroquial…" className={`mt-2 ${inputCls}`} />
            )}
          </>
        ) : (
          <input value={form.local ?? ""} onChange={(e) => f("local", e.target.value || null)}
            placeholder="Ex: Igreja Matriz, Salão Paroquial…" className={inputCls} />
        )}
      </div>

      {/* Recorrência */}
      <div>
        <FL label="Recorrência" />
        <select value={form.recorrencia?.tipo ?? "semanal"}
          onChange={(e) => f("recorrencia", { ...form.recorrencia, tipo: e.target.value as Recorrencia["tipo"] })}
          className={selectCls2}>
          {RECORRENCIAS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {form.recorrencia?.tipo === "esporadico" && (
          <input type="date" value={form.recorrencia?.data ?? ""}
            onChange={(e) => f("recorrencia", { tipo: "esporadico", data: e.target.value || undefined })}
            className={`mt-2 ${inputCls}`} />
        )}
      </div>

      {/* Características */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Características</p>
        {([
          { key: "solene", label: "Missa solene" },
          { key: "tem_adoracao", label: "Com Adoração" },
          { key: "tem_bispo", label: "Presença do Bispo" },
        ] as const).map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-sm">{label}</span>
            <Switch checked={!!form[key]} onCheckedChange={(v) => f(key, v)} />
          </div>
        ))}
      </div>

      {/* Observações */}
      <div>
        <FL label="Observações (opcional)" />
        <textarea
          value={form.observacoes ?? ""}
          onChange={(e) => f("observacoes", e.target.value || null)}
          rows={2}
          placeholder="Informações adicionais sobre esta missa…"
          className={`resize-none ${inputCls}`}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button disabled={saving || !form.nome} onClick={onSubmit} type="button"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
        </button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

// ── Tab: Imagens do PDF ───────────────────────────────────────────────────────

const BUCKET = "paroquia-imagens";

function PDFImagesTab({ paroquia, onSaved }: { paroquia: Paroquia; onSaved: () => void }) {
  const [cabecalhoUrl, setCabecalhoUrl] = useState<string | null>(paroquia.pdf_cabecalho_url);
  const [rodapeUrl, setRodapeUrl]       = useState<string | null>(paroquia.pdf_rodape_url);
  const [uploading, setUploading]       = useState<"cabecalho" | "rodape" | null>(null);
  const [saving, setSaving]             = useState(false);
  const cabecalhoRef = useRef<HTMLInputElement>(null);
  const rodapeRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCabecalhoUrl(paroquia.pdf_cabecalho_url);
    setRodapeUrl(paroquia.pdf_rodape_url);
  }, [paroquia]);

  async function upload(file: File, slot: "cabecalho" | "rodape") {
    setUploading(slot);
    const ext  = file.name.split(".").pop() ?? "png";
    const path = `${paroquia.id}/${slot}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      toast.error(`Erro ao enviar imagem: ${upErr.message}`);
      setUploading(null);
      return;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const url = data.publicUrl + `?t=${Date.now()}`;
    if (slot === "cabecalho") setCabecalhoUrl(url);
    else setRodapeUrl(url);
    setUploading(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, slot: "cabecalho" | "rodape") {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione um arquivo de imagem."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Imagem muito grande (máx 2 MB)."); return; }
    await upload(file, slot);
    e.target.value = "";
  }

  async function removeImage(slot: "cabecalho" | "rodape") {
    if (slot === "cabecalho") setCabecalhoUrl(null);
    else setRodapeUrl(null);
  }

  async function save() {
    setSaving(true);
    const { error } = await anyDb.from("paroquias").update({
      pdf_cabecalho_url: cabecalhoUrl ?? null,
      pdf_rodape_url:    rodapeUrl    ?? null,
    }).eq("id", paroquia.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Imagens do PDF salvas.");
    onSaved();
  }

  function ImageSlot({
    label, hint, url, slot, inputRef,
  }: {
    label: string; hint: string; url: string | null;
    slot: "cabecalho" | "rodape"; inputRef: React.RefObject<HTMLInputElement | null>;
  }) {
    const isUploading = uploading === slot;
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>

        {url ? (
          <div className="relative rounded-lg border border-input overflow-hidden bg-muted/30">
            <img
              src={url}
              alt={label}
              className="w-full max-h-32 object-contain p-2"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <button
              type="button"
              onClick={() => removeImage(slot)}
              className="absolute top-2 right-2 rounded-full bg-destructive/90 p-1 text-white hover:bg-destructive"
              title="Remover imagem"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/20 py-8 cursor-pointer hover:border-ring hover:bg-muted/40 transition-colors"
          >
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Plus className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Clique para selecionar imagem</p>
                <p className="text-xs text-muted-foreground/60">PNG, JPG ou SVG — máx 2 MB</p>
              </>
            )}
          </div>
        )}

        {!url && (
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-input px-4 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-60"
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {isUploading ? "Enviando…" : "Selecionar imagem"}
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e, slot)}
        />
      </div>
    );
  }

  return (
    <Card className="space-y-8">
      <div>
        <p className="text-xs text-muted-foreground">
          As imagens abaixo aparecem nos PDFs de escala gerados pelo sistema. Recomendado: fundo
          transparente (PNG) ou imagem com proporção 4:1 (ex: 800×200 px).
        </p>
      </div>

      <ImageSlot
        label="Imagem do cabeçalho"
        hint="Exibida no topo do PDF — ideal para o brasão ou logotipo da paróquia"
        url={cabecalhoUrl}
        slot="cabecalho"
        inputRef={cabecalhoRef}
      />

      <ImageSlot
        label="Imagem do rodapé"
        hint="Exibida na parte inferior do PDF — pode conter endereço, telefone ou slogan"
        url={rodapeUrl}
        slot="rodape"
        inputRef={rodapeRef}
      />

      <button
        type="button"
        disabled={saving || uploading !== null}
        onClick={save}
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Salvar imagens
      </button>
    </Card>
  );
}

// ── Tab: Regras de Escala ─────────────────────────────────────────────────────

type ConfigEscalasEngine = {
  confirmacao_ativa: boolean;
  confirmacao_horas_antes: number;
  substituicao_ativa: boolean;
  substituicao_horas_antes: number;
  auto_pontuar: boolean;
  pontuacao_presenca: number;
  pontuacao_falta: number;
  pontuacao_atraso: number;
  pontuacao_justificou: number;
};

const DEFAULT_CONFIG_ESCALAS: ConfigEscalasEngine = {
  confirmacao_ativa: false,
  confirmacao_horas_antes: 72,
  substituicao_ativa: false,
  substituicao_horas_antes: 48,
  auto_pontuar: false,
  pontuacao_presenca: 1,
  pontuacao_falta: -2,
  pontuacao_atraso: -1,
  pontuacao_justificou: 0,
};

function RegrasEscalaTab({ paroquia, onSaved }: { paroquia: Paroquia; onSaved: () => void }) {
  const raw = paroquia.regras_escala as RegrasEscala | null;
  const [regras, setRegras] = useState<RegrasEscala>({ ...DEFAULT_REGRAS, ...(raw ?? {}) });
  const [configEscalas, setConfigEscalas] = useState<ConfigEscalasEngine>(DEFAULT_CONFIG_ESCALAS);
  const [saving, setSaving] = useState(false);

  useQuery<ConfigEscalasEngine>({
    queryKey: ["config-escalas-engine", paroquia.id],
    queryFn: async () => {
      const { data } = await anyDb.from("paroquia_config_escalas").select("*").eq("paroquia_id", paroquia.id).maybeSingle();
      const cfg = { ...DEFAULT_CONFIG_ESCALAS, ...(data ?? {}) };
      setConfigEscalas(cfg);
      return cfg;
    },
  });

  function r(key: keyof RegrasEscala, value: unknown) { setRegras({ ...regras, [key]: value }); }
  function c(key: keyof ConfigEscalasEngine, value: unknown) {
    setConfigEscalas((prev) => ({ ...prev, [key]: value }));
    // Sincroniza confirmacao_escala_ativa com confirmacao_ativa
    if (key === "confirmacao_ativa") setRegras((prev) => ({ ...prev, confirmacao_escala_ativa: value as boolean }));
  }

  async function save() {
    setSaving(true);
    const { error: e1 } = await supabase.from("paroquias").update({ regras_escala: { ...regras, confirmacao_escala_ativa: configEscalas.confirmacao_ativa } }).eq("id", paroquia.id);
    if (e1) { setSaving(false); toast.error(e1.message); return; }

    const { error: e2 } = await anyDb.from("paroquia_config_escalas").upsert({
      paroquia_id: paroquia.id,
      ...configEscalas,
    }, { onConflict: "paroquia_id" });
    setSaving(false);
    if (e2) { toast.error(e2.message); return; }

    toast.success("Regras de escala salvas.");
    onSaved();
  }

  return (
    <Card className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Estas regras guiam o motor de escalas ao sugerir atribuições automaticamente.
      </p>

      {/* Modo de confirmação */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Política de confirmação</p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => c("confirmacao_ativa", false)}
            className={`w-full text-left rounded-xl border-2 p-4 transition ${
              !configEscalas.confirmacao_ativa
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${!configEscalas.confirmacao_ativa ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              <div>
                <p className="font-semibold text-sm">Escala Fixa <span className="text-xs text-emerald-600 font-normal ml-1">(Recomendado)</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Escala publicada = presença esperada. Membros informam indisponibilidades antecipadamente.
                  Faltas são registradas pelo coordenador após o evento. Sem botão confirmar/recusar.
                </p>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => c("confirmacao_ativa", true)}
            className={`w-full text-left rounded-xl border-2 p-4 transition ${
              configEscalas.confirmacao_ativa
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${configEscalas.confirmacao_ativa ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              <div>
                <p className="font-semibold text-sm">Confirmação Ativa</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Membro confirma ou justifica ausência. Coordenador recebe notificação de cada resposta.
                </p>
              </div>
            </div>
          </button>
        </div>
        {configEscalas.confirmacao_ativa && (
          <div className="pt-2">
            <label className="text-xs text-muted-foreground">Prazo para confirmar (horas antes da escala)</label>
            <input
              type="number" min={1} max={168}
              value={configEscalas.confirmacao_horas_antes}
              onChange={(e) => c("confirmacao_horas_antes", Number(e.target.value))}
              className="mt-1 w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </div>
        )}
      </div>

      {/* Substituições */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Substituições</p>
            <p className="text-xs text-muted-foreground mt-0.5">Permite que membros solicitem troca de escala.</p>
          </div>
          <Switch
            checked={configEscalas.substituicao_ativa}
            onCheckedChange={(v) => c("substituicao_ativa", v)}
          />
        </div>
        {configEscalas.substituicao_ativa && (
          <div>
            <label className="text-xs text-muted-foreground">Prazo para solicitar substituição (horas antes)</label>
            <input
              type="number" min={1} max={168}
              value={configEscalas.substituicao_horas_antes}
              onChange={(e) => c("substituicao_horas_antes", Number(e.target.value))}
              className="mt-1 w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </div>
        )}
      </div>

      {/* Auto-pontuação */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pontuação automática</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Atribui pontos ao membro automaticamente quando o coordenador registra presença/falta.
              Alimenta o Ranking.
            </p>
          </div>
          <Switch
            checked={configEscalas.auto_pontuar}
            onCheckedChange={(v) => c("auto_pontuar", v)}
          />
        </div>
        {configEscalas.auto_pontuar && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {([
              { key: "pontuacao_presenca" as const,   label: "Presença",   sign: "+" },
              { key: "pontuacao_atraso" as const,     label: "Atraso",     sign: "−" },
              { key: "pontuacao_falta" as const,      label: "Falta",      sign: "−" },
              { key: "pontuacao_justificou" as const, label: "Justificou", sign: "±" },
            ]).map(({ key, label, sign }) => (
              <div key={key} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground flex-1">{label}</label>
                <span className="text-xs font-bold text-muted-foreground w-3 shrink-0">{sign}</span>
                <input
                  type="number" min={-10} max={10}
                  value={Math.abs(configEscalas[key])}
                  onChange={(e) => {
                    const abs = Number(e.target.value);
                    c(key, sign === "+" || sign === "±" ? abs : -abs);
                  }}
                  className="w-16 rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-center outline-none focus:border-ring"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Indisponibilidade */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indisponibilidade</p>
        <div>
          <label className="text-xs text-muted-foreground">
            Antecedência mínima para registrar indisponibilidade (dias)
          </label>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5 mb-1.5">
            Membros só poderão registrar indisponibilidade para datas com pelo menos esse número de dias de antecedência. 0 = sem restrição.
          </p>
          <input
            type="number"
            min={0}
            placeholder="Ex: 3"
            value={regras.dias_antecedencia_indisp ?? ""}
            onChange={(e) => r("dias_antecedencia_indisp", e.target.value === "" ? null : Number(e.target.value))}
            className="w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Limites de participação</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Limite semanal</label>
            <input type="number" min={0} placeholder="Sem limite" value={regras.limite_semanal ?? ""}
              onChange={(e) => r("limite_semanal", e.target.value === "" ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Limite mensal</label>
            <input type="number" min={0} placeholder="Sem limite" value={regras.limite_mensal ?? ""}
              onChange={(e) => r("limite_mensal", e.target.value === "" ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Comportamento do motor</p>
        <div className="space-y-3">
          {([
            { key: "impedir_repeticao_consecutiva", label: "Impedir escalação consecutiva", desc: "Evita escalar o mesmo membro em dois eventos seguidos" },
          ] as const).map(({ key, label, desc }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch checked={!!regras[key]} onCheckedChange={(v) => r(key, v)} />
            </div>
          ))}
        </div>
      </div>

      <button type="button" disabled={saving} onClick={save}
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar regras
      </button>
    </Card>
  );
}

// ── Tab: Tipos de Prioridade ──────────────────────────────────────────────────

type TipoPrioridade = {
  id: string;
  nome: string;
  descricao: string | null;
  peso_escala: number;
  frequencia_min: number | null;
  frequencia_max: number | null;
  priorizar_solenes: boolean;
  priorizar_eventos_especiais: boolean;
  cor: string;
  ativo: boolean;
  ordem: number;
};

function TiposPrioridadeTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TipoPrioridade | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TipoPrioridade | null>(null);

  const { data: tipos = [], isLoading } = useQuery<TipoPrioridade[]>({
    queryKey: ["tipos_prioridade", paroquiaId],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("tipos_prioridade")
        .select("id,nome,descricao,peso_escala,frequencia_min,frequencia_max,priorizar_solenes,priorizar_eventos_especiais,cor,ativo,ordem")
        .eq("paroquia_id", paroquiaId)
        .order("ordem").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as TipoPrioridade[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (form: Omit<TipoPrioridade, "id" | "ordem"> & { id?: string }) => {
      if (form.id) {
        const { error } = await anyDb.from("tipos_prioridade").update({ ...form }).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb.from("tipos_prioridade").insert({ ...form, paroquia_id: paroquiaId, ordem: tipos.length });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tipos_prioridade", paroquiaId] });
      toast.success(editTarget ? "Prioridade atualizada." : "Prioridade criada.");
      setDialogOpen(false); setEditTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("tipos_prioridade").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tipos_prioridade", paroquiaId] });
      toast.success("Prioridade removida."); setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Tipos de Prioridade</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define o peso de cada membro na distribuição automática da escala.
            </p>
          </div>
          <Button size="sm" onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova prioridade
          </Button>
        </div>

        {tipos.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma prioridade cadastrada. Clique em "Nova prioridade" para começar.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tipos.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{t.nome}</span>
                    <span className="text-xs text-muted-foreground">Peso: {t.peso_escala}</span>
                    {t.priorizar_solenes && <span className="text-xs px-1.5 py-0.5 bg-amber-500/10 text-amber-700 rounded-full">Solenes</span>}
                    {t.frequencia_max && <span className="text-xs text-muted-foreground">Max: {t.frequencia_max}×/mês</span>}
                  </div>
                  {t.descricao && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.descricao}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditTarget(t); setDialogOpen(true); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleteTarget(t)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Diálogo */}
      <TipoPrioridadeDialog
        open={dialogOpen}
        initial={editTarget}
        saving={saveMutation.isPending}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        onSave={(data) => saveMutation.mutate(editTarget ? { ...data, id: editTarget.id } : data)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover prioridade?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removida. Membros com essa prioridade ficam sem tipo vinculado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TipoPrioridadeDialog({
  open, initial, saving, onClose, onSave,
}: {
  open: boolean;
  initial: TipoPrioridade | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: Omit<TipoPrioridade, "id" | "ordem">) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [peso, setPeso] = useState(1);
  const [freqMin, setFreqMin] = useState("");
  const [freqMax, setFreqMax] = useState("");
  const [solenes, setSolenes] = useState(false);
  const [especiais, setEspeciais] = useState(false);
  const [cor, setCor] = useState("#6366f1");

  useEffect(() => {
    if (initial) {
      setNome(initial.nome); setDescricao(initial.descricao ?? "");
      setPeso(initial.peso_escala);
      setFreqMin(initial.frequencia_min?.toString() ?? "");
      setFreqMax(initial.frequencia_max?.toString() ?? "");
      setSolenes(initial.priorizar_solenes);
      setEspeciais(initial.priorizar_eventos_especiais);
      setCor(initial.cor);
    } else {
      setNome(""); setDescricao(""); setPeso(1); setFreqMin(""); setFreqMax("");
      setSolenes(false); setEspeciais(false); setCor("#6366f1");
    }
  }, [initial, open]);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    onSave({
      nome: nome.trim(), descricao: descricao || null,
      peso_escala: peso,
      frequencia_min: freqMin ? Number(freqMin) : null,
      frequencia_max: freqMax ? Number(freqMax) : null,
      priorizar_solenes: solenes,
      priorizar_eventos_especiais: especiais,
      cor, ativo: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar prioridade" : "Nova prioridade"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome *</Label>
            <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Cerimoniário Principal" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Breve descrição…" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Peso na escala</Label>
              <input type="number" min={0} max={10} value={peso} onChange={(e) => setPeso(Number(e.target.value))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
            </div>
            <div className="space-y-1.5">
              <Label>Freq. mín. / mês</Label>
              <input type="number" min={0} placeholder="—" value={freqMin} onChange={(e) => setFreqMin(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
            </div>
            <div className="space-y-1.5">
              <Label>Freq. máx. / mês</Label>
              <input type="number" min={0} placeholder="—" value={freqMax} onChange={(e) => setFreqMax(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={solenes} onCheckedChange={setSolenes} id="sol" />
              <Label htmlFor="sol" className="text-xs">Prioridade em solenes</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={especiais} onCheckedChange={setEspeciais} id="esp" />
              <Label htmlFor="esp" className="text-xs">Eventos especiais</Label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex items-center gap-3">
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-9 w-16 rounded-lg border border-input cursor-pointer" />
              <div className="flex gap-1.5 flex-wrap">
                {CORES.map((c) => (
                  <button key={c} type="button" onClick={() => setCor(c)}
                    className={`h-6 w-6 rounded-full border-2 transition ${cor === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || !nome.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: Pontuação ────────────────────────────────────────────────────────────

type ConfigEscalasP = {
  auto_pontuar: boolean;
  pontuacao_presenca: number;
  pontuacao_presenca_solene: number;
  pontuacao_presenca_bispo: number;
  pontuacao_falta: number;
  pontuacao_justificou: number;
  pontuacao_atraso: number;
  pontuacao_ocorrencia_grave: number;
  pontuacao_formacao: number;
  pontuacao_reuniao: number;
  pontuacao_retiro: number;
  pontuacao_adoracao: number;
  pontuacao_ensaio: number;
  pontuacao_encontro: number;
  pontuacao_compromisso: number;
  pontuacao_evento: number;
  pontuacao_substituicao_aceita: number;
  pontuacao_substituicao_recusada: number;
};

const PONT_DEFAULTS: ConfigEscalasP = {
  auto_pontuar: false,
  pontuacao_presenca: 1,
  pontuacao_presenca_solene: 3,
  pontuacao_presenca_bispo: 5,
  pontuacao_falta: -2,
  pontuacao_justificou: 0,
  pontuacao_atraso: -1,
  pontuacao_ocorrencia_grave: -10,
  pontuacao_formacao: 2,
  pontuacao_reuniao: 1,
  pontuacao_retiro: 5,
  pontuacao_adoracao: 2,
  pontuacao_ensaio: 1,
  pontuacao_encontro: 2,
  pontuacao_compromisso: 2,
  pontuacao_evento: 3,
  pontuacao_substituicao_aceita: 3,
  pontuacao_substituicao_recusada: -1,
};

function PRow({ label, color, value, onChange }: {
  label: string; color: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`text-sm flex-1 ${color}`}>{label}</span>
      <input
        type="number" min={-99} max={99}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-20 rounded-xl border border-input bg-background px-2 py-1.5 text-sm text-center outline-none focus:border-ring"
      />
      <span className="text-xs text-muted-foreground w-6">pts</span>
    </div>
  );
}

function PontuacaoConfigTab({ paroquia, onSaved }: { paroquia: Paroquia; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigEscalasP>(PONT_DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reprocessLoading, setReprocessLoading] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);

  const { data: configDb, isLoading } = useQuery({
    queryKey: ["config-escalas-pont", paroquia.id],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("paroquia_config_escalas")
        .select("*")
        .eq("paroquia_id", paroquia.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (configDb) {
      setForm({ ...PONT_DEFAULTS, ...configDb });
      setDirty(false);
    }
  }, [configDb]);

  function update<K extends keyof ConfigEscalasP>(key: K, value: ConfigEscalasP[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await anyDb
      .from("paroquia_config_escalas")
      .upsert({ paroquia_id: paroquia.id, ...form }, { onConflict: "paroquia_id" });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Configuração de pontuação salva.");
    qc.invalidateQueries({ queryKey: ["config-escalas-pont", paroquia.id] });
    qc.invalidateQueries({ queryKey: ["config-escalas", paroquia.id] });
    onSaved();
    setDirty(false);
  }

  async function handleReprocessar() {
    setReprocessLoading(true);
    try {
      const { data, error } = await anyDb.rpc("admin_reprocessar_historico_escala", {
        p_paroquia_id: paroquia.id,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error);
      toast.success(`Reprocessado: ${data.registros_atualizados} presenças · ${data.membros_atualizados} membros atualizados.`);
    } catch (e: unknown) {
      toast.error("Erro ao reprocessar: " + (e as Error).message);
    } finally {
      setReprocessLoading(false);
    }
  }

  async function handleRecalcular() {
    setRecalcLoading(true);
    try {
      const { data, error } = await anyDb.rpc("admin_recalcular_scores_paroquia", {
        p_paroquia_id: paroquia.id,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error);
      toast.success(`Scores recalculados para ${data.membros_atualizados} membros.`);
    } catch (e: unknown) {
      toast.error("Erro ao recalcular: " + (e as Error).message);
    } finally {
      setRecalcLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <div>
          <p className="text-sm font-medium">Motor de Pontuação</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure os pontos atribuídos a cada ação. Administradores e coordenadores de escala usam estes valores ao registrar presenças.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40">
          <div>
            <Label className="text-sm font-medium">Pontuar automaticamente</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Score dos membros é atualizado ao registrar presença em escalas e eventos.
            </p>
          </div>
          <Switch
            checked={form.auto_pontuar}
            onCheckedChange={(v) => update("auto_pontuar", v)}
          />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Escalas de missa</p>
          <PRow label="Presente — missa normal"  color="text-green-600"   value={form.pontuacao_presenca}        onChange={(v) => update("pontuacao_presenca", v)} />
          <PRow label="Presente — missa solene"  color="text-emerald-600" value={form.pontuacao_presenca_solene}  onChange={(v) => update("pontuacao_presenca_solene", v)} />
          <PRow label="Presente — com bispo"     color="text-teal-600"    value={form.pontuacao_presenca_bispo}   onChange={(v) => update("pontuacao_presenca_bispo", v)} />
          <PRow label="Faltou"                   color="text-red-600"     value={form.pontuacao_falta}            onChange={(v) => update("pontuacao_falta", v)} />
          <PRow label="Justificou"               color="text-amber-600"   value={form.pontuacao_justificou}       onChange={(v) => update("pontuacao_justificou", v)} />
          <PRow label="Atrasado"                 color="text-orange-600"  value={form.pontuacao_atraso}           onChange={(v) => update("pontuacao_atraso", v)} />
          <PRow label="Ocorrência grave"         color="text-rose-700"    value={form.pontuacao_ocorrencia_grave} onChange={(v) => update("pontuacao_ocorrencia_grave", v)} />
        </div>

        <div className="space-y-3 border-t border-border/40 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda pastoral</p>
          <PRow label="Formação"             color="text-blue-600"   value={form.pontuacao_formacao}    onChange={(v) => update("pontuacao_formacao", v)} />
          <PRow label="Reunião"              color="text-slate-600"  value={form.pontuacao_reuniao}     onChange={(v) => update("pontuacao_reuniao", v)} />
          <PRow label="Retiro"               color="text-purple-600" value={form.pontuacao_retiro}      onChange={(v) => update("pontuacao_retiro", v)} />
          <PRow label="Adoração"             color="text-yellow-600" value={form.pontuacao_adoracao}    onChange={(v) => update("pontuacao_adoracao", v)} />
          <PRow label="Ensaio"               color="text-green-700"  value={form.pontuacao_ensaio}      onChange={(v) => update("pontuacao_ensaio", v)} />
          <PRow label="Encontro"             color="text-cyan-600"   value={form.pontuacao_encontro}    onChange={(v) => update("pontuacao_encontro", v)} />
          <PRow label="Compromisso pastoral" color="text-rose-600"   value={form.pontuacao_compromisso} onChange={(v) => update("pontuacao_compromisso", v)} />
          <PRow label="Evento especial"      color="text-amber-700"  value={form.pontuacao_evento}      onChange={(v) => update("pontuacao_evento", v)} />
        </div>

        <div className="space-y-3 border-t border-border/40 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Substituições</p>
          <PRow label="Substituição aceita"   color="text-green-600" value={form.pontuacao_substituicao_aceita}   onChange={(v) => update("pontuacao_substituicao_aceita", v)} />
          <PRow label="Substituição recusada" color="text-red-600"   value={form.pontuacao_substituicao_recusada} onChange={(v) => update("pontuacao_substituicao_recusada", v)} />
        </div>

        <button type="button" disabled={saving || !dirty} onClick={save}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar pontuação
        </button>
      </Card>

      <Card className="space-y-4">
        <div>
          <p className="text-sm font-medium">Ferramentas de pontuação</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aplique os valores configurados ao histórico existente ou recalcule os scores dos membros.
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2.5">
          <span className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 text-xs font-bold select-none">i</span>
          <p className="text-xs text-blue-700 dark:text-blue-400">
            <strong>Reprocessar pontuação histórica:</strong> recalcula os pontos de cada presença
            já registrada em escala conforme os valores atuais (normal / solene / bispo / falta…).
            Use após alterar pontuações para corrigir o histórico existente.
            <br /><br />
            <strong>Recalcular scores (soma):</strong> apenas soma o que já está no histórico, sem
            alterar os pontos individuais de cada registro.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="default" size="sm" className="rounded-xl flex-1"
            disabled={reprocessLoading || recalcLoading}
            onClick={handleReprocessar}
          >
            {reprocessLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            Reprocessar pontuação histórica
          </Button>
          <Button
            variant="outline" size="sm" className="rounded-xl flex-1"
            disabled={recalcLoading || reprocessLoading}
            onClick={handleRecalcular}
          >
            {recalcLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            Recalcular scores (soma)
          </Button>
        </div>
      </Card>
    </div>
  );
}
