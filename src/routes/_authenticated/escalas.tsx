import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  Plus, Loader2, Calendar, List, ChevronLeft, ChevronRight, ChevronDown,
  MapPin, Clock, Trash2, Pencil, UserPlus, UserMinus, X, Check, Sparkles, Send,
  MoreVertical, FileText, AlertTriangle, Users, ClipboardCheck,
  CheckCircle2, XCircle, Church, Ban, RefreshCw, Activity,
  TrendingUp, TrendingDown, Minus, ChevronUp, BarChart2, Star,
} from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  generateEscalaWithAlertas,
  type AssignmentHistoryEntry,
  type FuncaoRestricao,
  type InsightFuncao,
} from "@/lib/escala-engine";
import {
  useEscalaPreview,
  computePreviewHash,
  type SugestaoItem,
  type JustificativaMotorV3,
} from "@/hooks/use-escala-preview";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSetPageTabs } from "@/contexts/page-tabs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const Route = createFileRoute("/_authenticated/escalas")({
  validateSearch: (search: Record<string, unknown>): { abrir?: string; view?: string } => ({
    abrir: typeof search.abrir === "string" ? search.abrir : undefined,
    view: typeof search.view === "string" ? search.view : undefined,
  }),
  component: EscalasPage,
  head: () => ({ meta: [{ title: "Escalas — Lumen Pastoral" }] }),
});

import { nomeExibicao } from "@/lib/nome";
import { AssistenteGeracaoEscalas } from "@/components/escalas/assistente-geracao";
import { EscalaPreviewPanel } from "@/components/escalas/escala-preview-panel";

async function _pdfUrlToBase64(url: string): Promise<{ data: string; format: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ data: reader.result as string, format: blob.type.includes("png") ? "PNG" : "JPEG" });
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ── Tipos ────────────────────────────────────────────────────────────────────

type Ministerio = { id: string; nome: string; cor: string; categoria?: string | null; relevancia?: "normal" | "principal"; duplicidade_permitida?: boolean; ordem_prioridade?: number };
type Membro = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  score: number;
  forcar_escalacao_solene: boolean;
  restricoes_dia_semana: number[];
  sexo: "M" | "F" | null;
  prioridade_escala: string;
};

type Escala = {
  id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  tipo: string;
  tipo_missa_id: string | null;
  status: string;
  observacoes: string | null;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
  token_publico: string;
  motor_gerado_em: string | null;
  published_at: string | null;
  published_by: string | null;
  updated_at: string | null;
};

type EscalaFuncao = {
  id: string;
  escala_id: string;
  ministerio_id: string;
  quantidade: number;
  ministerio: Ministerio;
};

type EscalaMembro = {
  id: string;
  membro_id: string;
  ministerio_id: string;
  status: string;
  membro: Membro;
};

type EscalaForm = {
  titulo: string;
  data: string;
  hora_inicio: string;
  local: string;
  tipo: string;
  tipo_missa_id: string;
  status: string;
  observacoes: string;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
};

const EMPTY_FORM: EscalaForm = {
  titulo: "",
  data: format(new Date(), "yyyy-MM-dd"),
  hora_inicio: "",
  local: "",
  tipo: "",
  tipo_missa_id: "",
  status: "rascunho",
  observacoes: "",
  solene: false,
  tem_adoracao: false,
  tem_bispo: false,
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  rascunho:  { label: "Rascunho",  variant: "secondary"    },
  publicada: { label: "Publicada", variant: "default"      },
  arquivada: { label: "Arquivada", variant: "outline"      },
  cancelada: { label: "Cancelada", variant: "destructive"  },
};

type FuncaoPreview = {
  ministerio_id: string;
  nome: string;
  cor: string;
  categoria?: string | null;
  quantidade: number;
  membros: { id: string; nome: string; status: string }[];
};
type EscalaPreview = {
  needed: number; filled: number; funcoes: FuncaoPreview[];
  confirmados: number; pendentes: number; recusados: number;
};

type IndispRow = {
  id: string; membro_id: string; data: string;
  hora_inicio: string | null; hora_fim: string | null;
  tipo: string; data_fim: string | null; cancelada: boolean; motivo: string | null;
};

// ── Componente principal ─────────────────────────────────────────────────────

function EscalasPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { abrir, view: viewParam } = Route.useSearch();

  const [view, setView] = useState<"lista" | "indisponibilidades">(() => {
    if (viewParam === "indisponibilidades") return "indisponibilidades";
    return "lista";
  });
  const [calMonth, setCalMonth] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [detailEscala, setDetailEscala] = useState<Escala | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Escala | null>(null);
  const [autoArchiveTriggered, setAutoArchiveTriggered] = useState(false);
  const [selectedEscalaIds, setSelectedEscalaIds] = useState<Set<string>>(new Set());
  const [bulkDeleteEscalasOpen, setBulkDeleteEscalasOpen] = useState(false);
  const [assistenteOpen, setAssistenteOpen] = useState(false);
  const [reorganizarOpen, setReorganizarOpen] = useState(false);
  const [reorganizarEscalaId, setReorganizarEscalaId] = useState("");

  // Buffer de mudanças de membros — aplica só ao clicar Salvar
  const [pendingAdds, setPendingAdds] = useState<{ membro_id: string; ministerio_id: string }[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<string[]>([]);
  const hasPendingMemberChanges = pendingAdds.length > 0 || pendingRemoves.length > 0;

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: escalas = [], isLoading } = useQuery({
    queryKey: ["escalas", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio, hora_fim, local, tipo, tipo_missa_id, status, observacoes, solene, tem_adoracao, tem_bispo, token_publico, motor_gerado_em, published_at, published_by, updated_at")
        .eq("paroquia_id", profile!.paroquia_id!)
        .order("data")
        .order("hora_inicio");
      if (error) throw error;
      return (data ?? []) as Escala[];
    },
  });

  const { data: ministerios = [] } = useQuery({
    queryKey: ["ministerios", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("ministerios")
        .select("id, nome, cor, categoria")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("ativo", true)
        .order("ordem");
      return (data ?? []) as Ministerio[];
    },
  });

  const { data: membros = [] } = useQuery({
    queryKey: ["membros-ativos", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membros")
        .select("id, nome, telefone, email, score, forcar_escalacao_solene, restricoes_dia_semana, sexo, prioridade_escala")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("ativo", true)
        .order("nome");
      return ((data ?? []) as unknown[]).map((m: any) => ({
        ...m,
        restricoes_dia_semana: m.restricoes_dia_semana ?? [],
        prioridade_escala: m.prioridade_escala ?? "nenhuma",
      })) as Membro[];
    },
  });

  const { data: paroquiaNome = "" } = useQuery({
    queryKey: ["paroquia-nome", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("paroquias")
        .select("nome")
        .eq("id", profile!.paroquia_id!)
        .single();
      return (data?.nome ?? "") as string;
    },
  });

  // ── Carregar atuações dos membros (para usar no motor) ───────────────────
  const { data: membroAtuacoes = {} } = useQuery({
    queryKey: ["membro-atuacoes-map", profile?.paroquia_id, membros.length],
    enabled: !!profile?.paroquia_id && membros.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membro_atuacoes")
        .select("membro_id, atuacao_id")
        .in(
          "membro_id",
          membros.map((m) => m.id)
        );
      const map: Record<string, string[]> = {};
      (data ?? []).forEach((r: { membro_id: string; atuacao_id: string }) => {
        if (!map[r.membro_id]) map[r.membro_id] = [];
        map[r.membro_id].push(r.atuacao_id);
      });
      return map;
    },
  });

  const { data: funcoes = [], refetch: refetchFuncoes } = useQuery({
    queryKey: ["escala-funcoes", detailEscala?.id],
    enabled: !!detailEscala,
    queryFn: async () => {
      const { data } = await supabase
        .from("escala_funcoes")
        .select("id, escala_id, ministerio_id, quantidade, atuacoes_exigidas, ministerios(id, nome, cor, categoria, relevancia, duplicidade_permitida, ordem_prioridade)")
        .eq("escala_id", detailEscala!.id);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        ministerio: r.ministerios,
      })) as EscalaFuncao[];
    },
  });

  const { data: atribuicoes = [], refetch: refetchAtribuicoes } = useQuery({
    queryKey: ["escala-membros", detailEscala?.id],
    enabled: !!detailEscala,
    queryFn: async () => {
      const { data } = await supabase
        .from("escala_membros")
        .select("id, membro_id, ministerio_id, status, membros!membro_id(id, nome, telefone)")
        .eq("escala_id", detailEscala!.id)
        .neq("ativo", false);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        membro: r.membros,
      })) as EscalaMembro[];
    },
  });

  // Limpa buffer quando o painel muda de escala
  useEffect(() => {
    setPendingAdds([]);
    setPendingRemoves([]);
  }, [detailEscala?.id]);

  // Atribuicoes com mudanças pendentes aplicadas (otimista)
  const atribuicoesComPending = useMemo((): EscalaMembro[] => {
    const base = atribuicoes.filter((a) => !pendingRemoves.includes(a.id));
    const fakeAdds: EscalaMembro[] = pendingAdds.map((add, i) => ({
      id: `pending-add-${i}`,
      membro_id: add.membro_id,
      ministerio_id: add.ministerio_id,
      status: "pendente",
      membro: membros.find((m) => m.id === add.membro_id) ?? ({ id: add.membro_id, nome: "…" } as any),
    }));
    return [...base, ...fakeAdds];
  }, [atribuicoes, pendingRemoves, pendingAdds, membros]);

  async function applyPendingMemberChanges() {
    try {
      for (const id of pendingRemoves) {
        await removerAtribuicaoMutation.mutateAsync(id);
      }
      for (const add of pendingAdds) {
        await atribuirMutation.mutateAsync(add);
      }
      setPendingAdds([]);
      setPendingRemoves([]);
      toast.success("Mudanças salvas.");
    } catch {
      // erro já exibido pelas mutations
    }
  }

  const { data: removidos = [], refetch: refetchRemovidos } = useQuery({
    queryKey: ["escala-membros-removidos", detailEscala?.id],
    enabled: !!detailEscala,
    queryFn: async () => {
      const { data } = await supabase
        .from("escala_membros")
        .select("id, membro_id, ministerio_id, removido_em, membros!membro_id(id, nome)")
        .eq("escala_id", detailEscala!.id)
        .eq("ativo", false);
      return ((data ?? []) as any[]).map((r) => ({ ...r, membro: r.membros }));
    },
  });

  const { data: membroMinisterios = {} } = useQuery({
    queryKey: ["membro-ministerios-map", profile?.paroquia_id, membros.length],
    enabled: !!profile?.paroquia_id && membros.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("membro_ministerios")
        .select("membro_id, ministerio_id")
        .in(
          "membro_id",
          membros.map((m) => m.id)
        );
      const map: Record<string, string[]> = {};
      (data ?? []).forEach((r) => {
        if (!map[r.ministerio_id]) map[r.ministerio_id] = [];
        map[r.ministerio_id].push(r.membro_id);
      });
      return map;
    },
  });

  const { data: preferenciaisSolene = [] } = useQuery({
    queryKey: ["preferencias-solene", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membro_ministerios")
        .select("ministerio_id, membro_id")
        .eq("preferencial_solene", true)
        .in("membro_id", membros.map((m) => m.id));
      return (data ?? []) as { ministerio_id: string; membro_id: string }[];
    },
  });

  const { data: assignmentHistory = [] } = useQuery<AssignmentHistoryEntry[]>({
    queryKey: ["escala-historico", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const sixMonthsAgo = format(subMonths(new Date(), 6), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("escalas")
        .select("id, data, escala_membros(membro_id, ministerio_id, ativo)")
        .eq("paroquia_id", profile!.paroquia_id!)
        .gte("data", sixMonthsAgo);

      if (error || !data) return [];

      return (data as any[]).flatMap((escala) =>
        (escala.escala_membros ?? [])
          .filter((entry: any) => entry.ativo !== false)
          .map((entry: any) => ({
          memberId: entry.membro_id,
          ministerioId: entry.ministerio_id,
          date: escala.data,
        }))
      );
    },
  });

  const { data: comunidades = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["comunidades", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("comunidades")
        .select("id, nome")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("ativo", true)
        .order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const { data: tiposMissa = [] } = useQuery<{ id: string; nome: string; cor: string; icone: string | null }[]>({
    queryKey: ["tipos_missa", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("tipos_missa")
        .select("id, nome, cor, icone")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("ativo", true)
        .order("ordem");
      return (data ?? []) as { id: string; nome: string; cor: string; icone: string | null }[];
    },
  });

  const { data: missasPadrao = [] } = useQuery<{
    id: string; nome: string; dia_semana: number; hora_inicio: string | null;
    local: string | null; tipo_missa_id: string | null; solene: boolean;
    tem_adoracao: boolean; tem_bispo: boolean; recorrencia: any;
  }[]>({
    queryKey: ["missas_padrao", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("missas_padrao")
        .select("id, nome, dia_semana, hora_inicio, local, tipo_missa_id, solene, tem_adoracao, tem_bispo, recorrencia")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("ativo", true)
        .order("dia_semana").order("ordem");
      return (data ?? []) as any[];
    },
  });

  const { data: indisponibilidades = [] } = useQuery<IndispRow[]>({
    queryKey: ["indisponibilidades", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("indisponibilidades")
        .select("id, membro_id, data, hora_inicio, hora_fim, tipo, data_fim, cancelada, motivo")
        .eq("paroquia_id", profile!.paroquia_id!)
        .or("cancelada.is.null,cancelada.eq.false")
        .order("data", { ascending: false });
      return (data ?? []) as unknown as IndispRow[];
    },
  });

  const membroIds = membros.map((m) => m.id);
  const { data: funcaoRestricoes = [] } = useQuery<FuncaoRestricao[]>({
    queryKey: ["funcao-restricoes", profile?.paroquia_id, membroIds.length],
    enabled: !!profile?.paroquia_id && membroIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membro_funcao_restricoes")
        .select("membro_id, ministerio_id, tipo")
        .in("membro_id", membroIds);
      return (data ?? []) as FuncaoRestricao[];
    },
  });

  const { data: membroIncompat = [] } = useQuery<{ membro_a_id: string; membro_b_id: string }[]>({
    queryKey: ["membro-incompatibilidades-paroquia", profile?.paroquia_id, membroIds.length],
    enabled: !!profile?.paroquia_id && membroIds.length > 0,
    queryFn: async () => {
      const idList = membroIds.join(",");
      const { data, error } = await (supabase as any)
        .from("membro_incompatibilidades")
        .select("membro_a_id, membro_b_id")
        .eq("paroquia_id", profile!.paroquia_id)
        .or(`membro_a_id.in.(${idList}),membro_b_id.in.(${idList})`);
      if (error) console.warn("[incompatibilidades] RLS bloqueou a query:", error.message);
      else console.log("[incompatibilidades] pares carregados:", data?.length ?? 0, data);
      return (data ?? []) as { membro_a_id: string; membro_b_id: string }[];
    },
  });

  // missa_padrao_id → membro_ids que não podem servir nessa missa
  const { data: membroMissaRestricoes = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["membro-missa-restricoes", profile?.paroquia_id, membroIds.length],
    enabled: !!profile?.paroquia_id && membroIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membro_missa_restricoes")
        .select("membro_id, missa_padrao_id")
        .in("membro_id", membroIds);
      const map: Record<string, string[]> = {};
      (data ?? []).forEach((r: any) => {
        if (!map[r.missa_padrao_id]) map[r.missa_padrao_id] = [];
        map[r.missa_padrao_id].push(r.membro_id);
      });
      return map;
    },
  });

  const { data: paroquiaConfig } = useQuery<{ regras_escala: any; usa_tochas: boolean; nome: string | null; pdf_cabecalho_url: string | null; pdf_rodape_url: string | null } | null>({
    queryKey: ["paroquia-config", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("paroquias")
        .select("regras_escala, usa_tochas, nome, pdf_cabecalho_url, pdf_rodape_url")
        .eq("id", profile!.paroquia_id!)
        .maybeSingle();
      return data ?? null;
    },
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async ({ form, editId }: { form: EscalaForm; editId: string | null }): Promise<{ autoSugestoes: number }> => {
      const payload = {
        titulo: form.titulo.trim(),
        data: form.data,
        hora_inicio: form.hora_inicio || null,
        local: form.local || null,
        tipo: form.tipo_missa_id ? "tipo_missa" : (form.tipo || "missa"),
        tipo_missa_id: form.tipo_missa_id || null,
        status: form.status,
        observacoes: form.observacoes || null,
        solene: form.solene,
        tem_adoracao: form.tem_adoracao,
        tem_bispo: form.tem_bispo,
      };
      const anyDb = supabase as any;
      if (editId) {
        const { error } = await anyDb.from("escalas").update(payload).eq("id", editId);
        if (error) throw error;
        return { autoSugestoes: 0 };
      }

      const { data: nova, error } = await anyDb
        .from("escalas")
        .insert({ ...payload, paroquia_id: profile!.paroquia_id!, created_by: profile!.id })
        .select("id")
        .single();
      if (error) throw error;

      let autoSugestoes = 0;

      // Auto-inject funções do tipo de missa e distribuir membros
      if (nova?.id && payload.tipo_missa_id) {
        const { data: tipoFuncoes } = await anyDb
          .from("tipo_missa_funcoes")
          .select("ministerio_id, quantidade_min")
          .eq("tipo_missa_id", payload.tipo_missa_id)
          .eq("tipo_vinculo", "obrigatoria");

        if (tipoFuncoes && tipoFuncoes.length > 0) {
          await anyDb.from("escala_funcoes").insert(
            (tipoFuncoes as { ministerio_id: string; quantidade_min: number }[]).map((tf) => ({
              escala_id: nova.id,
              ministerio_id: tf.ministerio_id,
              quantidade: tf.quantidade_min,
            }))
          );

          // Busca nomes dos ministérios para o motor
          const minIds = (tipoFuncoes as { ministerio_id: string }[]).map((tf) => tf.ministerio_id);
          const { data: ministData } = await anyDb
            .from("ministerios")
            .select("id, nome, cor, relevancia, duplicidade_permitida, ordem_prioridade")
            .in("id", minIds);
          const ministMap = new Map((ministData ?? []).map((m: any) => [m.id, m]));

          const funcoesPedido = (tipoFuncoes as { ministerio_id: string; quantidade_min: number }[]).map((tf) => {
            const min = ministMap.get(tf.ministerio_id) as any;
            return {
              ministerio_id: tf.ministerio_id,
              quantidade: tf.quantidade_min,
              ministerio: { id: tf.ministerio_id, nome: min?.nome ?? "", cor: min?.cor },
              relevancia: min?.relevancia,
              duplicidade_permitida: min?.duplicidade_permitida,
              ordem_prioridade: min?.ordem_prioridade,
            };
          });

          const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
          const config = {
            usa_tochas:               paroquiaConfig?.usa_tochas ?? false,
            limite_semanal:           (regras.limite_semanal           as number  | undefined) ?? undefined,
            limite_mensal:            (regras.limite_mensal            as number  | undefined) ?? undefined,
            impedir_repeticao_seguida:(regras.impedir_repeticao_consecutiva as boolean | undefined) ?? false,
            distribuicao_masc_pct:    (regras.distribuicao_masc_pct    as number  | undefined) ?? undefined,
            intervalo_minimo_dias:    (regras.intervalo_minimo_dias     as number  | undefined) ?? undefined,
            variedade_ministerio:     (regras.variedade_ministerio      as boolean | undefined) ?? false,
            prioridade_bonus_alto:    (regras.prioridade_bonus_alto     as number  | undefined) ?? undefined,
            prioridade_bonus_medio:   (regras.prioridade_bonus_medio    as number  | undefined) ?? undefined,
            bonus_preferencial_solene:(regras.bonus_preferencial_solene as number  | undefined) ?? undefined,
          };

          const membrosComAtuacoes = membros.map((m) => ({ ...m, atuacao_ids: membroAtuacoes[m.id] ?? [] }));

          const saveDia  = new Date(payload.data + "T12:00:00").getDay();
          const saveHora = (payload.hora_inicio ?? "").slice(0, 5);
          const saveMissasMatch = missasPadrao.filter((mp) => {
            if (mp.dia_semana !== saveDia) return false;
            if (saveHora && mp.hora_inicio) return mp.hora_inicio.slice(0, 5) === saveHora;
            return true;
          });
          const saveMissaRestricaoIndisp = saveMissasMatch.flatMap((mp) =>
            (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: payload.data }))
          );

          const resultado = generateEscalaWithAlertas(
            { titulo: payload.titulo, data: payload.data, tipo: payload.tipo, observacoes: payload.observacoes },
            funcoesPedido,
            membrosComAtuacoes,
            membroMinisterios,
            {
              history: assignmentHistory,
              indisponibilidades: [...indisponibilidades, ...saveMissaRestricaoIndisp],
              restricoes: funcaoRestricoes,
              incompatibilidades: membroIncompat,
              config,
              solene: payload.solene,
              preferenciaisSolene,
            }
          );

          if (resultado.sugestoes.length > 0) {
            await anyDb.from("escala_membros").insert(
              resultado.sugestoes.map((s) => ({
                escala_id: nova.id,
                membro_id: s.membro_id,
                ministerio_id: s.ministerio_id,
                status: "pendente",
                origem: "motor",
              }))
            );
            autoSugestoes = resultado.sugestoes.length;
          }
        }
      }

      return { autoSugestoes };
    },
    onSuccess: ({ autoSugestoes }, { form, editId }) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      // Sincroniza com portal do membro
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      if (editId) {
        setDetailEscala((prev) =>
          prev
            ? {
                ...prev,
                titulo: form.titulo.trim(),
                data: form.data,
                hora_inicio: form.hora_inicio || null,
                local: form.local || null,
                tipo: form.tipo_missa_id ? "tipo_missa" : (form.tipo || "missa"),
                tipo_missa_id: form.tipo_missa_id || null,
                status: form.status,
                observacoes: form.observacoes || null,
                solene: form.solene,
                tem_adoracao: form.tem_adoracao,
                tem_bispo: form.tem_bispo,
              }
            : prev
        );
        toast.success("Escala atualizada.");
      } else {
        if (autoSugestoes > 0) {
          toast.success(`Escala criada com ${autoSugestoes} membro(s) sugerido(s) pelo motor.`);
        } else {
          toast.success("Escala criada. Clique em \"Gerar Sugestão\" para distribuir os membros.");
        }
      }
      if (!editId) setFormOpen(false);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("escalas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Escala removida.");
      setDeleteTarget(null);
      setDetailEscala(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const addFuncaoMutation = useMutation({
    mutationFn: async ({ ministerio_id, quantidade }: { ministerio_id: string; quantidade: number }) => {
      const { error } = await supabase.from("escala_funcoes").upsert({
        escala_id: detailEscala!.id,
        ministerio_id,
        quantidade,
      });
      if (error) throw error;
    },
    onSuccess: () => refetchFuncoes(),
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const removeFuncaoMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("escala_funcoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchFuncoes();
      refetchAtribuicoes();
    },
  });

  const atribuirMutation = useMutation({
    mutationFn: async ({ membro_id, ministerio_id }: { membro_id: string; ministerio_id: string }) => {
      const { error } = await (supabase as any).from("escala_membros").insert({
        escala_id: detailEscala!.id,
        membro_id,
        ministerio_id,
        status: "pendente",
      });
      if (error) throw error;
    },
    onSuccess: (_data, { membro_id, ministerio_id }) => {
      refetchAtribuicoes();
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      // Email só quando a escala já está publicada — rascunho não notifica membros
      if (detailEscala?.status === "publicada") {
        const membro = membros.find((m) => m.id === membro_id);
        const min = ministerios.find((m) => m.id === ministerio_id);
        if (membro?.email) {
          supabase.functions.invoke("send-email", {
            body: {
              template: "escala_atribuida",
              to: membro.email,
              nome: membro.nome,
              paroquia: paroquiaNome,
              escalaTitulo: detailEscala.titulo,
              escalaData: detailEscala.data,
              escalaHora: detailEscala.hora_inicio?.slice(0, 5) ?? "",
              ministerioNome: min?.nome ?? "",
            },
          });
        }
      }
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const removerAtribuicaoMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("escala_membros")
        .update({ ativo: false, removido_em: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchAtribuicoes();
      refetchRemovidos();
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
    },
  });

  const removerPublicadaMutation = useMutation({
    mutationFn: async (args: {
      atribId: string;
      membroId: string;
      motivo: string;
      abrirVaga: boolean;
      penalidade: "nenhuma" | "justificou" | "faltou";
    }) => {
      const { error, data } = await (supabase as any).rpc("admin_remover_membro_escala", {
        p_escala_membro_id: args.atribId,
        p_motivo:           args.motivo || null,
        p_abrir_vaga:       args.abrirVaga,
        p_penalidade:       args.penalidade,
      });
      if (error) throw error;
      return data as { acao: string; substituicao_id?: string };
    },
    onSuccess: (data) => {
      refetchAtribuicoes();
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      qc.invalidateQueries({ queryKey: ["membros-ativos", profile?.paroquia_id] });
      if (data?.acao === "vaga_aberta") {
        toast.success("Vaga aberta para substituição.");
        qc.invalidateQueries({ queryKey: ["substituicoes", profile?.paroquia_id] });
      } else {
        toast.success("Membro removido da escala.");
        if (data?.acao !== "removido") {
          // fallback
        }
      }
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "publicada") {
        patch.published_at = new Date().toISOString();
        patch.published_by = profile?.id ?? null;

        // Calcula aderência ao motor: % de linhas ativas com origem='motor'
        const { data: linhas } = await (supabase as any)
          .from("escala_membros")
          .select("origem, ativo")
          .eq("escala_id", id);
        const ativas = (linhas ?? []).filter((l: any) => l.ativo !== false);
        if (ativas.length > 0) {
          const motor = ativas.filter((l: any) => l.origem === "motor").length;
          patch.aderencia_motor = Math.round((motor / ativas.length) * 100 * 100) / 100;
        }
      }
      const { error } = await (supabase as any).from("escalas").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      // Sincroniza com portal do membro quando status é alterado
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      if (vars.status === "cancelada") {
        qc.invalidateQueries({ queryKey: ["sacristia-todas"] });
        qc.invalidateQueries({ queryKey: ["sacristia-membros-todos"] });
      }
      setDetailEscala((prev) => prev ? { ...prev, status: vars.status } : prev);
      toast.success("Status da escala atualizado.");

      const escalaRef = escalas.find((e) => e.id === vars.id) ?? detailEscala;

      // Ao publicar, envia e-mails a todos os membros já atribuídos
      // (in-app notifications são feitas pelo trigger _trigger_escala_publicada_membros)
      if (vars.status === "publicada" && escalaRef) {
        // Busca email direto do join para não depender do estado local (que pode ter email=null)
        const { data: atrib } = await (supabase as any)
          .from("escala_membros")
          .select("membro_id, ministerio_id, membros!membro_id(id, nome, email)")
          .eq("escala_id", vars.id);
        for (let i = 0; i < (atrib ?? []).length; i++) {
          const a = (atrib ?? [])[i];
          const emailTo   = a.membros?.email ?? membros.find((m: Membro) => m.id === a.membro_id)?.email;
          const nomeMemb  = a.membros?.nome  ?? membros.find((m: Membro) => m.id === a.membro_id)?.nome ?? "";
          const min = ministerios.find((m: Ministerio) => m.id === a.ministerio_id);
          if (!emailTo) continue;
          if (i > 0) await new Promise((r) => setTimeout(r, 400));
          supabase.functions.invoke("send-email", {
            body: {
              template: "escala_publicada",
              to: emailTo,
              nome: nomeMemb,
              paroquia: paroquiaNome,
              escalaTitulo: escalaRef.titulo,
              escalaData: escalaRef.data,
              escalaHora: escalaRef.hora_inicio?.slice(0, 5) ?? "",
              ministerioNome: min?.nome ?? "",
            },
          });
        }
      }

      // Ao cancelar, notifica in-app + e-mail todos os membros atribuídos
      if (vars.status === "cancelada" && escalaRef) {
        const { data: atrib } = await (supabase as any)
          .from("escala_membros")
          .select("membro_id, ministerio_id")
          .eq("escala_id", vars.id);
        const atribList = atrib ?? [];
        // Notificações in-app
        const notifs = atribList.map((a: { membro_id: string }) => ({
          paroquia_id: profile?.paroquia_id,
          membro_id: a.membro_id,
          titulo: `Escala cancelada: ${escalaRef.titulo}`,
          mensagem: `A escala "${escalaRef.titulo}" do dia ${escalaRef.data} foi cancelada pela coordenação.`,
          tipo: "aviso",
          lida: false,
          apenas_admin: false,
          link_referencia: "/portal-membro/escalas",
        }));
        if (notifs.length > 0) await (supabase as any).from("notificacoes").insert(notifs);
        // E-mails
        for (let i = 0; i < atribList.length; i++) {
          const a = atribList[i];
          const membro = membros.find((m: Membro) => m.id === a.membro_id);
          const min = ministerios.find((m: Ministerio) => m.id === a.ministerio_id);
          if (!membro?.email) continue;
          if (i > 0) await new Promise((r) => setTimeout(r, 400));
          supabase.functions.invoke("send-email", {
            body: {
              template: "escala_cancelada",
              to: membro.email,
              nome: membro.nome,
              paroquia: paroquiaNome,
              escalaTitulo: escalaRef.titulo,
              escalaData: escalaRef.data,
              escalaHora: escalaRef.hora_inicio?.slice(0, 5) ?? "",
              ministerioNome: min?.nome ?? "",
            },
          });
        }
      }
    },
  });

  const bulkUpdateStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const { error } = await supabase.from("escalas").update({ status }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: async (_, { ids, status }) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      if (status === "cancelada") {
        qc.invalidateQueries({ queryKey: ["sacristia-todas"] });
        qc.invalidateQueries({ queryKey: ["sacristia-membros-todos"] });
      }
      setSelectedEscalaIds(new Set());
      toast.success(`${ids.length} escala(s) ${status === "publicada" ? "publicada(s)" : status === "cancelada" ? "cancelada(s)" : "arquivada(s)"}.`);

      // Envia e-mails ao publicar ou cancelar múltiplas escalas em lote
      if ((status === "publicada" || status === "cancelada") && ids.length > 0) {
        const { data: atrib } = await (supabase as any)
          .from("escala_membros")
          .select("membro_id, ministerio_id, escala_id")
          .in("escala_id", ids);
        const allAtrib = atrib ?? [];

        // Notificações in-app ao cancelar em lote
        if (status === "cancelada") {
          const notifs = allAtrib.map((a: { membro_id: string; escala_id: string }) => {
            const escalaRef = escalas.find((e) => e.id === a.escala_id);
            return {
              paroquia_id: profile?.paroquia_id,
              membro_id: a.membro_id,
              titulo: `Escala cancelada: ${escalaRef?.titulo ?? ""}`,
              mensagem: `A escala "${escalaRef?.titulo ?? ""}" do dia ${escalaRef?.data ?? ""} foi cancelada pela coordenação.`,
              tipo: "aviso",
              lida: false,
              apenas_admin: false,
              link_referencia: "/portal-membro/escalas",
            };
          });
          if (notifs.length > 0) await (supabase as any).from("notificacoes").insert(notifs);
        }

        const template = status === "publicada" ? "escala_publicada" : "escala_cancelada";
        for (let i = 0; i < allAtrib.length; i++) {
          const a = allAtrib[i];
          const escalaRef = escalas.find((e) => e.id === a.escala_id);
          const membro = membros.find((m: Membro) => m.id === a.membro_id);
          const min = ministerios.find((m: Ministerio) => m.id === a.ministerio_id);
          if (!membro?.email || !escalaRef) continue;
          if (i > 0) await new Promise((r) => setTimeout(r, 400));
          supabase.functions.invoke("send-email", {
            body: {
              template,
              to: membro.email,
              nome: membro.nome,
              paroquia: paroquiaNome,
              escalaTitulo: escalaRef.titulo,
              escalaData: escalaRef.data,
              escalaHora: escalaRef.hora_inicio?.slice(0, 5) ?? "",
              ministerioNome: min?.nome ?? "",
            },
          });
        }
      }
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const bulkDeleteEscalasMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("escalas").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      setSelectedEscalaIds(new Set());
      setBulkDeleteEscalasOpen(false);
      toast.success(`${ids.length} escala(s) removida(s).`);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const bulkPublishMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase as any)
        .from("escalas")
        .update({ status: "publicada" })
        .in("id", ids)
        .eq("paroquia_id", profile!.paroquia_id!);
      if (error) throw error;
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      setSelectedEscalaIds(new Set());
      toast.success(`${ids.length} escala(s) publicada(s).`);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const swapMembroMutation = useMutation({
    mutationFn: async ({ removeId, escalaId, membroId, ministerioId }: { removeId: string; escalaId: string; membroId: string; ministerioId: string }) => {
      const { error: updErr } = await (supabase as any)
        .from("escala_membros")
        .update({ ativo: false, removido_em: new Date().toISOString() })
        .eq("id", removeId);
      if (updErr) throw updErr;
      const { error: insErr } = await (supabase as any).from("escala_membros").insert({ escala_id: escalaId, membro_id: membroId, ministerio_id: ministerioId, status: "pendente" });
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalas-counts"] });
      qc.invalidateQueries({ queryKey: ["escala-membros"] });
      qc.invalidateQueries({ queryKey: ["escala-membros-removidos"] });
      qc.invalidateQueries({ queryKey: ["escala-historico"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Substituição realizada.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const reorganizarMutation = useMutation({
    mutationFn: async (escalaId: string) => {
      const escala = escalas.find((e) => e.id === escalaId);
      if (!escala) throw new Error("Escala não encontrada.");

      const { data: funcoesData } = await (supabase as any)
        .from("escala_funcoes")
        .select("ministerio_id, quantidade, ministerios(id, nome, cor, relevancia, duplicidade_permitida, ordem_prioridade)")
        .eq("escala_id", escalaId);

      if (!funcoesData || funcoesData.length === 0)
        throw new Error("Escala sem funções definidas. Adicione funções em Geral → Tipos de Missa ou manualmente nesta escala.");

      // Diagnóstico antecipado: verifica se há vínculos membro-função antes de rodar o motor
      const minIds = (funcoesData as any[]).map((f) => f.ministerio_id as string);
      const membrosComVinculo = minIds.some((mid) => (membroMinisterios[mid] ?? []).length > 0);
      if (!membrosComVinculo) {
        throw new Error(
          "Nenhum membro possui vínculo com as funções desta escala. " +
          "Acesse Membros → edite cada membro → aba Funções e marque as funções que ele exerce."
        );
      }

      await (supabase as any).from("escala_membros").delete().eq("escala_id", escalaId);

      const funcoesPedido = (funcoesData as any[]).map((f) => ({
        ministerio_id:        f.ministerio_id,
        quantidade:           f.quantidade,
        ministerio:           { id: f.ministerio_id, nome: f.ministerios?.nome ?? "", cor: f.ministerios?.cor },
        relevancia:           f.ministerios?.relevancia,
        duplicidade_permitida: f.ministerios?.duplicidade_permitida,
        ordem_prioridade:     f.ministerios?.ordem_prioridade,
      }));

      const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
      const engineConfig = {
        usa_tochas:               paroquiaConfig?.usa_tochas ?? false,
        limite_semanal:           (regras.limite_semanal           as number  | undefined) ?? undefined,
        limite_mensal:            (regras.limite_mensal            as number  | undefined) ?? undefined,
        impedir_repeticao_seguida:(regras.impedir_repeticao_consecutiva as boolean | undefined) ?? false,
        distribuicao_masc_pct:    (regras.distribuicao_masc_pct    as number  | undefined) ?? undefined,
        intervalo_minimo_dias:    (regras.intervalo_minimo_dias     as number  | undefined) ?? undefined,
        variedade_ministerio:     (regras.variedade_ministerio      as boolean | undefined) ?? false,
        prioridade_bonus_alto:    (regras.prioridade_bonus_alto     as number  | undefined) ?? undefined,
        prioridade_bonus_medio:   (regras.prioridade_bonus_medio    as number  | undefined) ?? undefined,
        bonus_preferencial_solene:(regras.bonus_preferencial_solene as number  | undefined) ?? undefined,
      };

      const membrosComAtuacoes = membros.map((m) => ({
        ...m,
        atuacao_ids: membroAtuacoes[m.id] ?? [],
      }));

      const reorgDia  = new Date(escala.data + "T12:00:00").getDay();
      const reorgHora = (escala.hora_inicio ?? "").slice(0, 5);
      const reorgMissasMatch = missasPadrao.filter((mp) => {
        if (mp.dia_semana !== reorgDia) return false;
        if (reorgHora && mp.hora_inicio) return mp.hora_inicio.slice(0, 5) === reorgHora;
        return true;
      });
      const reorgMissaRestricaoIndisp = reorgMissasMatch.flatMap((mp) =>
        (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: escala.data }))
      );

      const resultado = generateEscalaWithAlertas(
        { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
        funcoesPedido,
        membrosComAtuacoes,
        membroMinisterios,
        {
          history: assignmentHistory.filter((h) => h.date !== escala.data),
          indisponibilidades: [...indisponibilidades, ...reorgMissaRestricaoIndisp],
          restricoes: funcaoRestricoes,
          incompatibilidades: membroIncompat,
          config: engineConfig,
          solene: escala.solene,
          tem_adoracao: escala.tem_adoracao,
          tem_bispo: escala.tem_bispo,
          preferenciaisSolene,
        }
      );

      if (resultado.sugestoes.length > 0) {
        const { error: reorganizarErr } = await (supabase as any).from("escala_membros").insert(
          resultado.sugestoes.map((s) => ({
            escala_id: escalaId,
            membro_id: s.membro_id,
            ministerio_id: s.ministerio_id,
            status: "pendente",
          }))
        );
        if (reorganizarErr) {
          console.error("[REORGANIZAR] Erro ao inserir membros:", reorganizarErr);
          throw reorganizarErr;
        }
      }
      return { count: resultado.sugestoes.length, alertas: resultado.alertas, detalhes: resultado.detalhesPorFuncao };
    },
    onSuccess: ({ count, alertas, detalhes }) => {
      qc.invalidateQueries({ queryKey: ["escalas-counts"] });
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      qc.invalidateQueries({ queryKey: ["escala-membros"] });
      setReorganizarOpen(false);
      setReorganizarEscalaId("");
      if (count > 0) {
        toast.success(`${count} membro(s) atribuído(s) automaticamente.`);
        // Exibe alertas de vagas não preenchidas
        alertas.forEach((a) => toast.warning(a, { duration: 8000 }));
      } else {
        const motivo = alertas[0] ?? "Verifique se os membros têm funções vinculadas em Membros → Funções.";
        toast.error(`Nenhum membro distribuído: ${motivo}`, { duration: 10000 });
        // Diagnóstico por função
        detalhes
          .filter((d) => d.alocados < d.solicitados)
          .forEach((d) => {
            toast.warning(
              `"${d.ministerio_nome}": ${d.alocados}/${d.solicitados} preenchido${d.motivo_vazio ? ` — ${d.motivo_vazio}` : ""}`,
              { duration: 8000 },
            );
          });
      }
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const archivePastEscalasMutation = useMutation({
    mutationFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      // Arquiva apenas escalas publicadas passadas (não canceladas — mantêm status próprio)
      const { error } = await supabase
        .from("escalas")
        .update({ status: "arquivada" })
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("status", "publicada")
        .lt("data", today);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Escalas antigas arquivadas.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openCreate() {
    setFormOpen(true);
  }

  function openEdit(e: Escala, ev: React.MouseEvent) {
    ev.stopPropagation();
    setDetailEditMode(true);
    setDetailEscala(e);
  }

  const today = new Date();
  const upcoming = useMemo(
    () => escalas.filter((e) => new Date(e.data + "T00:00:00") >= new Date(today.toDateString())),
    [escalas]
  );

  // histórico migrou para Sacristia > Concluídas

  // Status counts para indicadores rápidos
  const statusCounts = useMemo(() => {
    const rascunhos  = escalas.filter((e) => e.status === "rascunho"  && new Date(e.data + "T00:00:00") >= new Date(today.toDateString())).length;
    const publicadas = escalas.filter((e) => e.status === "publicada" && new Date(e.data + "T00:00:00") >= new Date(today.toDateString())).length;
    const arquivadas = escalas.filter((e) => e.status === "arquivada").length;
    const canceladas = escalas.filter((e) => e.status === "cancelada").length;
    return { rascunhos, publicadas, arquivadas, canceladas };
  }, [escalas, today]);

  useEffect(() => {
    if (autoArchiveTriggered || !profile?.paroquia_id) return;
    const hasPast = escalas.some((e) => {
      const eventDate = new Date(e.data + "T00:00:00");
      return eventDate < new Date(today.toDateString()) && e.status === "publicada";
    });
    if (hasPast) {
      archivePastEscalasMutation.mutate();
      setAutoArchiveTriggered(true);
    }
  }, [autoArchiveTriggered, escalas, profile?.paroquia_id, today, archivePastEscalasMutation]);

  // Abre escala via search param ?abrir=id (vindo de links profundos do painel)
  useEffect(() => {
    if (!abrir || !escalas.length || detailEscala) return;
    const found = escalas.find((e) => e.id === abrir);
    if (found) setDetailEscala(found);
  }, [abrir, escalas, detailEscala]);

  // ── Calendar helpers ────────────────────────────────────────────────────────

  const calDays = useMemo(() => {
    const start = startOfMonth(calMonth);
    const end = endOfMonth(calMonth);
    const days = eachDayOfInterval({ start, end });
    const offset = getDay(start);
    return { days, offset };
  }, [calMonth]);

  function escalasForDay(day: Date) {
    return escalas.filter((e) => {
      const d = new Date(e.data + "T00:00:00");
      return isSameDay(d, day);
    });
  }

  // ── Contagens para progress bar nos cards ───────────────────────────────────
  const escalaIds = useMemo(() => escalas.map((e) => e.id), [escalas]);

  const { data: escalaCounts = {} as Record<string, EscalaPreview> } = useQuery({
    queryKey: ["escalas-counts", escalaIds],
    enabled: escalaIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const [funcRes, membRes] = await Promise.all([
        (supabase as any)
          .from("escala_funcoes")
          .select("escala_id, quantidade, ministerio_id, ministerios(id, nome, cor, categoria)")
          .in("escala_id", escalaIds),
        (supabase as any)
          .from("escala_membros")
          .select("escala_id, ministerio_id, status, membros!membro_id(id, nome)")
          .in("escala_id", escalaIds),
      ]);
      const counts: Record<string, EscalaPreview> = {};
      ((funcRes.data ?? []) as any[]).forEach((f) => {
        if (!counts[f.escala_id]) counts[f.escala_id] = { needed: 0, filled: 0, funcoes: [], confirmados: 0, pendentes: 0, recusados: 0 };
        counts[f.escala_id].needed += f.quantidade;
        counts[f.escala_id].funcoes.push({
          ministerio_id: f.ministerio_id,
          nome: f.ministerios?.nome ?? "—",
          cor: f.ministerios?.cor ?? "#888",
          categoria: f.ministerios?.categoria ?? null,
          quantidade: f.quantidade,
          membros: [],
        });
      });
      ((membRes.data ?? []) as any[]).forEach((m) => {
        if (!counts[m.escala_id]) counts[m.escala_id] = { needed: 0, filled: 0, funcoes: [], confirmados: 0, pendentes: 0, recusados: 0 };
        counts[m.escala_id].filled += 1;
        const st: string = m.status ?? "pendente";
        if (st === "confirmado" || st === "presente") counts[m.escala_id].confirmados++;
        else if (st === "recusado") counts[m.escala_id].recusados++;
        else counts[m.escala_id].pendentes++;
        const funcao = counts[m.escala_id].funcoes.find((f) => f.ministerio_id === m.ministerio_id);
        if (funcao && m.membros) funcao.membros.push({ id: m.membros.id, nome: m.membros.nome, status: st });
      });
      return counts;
    },
  });

  // ── PDF Export ──────────────────────────────────────────────────────────────
  async function exportarEscalasPDF(ids: string[]) {
    const selected = escalas.filter((e) => ids.includes(e.id));
    if (selected.length === 0) return;

    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF("p", "mm", "a4");
    const W = 210;
    const H = 297;
    const MARGIN = 14;

    const NAVY:        [number,number,number] = [15,  23,  42];
    const GOLD:        [number,number,number] = [245, 158, 11];
    const WHITE:       [number,number,number] = [255, 255, 255];
    const GRAY:        [number,number,number] = [100, 116, 139];
    const LIGHT_GRAY:  [number,number,number] = [248, 250, 252];
    const BORDER_GRAY: [number,number,number] = [226, 232, 240];
    const STEEL:       [number,number,number] = [71,  85,  105];
    const SECTION_BG:  [number,number,number] = [241, 245, 249];

    const nomeParoquia = paroquiaConfig?.nome ?? "Pastoral Litúrgica";
    const hoje = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

    // Load images
    const imgCabecalho = paroquiaConfig?.pdf_cabecalho_url
      ? await _pdfUrlToBase64(paroquiaConfig.pdf_cabecalho_url) : null;
    const imgRodape = paroquiaConfig?.pdf_rodape_url
      ? await _pdfUrlToBase64(paroquiaConfig.pdf_rodape_url) : null;

    // Calculate header height
    let headerH = 0;
    if (imgCabecalho) {
      const props = doc.getImageProperties(imgCabecalho.data);
      headerH = W * (props.height / props.width);
      doc.addImage(imgCabecalho.data, imgCabecalho.format as "PNG" | "JPEG", 0, 0, W, headerH);
    } else {
      headerH = 34;
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, headerH, "F");
      doc.setFillColor(...GOLD);
      doc.rect(0, headerH - 2.5, W, 2.5, "F");
      doc.setTextColor(...WHITE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(nomeParoquia, W / 2, 12, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...GOLD);
      doc.text("Pastoral Litúrgica  ·  Escalas de Serviço", W / 2, 19, { align: "center" });
      doc.setTextColor(160, 170, 190);
      doc.setFontSize(6.5);
      doc.text("Emitido em " + hoje, W / 2, 27, { align: "center" });
    }

    // Calculate footer height
    let footerH = 10;
    let footerDisplayH = 0;
    if (imgRodape) {
      const props = doc.getImageProperties(imgRodape.data);
      footerDisplayH = W * (props.height / props.width);
      footerH = footerDisplayH;
    }

    let y = headerH + 6;

    // Meta line
    const dates = selected.map((e) => new Date(e.data + "T00:00:00"));
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const periodoTitle =
      format(minDate, "MMyyyy") === format(maxDate, "MMyyyy")
        ? format(minDate, "MMMM 'de' yyyy", { locale: ptBR }).toUpperCase()
        : `${format(minDate, "MMM", { locale: ptBR })} – ${format(maxDate, "MMM 'de' yyyy", { locale: ptBR })}`.toUpperCase();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(
      `${selected.length} escala${selected.length !== 1 ? "s" : ""}  ·  ${periodoTitle}  ·  ${hoje}`,
      MARGIN, y
    );
    y += 4;
    doc.setDrawColor(...BORDER_GRAY);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, W - MARGIN, y);
    y += 7;

    function _drawTextFooter(pageNum: number) {
      doc.setFillColor(...NAVY);
      doc.rect(0, H - 10, W, 10, "F");
      doc.setFillColor(...GOLD);
      doc.rect(0, H - 10, W, 0.8, "F");
      doc.setTextColor(...WHITE);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(nomeParoquia, MARGIN, H - 4.5);
      doc.text("Pagina " + pageNum, W - MARGIN, H - 4.5, { align: "right" });
    }

    const STATUS_LABELS: Record<string, string> = {
      publicada: "Publicada", rascunho: "Rascunho",
      arquivada: "Arquivada", cancelada: "Cancelada",
    };
    const STATUS_COLORS: Record<string, [[number,number,number],[number,number,number]]> = {
      publicada: [[16, 185, 129], WHITE],
      rascunho:  [STEEL, [200, 210, 220]],
      arquivada: [STEEL, GRAY],
      cancelada: [[220, 38, 38], WHITE],
    };

    for (const e of selected) {
      const d = new Date(e.data + "T00:00:00");
      const diaSemana = format(d, "EEEE", { locale: ptBR }).toUpperCase();
      const dataCompleta = format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
      const preview = escalaCounts[e.id];
      const funcoes = preview?.funcoes ?? [];

      // Estimate header height to check for page break
      const titleLines = doc.splitTextToSize(e.titulo, W - 2 * MARGIN - 58);
      let cardHeaderH = 7 + titleLines.length * 5.5 + 4.5 + 8;
      if (e.hora_inicio) cardHeaderH += 5;
      if (cardHeaderH < 30) cardHeaderH = 30;

      if (y + cardHeaderH + 8 > H - footerH - 5) {
        if (!imgRodape) _drawTextFooter((doc as any).internal.getNumberOfPages());
        doc.addPage();
        y = 15;
      }

      const cX = MARGIN;
      const cW = W - 2 * MARGIN;
      const cardStartY = y;

      // Card header background
      doc.setFillColor(...NAVY);
      doc.rect(cX, y, cW, cardHeaderH, "F");
      doc.setFillColor(...GOLD);
      doc.rect(cX, y, 4, cardHeaderH, "F");

      const tx = cX + 9;
      let hy = y + 7;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...GOLD);
      doc.text(diaSemana, tx, hy);
      hy += 5.5;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...WHITE);
      doc.text(titleLines, tx, hy);
      hy += titleLines.length * 5.5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(170, 185, 210);
      doc.text(dataCompleta, tx, hy);
      hy += 4.5;

      if (e.hora_inicio) {
        const timeStr = e.hora_inicio.slice(0, 5)
          + (e.hora_fim ? ` – ${e.hora_fim.slice(0, 5)}` : "")
          + (e.local ? `  ·  ${e.local}` : "");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(251, 191, 36);
        doc.text(timeStr, tx, hy);
      }

      // Badges top-right
      let bx = cX + cW - 4;
      const badgeY = y + 6;

      const sLabel = STATUS_LABELS[e.status] ?? e.status;
      const [sBg, sFg] = STATUS_COLORS[e.status] ?? [STEEL, GRAY];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      const sW = doc.getTextWidth(sLabel) + 6;
      doc.setFillColor(...sBg);
      doc.roundedRect(bx - sW, badgeY, sW, 5.5, 1, 1, "F");
      doc.setTextColor(...sFg);
      doc.text(sLabel, bx - sW / 2, badgeY + 3.8, { align: "center" });
      bx -= sW + 3;

      if (e.solene) {
        const sol = "Solene";
        const solW = doc.getTextWidth(sol) + 6;
        doc.setFillColor(92, 62, 5);
        doc.roundedRect(bx - solW, badgeY, solW, 5.5, 1, 1, "F");
        doc.setTextColor(...GOLD);
        doc.text(sol, bx - solW / 2, badgeY + 3.8, { align: "center" });
      }

      y += cardHeaderH;

      // Observations row
      if (e.observacoes) {
        const obsH = 10;
        doc.setFillColor(255, 251, 235);
        doc.rect(cX, y, cW, obsH, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(120, 53, 15);
        const obsLines = doc.splitTextToSize(e.observacoes, cW - 10);
        doc.text(obsLines[0], cX + 5, y + 6.5);
        y += obsH;
      }

      // Functions table
      if (funcoes.length === 0) {
        doc.setFillColor(250, 251, 252);
        doc.rect(cX, y, cW, 10, "F");
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(...GRAY);
        doc.text("Nenhuma funcao definida para esta escala.", W / 2, y + 6.5, { align: "center" });
        y += 10;
      } else {
        // Group by categoria
        const groups: { cat: string | null; funcoes: typeof funcoes }[] = [];
        funcoes.forEach((f) => {
          if (f.categoria) {
            const g = groups.find((x) => x.cat === f.categoria);
            if (g) g.funcoes.push(f); else groups.push({ cat: f.categoria, funcoes: [f] });
          } else {
            const g = groups.find((x) => x.cat === null);
            if (g) g.funcoes.push(f); else groups.push({ cat: null, funcoes: [f] });
          }
        });

        const tableBody: any[][] = [];
        for (const group of groups) {
          if (group.cat) {
            tableBody.push([{
              content: group.cat.toUpperCase(), colSpan: 4,
              styles: { fontStyle: "bold" as const, textColor: GRAY, fillColor: SECTION_BG, fontSize: 7 },
            }]);
          }
          for (let i = 0; i < group.funcoes.length; i += 2) {
            const f1 = group.funcoes[i];
            const f2 = group.funcoes[i + 1];
            const m1 = f1.membros.length > 0 ? f1.membros.map((m) => nomeExibicao(m.nome)).join(", ") : "—";
            if (f2) {
              const m2 = f2.membros.length > 0 ? f2.membros.map((m) => nomeExibicao(m.nome)).join(", ") : "—";
              tableBody.push([
                { content: f1.nome, styles: { fontStyle: "bold" as const, textColor: STEEL } },
                { content: m1, styles: { textColor: f1.membros.length === 0 ? GRAY : NAVY } },
                { content: f2.nome, styles: { fontStyle: "bold" as const, textColor: STEEL } },
                { content: m2, styles: { textColor: f2.membros.length === 0 ? GRAY : NAVY } },
              ]);
            } else {
              tableBody.push([
                { content: f1.nome, styles: { fontStyle: "bold" as const, textColor: STEEL } },
                { content: m1, colSpan: 3, styles: { textColor: f1.membros.length === 0 ? GRAY : NAVY } },
              ]);
            }
          }
        }

        autoTable(doc, {
          startY: y,
          body: tableBody,
          margin: { left: cX, right: MARGIN, bottom: footerH + 4 },
          styles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 6, right: 6 } },
          columnStyles: {
            0: { cellWidth: 44 }, 1: { cellWidth: 47 },
            2: { cellWidth: 44 }, 3: { cellWidth: 47 },
          },
          alternateRowStyles: { fillColor: LIGHT_GRAY },
          tableLineColor: BORDER_GRAY,
          tableLineWidth: 0.2,
          didDrawPage: (data: any) => {
            if (!imgRodape) _drawTextFooter(data.pageNumber);
          },
        });

        y = (doc as any).lastAutoTable.finalY;
      }

      // Separator line between cards
      doc.setDrawColor(...BORDER_GRAY);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y + 1, W - MARGIN, y + 1);
      y += 7;
    }

    // Footer images on all pages
    if (imgRodape) {
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.addImage(imgRodape.data, imgRodape.format as "PNG" | "JPEG", 0, H - footerDisplayH, W, footerDisplayH);
      }
    }

    const nomeArq = `escalas_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`;
    doc.save(nomeArq);
  }

  const [escalaForm, setEscalaForm] = useState<EscalaForm>(EMPTY_FORM);

  useEffect(() => {
    if (formOpen) setEscalaForm(EMPTY_FORM);
  }, [formOpen]);

  useSetPageTabs([
    { label: "Planejamento",       onClick: () => setView("lista"),              isActive: view === "lista" },
    { label: "Sacristia",          to: "/sacristia",                             isActive: false },
    { label: "Indisponibilidades", onClick: () => setView("indisponibilidades"), isActive: view === "indisponibilidades" },
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-28">

      {/* Header */}
      <div className="page-header mt-4">
        <div>
          <h1 className="page-header-title">Planejamento</h1>
          <p className="page-header-sub">Organize e publique as escalas litúrgicas da paróquia.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          <Button
            variant="outline" size="sm" className="rounded-xl h-9"
            onClick={() => archivePastEscalasMutation.mutate()}
            disabled={archivePastEscalasMutation.isPending}
            title="Arquivar escalas passadas"
          >
            <span className="hidden sm:inline">Arquivar antigas</span>
            <span className="sm:hidden">Arquivar</span>
          </Button>
          <Button
            variant="outline" size="sm" className="rounded-xl h-9"
            onClick={() => setAssistenteOpen(true)}
            title="Assistente de geração de escalas"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline ml-1.5">Gerar escalas</span>
          </Button>
          <Button size="sm" className="rounded-xl h-9" onClick={openCreate}>
            <Plus className="h-4 w-4" /><span className="hidden sm:inline ml-1">Nova escala</span>
          </Button>
        </div>
      </div>

      {/* Indicadores de status */}
      {escalas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {statusCounts.publicadas > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {statusCounts.publicadas} publicada{statusCounts.publicadas !== 1 ? "s" : ""}
            </span>
          )}
          {statusCounts.rascunhos > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/70 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {statusCounts.rascunhos} rascunho{statusCounts.rascunhos !== 1 ? "s" : ""}
            </span>
          )}
          {statusCounts.arquivadas > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 border border-border/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/60">
              {statusCounts.arquivadas} arquivada{statusCounts.arquivadas !== 1 ? "s" : ""}
            </span>
          )}
          {statusCounts.canceladas > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200/70 px-2.5 py-1 text-[11px] font-semibold text-red-700">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {statusCounts.canceladas} cancelada{statusCounts.canceladas !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Barra de ações em massa — fixa na base */}
      {selectedEscalaIds.size > 0 && (
        <div className="fixed floating-bar-bottom left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-md shadow-2xl px-4 py-2.5 max-w-[calc(100vw-2rem)]">
          <span className="text-sm font-semibold whitespace-nowrap">
            <span className="text-primary">{selectedEscalaIds.size}</span> escala(s)
          </span>
          <div className="h-4 w-px bg-border mx-0.5 shrink-0" />
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => exportarEscalasPDF([...selectedEscalaIds])}
              title="Exportar PDF — Cards"
            >
              <FileText className="h-3 w-3 mr-1" />PDF
            </Button>
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              disabled={bulkUpdateStatusMutation.isPending}
              onClick={() => bulkUpdateStatusMutation.mutate({ ids: [...selectedEscalaIds], status: "publicada" })}
            >Publicar</Button>
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              disabled={bulkUpdateStatusMutation.isPending}
              onClick={() => bulkUpdateStatusMutation.mutate({ ids: [...selectedEscalaIds], status: "arquivada" })}
            >Arquivar</Button>
            <Button
              size="sm" variant="destructive" className="h-7 text-xs"
              onClick={() => setBulkDeleteEscalasOpen(true)}
            ><Trash2 className="h-3 w-3 mr-1" />Excluir</Button>
            <button
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
              onClick={() => setSelectedEscalaIds(new Set())}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Barra de mudanças pendentes de membros */}
      {hasPendingMemberChanges && (
        <div className="fixed floating-bar-bottom right-4 z-50 flex items-center gap-2 rounded-2xl border border-amber-400/60 bg-card/95 backdrop-blur-md shadow-2xl px-4 py-2.5">
          <span className="text-sm font-semibold text-amber-600 whitespace-nowrap">
            {pendingAdds.length + pendingRemoves.length} mudança(s) pendente(s)
          </span>
          <div className="h-4 w-px bg-border mx-0.5 shrink-0" />
          <Button
            size="sm" className="h-7 text-xs"
            disabled={atribuirMutation.isPending || removerAtribuicaoMutation.isPending}
            onClick={applyPendingMemberChanges}
          >
            Salvar
          </Button>
          <Button
            size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
            onClick={() => { setPendingAdds([]); setPendingRemoves([]); }}
          >
            Descartar
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
              <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      ) : view === "lista" ? (
        <ListaView
          escalas={upcoming}
          allEscalas={escalas}
          selectedIds={selectedEscalaIds}
          escalaCounts={escalaCounts}
          membros={membros}
          assignmentHistory={assignmentHistory}
          paroquiaConfig={paroquiaConfig}
          indisponibilidades={indisponibilidades}
          membroMinisterios={membroMinisterios}
          funcaoRestricoes={funcaoRestricoes}
          onToggleSelect={(id) => {
            const next = new Set(selectedEscalaIds);
            if (next.has(id)) next.delete(id); else next.add(id);
            setSelectedEscalaIds(next);
          }}
          onSelectAll={(ids) => setSelectedEscalaIds(new Set(ids))}
          onOpenDetail={(e) => setDetailEscala(e)}
          onEdit={openEdit}
          onDelete={(e) => setDeleteTarget(e)}
          onCreate={openCreate}
          onExportPDF={(id: string) => exportarEscalasPDF([id])}
          onReorganizar={() => setReorganizarOpen(true)}
          onBulkPublish={(ids) => bulkPublishMutation.mutate(ids)}
          onSwapMembro={(args) => swapMembroMutation.mutate(args)}
          isBulkPublishing={bulkPublishMutation.isPending}
        />
      ) : view === "indisponibilidades" ? (
        <IndisponibilidadesTab
          indisponibilidades={indisponibilidades}
          membros={membros}
          onRefresh={() => qc.invalidateQueries({ queryKey: ["indisponibilidades", profile?.paroquia_id] })}
        />
      ) : null}

      {/* ── Assistente de geração de escalas ───────────────────────────────── */}
      {profile && (
        <AssistenteGeracaoEscalas
          open={assistenteOpen}
          onClose={() => setAssistenteOpen(false)}
          paroquiaId={profile.paroquia_id!}
          profileId={profile.id}
          membros={membros}
          ministerios={ministerios}
          missasPadrao={missasPadrao}
          membroMinisterios={membroMinisterios}
          membroAtuacoes={membroAtuacoes}
          assignmentHistory={assignmentHistory}
          indisponibilidades={indisponibilidades}
          funcaoRestricoes={funcaoRestricoes}
          membroMissaRestricoes={membroMissaRestricoes}
          paroquiaConfig={paroquiaConfig ?? null}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["escalas"] });
            qc.invalidateQueries({ queryKey: ["escalas-counts"] });
            qc.invalidateQueries({ queryKey: ["escala-membros"] });
            qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
            qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
          }}
        />
      )}

      {/* ── Dialog criar ────────────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) setFormOpen(false); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova escala</DialogTitle>
          </DialogHeader>
          <EscalaFormContent
            form={escalaForm}
            setForm={setEscalaForm}
            saving={saveMutation.isPending}
            comunidades={comunidades}
            tiposMissa={tiposMissa}
            onSave={() => saveMutation.mutate({ form: escalaForm, editId: null })}
            onClose={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ── Dialog reorganizar membros ──────────────────────────────────────── */}
      <Dialog open={reorganizarOpen} onOpenChange={(o) => { if (!o) { setReorganizarOpen(false); setReorganizarEscalaId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reorganizar membros</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Selecione uma escala para limpar as atribuições atuais e redistribuir os membros automaticamente.
            </p>
            <div className="space-y-1.5">
              <Label>Escala</Label>
              <Select value={reorganizarEscalaId} onValueChange={setReorganizarEscalaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar escala..." />
                </SelectTrigger>
                <SelectContent>
                  {upcoming.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {format(new Date(e.data + "T00:00:00"), "dd/MM", { locale: ptBR })} — {e.titulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              As atribuições atuais serão removidas e redistribuídas pelo motor automático.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReorganizarOpen(false); setReorganizarEscalaId(""); }}>Cancelar</Button>
            <Button
              disabled={!reorganizarEscalaId || reorganizarMutation.isPending}
              onClick={() => reorganizarMutation.mutate(reorganizarEscalaId)}
            >
              {reorganizarMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Reorganizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sheet detalhe / editar ──────────────────────────────────────────── */}
      <Sheet open={!!detailEscala} onOpenChange={(o) => { if (!o) { setDetailEscala(null); setDetailEditMode(false); } }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {detailEscala && (
            <EscalaDetail
              escala={detailEscala}
              ministerios={ministerios}
              membros={membros}
              funcoes={funcoes}
              atribuicoes={atribuicoesComPending}
              removidos={removidos}
              membroMinisterios={membroMinisterios}
              assignmentHistory={assignmentHistory}
              membroAtuacoes={membroAtuacoes}
              indisponibilidades={indisponibilidades}
              funcaoRestricoes={funcaoRestricoes}
              incompatibilidades={membroIncompat}
              missasPadrao={missasPadrao}
              membroMissaRestricoes={membroMissaRestricoes}
              paroquiaConfig={paroquiaConfig}
              preferenciaisSolene={preferenciaisSolene}
              initialEditMode={detailEditMode}
              comunidades={comunidades}
              tiposMissa={tiposMissa}
              isSaving={saveMutation.isPending}
              onSave={(form, onDone) => saveMutation.mutate({ form, editId: detailEscala.id }, { onSuccess: onDone })}
              onDelete={(e) => setDeleteTarget(e)}
              onAddFuncao={(mid, qty) => addFuncaoMutation.mutate({ ministerio_id: mid, quantidade: qty })}
              onRemoveFuncao={(id) => removeFuncaoMutation.mutate(id)}
              paroquiaNome={paroquiaNome}
              onAtribuir={(mid, minid) => {
                if (detailEscala.status === "rascunho") {
                  atribuirMutation.mutate({ membro_id: mid, ministerio_id: minid });
                } else {
                  setPendingAdds((prev) => [...prev, { membro_id: mid, ministerio_id: minid }]);
                }
              }}
              onRemoverAtribuicao={(id) => {
                if (detailEscala.status === "rascunho") {
                  removerAtribuicaoMutation.mutate(id);
                } else {
                  setPendingRemoves((prev) => [...prev, id]);
                }
              }}
              hasPendingMemberChanges={hasPendingMemberChanges}
              onApplyPendingMemberChanges={applyPendingMemberChanges}
              onRemoverPublicada={(args) => removerPublicadaMutation.mutate(args)}
              onStatusChange={(status) => updateStatusMutation.mutate({ id: detailEscala.id, status })}
              onNotificarVaga={async ({ escalaId, ministerioId, ministerioNome }) => {
                const paroquiaId = profile?.paroquia_id;
                if (!paroquiaId) return;
                // Busca dados da escala para o e-mail
                const escalaRef = escalas.find((e) => e.id === escalaId) ?? detailEscala;
                // Busca membros elegíveis: no ministério e não já na escala nesta função
                const { data: memMinData } = await supabase
                  .from("membro_ministerios")
                  .select("membro_id")
                  .eq("ministerio_id", ministerioId);
                const elegiveisIds = (memMinData ?? []).map((m: { membro_id: string }) => m.membro_id);
                if (elegiveisIds.length === 0) return;
                const { data: jaAtribData } = await supabase
                  .from("escala_membros")
                  .select("membro_id")
                  .eq("escala_id", escalaId)
                  .eq("ministerio_id", ministerioId);
                const jaAtrib = new Set((jaAtribData ?? []).map((a: { membro_id: string }) => a.membro_id));
                const destinatariosIds = elegiveisIds.filter((id: string) => !jaAtrib.has(id));
                if (destinatariosIds.length === 0) return;
                // Busca dados dos membros (nome + e-mail)
                const { data: membrosData } = await supabase
                  .from("membros")
                  .select("id, nome, email")
                  .in("id", destinatariosIds)
                  .eq("ativo", true);
                const membrosList = membrosData ?? [];
                // Notificações in-app
                const notifs = membrosList.map((m: { id: string; nome: string; email: string | null }) => ({
                  paroquia_id: paroquiaId,
                  membro_id: m.id,
                  titulo: `Vaga disponível: ${ministerioNome}`,
                  mensagem: `Uma vaga em ${ministerioNome} ficou disponível na escala "${escalaRef?.titulo ?? ""}". Se você puder servir, entre em contato com a coordenação.`,
                  tipo: "info" as const,
                  lida: false,
                  apenas_admin: false,
                  link_referencia: "/escalas",
                }));
                await (supabase as any).from("notificacoes").insert(notifs);
                // E-mails individuais
                for (const m of membrosList as { id: string; nome: string; email: string | null }[]) {
                  if (!m.email) continue;
                  await supabase.functions.invoke("send-email", {
                    body: {
                      template: "vaga_disponivel",
                      to: m.email,
                      nome: m.nome,
                      paroquia: paroquiaNome ?? "",
                      ministerioNome,
                      escalaTitulo: escalaRef?.titulo ?? "",
                      escalaData: escalaRef?.data ?? "",
                      escalaHora: escalaRef?.hora_inicio?.slice(0, 5) ?? "",
                    },
                  });
                }
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* ── Confirm bulk delete escalas ─────────────────────────────────────── */}
      <AlertDialog open={bulkDeleteEscalasOpen} onOpenChange={(o) => !o && setBulkDeleteEscalasOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {selectedEscalaIds.size} escala(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente. Todas as atribuições de membros nestas escalas também serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteEscalasMutation.mutate([...selectedEscalaIds])}
            >
              {bulkDeleteEscalasMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover {selectedEscalaIds.size} escala(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm delete ──────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover escala?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.titulo}</strong> e todas as atribuições de membros serão
              removidas permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Formulário de escala ─────────────────────────────────────────────────────

function EscalaFormContent({
  form, setForm, saving, onSave, onClose, comunidades, tiposMissa,
}: {
  form: EscalaForm;
  setForm: (f: EscalaForm) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  comunidades: { id: string; nome: string }[];
  tiposMissa: { id: string; nome: string; cor: string; icone: string | null }[];
}) {
  // Local: detect if it's a comunidade name or free text
  const comunidadeNomes = comunidades.map((c) => c.nome);
  const localIsOutro = form.local !== "" && !comunidadeNomes.includes(form.local);

  function handleLocalSelect(val: string) {
    if (val === "") setForm({ ...form, local: "" });
    else if (val === "_outro_") setForm({ ...form, local: " " }); // space triggers text input
    else setForm({ ...form, local: val });
  }

  const localSelectVal = form.local === ""
    ? ""
    : comunidadeNomes.includes(form.local)
      ? form.local
      : "_outro_";

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      <div className="space-y-1.5">
        <Label>Título *</Label>
        <Input
          required
          value={form.titulo}
          onChange={(e) => setForm({ ...form, titulo: e.target.value })}
          placeholder="Ex: Missa Dominical 10h"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Data *</Label>
          <Input
            type="date"
            required
            value={form.data}
            onChange={(e) => setForm({ ...form, data: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Hora início</Label>
          <Input type="time" value={form.hora_inicio} onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })} />
        </div>
      </div>

      {/* Tipo de Missa — obrigatório */}
      <div className="space-y-1.5">
        <Label>Tipo de celebração *</Label>
        <select
          required
          value={form.tipo_missa_id}
          onChange={(e) => {
            const val = e.target.value;
            setForm({ ...form, tipo_missa_id: val, tipo: "tipo_missa" });
          }}
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
        >
          <option value="">Selecione o tipo de celebração…</option>
          {tiposMissa.map((t) => (
            <option key={t.id} value={t.id}>{t.icone ? `${t.icone} ` : ""}{t.nome}</option>
          ))}
        </select>
        {tiposMissa.length === 0 && (
          <p className="text-xs text-red-600 font-medium">Nenhum Tipo de Missa cadastrado. Configure em Geral → Tipos de Missa.</p>
        )}
      </div>

      {/* Local — dinâmico (comunidades + outro) */}
      <div className="space-y-1.5">
        <Label>Local</Label>
        {comunidades.length > 0 ? (
          <>
            <select
              value={localSelectVal}
              onChange={(e) => handleLocalSelect(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
            >
              <option value="">Sem local definido</option>
              {comunidades.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              <option value="_outro_">Outro local…</option>
            </select>
            {localIsOutro && (
              <Input
                value={form.local.trim()}
                onChange={(e) => setForm({ ...form, local: e.target.value })}
                placeholder="Ex: Nave principal, Salão paroquial…"
              />
            )}
          </>
        ) : (
          <Input value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Nave principal, Salão paroquial…" />
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rascunho">Rascunho</SelectItem>
            <SelectItem value="publicada">Publicada</SelectItem>
            <SelectItem value="arquivada">Arquivada</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Observações</Label>
        <Textarea
          value={form.observacoes}
          onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
          placeholder="Informações adicionais..."
          rows={2}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={saving || !form.titulo.trim() || !form.data || !form.tipo_missa_id} onClick={onSave}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Vista lista ──────────────────────────────────────────────────────────────

const STATUS_BORDER: Record<string, string> = {
  rascunho:  "#94a3b8",
  publicada: "#22c55e",
  arquivada: "#cbd5e1",
};

// ── Agrupa funções por categoria/atuação ────────────────────────────────────

function groupFuncoesByCategoria(funcoes: FuncaoPreview[]) {
  const groups: { categoria: string | null; funcoes: FuncaoPreview[] }[] = [];
  funcoes.forEach((f) => {
    const cat = f.categoria ?? null;
    const g = groups.find((x) => x.categoria === cat);
    if (g) g.funcoes.push(f);
    else groups.push({ categoria: cat, funcoes: [f] });
  });
  return groups.sort((a, b) => {
    if (a.categoria === null) return 1;
    if (b.categoria === null) return -1;
    return a.categoria.localeCompare(b.categoria, "pt-BR");
  });
}

// ── IndisponibilidadesTab ─────────────────────────────────────────────────────

function IndisponibilidadesTab({
  indisponibilidades,
  membros,
  onRefresh,
}: {
  indisponibilidades: IndispRow[];
  membros: { id: string; nome: string }[];
  onRefresh: () => void;
}) {
  const [filtro, setFiltro] = useState<"ativas" | "todas">("ativas");
  const [cancelTarget, setCancelTarget] = useState<IndispRow | null>(null);
  const [canceling, setCanceling] = useState(false);
  // dia selecionado na grade "esta semana" (string yyyy-MM-dd)
  const [weekDaySelected, setWeekDaySelected] = useState<string | null>(null);
  // membro selecionado pelo pill de nome
  const [membroSelected, setMembroSelected] = useState<string | null>(null);

  const hoje = format(new Date(), "yyyy-MM-dd");
  const todayDate = new Date();

  // ── dayMap: expande intervalos para lookup por dia ─────────────────────────
  const dayMap = useMemo(() => {
    const map = new Map<string, IndispRow[]>();
    for (const row of indisponibilidades) {
      if (row.cancelada) continue;
      const start = new Date(row.data + "T00:00:00");
      const end = row.tipo === "intervalo" && row.data_fim
        ? new Date(row.data_fim + "T00:00:00") : start;
      let cur = start;
      while (cur <= end) {
        const k = format(cur, "yyyy-MM-dd");
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(row);
        cur = addDays(cur, 1);
      }
    }
    return map;
  }, [indisponibilidades]);

  // ── Semana atual: Dom–Sáb ──────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const dow = todayDate.getDay();
    const sunday = addDays(todayDate, -dow);
    return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
  }, []);

  // ── Insights sobre padrões ─────────────────────────────────────────────────
  const insights = useMemo(() => {
    const ativas = indisponibilidades.filter((i) => !i.cancelada && i.data >= hoje);

    // Dia da semana com mais ocorrências
    const byDow: number[] = [0, 0, 0, 0, 0, 0, 0];
    for (const row of ativas) {
      const d = new Date(row.data + "T00:00:00").getDay();
      byDow[d]++;
      if (row.tipo === "intervalo" && row.data_fim) {
        let cur = addDays(new Date(row.data + "T00:00:00"), 1);
        const end = new Date(row.data_fim + "T00:00:00");
        while (cur <= end) { byDow[cur.getDay()]++; cur = addDays(cur, 1); }
      }
    }
    const dowNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const maxDow = Math.max(...byDow);
    const peakDow = maxDow > 0 ? dowNames[byDow.indexOf(maxDow)] : null;
    const peakDowCount = maxDow;

    // Membros com mais indisponibilidades ativas
    const byMembro: Record<string, number> = {};
    for (const row of ativas) byMembro[row.membro_id] = (byMembro[row.membro_id] ?? 0) + 1;
    const topMembros = Object.entries(byMembro)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({ nome: membros.find((m) => m.id === id)?.nome ?? "—", count }));

    // Motivos mais comuns
    const byMotivo: Record<string, number> = {};
    for (const row of ativas) {
      if (row.motivo) byMotivo[row.motivo] = (byMotivo[row.motivo] ?? 0) + 1;
    }
    const topMotivos = Object.entries(byMotivo)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([motivo, count]) => ({ motivo, count }));

    // Dia com mais simultâneos (próximos 60 dias)
    let peakDay: string | null = null; let peakDayCount = 0;
    for (let i = 0; i < 60; i++) {
      const d = format(addDays(todayDate, i), "yyyy-MM-dd");
      const c = dayMap.get(d)?.length ?? 0;
      if (c > peakDayCount) { peakDayCount = c; peakDay = d; }
    }

    // % membros que têm ao menos 1 indisp ativa
    const membroUids = new Set(ativas.map((r) => r.membro_id));
    const pct = membros.length > 0 ? Math.round((membroUids.size / membros.length) * 100) : 0;

    return { peakDow, peakDowCount, topMembros, topMotivos, peakDay, peakDayCount, membrosAfetados: membroUids.size, pctAfetados: pct };
  }, [indisponibilidades, membros, dayMap, hoje]);

  function nomeMembro(id: string) {
    return membros.find((m) => m.id === id)?.nome ?? "—";
  }

  function labelData(row: IndispRow) {
    if (row.tipo === "intervalo" && row.data_fim) {
      return `${format(new Date(row.data + "T00:00:00"), "dd/MM/yyyy")} → ${format(new Date(row.data_fim + "T00:00:00"), "dd/MM/yyyy")}`;
    }
    return format(new Date(row.data + "T00:00:00"), "EEEE, dd/MM/yyyy", { locale: ptBR });
  }

  function labelHorario(row: IndispRow) {
    if (row.tipo === "periodo" && row.hora_inicio) {
      return `${row.hora_inicio.slice(0, 5)}${row.hora_fim ? ` – ${row.hora_fim.slice(0, 5)}` : ""}`;
    }
    return "Dia inteiro";
  }

  async function handleCancelar() {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      const { error } = await (supabase as any)
        .from("indisponibilidades")
        .update({ cancelada: true })
        .eq("id", cancelTarget.id);
      if (error) throw error;
      toast.success("Indisponibilidade cancelada.");
      onRefresh();
    } catch {
      toast.error("Erro ao cancelar indisponibilidade.");
    } finally {
      setCanceling(false);
      setCancelTarget(null);
    }
  }

  const ativas = indisponibilidades.filter((i) => !i.cancelada && i.data >= hoje).length;
  const passadas = indisponibilidades.filter((i) => !i.cancelada && i.data < hoje).length;
  const canceladas = indisponibilidades.filter((i) => i.cancelada).length;

  const lista = useMemo(() => {
    const base = filtro === "ativas"
      ? indisponibilidades.filter((i) => !i.cancelada && i.data >= hoje)
      : indisponibilidades;
    return [...base].sort((a, b) => a.data.localeCompare(b.data));
  }, [indisponibilidades, filtro, hoje]);

  const DOWLABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="mt-6 space-y-5 pb-6">

      {/* ── Semana atual ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Esta semana</p>
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const count = dayMap.get(key)?.length ?? 0;
            const isToday = key === hoje;
            const isPast = key < hoje;
            const dow = day.getDay();
            const isSunday = dow === 0;
            const isSelected = weekDaySelected === key;
            return (
              <button
                key={key}
                type="button"
                disabled={isPast}
                onClick={() => {
                  setMembroSelected(null);
                  setWeekDaySelected(isSelected ? null : key);
                }}
                className={`flex flex-col items-center gap-1 rounded-xl py-2.5 px-1 border transition-all w-full
                  ${isPast ? "border-transparent bg-muted/30 opacity-40 cursor-default" : "cursor-pointer hover:border-primary/30"}
                  ${isSelected ? "border-primary bg-primary/10 ring-2 ring-primary/30" : ""}
                  ${!isSelected && isToday ? "border-primary/40 bg-primary/5" : ""}
                  ${!isSelected && !isPast && !isToday && count > 0 ? "border-amber-400/50 bg-amber-400/5" : ""}
                  ${!isSelected && !isPast && !isToday && count === 0 ? "border-border bg-muted/20" : ""}
                  ${isSunday && !isPast && !isSelected ? "border-red-300/40" : ""}
                `}
              >
                <span className={`text-[9px] font-bold uppercase tracking-wider ${isSelected ? "text-primary" : isToday ? "text-primary" : isSunday ? "text-red-500/70" : "text-muted-foreground/60"}`}>
                  {DOWLABELS[dow]}
                </span>
                <span className={`text-sm font-bold leading-none ${isSelected || isToday ? "text-primary" : "text-foreground"}`}>
                  {day.getDate()}
                </span>
                {count > 0 ? (
                  <span className={`text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded-full
                    ${count >= 4 ? "bg-red-500 text-white" : count >= 2 ? "bg-amber-500 text-white" : "bg-amber-400/30 text-amber-700"}`}>
                    {count}
                  </span>
                ) : (
                  <span className="h-4" />
                )}
              </button>
            );
          })}
        </div>

        {/* Painel: dia selecionado → membros daquele dia */}
        {weekDaySelected && (() => {
          const rows = dayMap.get(weekDaySelected) ?? [];
          const dayDate = new Date(weekDaySelected + "T00:00:00");
          return (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-primary capitalize">
                  {format(dayDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
                </p>
                <button type="button" onClick={() => setWeekDaySelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum membro indisponível neste dia.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.id} className="flex items-start gap-2.5 rounded-lg bg-card border border-border/60 px-3 py-2">
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${row.tipo === "intervalo" ? "bg-violet-500" : "bg-amber-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">{nomeMembro(row.membro_id)}</p>
                        <p className="text-[11px] text-muted-foreground">{labelHorario(row)}{row.motivo ? ` · "${row.motivo}"` : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Pills de nomes — toda a semana (sem dia selecionado) */}
        {!weekDaySelected && (() => {
          const semanaKeys = weekDays.map((d) => format(d, "yyyy-MM-dd")).filter((k) => k >= hoje);
          const idSet = new Set<string>();
          semanaKeys.forEach((k) => dayMap.get(k)?.forEach((r) => idSet.add(r.membro_id)));
          if (idSet.size === 0) return <p className="text-xs text-muted-foreground text-center py-1">Nenhum membro indisponível esta semana.</p>;
          return (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Indisponíveis esta semana — toque para ver os dias</p>
              <div className="flex flex-wrap gap-1.5">
                {[...idSet].map((id) => {
                  const isActive = membroSelected === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMembroSelected(isActive ? null : id)}
                      className={`text-[11px] rounded-full px-2.5 py-0.5 font-medium border transition-all
                        ${isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-amber-500/10 border-amber-400/30 text-amber-800 dark:text-amber-300 hover:border-amber-500"}`}
                    >
                      {nomeMembro(id).split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Painel: membro selecionado → todos os dias futuros dele */}
        {membroSelected && (() => {
          const futuras = indisponibilidades
            .filter((r) => r.membro_id === membroSelected && !r.cancelada && r.data >= hoje)
            .sort((a, b) => a.data.localeCompare(b.data));
          return (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-primary">
                  Indisponibilidades futuras — {nomeMembro(membroSelected).split(" ")[0]}
                </p>
                <button type="button" onClick={() => setMembroSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {futuras.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem indisponibilidades futuras registradas.</p>
              ) : (
                <div className="space-y-1.5">
                  {futuras.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 rounded-lg bg-card border border-border/60 px-3 py-2">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${row.tipo === "intervalo" ? "bg-violet-500" : "bg-amber-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{labelData(row)}</p>
                        <p className="text-[11px] text-muted-foreground">{labelHorario(row)}{row.motivo ? ` · "${row.motivo}"` : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Insights ──────────────────────────────────────────────────────── */}
      {ativas > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Insights</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">Análise</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* % membros afetados */}
            <div className="rounded-xl bg-muted/40 border border-border p-3 space-y-0.5">
              <p className="text-2xl font-bold text-foreground leading-none">{insights.pctAfetados}%</p>
              <p className="text-[11px] text-muted-foreground">dos membros têm indisp. ativa</p>
              <p className="text-[10px] text-muted-foreground/60">{insights.membrosAfetados} de {membros.length}</p>
            </div>

            {/* Dia da semana mais afetado */}
            {insights.peakDow && (
              <div className="rounded-xl bg-amber-500/8 border border-amber-400/30 p-3 space-y-0.5">
                <p className="text-2xl font-bold text-amber-600 leading-none">{insights.peakDow}</p>
                <p className="text-[11px] text-muted-foreground">dia mais crítico</p>
                <p className="text-[10px] text-amber-600/70">{insights.peakDowCount} ocorrência{insights.peakDowCount !== 1 ? "s" : ""}</p>
              </div>
            )}

            {/* Pico de simultâneos */}
            {insights.peakDay && insights.peakDayCount > 1 && (
              <div className="rounded-xl bg-red-500/8 border border-red-400/30 p-3 space-y-0.5 col-span-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Maior concentração nos próximos 60 dias</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {format(new Date(insights.peakDay + "T00:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}
                    </p>
                  </div>
                  <span className="text-2xl font-bold text-red-500 leading-none shrink-0">{insights.peakDayCount}</span>
                </div>
              </div>
            )}
          </div>

          {/* Membros que mais registram */}
          {insights.topMembros.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/40">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Membros com mais ausências registradas</p>
              {insights.topMembros.map(({ nome, count }) => (
                <div key={nome} className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60 rounded-full"
                      style={{ width: `${(count / (insights.topMembros[0]?.count || 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium w-28 truncate text-right">{nome.split(" ")[0]}</span>
                  <span className="text-[11px] text-muted-foreground w-4 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Motivos recorrentes */}
          {insights.topMotivos.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/40">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Motivos mais comuns</p>
              <div className="flex flex-wrap gap-1.5">
                {insights.topMotivos.map(({ motivo, count }) => (
                  <span key={motivo} className="text-[11px] bg-muted border border-border rounded-full px-2.5 py-0.5 font-medium">
                    {motivo} · <span className="text-primary font-bold">{count}×</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Totais + filtro ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFiltro("ativas")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${filtro === "ativas" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}
          >
            Ativas ({ativas})
          </button>
          <button
            type="button"
            onClick={() => setFiltro("todas")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${filtro === "todas" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}
          >
            Todas ({ativas + passadas + canceladas})
          </button>
        </div>
      </div>

      {/* ── Cards agrupados por data ──────────────────────────────────────── */}
      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Ban className="h-6 w-6 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma indisponibilidade encontrada.</p>
        </div>
      ) : (() => {
        // Agrupar por data de início
        const groups = new Map<string, IndispRow[]>();
        for (const row of lista) {
          if (!groups.has(row.data)) groups.set(row.data, []);
          groups.get(row.data)!.push(row);
        }
        return (
          <div className="space-y-5">
            {[...groups.entries()].map(([date, rows]) => {
              const dateObj = new Date(date + "T00:00:00");
              const isPastGroup = date < hoje;
              const isThisWeek = weekDays.some((d) => format(d, "yyyy-MM-dd") === date);
              return (
                <div key={date} className="space-y-2">
                  {/* Cabeçalho do grupo */}
                  <div className="flex items-center gap-3">
                    <div className={`h-px flex-1 ${isPastGroup ? "bg-border/40" : "bg-border"}`} />
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold
                      ${isPastGroup ? "border-border/40 text-muted-foreground/50 bg-muted/20" :
                        isThisWeek ? "border-primary/30 text-primary bg-primary/8" :
                        "border-border text-foreground/70 bg-card"}`}>
                      <span className="capitalize">{format(dateObj, "EEEE", { locale: ptBR })}</span>
                      <span className="text-muted-foreground font-normal">·</span>
                      <span>{format(dateObj, "d 'de' MMM", { locale: ptBR })}</span>
                      {isThisWeek && <span className="text-[9px] text-primary font-bold uppercase tracking-wider ml-0.5">esta semana</span>}
                      <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold
                        ${isPastGroup ? "bg-muted text-muted-foreground" : rows.length >= 3 ? "bg-red-500 text-white" : "bg-amber-500/20 text-amber-700"}`}>
                        {rows.length}
                      </span>
                    </div>
                    <div className={`h-px flex-1 ${isPastGroup ? "bg-border/40" : "bg-border"}`} />
                  </div>

                  {/* Cards do grupo */}
                  <div className="space-y-2">
                    {rows.map((row) => {
                      const isPast = row.data < hoje;
                      const isInterval = row.tipo === "intervalo" && !!row.data_fim;
                      return (
                        <div
                          key={row.id}
                          className={`rounded-2xl border bg-card overflow-hidden ${row.cancelada || isPast ? "opacity-50" : ""}`}
                        >
                          <div className={`h-1 w-full ${row.cancelada ? "bg-muted" : isPast ? "bg-muted" : isInterval ? "bg-violet-500" : "bg-amber-500"}`} />
                          <div className="px-4 py-3 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold">{nomeMembro(row.membro_id)}</p>
                                {row.cancelada && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">Cancelada</span>}
                                {isInterval && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-400/30 text-violet-700 dark:text-violet-300 font-medium">Intervalo</span>}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] bg-muted/60 border border-border/60 rounded-md px-2 py-0.5 font-medium">{labelHorario(row)}</span>
                                {row.motivo && <span className="text-[11px] text-muted-foreground italic truncate max-w-[200px]">"{row.motivo}"</span>}
                              </div>
                              {isInterval && row.data_fim && (
                                <p className="text-[11px] text-muted-foreground">
                                  até {format(new Date(row.data_fim + "T00:00:00"), "d 'de' MMM", { locale: ptBR })}
                                </p>
                              )}
                            </div>
                            {!row.cancelada && row.data >= hoje && (
                              <button
                                type="button"
                                onClick={() => setCancelTarget(row)}
                                className="shrink-0 mt-0.5 text-muted-foreground hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Confirmar cancelamento ─────────────────────────────────────────── */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar indisponibilidade?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget && (
                <><strong>{nomeMembro(cancelTarget.membro_id)}</strong> — {labelData(cancelTarget)}. O membro poderá voltar a ser escalado nessa data.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelar} disabled={canceling}>
              {canceling && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Cancelar indisponibilidade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── SwapMembroModal ───────────────────────────────────────────────────────────

function SwapMembroModal({
  membroId, membroNome, escalas, escalaCounts, radarData, membros,
  indisponibilidades, membroMinisterios, funcaoRestricoes,
  paroquiaConfig, assignmentHistory,
  onSwap, onClose,
}: {
  membroId: string;
  membroNome: string;
  escalas: Escala[];
  escalaCounts: Record<string, EscalaPreview>;
  radarData: { id: string; nome: string; status: string; vezes7dias: number }[];
  membros: Membro[];
  indisponibilidades: IndispRow[];
  membroMinisterios: Record<string, string[]>;
  funcaoRestricoes: FuncaoRestricao[];
  paroquiaConfig: { regras_escala: any; usa_tochas: boolean } | null | undefined;
  assignmentHistory: AssignmentHistoryEntry[];
  onSwap: (args: { removeId: string; escalaId: string; membroId: string; ministerioId: string }) => void;
  onClose: () => void;
}) {
  const [selectedEscala, setSelectedEscala] = useState<string>("");
  const [selectedAtrib, setSelectedAtrib] = useState<string>("");

  // Membro a incluir — verificar suas funções vinculadas
  const funcoesDoMembro = Object.entries(membroMinisterios)
    .filter(([, ids]) => ids.includes(membroId))
    .map(([minId]) => minId);

  // Helper: verifica se o membro está indisponível para uma data
  function membroIndisponivel(data: string): string | null {
    const membro = membros.find((m) => m.id === membroId);
    if (!membro) return null;
    const diaSemana = new Date(data + "T12:00:00").getDay();
    if (membro.restricoes_dia_semana?.includes(diaSemana)) {
      const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
      return `Restrito às ${dias[diaSemana]}`;
    }
    const indisp = indisponibilidades.find((i) => {
      if (i.membro_id !== membroId) return false;
      if (i.cancelada) return false;
      if (i.tipo === "intervalo" && i.data_fim) return data >= i.data && data <= i.data_fim;
      return i.data === data;
    });
    if (indisp) return indisp.motivo ? `Indisponível: ${indisp.motivo}` : "Indisponível nesta data";
    return null;
  }

  // Pré-computa regras do motor para o membro
  const regrasSwap = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
  const swapLimiteSem   = regrasSwap.limite_semanal        as number | undefined;
  const swapLimiteMen   = regrasSwap.limite_mensal         as number | undefined;
  const swapImpedirRep  = (regrasSwap.impedir_repeticao_consecutiva as boolean) ?? false;
  const swapIntervaloMin = regrasSwap.intervalo_minimo_dias as number | undefined;
  const membroHistAll   = assignmentHistory.filter((h) => h.memberId === membroId);

  // Escalas futuras onde este membro ainda não está e é elegível (todas as regras do motor)
  const hojeStr = new Date().toISOString().slice(0, 10);
  const escalasDisponiveis = escalas.filter((e) => {
    if (e.data < hojeStr) return false;
    const counts = escalaCounts[e.id];
    if (!counts) return false;
    const jaEsta = counts.funcoes.some((f) => f.membros.some((m) => m.id === membroId));
    if (jaEsta) return false;
    const temFuncaoCompativel = counts.funcoes.some((f) =>
      funcoesDoMembro.includes(f.ministerio_id) &&
      !funcaoRestricoes.some((r) => r.membro_id === membroId && r.ministerio_id === f.ministerio_id && r.tipo === "nao_pode")
    );
    if (!temFuncaoCompativel) return false;

    // Restrição de dia da semana
    const membro = membros.find((m) => m.id === membroId);
    if (membro?.restricoes_dia_semana?.includes(new Date(e.data + "T12:00:00").getDay())) return false;

    // Indisponibilidade
    const indispAtiva = indisponibilidades.some((i) => {
      if (i.membro_id !== membroId || i.cancelada) return false;
      if (i.tipo === "intervalo" && i.data_fim) return e.data >= i.data && e.data <= i.data_fim;
      return i.data === e.data;
    });
    if (indispAtiva) return false;

    // Anti-repetição consecutiva
    if (swapImpedirRep) {
      const ontemE = format(addDays(new Date(e.data + "T00:00:00"), -1), "yyyy-MM-dd");
      if (membroHistAll.some((h) => h.date === ontemE)) return false;
    }

    // Intervalo mínimo
    if (swapIntervaloMin && swapIntervaloMin > 0) {
      const limite = format(addDays(new Date(e.data + "T00:00:00"), -swapIntervaloMin), "yyyy-MM-dd");
      if (membroHistAll.some((h) => (h.date ?? "") > limite && (h.date ?? "") < e.data)) return false;
    }

    // Limite semanal
    if (swapLimiteSem) {
      const sem7 = format(addDays(new Date(e.data + "T00:00:00"), -6), "yyyy-MM-dd");
      const cnt = membroHistAll.filter((h) => (h.date ?? "") >= sem7 && (h.date ?? "") <= e.data).length;
      if (cnt >= swapLimiteSem) return false;
    }

    // Limite mensal
    if (swapLimiteMen) {
      const mesInicio = e.data.slice(0, 7) + "-01";
      const cnt = membroHistAll.filter((h) => (h.date ?? "") >= mesInicio && (h.date ?? "") <= e.data).length;
      if (cnt >= swapLimiteMen) return false;
    }

    return true;
  });

  const escalaObj = escalasDisponiveis.find((e) => e.id === selectedEscala);
  const counts = escalaObj ? escalaCounts[escalaObj.id] : null;

  // Disponibilidade do membro para a escala selecionada
  const motivoIndisponivel = escalaObj ? membroIndisponivel(escalaObj.data) : null;

  // Membros já na escala, filtrados a funções que o membro entrante pode exercer, ordenados por frequência
  type AtribEntry = { atribId: string; membroId: string; nome: string; vezes7dias: number; ministerioId: string; ministerioNome: string };
  const membrosNaEscala: AtribEntry[] = useMemo(() => {
    if (!counts) return [];
    const entries: AtribEntry[] = [];
    counts.funcoes.forEach((f) => {
      // Só mostrar funções que o membro entrante pode exercer
      if (!funcoesDoMembro.includes(f.ministerio_id)) return;
      // Excluir funções em que o membro tem restrição "nao_pode"
      const naoPode = funcaoRestricoes.some((r) => r.membro_id === membroId && r.ministerio_id === f.ministerio_id && r.tipo === "nao_pode");
      if (naoPode) return;
      f.membros.forEach((m) => {
        if (m.id === membroId) return;
        const r = radarData.find((rd) => rd.id === m.id);
        entries.push({ atribId: "", membroId: m.id, nome: m.nome, vezes7dias: r?.vezes7dias ?? 0, ministerioId: f.ministerio_id, ministerioNome: f.nome });
      });
    });
    return entries.sort((a, b) => b.vezes7dias - a.vezes7dias);
  }, [counts, membroId, radarData, funcoesDoMembro, funcaoRestricoes]);

  // Find atribuicao ID for selected member
  // We don't have the real DB IDs here, so we'll pass the membro_id + escala context to the parent
  // The parent mutation will find and delete by (escala_id, membro_id)

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir {nomeExibicao(membroNome)} em uma escala</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Escolha a escala</p>
            {escalasDisponiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma escala futura disponível para este membro.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {escalasDisponiveis.map((e) => {
                  const d = new Date(e.data + "T00:00:00");
                  const c = escalaCounts[e.id];
                  const pct = c && c.needed > 0 ? c.filled / c.needed : 1;
                  return (
                    <button key={e.id} type="button"
                      className={`w-full text-left rounded-2xl border px-3 py-2.5 transition-all ${selectedEscala === e.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                      onClick={() => { setSelectedEscala(e.id); setSelectedAtrib(""); }}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{e.titulo}</p>
                          <p className="text-xs text-muted-foreground">{format(d, "EEE d 'de' MMM", { locale: ptBR })}</p>
                        </div>
                        {pct < 1 && <span className="text-[10px] rounded-full bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 font-semibold">{c?.filled}/{c?.needed}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedEscala && motivoIndisponivel && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Atenção: possível indisponibilidade</p>
                <p className="text-xs text-amber-600 dark:text-amber-500">{motivoIndisponivel}</p>
              </div>
            </div>
          )}

          {selectedEscala && membrosNaEscala.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Substituir quem? <span className="normal-case font-normal">(mais frequentes primeiro — apenas funções compatíveis)</span>
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {membrosNaEscala.map((m, i) => (
                  <button key={`${m.membroId}-${m.ministerioId}`} type="button"
                    className={`w-full text-left rounded-2xl border px-3 py-2.5 transition-all ${selectedAtrib === `${m.membroId}:${m.ministerioId}` ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                    onClick={() => setSelectedAtrib(`${m.membroId}:${m.ministerioId}`)}>
                    <div className="flex items-center gap-3">
                      {m.vezes7dias >= 2 && <div className="h-2 w-2 rounded-full bg-red-500 shrink-0" />}
                      {m.vezes7dias === 1 && <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />}
                      {m.vezes7dias === 0 && <div className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{nomeExibicao(m.nome)}</p>
                        <p className="text-xs text-muted-foreground">{m.ministerioNome} · {m.vezes7dias}× esta semana</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedEscala && membrosNaEscala.length === 0 && (
            <p className="text-sm text-muted-foreground">Esta escala não tem membros ainda. Você pode adicioná-lo diretamente.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!selectedEscala || (membrosNaEscala.length > 0 && !selectedAtrib)}
            onClick={async () => {
              if (!selectedEscala) return;
              const [repMembroId, repMinisterioId] = selectedAtrib.split(":");
              if (membrosNaEscala.length > 0 && (!repMembroId || !repMinisterioId)) return;

              if (selectedAtrib) {
                // Find the real atribuicao id — we need to query it
                // For now, use a workaround: delete by membro_id + escala_id + ministerio_id and insert new
                const { data: atribs } = await (supabase as any)
                  .from("escala_membros")
                  .select("id")
                  .eq("escala_id", selectedEscala)
                  .eq("membro_id", repMembroId)
                  .eq("ministerio_id", repMinisterioId)
                  .limit(1);
                const atribId = atribs?.[0]?.id;
                if (atribId) {
                  onSwap({ removeId: atribId, escalaId: selectedEscala, membroId, ministerioId: repMinisterioId });
                }
              }
              onClose();
            }}
          >
            <UserPlus className="h-4 w-4 mr-1.5" />
            {selectedAtrib ? "Substituir e incluir" : "Incluir na escala"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ListaView ─────────────────────────────────────────────────────────────────

function ListaView({
  escalas, allEscalas, selectedIds, escalaCounts, membros, assignmentHistory, paroquiaConfig,
  indisponibilidades, membroMinisterios, funcaoRestricoes,
  onToggleSelect, onSelectAll, onOpenDetail, onEdit, onDelete, onCreate, onExportPDF, onReorganizar,
  onBulkPublish, onSwapMembro, isBulkPublishing,
}: {
  escalas: Escala[];
  allEscalas: Escala[];
  selectedIds: Set<string>;
  escalaCounts: Record<string, EscalaPreview>;
  membros: Membro[];
  assignmentHistory: AssignmentHistoryEntry[];
  paroquiaConfig: { regras_escala: any; usa_tochas: boolean } | null | undefined;
  indisponibilidades: IndispRow[];
  membroMinisterios: Record<string, string[]>;
  funcaoRestricoes: FuncaoRestricao[];
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onOpenDetail: (e: Escala) => void;
  onEdit: (e: Escala, ev: React.MouseEvent) => void;
  onDelete: (e: Escala) => void;
  onCreate: () => void;
  onExportPDF: (id: string) => void;
  onReorganizar: () => void;
  onBulkPublish: (ids: string[]) => void;
  onSwapMembro: (args: { removeId: string; escalaId: string; membroId: string; ministerioId: string }) => void;
  isBulkPublishing: boolean;
}) {
  const [radarOpen, setRadarOpen] = useState(false);
  const [filtro, setFiltro] = useState<"todos" | "semana" | "2semanas" | "incompletas" | "rascunho" | "publicadas" | "arquivadas">("todos");
  const [paginaEscalas, setPaginaEscalas] = useState(20);
  const [swapTarget, setSwapTarget] = useState<{ membroId: string; nome: string } | null>(null);
  const allSelected = escalas.length > 0 && escalas.every((e) => selectedIds.has(e.id));
  const publishedCount = escalas.filter((e) => e.status === "publicada").length;
  const draftCount = escalas.filter((e) => e.status === "rascunho").length;
  const archivedCount = escalas.filter((e) => e.status === "arquivada").length;

  // ── Radar de atividade dos membros ──────────────────────────────────────────
  const radarData = useMemo(() => {
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje);
    seteDiasAtras.setDate(hoje.getDate() - 7);
    const trinteSeteDiasAtras = new Date(hoje);
    trinteSeteDiasAtras.setDate(hoje.getDate() - 37);

    return membros.map((m) => {
      const historico = assignmentHistory.filter((h) => h.memberId === m.id);
      const na7dias = historico.filter((h) => {
        const d = new Date(h.date + "T00:00:00");
        return d >= seteDiasAtras && d <= hoje;
      });
      const na37dias = historico.filter((h) => {
        const d = new Date(h.date + "T00:00:00");
        return d >= trinteSeteDiasAtras && d <= hoje;
      });

      const ultimaData: string | null = historico.length
        ? historico.reduce((acc: string, h) => ((h.date ?? "") > acc ? (h.date ?? acc) : acc), historico[0].date ?? "")
        : null;
      const diasSemServir = ultimaData
        ? Math.floor((hoje.getTime() - new Date(ultimaData + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24))
        : null;

      let status: "sobrecargado" | "ativo" | "inativo" | "ausente";
      if (na7dias.length >= 2) status = "sobrecargado";
      else if (na7dias.length >= 1) status = "ativo";
      else if (diasSemServir !== null && diasSemServir <= 30) status = "inativo";
      else status = "ausente";

      return {
        id: m.id,
        nome: m.nome,
        status,
        vezes7dias: na7dias.length,
        vezes37dias: na37dias.length,
        diasSemServir,
      };
    }).sort((a, b) => {
      const order = { sobrecargado: 0, inativo: 1, ausente: 2, ativo: 3 };
      return order[a.status] - order[b.status];
    });
  }, [membros, assignmentHistory]);

  const sobrecargados = radarData.filter((m) => m.status === "sobrecargado");
  const inativos = radarData.filter((m) => m.status === "inativo");
  const ausentes = radarData.filter((m) => m.status === "ausente");
  const ativos = radarData.filter((m) => m.status === "ativo");

  // Limits from config
  const regrasConfig = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
  const limiteSemanal = (regrasConfig.limite_semanal as number | null) ?? null;
  const limiteMensal = (regrasConfig.limite_mensal as number | null) ?? null;
  const membrosNoLimite = useMemo(() => {
    if (!limiteSemanal && !limiteMensal) return new Set<string>();
    const hoje2 = new Date();
    const semanaInicio = new Date(hoje2); semanaInicio.setDate(hoje2.getDate() - 6);
    const mesInicio = hoje2.toISOString().slice(0, 7) + "-01";
    const set = new Set<string>();
    membros.forEach((m) => {
      const hist = assignmentHistory.filter((h) => h.memberId === m.id);
      if (limiteSemanal) {
        const cnt = hist.filter((h) => (h.date ?? "") >= semanaInicio.toISOString().slice(0, 10)).length;
        if (cnt >= limiteSemanal) set.add(m.id);
      }
      if (limiteMensal && !set.has(m.id)) {
        const cnt = hist.filter((h) => (h.date ?? "") >= mesInicio).length;
        if (cnt >= limiteMensal) set.add(m.id);
      }
    });
    return set;
  }, [membros, assignmentHistory, limiteSemanal, limiteMensal]);

  // Filter escalas by quick filter
  const escalasVisiveis = useMemo(() => {
    setPaginaEscalas(20); // reset ao mudar filtro
    const hojeStr = new Date().toISOString().slice(0, 10);
    const em7 = new Date(); em7.setDate(em7.getDate() + 7);
    const em14 = new Date(); em14.setDate(em14.getDate() + 14);
    const em7Str = em7.toISOString().slice(0, 10);
    const em14Str = em14.toISOString().slice(0, 10);
    return escalas.filter((e) => {
      if (filtro === "semana") return e.data >= hojeStr && e.data <= em7Str;
      if (filtro === "2semanas") return e.data >= hojeStr && e.data <= em14Str;
      if (filtro === "incompletas") { const c = escalaCounts[e.id]; return c ? c.filled < c.needed : false; }
      if (filtro === "rascunho")    return e.status === "rascunho";
      if (filtro === "publicadas")  return e.status === "publicada";
      if (filtro === "arquivadas")  return e.status === "arquivada";
      return true;
    });
  }, [escalas, filtro, escalaCounts]);

  const escalasPagina = useMemo(() => escalasVisiveis.slice(0, paginaEscalas), [escalasVisiveis, paginaEscalas]);

  const repeatedAlerts = useMemo(() => {
    type AlertEntry = {
      type: "same-day" | "consecutive";
      memberName: string;
      escalaA: string;
      escalaB: string;
      date: string;
      dateB?: string;
    };
    const alerts: AlertEntry[] = [];
    const dateMap: Record<string, { memberId: string; memberName: string; escalaId: string; titulo: string }[]> = {};

    escalas.forEach((e) => {
      const counts = escalaCounts[e.id];
      if (!counts) return;
      counts.funcoes.forEach((f) => {
        f.membros.forEach((m) => {
          if (!dateMap[e.data]) dateMap[e.data] = [];
          if (!dateMap[e.data].some((x) => x.memberId === m.id && x.escalaId === e.id))
            dateMap[e.data].push({ memberId: m.id, memberName: m.nome, escalaId: e.id, titulo: e.titulo });
        });
      });
    });

    const dates = Object.keys(dateMap).sort();

    dates.forEach((date) => {
      const entries = dateMap[date];
      const memberTitulos: Record<string, string[]> = {};
      entries.forEach((e) => {
        if (!memberTitulos[e.memberId]) memberTitulos[e.memberId] = [];
        if (!memberTitulos[e.memberId].includes(e.titulo)) memberTitulos[e.memberId].push(e.titulo);
      });
      Object.entries(memberTitulos).forEach(([memberId, titulos]) => {
        if (titulos.length > 1) {
          const memberName = entries.find((x) => x.memberId === memberId)?.memberName ?? memberId;
          alerts.push({ type: "same-day", memberName, escalaA: titulos[0], escalaB: titulos[1], date });
        }
      });
    });

    for (let i = 0; i < dates.length - 1; i++) {
      const date = dates[i];
      const dateNext = dates[i + 1];
      const d1 = new Date(date + "T00:00:00");
      const d2 = new Date(dateNext + "T00:00:00");
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays !== 1) continue;
      const members1 = dateMap[date];
      const members2 = dateMap[dateNext];
      const ids1 = new Set(members1.map((m) => m.memberId));
      const seen = new Set<string>();
      members2.forEach((m) => {
        if (ids1.has(m.memberId) && !seen.has(m.memberId)) {
          seen.add(m.memberId);
          const escalaA = members1.find((x) => x.memberId === m.memberId)?.titulo ?? date;
          alerts.push({ type: "consecutive", memberName: m.memberName, escalaA, escalaB: m.titulo, date, dateB: dateNext });
        }
      });
    }

    return alerts;
  }, [escalas, escalaCounts]);

  if (allEscalas.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
        <Calendar className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma escala cadastrada ainda.</p>
        <Button className="mt-4" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Criar primeira escala
        </Button>
      </div>
    );
  }

  if (escalas.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
        <Calendar className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="mt-4 text-sm font-medium text-foreground">Nenhuma escala futura</p>
        <p className="mt-1 text-sm text-muted-foreground">Crie uma nova escala para começar a organizar os servidores.</p>
        <Button className="mt-4" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Nova escala
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-2 rounded-3xl border border-border bg-card p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Escalas</p>
              <p className="mt-1.5 text-4xl font-serif leading-none">{escalas.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">agendadas</p>
            </div>
            <div className="flex gap-1.5 mt-1">
              {publishedCount > 0 && (
                <span className="rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                  {publishedCount} pub.
                </span>
              )}
              {draftCount > 0 && (
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  {draftCount} rasc.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-4 flex flex-col justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Ativos</p>
          <div className="mt-2">
            <p className="text-3xl font-serif leading-none">{ativos.length}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">na semana</p>
          </div>
        </div>

        <div
          className="rounded-3xl border border-border bg-card p-4 flex flex-col justify-between cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setRadarOpen((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Radar</p>
            <Activity className={`h-3.5 w-3.5 ${sobrecargados.length > 0 || ausentes.length > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
          </div>
          <div className="mt-2">
            <p className="text-3xl font-serif leading-none">
              {sobrecargados.length + inativos.length + ausentes.length}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">precisam atenção</p>
          </div>
        </div>
      </div>

      {/* ── Radar de atividade ──────────────────────────────────────────────── */}
      {radarOpen && (
        <div className="rounded-3xl border border-border bg-card overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Radar de atividade</p>
              <span className="text-xs text-muted-foreground">· últimos 7 dias</span>
            </div>
            <button onClick={() => setRadarOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {sobrecargados.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
                    Sobrecarga · {sobrecargados.length}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {sobrecargados.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 px-3 py-2.5">
                      <div className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{nomeExibicao(m.nome)}</p>
                        <p className="text-xs text-muted-foreground">{m.vezes7dias}× nesta semana</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
                        {m.vezes7dias}×
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inativos.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Minus className="h-3.5 w-3.5 text-amber-500" />
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                    Sem servir esta semana · {inativos.length}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {inativos.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 px-3 py-2.5">
                      <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{nomeExibicao(m.nome)}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.diasSemServir !== null ? `${m.diasSemServir}d sem servir` : "sem histórico recente"}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 shrink-0"
                        onClick={() => setSwapTarget({ membroId: m.id, nome: m.nome })}>
                        <UserPlus className="h-3 w-3 mr-1" /> Incluir
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ausentes.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingDown className="h-3.5 w-3.5 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Ausentes há mais de 30 dias · {ausentes.length}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ausentes.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                      <div className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{nomeExibicao(m.nome)}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.diasSemServir !== null ? `${m.diasSemServir}d sem servir` : "nunca escalado"}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
                        onClick={() => setSwapTarget({ membroId: m.id, nome: m.nome })}>
                        <UserPlus className="h-3 w-3 mr-1" /> Incluir
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ativos.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">
                    Escalados esta semana · {ativos.length}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ativos.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      {nomeExibicao(m.nome)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {radarData.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum membro cadastrado.</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border/50 bg-muted/20">
            <p className="text-xs text-muted-foreground">
              {membros.length} membro{membros.length !== 1 ? "s" : ""} · histórico de 6 meses
            </p>
            <Button size="sm" variant="outline" onClick={onReorganizar} className="h-7 text-xs gap-1.5">
              <RefreshCw className="h-3 w-3" /> Reorganizar escalas
            </Button>
          </div>
        </div>
      )}

      {/* ── Ação rápida reorganizar (quando radar fechado) ───────────────────── */}
      {!radarOpen && (
        <div className="flex items-center gap-2 px-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={() => setRadarOpen(true)}>
            <Activity className={`h-3.5 w-3.5 ${sobrecargados.length > 0 || ausentes.length > 0 ? "text-amber-500" : ""}`} />
            Ver radar de membros
          </Button>
          <span className="text-muted-foreground/30">·</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={onReorganizar}>
            <RefreshCw className="h-3.5 w-3.5" /> Reorganizar
          </Button>
        </div>
      )}

      {repeatedAlerts.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <p className="text-xs font-semibold text-foreground">
              {repeatedAlerts.length} conflito{repeatedAlerts.length !== 1 ? "s" : ""} de repetição
            </p>
            <span className="ml-auto text-[10px] text-muted-foreground">Revisar antes de publicar</span>
          </div>
          <div className="divide-y divide-border/40">
            {repeatedAlerts.slice(0, 5).map((alert, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <div className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${alert.type === "same-day" ? "bg-red-500" : "bg-amber-400"}`} />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-foreground">{nomeExibicao(alert.memberName)}</span>
                  <span className="text-sm text-muted-foreground">
                    {alert.type === "same-day"
                      ? ` · mesmo dia (${format(new Date(alert.date + "T00:00:00"), "d/MM", { locale: ptBR })})`
                      : ` · dias seguidos (${format(new Date(alert.date + "T00:00:00"), "d/MM", { locale: ptBR })} e ${format(new Date(alert.dateB! + "T00:00:00"), "d/MM", { locale: ptBR })})`}
                  </span>
                </div>
                <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  alert.type === "same-day"
                    ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                }`}>
                  {alert.type === "same-day" ? "Mesmo dia" : "Consecutivo"}
                </span>
              </div>
            ))}
            {repeatedAlerts.length > 5 && (
              <div className="px-4 py-2.5 text-xs text-muted-foreground">
                + {repeatedAlerts.length - 5} conflito{repeatedAlerts.length - 5 !== 1 ? "s" : ""} não exibido{repeatedAlerts.length - 5 !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal de troca de membro ──────────────────────────────────────── */}
      {swapTarget && (
        <SwapMembroModal
          membroId={swapTarget.membroId}
          membroNome={swapTarget.nome}
          escalas={escalas}
          escalaCounts={escalaCounts}
          radarData={radarData}
          membros={membros}
          indisponibilidades={indisponibilidades}
          membroMinisterios={membroMinisterios}
          funcaoRestricoes={funcaoRestricoes}
          paroquiaConfig={paroquiaConfig}
          assignmentHistory={assignmentHistory}
          onSwap={onSwapMembro}
          onClose={() => setSwapTarget(null)}
        />
      )}

      {/* ── Filtros rápidos ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {([
          { id: "todos",      label: "Todas",          count: escalas.length },
          { id: "semana",     label: "Esta semana",     count: null },
          { id: "2semanas",   label: "Próx. 2 semanas", count: null },
          { id: "publicadas",  label: "Publicadas",      count: publishedCount || null },
          { id: "incompletas", label: "Incompletas",     count: escalas.filter((e) => { const c = escalaCounts[e.id]; return c && c.filled < c.needed; }).length || null },
          { id: "rascunho",    label: "Rascunho",        count: draftCount || null },
          { id: "arquivadas",  label: "Histórico",        count: archivedCount || null },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => { setFiltro(f.id); setPaginaEscalas(20); }}
            className={`filter-chip shrink-0 ${filtro === f.id ? "filter-chip-active" : ""}`}
          >
            {f.label}
            {f.count !== null && <span className="filter-chip-count">{f.count}</span>}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground whitespace-nowrap pl-2">
          {escalasVisiveis.length} de {escalas.length}
        </span>
      </div>

      {/* ── Barra de ações em lote ──────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-2xl bg-primary/5 border border-primary/20 px-3 py-2.5">
          <span className="text-sm font-semibold text-primary shrink-0">{selectedIds.size} selecionada(s)</span>
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white shrink-0"
            onClick={() => onBulkPublish(Array.from(selectedIds))}
            disabled={isBulkPublishing}
          >
            {isBulkPublishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Publicar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground shrink-0" onClick={() => onSelectAll([])}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="rounded-3xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border/40">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => onSelectAll(checked ? escalasVisiveis.map((e) => e.id) : [])}
            />
            <span className="text-xs text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} selecionada(s)` : "Selecionar todas"}
            </span>
          </label>
          <span className="text-xs text-muted-foreground">{escalasPagina.length} de {escalasVisiveis.length} escala(s)</span>
        </div>

        <div className="space-y-3 p-4 animate-fade-in">
          {escalasPagina.map((e, idx) => {
            const cfg = STATUS_CONFIG[e.status] ?? STATUS_CONFIG.rascunho;
            const borderColor = STATUS_BORDER[e.status] ?? STATUS_BORDER.rascunho;
            const d = new Date(e.data + "T00:00:00");
            const isSelected = selectedIds.has(e.id);
            const counts = escalaCounts[e.id];
            const pct = counts && counts.needed > 0 ? Math.min(1, counts.filled / counts.needed) : null;

            return (
              <div
                key={e.id}
                className={`rounded-3xl border bg-background transition-all ${
                  isSelected ? "border-primary/50 shadow-sm ring-1 ring-primary/20" : "border-border"
                }`}
                style={{ borderLeftColor: borderColor, borderLeftWidth: "4px", animationDelay: `${Math.min(idx * 25, 200)}ms` }}
              >
                <div className="flex items-start gap-3 px-4 py-4">
                  <div className="text-center min-w-[2.75rem] shrink-0">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">
                      {format(d, "MMM", { locale: ptBR })}
                    </p>
                    <p className="text-2xl font-serif leading-none mt-0.5">
                      {format(d, "d")}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 capitalize">
                      {format(d, "EEE", { locale: ptBR })}
                    </p>
                  </div>

                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={(ev) => { ev.stopPropagation(); onOpenDetail(e); }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight truncate hover:text-primary transition-colors">{e.titulo}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {e.hora_inicio && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {e.hora_inicio.slice(0, 5)}{e.hora_fim ? `–${e.hora_fim.slice(0, 5)}` : ""}
                            </span>
                          )}
                          {e.local && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <MapPin className="h-3 w-3 shrink-0" />{e.local}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <StatusBadge status={e.status} />
                        {e.solene && (
                          <span className="hidden sm:inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                            Solene
                          </span>
                        )}
                      </div>
                    </div>

                    {pct !== null && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          {pct < 1 && (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Escala incompleta" />
                          )}
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 1 ? "bg-green-500" : pct >= 0.5 ? "bg-amber-400" : "bg-red-400"}`}
                              style={{ width: `${Math.round(pct * 100)}%` }}
                            />
                          </div>
                          <span className={`text-[11px] shrink-0 tabular-nums font-medium ${pct >= 1 ? "text-green-600" : pct >= 0.5 ? "text-amber-600" : "text-red-500"}`}>
                            {counts!.filled}/{counts!.needed}
                          </span>
                        </div>
                        {/* ── Status chips de confirmação ── */}
                        {(counts!.confirmados > 0 || counts!.pendentes > 0 || counts!.recusados > 0) && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {counts!.confirmados > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {counts!.confirmados} confirmado{counts!.confirmados !== 1 ? "s" : ""}
                              </span>
                            )}
                            {counts!.pendentes > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                {counts!.pendentes} pendente{counts!.pendentes !== 1 ? "s" : ""}
                              </span>
                            )}
                            {counts!.recusados > 0 && (
                              <Link
                                to="/substituicoes"
                                onClick={(ev) => ev.stopPropagation()}
                                className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                                title="Ver substituições abertas"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                                {counts!.recusados} recusou{counts!.recusados !== 1 ? "ram" : ""} · substituição aberta
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onToggleSelect(e.id);
                      }}
                      aria-label={isSelected ? "Desmarcar escala" : "Selecionar escala"}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => onOpenDetail(e)}>
                          <ChevronDown className="h-3.5 w-3.5 mr-2 rotate-[-90deg]" />Ver detalhes
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(ev) => onEdit(e, ev)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />Editar
                        </DropdownMenuItem>
                        {e.status === "rascunho" && (
                          <DropdownMenuItem onClick={() => onBulkPublish([e.id])}>
                            <Send className="h-3.5 w-3.5 mr-2 text-green-600" />
                            <span className="text-green-700 dark:text-green-400 font-medium">Publicar</span>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => onExportPDF(e.id)}>
                          <FileText className="h-3.5 w-3.5 mr-2" />Exportar PDF
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete(e)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="border-t border-border/40 px-4 pb-4 pt-3">
                  {counts && counts.funcoes.length > 0 ? (
                    <div className="space-y-3">
                      {groupFuncoesByCategoria(counts.funcoes).map((group) => {
                        const groupFilled  = group.funcoes.reduce((s, f) => s + f.membros.length, 0);
                        const groupNeeded  = group.funcoes.reduce((s, f) => s + f.quantidade, 0);
                        const groupDone    = groupFilled >= groupNeeded && groupNeeded > 0;
                        return (
                          <div key={group.categoria ?? "__none__"}>
                            {group.categoria && (
                              <div className="flex items-center gap-2 mb-2">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
                                  {group.categoria}
                                </p>
                                <div className="flex-1 h-px bg-border/50" />
                                <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${groupDone ? "text-green-600" : "text-amber-500"}`}>
                                  {groupFilled}/{groupNeeded}
                                </span>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-1.5">
                              {group.funcoes.map((f) => {
                                const filled   = f.membros.length;
                                const complete = filled >= f.quantidade;
                                return (
                                  <div
                                    key={f.ministerio_id}
                                    className="rounded-xl border border-border bg-background px-2.5 py-2"
                                    style={{ borderLeftColor: f.cor, borderLeftWidth: "3px" }}
                                  >
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[11px] font-semibold truncate" style={{ color: f.cor }}>
                                        {f.nome}
                                      </span>
                                      <span className={`text-[10px] tabular-nums shrink-0 font-medium ${complete ? "text-green-600" : "text-amber-500"}`}>
                                        {filled}/{f.quantidade}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {filled === 0
                                        ? Array.from({ length: Math.min(f.quantidade, 2) }).map((_, i) => (
                                            <span key={i} className="text-[10px] text-muted-foreground/40 italic">Vaga</span>
                                          ))
                                        : f.membros.slice(0, 3).map((m) => {
                                            const dotColor = m.status === "confirmado" || m.status === "presente" ? "bg-emerald-500" : m.status === "recusado" ? "bg-red-500" : "bg-amber-400";
                                            return (
                                              <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
                                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                                                {nomeExibicao(m.nome)}
                                              </span>
                                            );
                                          })
                                      }
                                      {filled > 3 && (
                                        <span className="text-[10px] text-muted-foreground/60">+{filled - 3}</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma função definida para esta escala.</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Carregar mais ── */}
          {paginaEscalas < escalasVisiveis.length && (
            <div className="flex justify-center pt-2 pb-1">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setPaginaEscalas((p) => p + 20)}
              >
                Carregar mais ({escalasVisiveis.length - paginaEscalas} restantes)
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vista calendário ─────────────────────────────────────────────────────────

function CalendarioView({
  calMonth, setCalMonth, calDays, escalasForDay, onOpenDetail,
}: {
  calMonth: Date;
  setCalMonth: (d: Date) => void;
  calDays: { days: Date[]; offset: number };
  escalasForDay: (d: Date) => Escala[];
  onOpenDetail: (e: Escala) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<Date>(calMonth);

  useEffect(() => {
    setSelectedDay(calMonth);
  }, [calMonth]);

  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const selectedEscalas = selectedDay ? escalasForDay(selectedDay) : [];

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCalMonth(subMonths(calMonth, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCalMonth(addMonths(calMonth, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="font-serif text-xl capitalize text-center flex-1">
          {format(calMonth, "MMMM yyyy", { locale: ptBR })}
        </h2>
        <div className="w-10" />
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {weekDays.map((d) => (
            <div key={d} className="py-2 text-center text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase">
              <span className="hidden sm:inline">{d}</span>
              <span className="sm:hidden">{d[0]}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: calDays.offset }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[56px] sm:min-h-[80px] border-b border-r border-border bg-muted/10" />
          ))}
          {calDays.days.map((day, i) => {
            const dayEscalas = escalasForDay(day);
            const isToday = isSameDay(day, new Date());
            const isSelected = selectedDay && isSameDay(day, selectedDay);
            const col = (i + calDays.offset) % 7;
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelectedDay(day)}
                className={`min-h-[56px] sm:min-h-[80px] p-1 sm:p-1.5 border-b border-r border-border ${col === 6 ? "border-r-0" : ""} ${isToday ? "bg-primary/5" : ""} ${isSelected ? "ring-2 ring-primary/30" : ""}`}
              >
                <p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                  {format(day, "d")}
                </p>
                <div className="space-y-0.5">
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {dayEscalas.slice(0, 3).map((e) => (
                      <span key={e.id} className="h-1.5 w-1.5 rounded-full bg-primary" title={e.titulo} />
                    ))}
                    {dayEscalas.length > 3 && (
                      <span className="text-[9px] text-muted-foreground leading-none">+{dayEscalas.length - 3}</span>
                    )}
                  </div>
                  <div className="hidden sm:block space-y-0.5">
                    {dayEscalas.slice(0, 2).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className="w-full text-left text-[10px] leading-tight font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition truncate"
                        onClick={(ev) => { ev.stopPropagation(); onOpenDetail(e); }}
                      >
                        {e.hora_inicio ? e.hora_inicio.slice(0, 5) + " " : ""}{e.titulo}
                      </button>
                    ))}
                    {dayEscalas.length > 2 && (
                      <p className="text-[10px] text-muted-foreground px-1">+{dayEscalas.length - 2} mais</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Escalas do dia</p>
            <p className="mt-1 text-base font-semibold">
              {format(selectedDay, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
          <span className="text-sm text-muted-foreground">{selectedEscalas.length} evento(s)</span>
        </div>

        {selectedEscalas.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma escala agendada para esta data.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {selectedEscalas.map((e) => (
              <div key={e.id} className="rounded-2xl border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{e.titulo}</p>
                    <p className="text-sm text-muted-foreground">
                      {e.hora_inicio ? e.hora_inicio.slice(0, 5) : "Hora não definida"}
                      {e.local ? ` · ${e.local}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onOpenDetail(e)}>
                    Ver detalhes
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detalhe da escala ────────────────────────────────────────────────────────

function EscalaDetail({
  escala, ministerios, membros, funcoes, atribuicoes, removidos, membroMinisterios, assignmentHistory,
  membroAtuacoes,
  indisponibilidades, funcaoRestricoes, incompatibilidades, missasPadrao, membroMissaRestricoes, paroquiaConfig,
  paroquiaNome, initialEditMode, comunidades, tiposMissa, isSaving, onSave,
  onDelete, onAddFuncao, onRemoveFuncao, onAtribuir, onRemoverAtribuicao, onRemoverPublicada, onStatusChange, onNotificarVaga,
  preferenciaisSolene, hasPendingMemberChanges, onApplyPendingMemberChanges,
}: {
  escala: Escala;
  ministerios: Ministerio[];
  membros: Membro[];
  funcoes: EscalaFuncao[];
  atribuicoes: EscalaMembro[];
  removidos: { id: string; membro_id: string; ministerio_id: string; removido_em: string | null; membro: { id: string; nome: string } }[];
  membroMinisterios: Record<string, string[]>;
  assignmentHistory: AssignmentHistoryEntry[];
  membroAtuacoes: Record<string, string[]>;
  indisponibilidades: IndispRow[];
  funcaoRestricoes: FuncaoRestricao[];
  incompatibilidades: { membro_a_id: string; membro_b_id: string }[];
  missasPadrao: { id: string; dia_semana: number; hora_inicio: string | null }[];
  membroMissaRestricoes: Record<string, string[]>;
  paroquiaConfig: { regras_escala: any; usa_tochas: boolean } | null | undefined;
  paroquiaNome: string;
  preferenciaisSolene?: { ministerio_id: string; membro_id: string }[];
  initialEditMode: boolean;
  comunidades: { id: string; nome: string }[];
  tiposMissa: { id: string; nome: string; cor: string; icone: string | null }[];
  isSaving: boolean;
  onSave: (form: EscalaForm, onSuccess: () => void) => void;
  onDelete: (e: Escala) => void;
  onAddFuncao: (mid: string, qty: number) => void;
  onRemoveFuncao: (id: string) => void;
  onAtribuir: (memberId: string, ministerioId: string) => void;
  onRemoverAtribuicao: (id: string) => void;
  onRemoverPublicada: (args: { atribId: string; membroId: string; motivo: string; abrirVaga: boolean; penalidade: "nenhuma" | "justificou" | "faltou" }) => void;
  onStatusChange: (status: string) => void;
  onNotificarVaga: (args: { escalaId: string; ministerioId: string; ministerioNome: string }) => void;
  hasPendingMemberChanges: boolean;
  onApplyPendingMemberChanges: () => Promise<void>;
}) {
  const [editMode, setEditMode] = useState(initialEditMode);
  const [escalaForm, setEscalaForm] = useState<EscalaForm>(EMPTY_FORM);
  const [equilibrioOpen, setEquilibrioOpen] = useState(false);
  const [removerPendente, setRemoverPendente] = useState<{
    atribId: string; membroId: string; membroNome: string; ministerioId: string; ministerioNome: string;
  } | null>(null);
  const [motivoRemocao, setMotivoRemocao] = useState("");
  const [abrirVagaChecked, setAbrirVagaChecked] = useState(true);
  const [penalidade, setPenalidade] = useState<"nenhuma" | "justificou" | "faltou">("nenhuma");
  const [notificarVaga, setNotificarVaga] = useState(true);
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [membroBuscaOpen, setMembroBuscaOpen] = useState<Record<string, boolean>>({});
  const [removidosOpen, setRemovidosOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setEditMode(initialEditMode);
  }, [escala.id, initialEditMode]);

  useEffect(() => {
    if (!editMode) return;
    setEscalaForm({
      titulo: escala.titulo,
      data: escala.data,
      hora_inicio: escala.hora_inicio ?? "",
      local: escala.local ?? "",
      tipo: escala.tipo,
      tipo_missa_id: escala.tipo_missa_id ?? "",
      status: escala.status,
      observacoes: escala.observacoes ?? "",
      solene: escala.solene,
      tem_adoracao: escala.tem_adoracao,
      tem_bispo: escala.tem_bispo,
    });
  }, [editMode, escala]);

  const [addMinisterioId, setAddMinisterioId] = useState("");
  const [addQtd, setAddQtd] = useState("1");
  const [addMembroMap, setAddMembroMap] = useState<Record<string, string>>({});
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showDebugMotor, setShowDebugMotor] = useState(false);
  const [debugInsights, setDebugInsights] = useState<InsightFuncao[]>([]);
  const [confirmarPublicar, setConfirmarPublicar] = useState(false);
  const [vagasAbertasInfo, setVagasAbertasInfo] = useState<string>("");

  // ── Hook de preview ───────────────────────────────────────────────────────
  const { profile: authProfile } = useAuth();

  // Hash dos dados atuais para detectar mudanças desde a última geração
  const currentHash = useMemo(() => {
    const vinculosList = Object.entries(membroMinisterios).flatMap(([minId, mids]) =>
      mids.map((mid) => ({ membro_id: mid, ministerio_id: minId })),
    );
    return computePreviewHash({
      membroIds: membros.map((m) => m.id),
      vinculos: vinculosList,
      indisponibilidades: indisponibilidades.map((i) => ({ membro_id: i.membro_id, data: i.data })),
      escalaData: escala.data,
    });
  }, [membros, membroMinisterios, indisponibilidades, escala.data]);

  const preview = useEscalaPreview({
    escalaId: escala.id,
    userId: authProfile?.id ?? "anon",
    currentHash,
  });

  // Mantém engineInsights sincronizado com o snapshot para o painel de debug legado
  const engineInsights = useMemo(
    () => Object.values(preview.engineSnapshots),
    [preview.engineSnapshots],
  );

  // Alias de compat: código legado usa suggestedAssignments como array simples
  const suggestedAssignments = preview.suggestedAssignments;
  // Candidatos sugeridos por função (para o botão "Sugerir" por slot)
  type CandidatoSlot = import("@/lib/escala-engine").InsightCandidato & { motivo_indisp?: string };
  const [slotCandidatos, setSlotCandidatos] = useState<Record<string, CandidatoSlot[]>>({});
  const [slotLoading, setSlotLoading] = useState<Record<string, boolean>>({});

  // ── Presença pós-missa ──────────────────────────────────────────────────────
  const hoje = format(new Date(), "yyyy-MM-dd");
  const isPastOrToday = escala.data <= hoje;
  const [presencaOpen, setPresencaOpen] = useState(false);
  type PresencaStatus = "presente" | "faltou" | "atrasado" | "justificou" | "pendente";
  const [presencaMap, setPresencaMap] = useState<Record<string, PresencaStatus>>({});

  useEffect(() => {
    const map: Record<string, PresencaStatus> = {};
    const finals: PresencaStatus[] = ["presente", "faltou", "atrasado", "justificou"];
    atribuicoes.forEach((a) => {
      const s = a.status as PresencaStatus;
      map[a.id] = (finals as string[]).includes(s) ? s : "pendente";
    });
    setPresencaMap(map);
  }, [atribuicoes]);

  const queryClient = useQueryClient();

  // ── Salvar Rascunho (Sprint 2) ────────────────────────────────────────────
  // DELETE + INSERT com campos de auditoria + optimistic locking via updated_at
  const salvarRascunhoMutation = useMutation({
    mutationFn: async (assignments: SugestaoItem[]) => {
      if (assignments.length === 0) throw new Error("Nenhuma sugestão para salvar.");
      const anyDb = supabase as any;

      // Optimistic locking atômico: UPDATE condicional WHERE updated_at = valor original.
      // Se 0 linhas afetadas → outro usuário salvou entre a nossa leitura e este save.
      // Isso elimina a janela de corrida do padrão SELECT→compare→save.
      if (escala.updated_at) {
        const { data: locked } = await anyDb
          .from("escalas")
          .update({ motor_gerado_em: preview.lastGeneratedAt?.toISOString() ?? new Date().toISOString() })
          .eq("id", escala.id)
          .eq("updated_at", escala.updated_at)
          .select("id");

        if (!locked || (locked as unknown[]).length === 0) {
          throw new Error(
            "Esta escala foi modificada por outro coordenador. Atualize a página antes de salvar.",
          );
        }
      }

      // DELETE + INSERT (sem soft-delete nesta versão — adicionado Sprint 4+)
      await anyDb.from("escala_membros").delete().eq("escala_id", escala.id);

      const rows = assignments.map((a) => ({
        escala_id:          escala.id,
        membro_id:          a.membro_id,
        ministerio_id:      a.ministerio_id,
        status:             "pendente",
        origem:             a.origem,
        score_motor:        a.score_motor ?? null,
        substituido_de:     a.substituido_de ?? null,
        justificativa_motor: a.justificativa ?? null,
      }));

      // Caso escala.updated_at seja null (escala nova sem updated_at ainda),
      // grava motor_gerado_em separadamente (sem lock — sem risco de conflito em escala nova)
      if (!escala.updated_at) {
        await anyDb.from("escalas")
          .update({ motor_gerado_em: preview.lastGeneratedAt?.toISOString() ?? new Date().toISOString() })
          .eq("id", escala.id);
      }

      const { error: insertErr } = await anyDb.from("escala_membros").insert(rows);
      if (insertErr) throw insertErr;

      return rows.length;
    },
    onSuccess: (count) => {
      queryClient.refetchQueries({ queryKey: ["escala-membros", escala.id] });
      queryClient.invalidateQueries({ queryKey: ["pm-escalas"] });
      queryClient.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      queryClient.invalidateQueries({ queryKey: ["escala-historico"] });
      queryClient.invalidateQueries({ queryKey: ["escalas"] });
      preview.marcarSalvo();
      setGenerateNotice(null);
      setShowInsights(false);
      toast.success(`Rascunho salvo — ${count} membro(s) alocado(s).`);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const applySuggestionsMutation = useMutation({
    mutationFn: async ({ escalaId, assignments }: { escalaId: string; assignments: { membro_id: string; ministerio_id: string }[] }) => {
      if (assignments.length === 0) return 0;
      const { data: inserted, error } = await (supabase as any).from("escala_membros").insert(
        assignments.map((assignment) => ({
          escala_id: escalaId,
          membro_id: assignment.membro_id,
          ministerio_id: assignment.ministerio_id,
          status: "pendente",
        }))
      ).select("id");
      if (error) throw error;
      return (inserted as any[])?.length ?? assignments.length;
    },
    onSuccess: (count, { assignments }) => {
      // refetchQueries força atualização imediata (não apenas marca como stale)
      queryClient.refetchQueries({ queryKey: ["escala-membros", escala.id] });
      queryClient.invalidateQueries({ queryKey: ["pm-escalas"] });
      queryClient.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      queryClient.invalidateQueries({ queryKey: ["escala-historico"] });
      toast.success(`${count ?? 0} membro(s) atribuído(s) com sucesso.`);
      preview.limparPreview();
      setGenerateNotice(null);
      setShowInsights(false);
      // Emails só quando a escala já está publicada — rascunho não notifica membros
      if (escala.status === "publicada") {
        for (const { membro_id, ministerio_id } of assignments) {
          const membro = membros.find((m) => m.id === membro_id);
          const min = ministerios.find((m) => m.id === ministerio_id);
          if (membro?.email) {
            supabase.functions.invoke("send-email", {
              body: {
                template: "escala_atribuida",
                to: membro.email,
                nome: membro.nome,
                paroquia: paroquiaNome,
                escalaTitulo: escala.titulo,
                escalaData: escala.data,
                escalaHora: escala.hora_inicio?.slice(0, 5) ?? "",
                ministerioNome: min?.nome ?? "",
              },
            });
          }
        }
      }
    },
    onError: (e: unknown) => {
      console.error("[APPLY] Erro ao aplicar sugestões:", e);
      toast.error(supabaseErrorMessage(e));
    },
  });

  const marcarPresencasMutation = useMutation({
    mutationFn: async () => {
      const updates = atribuicoes.map((a) => ({
        id: a.id,
        status: presencaMap[a.id] ?? "pendente",
      }));
      const { error } = await supabase.rpc("salvar_presencas_escala", {
        p_escala_id: escala.id,
        p_updates: updates,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escala-membros", escala.id] });
      queryClient.invalidateQueries({ queryKey: ["escala-historico"] });
      queryClient.invalidateQueries({ queryKey: ["pm-escalas"] });
      queryClient.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Presenças registradas.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const reenviarMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("reenviar_notificacoes_escala", { p_escala_id: escala.id });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error ?? "Erro ao reenviar notificações.");

      // Envia e-mails com stagger de 400ms para respeitar rate limit da edge function
      const erros: string[] = [];
      for (let i = 0; i < atribuicoes.length; i++) {
        const a = atribuicoes[i];
        const membro = membros.find((m) => m.id === a.membro_id);
        const min = ministerios.find((m) => m.id === a.ministerio_id);
        if (!membro?.email) continue;
        if (i > 0) await new Promise((r) => setTimeout(r, 400));
        const { error: efErr, data: efData } = await supabase.functions.invoke("send-email", {
          body: {
            template: "escala_publicada",
            to: membro.email,
            nome: membro.nome,
            paroquia: paroquiaNome,
            escalaTitulo: escala.titulo,
            escalaData: escala.data,
            escalaHora: escala.hora_inicio?.slice(0, 5) ?? "",
            ministerioNome: min?.nome ?? "",
          },
        });
        if (efErr || efData?.ok === false) {
          let msg = efErr?.message ?? efData?.error ?? "erro desconhecido";
          try {
            const body = await (efErr as any)?.context?.json?.();
            if (body?.error) msg = body.error;
          } catch { /* ignora */ }
          erros.push(`${membro.email}: ${msg}`);
          console.error("[send-email]", membro.email, msg, efErr);
        }
      }
      if (erros.length > 0) throw new Error(`E-mails com falha (${erros.length}): ${erros[0]}`);
    },
    onSuccess: () => toast.success("Notificações e e-mails reenviados."),
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const cfg = STATUS_CONFIG[escala.status] ?? STATUS_CONFIG.rascunho;
  const publicUrl = typeof window !== "undefined" && escala.token_publico ? `${window.location.origin}/escala/${escala.token_publico}` : null;
  const dateStr = format(new Date(escala.data + "T00:00:00"), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  const funcaoMinsIds = funcoes.map((f) => f.ministerio_id);
  const ministeriosDisponiveis = ministerios.filter((m) => !funcaoMinsIds.includes(m.id));

  // Fonte única de elegibilidade — mesmas regras do motor automático
  function membrosClassificadosParaMinisterio(ministerioId: string): {
    disponiveis: (Membro & { motivo?: string; diasSemServir: number | null })[];
    indisponiveis: (Membro & { motivo: string })[];
  } {
    const atribuidos = new Set(atribuicoes.filter((a) => a.ministerio_id === ministerioId).map((a) => a.membro_id));
    const desteMinisterio = new Set(membroMinisterios[ministerioId] ?? []);
    const diaSemana = new Date(escala.data + "T12:00:00").getDay();

    // Regras do motor lidas da config da paróquia
    const regrasEngine = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
    const limiteSem   = regrasEngine.limite_semanal         as number  | undefined;
    const limiteMen   = regrasEngine.limite_mensal          as number  | undefined;
    const impedirRep  = (regrasEngine.impedir_repeticao_consecutiva as boolean) ?? false;
    const intervaloMin = regrasEngine.intervalo_minimo_dias  as number  | undefined;

    // Pré-computa quem atingiu limite semanal/mensal
    const acima_limite = new Set<string>();
    if ((limiteSem || limiteMen) && assignmentHistory.length > 0) {
      const sem7     = format(addDays(new Date(escala.data + "T00:00:00"), -6), "yyyy-MM-dd");
      const mesInicio = escala.data.slice(0, 7) + "-01";
      membros.forEach((m) => {
        const hist = assignmentHistory.filter((h) => h.memberId === m.id);
        if (limiteSem) {
          const cnt = hist.filter((h) => (h.date ?? "") >= sem7 && (h.date ?? "") <= escala.data).length;
          if (cnt >= limiteSem) { acima_limite.add(m.id); return; }
        }
        if (limiteMen) {
          const cnt = hist.filter((h) => (h.date ?? "") >= mesInicio && (h.date ?? "") <= escala.data).length;
          if (cnt >= limiteMen) acima_limite.add(m.id);
        }
      });
    }

    const ontemStr = format(addDays(new Date(escala.data + "T00:00:00"), -1), "yyyy-MM-dd");

    const disponiveis: (Membro & { motivo?: string; diasSemServir: number | null })[] = [];
    const indisponiveis: (Membro & { motivo: string })[] = [];

    membros.forEach((m) => {
      if (!desteMinisterio.has(m.id)) return; // sem vínculo
      if (atribuidos.has(m.id)) return;        // já atribuído nesta escala

      // Restrição de função (nao_pode)
      const naoPode = funcaoRestricoes.some((r) => r.membro_id === m.id && r.ministerio_id === ministerioId && r.tipo === "nao_pode");
      if (naoPode) { indisponiveis.push({ ...m, motivo: "Não pode exercer esta função" }); return; }

      // Restrição de dia da semana
      if (m.restricoes_dia_semana?.includes(diaSemana)) {
        const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
        indisponiveis.push({ ...m, motivo: `Restrito às ${dias[diaSemana]}` }); return;
      }

      // Indisponibilidade registrada
      const indisp = indisponibilidades.find((i) => {
        if (i.membro_id !== m.id || i.cancelada) return false;
        if (i.tipo === "intervalo" && i.data_fim) return escala.data >= i.data && escala.data <= i.data_fim;
        return i.data === escala.data;
      });
      if (indisp) { indisponiveis.push({ ...m, motivo: indisp.motivo ? `Indisponível: ${indisp.motivo}` : "Indisponível nesta data" }); return; }

      // Anti-repetição consecutiva
      if (impedirRep) {
        const serviuOntem = assignmentHistory.some((h) => h.memberId === m.id && h.date === ontemStr);
        if (serviuOntem) { indisponiveis.push({ ...m, motivo: "Serviu ontem (anti-repetição ativa)" }); return; }
      }

      // Intervalo mínimo entre escalações
      if (intervaloMin && intervaloMin > 0) {
        const limite = format(addDays(new Date(escala.data + "T00:00:00"), -intervaloMin), "yyyy-MM-dd");
        const serviuRecente = assignmentHistory.some((h) => h.memberId === m.id && (h.date ?? "") > limite && (h.date ?? "") < escala.data);
        if (serviuRecente) { indisponiveis.push({ ...m, motivo: `Serviu nos últimos ${intervaloMin} dias (intervalo mínimo)` }); return; }
      }

      // Limite semanal/mensal
      if (acima_limite.has(m.id)) {
        const motivo = limiteSem ? `Limite semanal (${limiteSem}×/sem) atingido` : `Limite mensal (${limiteMen}×/mês) atingido`;
        indisponiveis.push({ ...m, motivo }); return;
      }

      // Candidato elegível — calcula dias sem servir para ordenação
      const histMembro = assignmentHistory.filter((h) => h.memberId === m.id && (h.date ?? "") < escala.data);
      const ultimaData = histMembro.length > 0
        ? histMembro.reduce((acc, h) => (h.date ?? "") > acc ? (h.date ?? acc) : acc, histMembro[0].date ?? "")
        : null;
      const diasSemServir = ultimaData
        ? Math.floor((new Date(escala.data + "T00:00:00").getTime() - new Date(ultimaData + "T00:00:00").getTime()) / 86400000)
        : null;

      disponiveis.push({ ...m, diasSemServir });
    });

    // Ordenação: menor score acumulado = maior prioridade; tiebreaker: mais dias sem servir
    disponiveis.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return (b.diasSemServir ?? 365) - (a.diasSemServir ?? 365);
    });

    return { disponiveis, indisponiveis };
  }

  // Compat com uso legado
  function membrosParaMinisterio(ministerioId: string) {
    return membrosClassificadosParaMinisterio(ministerioId).disponiveis;
  }

  function handleGenerateSuggestions() {
    if (funcoes.length === 0) {
      toast.error("Adicione funções à escala antes de gerar sugestões.");
      return;
    }

    const linkCount = Object.values(membroMinisterios).flat().length;

    if (linkCount === 0) {
      toast.error(
        "Nenhum membro tem funções vinculadas. Acesse Membros → edite cada membro → Funções Litúrgicas → marque as funções → Salvar.",
        { duration: 10000 }
      );
      return;
    }

    const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
    const config = {
      usa_tochas:               paroquiaConfig?.usa_tochas ?? false,
      limite_semanal:           (regras.limite_semanal           as number  | undefined) ?? undefined,
      limite_mensal:            (regras.limite_mensal            as number  | undefined) ?? undefined,
      impedir_repeticao_seguida:(regras.impedir_repeticao_consecutiva as boolean | undefined) ?? false,
      distribuicao_masc_pct:    (regras.distribuicao_masc_pct    as number  | undefined) ?? undefined,
      intervalo_minimo_dias:    (regras.intervalo_minimo_dias     as number  | undefined) ?? undefined,
      variedade_ministerio:     (regras.variedade_ministerio      as boolean | undefined) ?? false,
      prioridade_bonus_alto:    (regras.prioridade_bonus_alto     as number  | undefined) ?? undefined,
      prioridade_bonus_medio:   (regras.prioridade_bonus_medio    as number  | undefined) ?? undefined,
      bonus_preferencial_solene:(regras.bonus_preferencial_solene as number  | undefined) ?? undefined,
    };

    // Encontra missas_padrao que correspondem a esta escala (mesmo dia da semana + hora)
    const escalaDia = new Date(escala.data + "T12:00:00").getDay();
    const escalaHora = (escala.hora_inicio ?? "").slice(0, 5);
    const missasMatch = missasPadrao.filter((mp) => {
      if (mp.dia_semana !== escalaDia) return false;
      if (escalaHora && mp.hora_inicio) return mp.hora_inicio.slice(0, 5) === escalaHora;
      return true;
    });
    const missaRestricaoIndisp = missasMatch.flatMap((mp) =>
      (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: escala.data }))
    );

    const membrosComAtuacoes = membros.map((m) => ({
      ...m,
      atuacao_ids: membroAtuacoes[m.id] ?? [],
    }));

    // Usa generateEscalaWithAlertas para obter alertas do motor
    const funcoesPedido = funcoes.map((f) => ({
      ...f,
      relevancia:           f.ministerio?.relevancia,
      duplicidade_permitida: f.ministerio?.duplicidade_permitida,
      ordem_prioridade:     f.ministerio?.ordem_prioridade,
    }));
    const resultado = generateEscalaWithAlertas(
      { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
      funcoesPedido,
      membrosComAtuacoes,
      membroMinisterios,
      {
        history: assignmentHistory,
        existingAssignments: atribuicoes.map((entry) => ({
          membro_id: entry.membro_id,
          ministerio_id: entry.ministerio_id,
        })),
        indisponibilidades: [...indisponibilidades, ...missaRestricaoIndisp],
        restricoes: funcaoRestricoes,
        incompatibilidades: incompatibilidades,
        config,
        solene: escala.solene,
        tem_adoracao: escala.tem_adoracao,
        tem_bispo: escala.tem_bispo,
        preferenciaisSolene,
      }
    );

    const totalSlots = funcoes.reduce((sum, f) => sum + f.quantidade, 0);

    if (resultado.sugestoes.length === 0) {
      const motivo = resultado.alertas[0] ?? "Verifique se os membros têm funções vinculadas e não estão indisponíveis.";
      setGenerateNotice(`Nenhuma sugestão gerada. ${motivo}`);
      return;
    }

    if (resultado.alertas.length > 0) {
      resultado.alertas.forEach((a) => toast.warning(a, { duration: 6000 }));
    }

    // Indexa insights por ministerio_id para lookup rápido
    const snapshotsMap: Record<string, InsightFuncao> = {};
    for (const insight of resultado.insights ?? []) {
      snapshotsMap[insight.ministerio_id] = insight;
    }

    // Constrói SugestaoItem[] com nomes e score do motor
    const membroMap = new Map(membros.map((m) => [m.id, m.nome]));
    const funcaoNomeMap = new Map(funcoes.map((f) => [f.ministerio_id, f.ministerio?.nome ?? f.ministerio_id]));

    const sugestaoItems: SugestaoItem[] = resultado.sugestoes.map((s) => {
      const snapshot = snapshotsMap[s.ministerio_id];
      const escolhido = snapshot?.escolhidos.find((c) => c.membro_id === s.membro_id);
      const justificativa: JustificativaMotorV3 | null = escolhido
        ? {
            v:                 "3",
            modo:              escolhido.breakdown.modo,
            score:             escolhido.score_final,
            participacoes_30d: escolhido.participacoes_30d,
            dias_sem_servir:   escolhido.dias_sem_servir,
            pool:              (1 as 1 | 2 | 3 | 4), // pool exata não está no InsightCandidato — Sprint 4
            forcado:           false,
          }
        : null;

      return {
        ministerio_id:    s.ministerio_id,
        membro_id:        s.membro_id,
        membro_nome:      membroMap.get(s.membro_id) ?? s.membro_id,
        ministerio_nome:  funcaoNomeMap.get(s.ministerio_id) ?? s.ministerio_id,
        origem:           "motor" as const,
        score_motor:      escolhido ? Math.round(escolhido.score_final) : null,
        substituido_de:   null,
        substituido_nome: null,
        justificativa,
      };
    });

    // Repassa para o hook de preview — persiste em localStorage automaticamente
    preview.setGeracaoCompleta(snapshotsMap, sugestaoItems, currentHash ?? "");

    if (resultado.sugestoes.length < totalSlots) {
      setGenerateNotice(
        `${resultado.sugestoes.length} de ${totalSlots} vagas preenchidas. ` +
        resultado.detalhesPorFuncao
          .filter((d) => d.alocados < d.solicitados)
          .map((d) => `"${d.ministerio_nome}" (${d.alocados}/${d.solicitados})`)
          .join(", "),
      );
      return;
    }

    setGenerateNotice(`${resultado.sugestoes.length} sugestões geradas pelo motor inteligente. Revise e salve o rascunho.`);
  }

  function handleClearSuggestions() {
    preview.limparPreview();
    setGenerateNotice(null);
    setShowInsights(false);
  }

  function handleSugerirParaFuncao(funcao: EscalaFuncao) {
    const minId = funcao.ministerio_id;
    // Toggle: se já aberto, fecha
    if (slotCandidatos[minId]) {
      setSlotCandidatos((prev) => { const n = { ...prev }; delete n[minId]; return n; });
      return;
    }
    setSlotLoading((prev) => ({ ...prev, [minId]: true }));

    const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
    const config = {
      usa_tochas:               paroquiaConfig?.usa_tochas ?? false,
      limite_semanal:           (regras.limite_semanal           as number  | undefined) ?? undefined,
      limite_mensal:            (regras.limite_mensal            as number  | undefined) ?? undefined,
      impedir_repeticao_seguida:(regras.impedir_repeticao_consecutiva as boolean | undefined) ?? false,
      distribuicao_masc_pct:    (regras.distribuicao_masc_pct    as number  | undefined) ?? undefined,
      intervalo_minimo_dias:    (regras.intervalo_minimo_dias     as number  | undefined) ?? undefined,
      variedade_ministerio:     (regras.variedade_ministerio      as boolean | undefined) ?? false,
      prioridade_bonus_alto:    (regras.prioridade_bonus_alto     as number  | undefined) ?? undefined,
      prioridade_bonus_medio:   (regras.prioridade_bonus_medio    as number  | undefined) ?? undefined,
      bonus_preferencial_solene:(regras.bonus_preferencial_solene as number  | undefined) ?? undefined,
    };

    const membrosComAtuacoes = membros.map((m) => ({ ...m, atuacao_ids: membroAtuacoes[m.id] ?? [] }));
    const resultado = generateEscalaWithAlertas(
      { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
      [{
        ministerio_id:         minId,
        quantidade:            funcao.quantidade - atribuicoes.filter((a) => a.ministerio_id === minId).length,
        ministerio:            { id: minId, nome: funcao.ministerio.nome, cor: funcao.ministerio.cor },
        relevancia:            funcao.ministerio?.relevancia,
        duplicidade_permitida: funcao.ministerio?.duplicidade_permitida,
        ordem_prioridade:      funcao.ministerio?.ordem_prioridade,
      }],
      membrosComAtuacoes,
      membroMinisterios,
      {
        history: assignmentHistory,
        existingAssignments: atribuicoes.map((a) => ({ membro_id: a.membro_id, ministerio_id: a.ministerio_id })),
        indisponibilidades,
        restricoes: funcaoRestricoes,
        incompatibilidades: incompatibilidades,
        config,
        solene: escala.solene,
        tem_adoracao: escala.tem_adoracao,
        tem_bispo: escala.tem_bispo,
        preferenciaisSolene: preferenciaisSolene ?? [],
      }
    );

    const insight = resultado.insights.find((i) => i.ministerio_id === minId);
    // Pega os top candidatos avaliados (escolhidos + não escolhidos), até 7
    const todos = insight ? [...insight.escolhidos, ...insight.top_candidatos.filter((c) => !c.escolhido)].slice(0, 7) : [];

    setSlotCandidatos((prev) => ({ ...prev, [minId]: todos }));
    setSlotLoading((prev) => ({ ...prev, [minId]: false }));
  }

  function handleDebugMotor() {
    // ── VERIFICAR 1: contagem de membros ──────────────────────────────────
    const membrosComVinculoSet = new Set(Object.values(membroMinisterios).flat());
    const semVinculo = membros.filter((m) => !membrosComVinculoSet.has(m.id));

    console.group("[DEBUG MOTOR] Auditoria completa do motor de escalas");
    console.log("=== VERIFICAR 1: CONTAGEM ===");
    console.log(`Total ativos: ${membros.length}`);
    console.log(`Com vínculo: ${membrosComVinculoSet.size}`);
    console.log(`Sem vínculo: ${semVinculo.length}`, semVinculo.map((m) => m.nome));

    // ── VERIFICAR 2: funções por membro ───────────────────────────────────
    const membroParaMin: Record<string, string[]> = {};
    for (const [minId, mids] of Object.entries(membroMinisterios)) {
      for (const mid of mids) {
        if (!membroParaMin[mid]) membroParaMin[mid] = [];
        membroParaMin[mid].push(minId);
      }
    }
    console.log("=== VERIFICAR 2: FUNÇÕES POR MEMBRO ===");
    membros.forEach((m) => {
      const fIds = membroParaMin[m.id] ?? [];
      const fNomes = fIds.map((fid) => ministerios.find((mn) => mn.id === fid)?.nome ?? `[${fid.slice(0, 8)}...]`);
      const atus = (membroAtuacoes[m.id] ?? []).length;
      console.log(`  ${m.nome}: funções=[${fNomes.join(", ") || "NENHUMA"}] atuações=${atus}`);
    });

    // ── VERIFICAR 5: compatibilidade de IDs ──────────────────────────────
    console.log("=== VERIFICAR 5: COMPATIBILIDADE DE IDs ===");
    const idsEscala = funcoes.map((f) => f.ministerio_id);
    const idsVinculo = Object.keys(membroMinisterios);
    console.log("IDs na escala:", idsEscala);
    console.log("IDs em membro_ministerios:", idsVinculo);
    funcoes.forEach((f) => {
      const cnt = (membroMinisterios[f.ministerio_id] ?? []).length;
      if (cnt === 0) {
        console.error(`  ❌ "${f.ministerio.nome}" (${f.ministerio_id}): NÍO MAPEADO — 0 membros`);
      } else {
        console.log(`  ✓ "${f.ministerio.nome}" (${f.ministerio_id}): ${cnt} membro(s)`);
      }
    });

    // ── Rodar motor com debug=true ────────────────────────────────────────
    const debugRegras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
    const debugConfig = {
      usa_tochas:               paroquiaConfig?.usa_tochas ?? false,
      limite_semanal:           (debugRegras.limite_semanal           as number  | undefined) ?? undefined,
      limite_mensal:            (debugRegras.limite_mensal            as number  | undefined) ?? undefined,
      impedir_repeticao_seguida:(debugRegras.impedir_repeticao_consecutiva as boolean | undefined) ?? false,
      distribuicao_masc_pct:    (debugRegras.distribuicao_masc_pct    as number  | undefined) ?? undefined,
      intervalo_minimo_dias:    (debugRegras.intervalo_minimo_dias     as number  | undefined) ?? undefined,
      variedade_ministerio:     (debugRegras.variedade_ministerio      as boolean | undefined) ?? false,
      prioridade_bonus_alto:    (debugRegras.prioridade_bonus_alto     as number  | undefined) ?? undefined,
      prioridade_bonus_medio:   (debugRegras.prioridade_bonus_medio    as number  | undefined) ?? undefined,
      bonus_preferencial_solene:(debugRegras.bonus_preferencial_solene as number  | undefined) ?? undefined,
    };

    const debugDia  = new Date(escala.data + "T12:00:00").getDay();
    const debugHora = (escala.hora_inicio ?? "").slice(0, 5);
    const debugMissasMatch = missasPadrao.filter((mp) => {
      if (mp.dia_semana !== debugDia) return false;
      if (debugHora && mp.hora_inicio) return mp.hora_inicio.slice(0, 5) === debugHora;
      return true;
    });
    const debugMissaRestricaoIndisp = debugMissasMatch.flatMap((mp) =>
      (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: escala.data }))
    );

    const membrosComAtuacoes = membros.map((m) => ({ ...m, atuacao_ids: membroAtuacoes[m.id] ?? [] }));
    const funcoesPedidoDebug = funcoes.map((f) => ({
      ...f,
      relevancia:            f.ministerio?.relevancia,
      duplicidade_permitida: f.ministerio?.duplicidade_permitida,
      ordem_prioridade:      f.ministerio?.ordem_prioridade,
    }));
    const resultado = generateEscalaWithAlertas(
      { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
      funcoesPedidoDebug,
      membrosComAtuacoes,
      membroMinisterios,
      {
        history: assignmentHistory,
        indisponibilidades: [...indisponibilidades, ...debugMissaRestricaoIndisp],
        restricoes: funcaoRestricoes,
        incompatibilidades: incompatibilidades,
        config: debugConfig,
        preferenciaisSolene: preferenciaisSolene ?? [],
        debug: true,
      },
    );

    console.log("=== RESULTADO DO MOTOR ===");
    console.log(`Sugestões: ${resultado.sugestoes.length} | Alertas: ${resultado.alertas.length}`);
    resultado.alertas.forEach((a) => console.warn(`  ${a}`));
    resultado.insights.forEach((ins) => {
      console.group(`FUNÇÍO: ${ins.ministerio_nome}`);
      console.log(`Candidatos avaliados: ${ins.candidatos_avaliados}`);
      console.log(`Alocados: ${ins.alocados}/${ins.solicitados}`);
      console.log("Excluídos:", ins.excluidos);
      if (ins.motivo_vazio) console.error("MOTIVO VAZIO:", ins.motivo_vazio);
      ins.top_candidatos.slice(0, 5).forEach((c) =>
        console.log(`  ${c.escolhido ? "✓" : "·"} ${c.nome} score=${c.score_final}`),
      );
      console.groupEnd();
    });
    console.groupEnd();

    setDebugInsights(resultado.insights);
    setShowDebugMotor(true);
  }

  async function handleApplySuggestions() {
    if (suggestedAssignments.length === 0) {
      toast.error("Nenhuma sugestão disponível para aplicar.");
      return;
    }

    const assignmentsToInsert = suggestedAssignments.filter(
      (suggestion) =>
        !atribuicoes.some(
          (existing) =>
            existing.membro_id === suggestion.membro_id && existing.ministerio_id === suggestion.ministerio_id
        )
    );

    if (assignmentsToInsert.length === 0) {
      toast.success("Todas as sugestões já foram aplicadas.");
      return;
    }

    applySuggestionsMutation.mutate({ escalaId: escala.id, assignments: assignmentsToInsert });
  }

  return (
    <div className="space-y-6 pt-2">
      <SheetHeader>
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="text-left font-serif text-2xl leading-tight">
            {editMode ? (escalaForm.titulo || escala.titulo) : escala.titulo}
          </SheetTitle>
          {!editMode && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditMode(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />Editar
            </Button>
          )}
        </div>
      </SheetHeader>

      {/* Edit form — shown when editMode is true */}
      {editMode ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <EscalaFormContent
            form={escalaForm}
            setForm={setEscalaForm}
            saving={isSaving}
            comunidades={comunidades}
            tiposMissa={tiposMissa}
            onSave={() => onSave(escalaForm, () => setEditMode(false))}
            onClose={() => setEditMode(false)}
          />
        </div>
      ) : (
        <>
          {/* Meta info */}
          <div className="rounded-xl bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="capitalize">{dateStr}</span>
            </div>
            {escala.hora_inicio && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{escala.hora_inicio.slice(0, 5)}{escala.hora_fim ? `–${escala.hora_fim.slice(0, 5)}` : ""}</span>
              </div>
            )}
            {escala.local && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{escala.local}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
              <StatusBadge status={escala.status} size="md" />
              <div className="flex items-center gap-2 flex-wrap">
                {escala.status === "rascunho" && (
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => {
                      // Calcula resumo de completude antes de abrir o modal
                      const totalVagas = funcoes.reduce((s, f) => s + f.quantidade, 0);
                      const preenchidas = atribuicoes.length;
                      const emAberto = totalVagas - preenchidas;
                      const funcaoCompleta = funcoes.filter((f) => {
                        const qt = atribuicoes.filter((a) => a.ministerio_id === f.ministerio_id).length;
                        return qt >= f.quantidade;
                      }).length;
                      if (emAberto > 0) {
                        setVagasAbertasInfo(
                          `${funcaoCompleta} de ${funcoes.length} função(ões) completa(s). ` +
                          `${emAberto} vaga(s) em aberto de ${totalVagas}.`,
                        );
                      } else {
                        setVagasAbertasInfo(`${funcoes.length} função(ões) completa(s). Todas as ${totalVagas} vagas preenchidas.`);
                      }
                      setConfirmarPublicar(true);
                    }}
                  >
                    <Send className="h-3 w-3" />
                    Publicar e notificar
                  </Button>
                )}
                {escala.status === "publicada" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    disabled={reenviarMutation.isPending}
                    onClick={() => reenviarMutation.mutate()}
                    title="Reenviar notificações e e-mails a todos os membros escalados"
                  >
                    <RefreshCw className={`h-3 w-3 ${reenviarMutation.isPending ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">Reenviar notificações</span>
                  </Button>
                )}
                <Select value={escala.status} onValueChange={(v) => {
                  if (v === "cancelada") { setConfirmarCancelamento(true); return; }
                  onStatusChange(v);
                }}>
                  <SelectTrigger className="h-7 text-xs w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rascunho">Rascunho</SelectItem>
                    <SelectItem value="publicada">Publicada</SelectItem>
                    <SelectItem value="arquivada">Arquivar</SelectItem>
                    <SelectItem value="cancelada">Cancelar escala</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {publicUrl && (
              <div className="mt-3 rounded-xl border border-border bg-background p-3 text-sm text-muted-foreground break-all">
                <p className="font-medium">Link público</p>
                {escala.status === "publicada" ? (
                  <a href={publicUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                    {publicUrl}
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    A escala ainda não está publicada. Altere o status para <strong>publicada</strong> para compartilhar o portal.
                  </p>
                )}
              </div>
            )}
          </div>

          {escala.observacoes && (
            <p className="text-sm text-muted-foreground">{escala.observacoes}</p>
          )}
        </>
      )}

      {/* ── Diagnóstico automático do motor ─────────────────────────────────── */}
      {funcoes.length > 0 && (() => {
        const analise = funcoes.map((f) => ({
          nome: f.ministerio.nome,
          ministerio_id: f.ministerio_id,
          membrosVinculados: (membroMinisterios[f.ministerio_id] ?? []).length,
        }));
        const semMembros = analise.filter((a) => a.membrosVinculados === 0);
        const totalMembrosComAlgumVinculo = Object.values(membroMinisterios).flat();
        const membrosAtivosComVinculo = [...new Set(totalMembrosComAlgumVinculo)].length;

        if (semMembros.length === 0 && membrosAtivosComVinculo > 0) return null; // tudo OK

        return (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                O motor não consegue distribuir — veja o que falta:
              </p>
            </div>

            {membrosAtivosComVinculo === 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800 p-2.5">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                  ❌ Nenhum membro tem funções vinculadas
                </p>
                <p className="text-xs text-red-600/80 dark:text-red-500/80 mt-1">
                  Acesse <strong>Membros</strong> → edite cada membro → seção <strong>Funções Litúrgicas</strong> → marque as funções que ele pode exercer → Salvar.
                </p>
              </div>
            )}

            {membrosAtivosComVinculo > 0 && semMembros.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {membrosAtivosComVinculo} membro(s) têm funções, mas as funções abaixo <strong>não têm membros vinculados</strong>:
                </p>
                {semMembros.map((a) => (
                  <div key={a.ministerio_id} className="flex items-center gap-2 rounded-lg bg-white dark:bg-background border border-amber-200 dark:border-amber-800 px-3 py-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                    <span className="text-xs font-medium">{a.nome}</span>
                    <span className="text-xs text-muted-foreground ml-auto">0 membros</span>
                  </div>
                ))}
                <p className="text-xs text-amber-700 dark:text-amber-400 pt-1">
                  Solução: em <strong>Membros</strong> → edite os membros que exercem essas funções → seção <strong>Funções Litúrgicas</strong> → marque as funções → Salvar.
                </p>
              </div>
            )}

            {/* Resumo do que está OK */}
            {analise.filter((a) => a.membrosVinculados > 0).map((a) => (
              <div key={a.ministerio_id} className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-medium">{a.nome}</span>
                <span className="text-muted-foreground ml-auto">{a.membrosVinculados} membro(s)</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Ministérios e atribuições */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Funções e atribuições</h3>
          <button
            type="button"
            onClick={handleDebugMotor}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded border border-dashed border-border hover:bg-muted/50 transition"
            title="Diagnóstico completo do motor de distribuição automática"
          >
            <AlertTriangle className="h-3 w-3" />
            Diagnóstico do motor
          </button>
        </div>

        {funcoes.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">
            Nenhuma função definida. Adicione os ministérios necessários abaixo.
          </p>
        )}

        {/* Group by categoria */}
        {(() => {
          const grouped: { categoria: string | null; fs: typeof funcoes }[] = [];
          funcoes.forEach((f) => {
            const cat = f.ministerio.categoria ?? null;
            const g = grouped.find((x) => x.categoria === cat);
            if (g) g.fs.push(f);
            else grouped.push({ categoria: cat, fs: [f] });
          });

          return grouped.map((group) => (
            <div key={group.categoria ?? "__none__"} className="mb-5">
              {group.categoria && (
                <div className="flex items-center gap-3 mb-3">
                  <span className="inline-flex items-center rounded-full bg-muted/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground shrink-0">
                    {group.categoria}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                  {(() => {
                    const gFilled  = group.fs.reduce((s, f) => s + atribuicoes.filter((a) => a.ministerio_id === f.ministerio_id).length, 0);
                    const gNeeded  = group.fs.reduce((s, f) => s + f.quantidade, 0);
                    const gDone    = gFilled >= gNeeded && gNeeded > 0;
                    return (
                      <span className={`text-xs font-semibold tabular-nums shrink-0 ${gDone ? "text-green-600" : "text-amber-600"}`}>
                        {gFilled}/{gNeeded}
                      </span>
                    );
                  })()}
                </div>
              )}
              <div className="space-y-3">
                {group.fs.map((f) => {
                  const atrib = atribuicoes.filter((a) => a.ministerio_id === f.ministerio_id);
                  const disponiveis = membrosParaMinisterio(f.ministerio_id);
                  const selectedMembro = addMembroMap[f.ministerio_id] ?? "";

                  return (
                    <div
                      key={f.id}
                      className="rounded-xl border border-border overflow-hidden"
                      style={{ borderLeftColor: f.ministerio.cor, borderLeftWidth: "4px" }}
                    >
                      {/* Header da função */}
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-muted/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm truncate" style={{ color: f.ministerio.cor }}>
                            {f.ministerio.nome}
                          </span>
                          <span className={`text-xs font-semibold tabular-nums ${atrib.length >= f.quantidade ? "text-green-600" : "text-amber-600"}`}>
                            {atrib.length}/{f.quantidade}
                          </span>
                          {atrib.length >= f.quantidade && (
                            <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {atrib.length < f.quantidade && (
                            <button
                              type="button"
                              className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition font-medium ${
                                slotCandidatos[f.ministerio_id]
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5"
                              }`}
                              onClick={() => handleSugerirParaFuncao(f)}
                            >
                              {slotLoading[f.ministerio_id]
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Sparkles className="h-3 w-3" />}
                              {slotCandidatos[f.ministerio_id] ? "Fechar" : "Sugerir"}
                            </button>
                          )}
                          <button
                            className="text-muted-foreground hover:text-destructive transition p-0.5"
                            onClick={() => onRemoveFuncao(f.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="px-3 py-2 space-y-1.5">

                      {/* Membros atribuídos */}
                      {atrib.map((a) => {
                        const st = a.status as string;
                        const badge =
                          st === "confirmado"  ? { label: "Confirmado",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" } :
                          st === "presente"    ? { label: "Presente",    cls: "bg-emerald-500 text-white" } :
                          st === "atrasado"    ? { label: "Atrasado",    cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" } :
                          st === "justificou"  ? { label: "Justificou",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" } :
                          st === "faltou"      ? { label: "Faltou",      cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" } :
                          st === "ausente"     ? { label: "Ausente",     cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" } :
                          st === "recusado"    ? { label: "Recusou",     cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" } :
                          null;
                        return (
                          <div key={a.id} className="flex items-center justify-between pl-5 text-sm gap-2">
                            <span className="truncate">{a.membro.nome}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {badge && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                                  {badge.label}
                                </span>
                              )}
                              <button
                                className="text-muted-foreground hover:text-destructive"
                                title="Remover desta escala"
                                onClick={() => {
                                  setNotificarVaga(true);
                                  setAbrirVagaChecked(true);
                                  setPenalidade("nenhuma");
                                  setMotivoRemocao("");
                                  setRemoverPendente({
                                    atribId: a.id,
                                    membroId: a.membro_id,
                                    membroNome: a.membro.nome,
                                    ministerioId: f.ministerio_id,
                                    ministerioNome: f.ministerio.nome,
                                  });
                                }}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Membros removidos desta função */}
                      {(() => {
                        const removidosFuncao = removidos.filter((r) => r.ministerio_id === f.ministerio_id);
                        if (removidosFuncao.length === 0) return null;
                        const isOpen = !!removidosOpen[f.ministerio_id];
                        return (
                          <div className="pl-5">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors py-0.5"
                              onClick={() => setRemovidosOpen((p) => ({ ...p, [f.ministerio_id]: !isOpen }))}
                            >
                              <UserMinus className="h-3 w-3" />
                              <span>{removidosFuncao.length} removido{removidosFuncao.length > 1 ? "s" : ""}</span>
                              <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </button>
                            {isOpen && (
                              <div className="mt-1 space-y-1 border-l border-dashed border-border ml-1.5 pl-2.5">
                                {removidosFuncao.map((r) => (
                                  <div key={r.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground/60">
                                    <span className="line-through truncate">{r.membro?.nome ?? "—"}</span>
                                    {r.removido_em && (
                                      <span className="tabular-nums shrink-0 text-[10px]">
                                        {new Date(r.removido_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Atribuir membro */}
                      {atrib.length < f.quantidade && (() => {
                        const { disponiveis: disp, indisponiveis: indisp } = membrosClassificadosParaMinisterio(f.ministerio_id);
                        const membroSelecionado = membros.find((m) => m.id === selectedMembro);
                        const isOpen = !!membroBuscaOpen[f.ministerio_id];
                        return (
                          <>
                            {disp.length > 0 || indisp.length > 0 ? (
                              <div className="flex gap-2 pl-5">
                                <Popover
                                  open={isOpen}
                                  onOpenChange={(o) => setMembroBuscaOpen((prev) => ({ ...prev, [f.ministerio_id]: o }))}
                                >
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1 justify-between font-normal">
                                      <span className="truncate">
                                        {membroSelecionado ? nomeExibicao(membroSelecionado.nome) : "Selecionar membro..."}
                                      </span>
                                      <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground shrink-0" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder="Buscar membro..." className="h-8 text-xs" />
                                      <CommandList className="max-h-56">
                                        <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">Nenhum membro encontrado.</CommandEmpty>
                                        {disp.length > 0 && (
                                          <CommandGroup heading={`Disponíveis (${disp.length})`}>
                                            {disp.map((m) => (
                                              <CommandItem
                                                key={m.id}
                                                value={nomeExibicao(m.nome)}
                                                onSelect={() => {
                                                  setAddMembroMap((prev) => ({ ...prev, [f.ministerio_id]: m.id }));
                                                  setMembroBuscaOpen((prev) => ({ ...prev, [f.ministerio_id]: false }));
                                                }}
                                                className="text-xs"
                                              >
                                                <Check className={`h-3 w-3 mr-1.5 shrink-0 ${selectedMembro === m.id ? "opacity-100" : "opacity-0"}`} />
                                                <span className="flex-1 truncate">{nomeExibicao(m.nome)}</span>
                                                <span className="ml-2 text-[10px] text-muted-foreground tabular-nums shrink-0">
                                                  {m.score > 0 ? `${m.score}pts` : "0pts"}
                                                  {m.diasSemServir !== null ? ` · ${m.diasSemServir}d` : " · novo"}
                                                </span>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                        {indisp.length > 0 && (
                                          <CommandGroup heading={`Indisponíveis (${indisp.length})`}>
                                            {indisp.map((m) => (
                                              <CommandItem
                                                key={m.id}
                                                value={nomeExibicao(m.nome)}
                                                onSelect={() => {
                                                  setAddMembroMap((prev) => ({ ...prev, [f.ministerio_id]: m.id }));
                                                  setMembroBuscaOpen((prev) => ({ ...prev, [f.ministerio_id]: false }));
                                                }}
                                                className="text-xs opacity-60"
                                              >
                                                <Check className={`h-3 w-3 mr-1.5 shrink-0 ${selectedMembro === m.id ? "opacity-100" : "opacity-0"}`} />
                                                <span className="flex-1 truncate">{nomeExibicao(m.nome)}</span>
                                                <span className="ml-2 text-[10px] text-amber-600 shrink-0 truncate max-w-[100px]">· {m.motivo}</span>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={!selectedMembro}
                                  onClick={() => {
                                    if (selectedMembro) {
                                      onAtribuir(selectedMembro, f.ministerio_id);
                                      setAddMembroMap((prev) => ({ ...prev, [f.ministerio_id]: "" }));
                                    }
                                  }}
                                >
                                  <UserPlus className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <p className="pl-5 text-xs text-muted-foreground">
                                Nenhum membro vinculado a esta função.
                              </p>
                            )}
                          </>
                        );
                      })()}
                      </div>

                      {/* ── Painel de candidatos sugeridos para esta função ── */}
                      {slotCandidatos[f.ministerio_id] && (
                        <div className="border-t border-border/50 bg-muted/10">
                          <div className="px-3 py-2 space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Candidatos recomendados pelo motor
                            </p>
                            {slotCandidatos[f.ministerio_id].length === 0 ? (
                              <p className="text-xs text-muted-foreground py-1">Nenhum candidato disponível para esta função.</p>
                            ) : (
                              slotCandidatos[f.ministerio_id].map((c) => {
                                const jaAtrib = atribuicoes.some((a) => a.membro_id === c.membro_id && a.ministerio_id === f.ministerio_id);
                                return (
                                  <div
                                    key={c.membro_id}
                                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                                      c.escolhido
                                        ? "bg-primary/8 border border-primary/20"
                                        : "bg-background border border-border/60"
                                    }`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        {c.escolhido && <Star className="h-3 w-3 text-primary shrink-0" />}
                                        <span className="text-xs font-semibold truncate">{nomeExibicao(c.nome)}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] text-muted-foreground">
                                          {c.dias_sem_servir >= 365 ? "Nunca serviu" : `${c.dias_sem_servir}d sem servir`}
                                        </span>
                                        {c.participacoes_30d > 0 && (
                                          <span className="text-[10px] text-muted-foreground">
                                            · {c.participacoes_30d}× no mês
                                          </span>
                                        )}
                                        {c.motivo_exclusao && (
                                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                            · {c.motivo_exclusao}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {/* Mini score bar */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${c.score_final >= 70 ? "bg-green-500" : c.score_final >= 40 ? "bg-amber-400" : "bg-red-400"}`}
                                          style={{ width: `${c.score_final}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right">{Math.round(c.score_final)}</span>
                                      {!jaAtrib && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10"
                                          onClick={() => {
                                            onAtribuir(c.membro_id, f.ministerio_id);
                                            setSlotCandidatos((prev) => { const n = { ...prev }; delete n[f.ministerio_id]; return n; });
                                          }}
                                        >
                                          <UserPlus className="h-3 w-3 mr-0.5" /> Add
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ));
        })()}

        {/* Adicionar função */}
        {ministeriosDisponiveis.length > 0 && (
          <div className="mt-4 flex gap-2">
            <Select value={addMinisterioId} onValueChange={setAddMinisterioId}>
              <SelectTrigger className="flex-1 h-8 text-sm">
                <SelectValue placeholder="Adicionar ministério..." />
              </SelectTrigger>
              <SelectContent>
                {ministeriosDisponiveis.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              max={20}
              value={addQtd}
              onChange={(e) => setAddQtd(e.target.value)}
              className="w-16 h-8 text-center text-sm"
            />
            <Button
              size="sm"
              className="h-8"
              disabled={!addMinisterioId}
              onClick={() => {
                if (addMinisterioId) {
                  onAddFuncao(addMinisterioId, parseInt(addQtd) || 1);
                  setAddMinisterioId("");
                  setAddQtd("1");
                }
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        {suggestedAssignments.length > 0 || generateNotice ? (
          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Sugestões de atribuição</p>
                {generateNotice && <p className="text-sm text-muted-foreground">{generateNotice}</p>}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button size="sm" variant="outline" onClick={handleGenerateSuggestions}>
                  <Sparkles className="h-4 w-4 mr-2" /> Atualizar sugestões
                </Button>
                {/* Salvar Rascunho — persiste no banco com campos de auditoria */}
                <Button
                  size="sm"
                  variant={preview.dirtyPreview ? "default" : "outline"}
                  disabled={suggestedAssignments.length === 0 || salvarRascunhoMutation.isPending}
                  onClick={() => salvarRascunhoMutation.mutate(suggestedAssignments)}
                >
                  {salvarRascunhoMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    : null}
                  {preview.dirtyPreview ? "● Salvar Rascunho" : "Salvar Rascunho"}
                </Button>
                <Button size="sm" disabled={suggestedAssignments.length === 0 || applySuggestionsMutation.isPending} onClick={handleApplySuggestions}>
                  {applySuggestionsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Aplicar sugestões"
                  )}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleClearSuggestions}>
                  Limpar
                </Button>
                {preview.hashDivergiu && (
                  <span className="text-xs text-amber-600 font-medium">
                    ⚠ Dados alterados desde a geração
                  </span>
                )}
              </div>
            </div>
            {suggestedAssignments.length > 0 && (
              <EscalaPreviewPanel
                funcoes={funcoes.map((f) => ({
                  ministerio_id: f.ministerio_id,
                  ministerio_nome: f.ministerio?.nome ?? f.ministerio_id,
                  quantidade: f.quantidade,
                }))}
                sugestoes={suggestedAssignments}
                engineSnapshots={preview.engineSnapshots}
                membrosDisponiveis={(minId) =>
                  membrosClassificadosParaMinisterio(minId).disponiveis.map((m) => ({
                    id: m.id,
                    nome: m.nome,
                  }))
                }
                dirtyPreview={preview.dirtyPreview}
                hashDivergiu={preview.hashDivergiu}
                lastGeneratedAt={preview.lastGeneratedAt}
                isSalvando={salvarRascunhoMutation.isPending}
                onTrocar={(minId, novo) => preview.trocarMembro(minId, novo)}
                onRemover={(minId, memId) => preview.removerDoPreview(minId, memId)}
                onSalvarRascunho={() => salvarRascunhoMutation.mutate(suggestedAssignments)}
                onLimpar={handleClearSuggestions}
              />
            )}

            {/* Painel de insights detalhados */}
            {engineInsights.length > 0 && (
              <div className="border-t border-primary/20 pt-3">
                <button
                  type="button"
                  onClick={() => setShowInsights((v) => !v)}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  {showInsights ? "Ocultar" : "Ver"} diagnóstico do motor
                  <ChevronDown className={`h-3 w-3 transition-transform ${showInsights ? "rotate-180" : ""}`} />
                </button>
                {showInsights && (
                  <div className="mt-3 space-y-3">
                    {engineInsights.map((insight) => (
                      <div key={insight.ministerio_id} className="rounded-lg border border-border/60 bg-background p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide">{insight.ministerio_nome}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {insight.candidatos_avaliados} candidato(s) avaliado(s)
                          </span>
                        </div>
                        {(insight.excluidos.indisponibilidade + insight.excluidos.ja_alocado + insight.excluidos.funcao_nao_pode + insight.excluidos.atuacao + insight.excluidos.dia_semana + insight.excluidos.acima_limite) > 0 && (
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            {insight.excluidos.indisponibilidade > 0 && (
                              <span className="bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                                {insight.excluidos.indisponibilidade} indisponível
                              </span>
                            )}
                            {insight.excluidos.funcao_nao_pode > 0 && (
                              <span className="bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5">
                                {insight.excluidos.funcao_nao_pode} bloqueado pela função
                              </span>
                            )}
                            {insight.excluidos.ja_alocado > 0 && (
                              <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                                {insight.excluidos.ja_alocado} já alocado
                              </span>
                            )}
                            {insight.excluidos.dia_semana > 0 && (
                              <span className="bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
                                {insight.excluidos.dia_semana} restrição de dia
                              </span>
                            )}
                            {insight.excluidos.acima_limite > 0 && (
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                                {insight.excluidos.acima_limite} acima do limite
                              </span>
                            )}
                          </div>
                        )}
                        {insight.top_candidatos.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Top candidatos</p>
                            {insight.top_candidatos.slice(0, 5).map((c) => (
                              <div key={c.membro_id} className={`flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 ${c.escolhido ? "bg-emerald-50 border border-emerald-200" : "bg-muted/40"}`}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {c.escolhido && <span className="text-emerald-600 font-bold shrink-0">✓</span>}
                                  <span className={`truncate ${c.escolhido ? "font-semibold" : "text-muted-foreground"}`}>{c.nome}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                                  <span>{c.dias_sem_servir >= 365 ? "novo" : `${c.dias_sem_servir}d`}</span>
                                  <span>{c.participacoes_30d}×/30d</span>
                                  <span className={`font-bold px-1.5 py-0.5 rounded ${c.escolhido ? "bg-emerald-100 text-emerald-700" : "bg-muted text-foreground"}`}>
                                    {c.score_final}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Equilíbrio de participação dos membros escalados */}
      {atribuicoes.length > 0 && (() => {
        const mesesLabel = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        const hoje = new Date();
        const meses = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1);
          return { key: d.toISOString().slice(0, 7), label: mesesLabel[d.getMonth()] };
        });
        const membrosEscalados = atribuicoes.map((a) => {
          const contagens = meses.map((m) => ({
            ...m,
            count: assignmentHistory.filter((h) => h.memberId === a.membro_id && (h.date ?? "").startsWith(m.key)).length,
          }));
          const max = Math.max(...contagens.map((c) => c.count), 1);
          return { id: a.membro_id, nome: a.membro.nome, contagens, max, total: contagens.reduce((s, c) => s + c.count, 0) };
        }).sort((a, b) => b.total - a.total);

        return (
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition text-left"
              onClick={() => setEquilibrioOpen((v) => !v)}
            >
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Equilíbrio de participação</span>
                <span className="text-xs text-muted-foreground">(6 meses)</span>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${equilibrioOpen ? "rotate-180" : ""}`} />
            </button>
            {equilibrioOpen && (
              <div className="px-4 py-3 space-y-3">
                <p className="text-xs text-muted-foreground">Número de escalações por membro nos últimos 6 meses.</p>
                {membrosEscalados.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{nomeExibicao(m.nome)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{m.total}× total</span>
                    </div>
                    <div className="flex items-end gap-0.5 h-8">
                      {m.contagens.map((c) => (
                        <div key={c.key} className="flex-1 flex flex-col items-center gap-0.5">
                          <div className="w-full rounded-t-sm relative" style={{ height: `${c.count > 0 ? Math.max(4, Math.round((c.count / m.max) * 24)) : 2}px`, background: c.count > 0 ? "hsl(var(--primary))" : "hsl(var(--muted))", opacity: c.count > 0 ? 0.7 + (c.count / m.max) * 0.3 : 1 }} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-0.5">
                      {m.contagens.map((c) => (
                        <div key={c.key} className="flex-1 text-center text-[9px] text-muted-foreground/60">{c.label}</div>
                      ))}
                    </div>
                  </div>
                ))}
                {membrosEscalados.every((m) => m.total === 0) && (
                  <p className="text-xs text-muted-foreground">Nenhum histórico de escalações encontrado.</p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Registrar presenças — visível para escalas de hoje ou passadas */}
      {isPastOrToday && atribuicoes.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition text-left"
            onClick={() => setPresencaOpen((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-emerald-600" />
              <span className="font-semibold text-sm">Registrar presenças</span>
              <span className="text-xs text-muted-foreground">
                ({atribuicoes.filter((a) => (presencaMap[a.id] ?? "pendente") === "presente").length}/{atribuicoes.length} presentes)
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${presencaOpen ? "rotate-180" : ""}`} />
          </button>

          {presencaOpen && (
            <div className="px-4 py-3 space-y-1">
              <p className="text-xs text-muted-foreground mb-3">
                Marque quem compareceu. Pontos são atribuídos automaticamente pelo sistema.
              </p>
              {atribuicoes.map((a) => {
                const status = presencaMap[a.id] ?? "pendente";
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm font-medium truncate">{a.membro.nome}</span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPresencaMap((p) => ({ ...p, [a.id]: p[a.id] === "presente" ? "pendente" : "presente" }))}
                        title="Presente"
                        className={`h-7 w-7 rounded-lg flex items-center justify-center transition ${
                          status === "presente"
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresencaMap((p) => ({ ...p, [a.id]: p[a.id] === "atrasado" ? "pendente" : "atrasado" }))}
                        title="Atrasado"
                        className={`h-7 w-7 rounded-lg flex items-center justify-center transition ${
                          status === "atrasado"
                            ? "bg-orange-500 text-white"
                            : "bg-muted text-muted-foreground hover:bg-orange-100 hover:text-orange-700"
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresencaMap((p) => ({ ...p, [a.id]: p[a.id] === "justificou" ? "pendente" : "justificou" }))}
                        title="Justificou"
                        className={`h-7 w-7 rounded-lg flex items-center justify-center transition ${
                          status === "justificou"
                            ? "bg-blue-500 text-white"
                            : "bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresencaMap((p) => ({ ...p, [a.id]: p[a.id] === "faltou" ? "pendente" : "faltou" }))}
                        title="Faltou"
                        className={`h-7 w-7 rounded-lg flex items-center justify-center transition ${
                          status === "faltou"
                            ? "bg-red-500 text-white"
                            : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"
                        }`}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 border-t border-border mt-2">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={marcarPresencasMutation.isPending}
                  onClick={() => marcarPresencasMutation.mutate()}
                >
                  {marcarPresencasMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Salvar presenças
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ações */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none text-destructive hover:text-destructive border-destructive/30"
          onClick={() => onDelete(escala)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remover
        </Button>
      </div>

      {/* ── Dialog: Debug do Motor ────────────────────────────────────────── */}
      <Dialog open={showDebugMotor} onOpenChange={setShowDebugMotor}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Debug do Motor — {escala.titulo}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 space-y-4 pr-1">

            {/* VERIFICAR 1: contagem */}
            {(() => {
              const comVinculo = new Set(Object.values(membroMinisterios).flat());
              return (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Verificar 1 — Contagem de Membros</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="p-2 bg-background rounded border space-y-0.5">
                      <div className="text-lg font-bold">{membros.length}</div>
                      <div className="text-[10px] text-muted-foreground">Total ativos</div>
                    </div>
                    <div className={`p-2 rounded border space-y-0.5 ${comVinculo.size > 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                      <div className={`text-lg font-bold ${comVinculo.size > 0 ? "text-emerald-700" : "text-red-700"}`}>{comVinculo.size}</div>
                      <div className="text-[10px] text-muted-foreground">Com vínculo</div>
                    </div>
                    <div className={`p-2 rounded border space-y-0.5 ${membros.length - comVinculo.size > 0 ? "bg-amber-50 border-amber-200" : "bg-background"}`}>
                      <div className={`text-lg font-bold ${membros.length - comVinculo.size > 0 ? "text-amber-700" : ""}`}>{membros.length - comVinculo.size}</div>
                      <div className="text-[10px] text-muted-foreground">Sem vínculo</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* VERIFICAR 2: por membro */}
            {(() => {
              const membroParaMin: Record<string, string[]> = {};
              for (const [minId, mids] of Object.entries(membroMinisterios)) {
                for (const mid of mids) {
                  if (!membroParaMin[mid]) membroParaMin[mid] = [];
                  membroParaMin[mid].push(minId);
                }
              }
              return (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Verificar 2 — Funções por Membro</p>
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {membros.map((m) => {
                      const fIds = membroParaMin[m.id] ?? [];
                      const fNomes = fIds.map((fid) => ministerios.find((mn) => mn.id === fid)?.nome ?? `[${fid.slice(0, 8)}...]`);
                      return (
                        <div key={m.id} className={`flex items-start gap-2 text-xs p-1.5 rounded ${fIds.length === 0 ? "bg-red-50 border border-red-200" : "bg-background border"}`}>
                          <span className="font-medium min-w-0 flex-1 truncate">{m.nome}</span>
                          {fIds.length === 0
                            ? <span className="text-red-600 font-semibold shrink-0">❌ SEM FUNÇÕES</span>
                            : <span className="text-emerald-700 text-right shrink-0 max-w-[55%] truncate" title={fNomes.join(", ")}>{fNomes.join(", ")}</span>
                          }
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* VERIFICAR 5: compatibilidade de IDs */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Verificar 5 — Compatibilidade de IDs</p>
              <div className="space-y-1">
                {funcoes.map((f) => {
                  const cnt = (membroMinisterios[f.ministerio_id] ?? []).length;
                  return (
                    <div key={f.ministerio_id} className={`flex items-center gap-2 text-xs p-2 rounded border ${cnt === 0 ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
                      <span className={`font-semibold shrink-0 ${cnt === 0 ? "text-red-700" : "text-emerald-700"}`}>{cnt === 0 ? "❌" : "✓"}</span>
                      <span className="font-medium flex-1 truncate">{f.ministerio.nome}</span>
                      <span className="text-muted-foreground font-mono text-[10px] hidden sm:block">{f.ministerio_id.slice(0, 12)}…</span>
                      <span className={`font-bold shrink-0 ${cnt === 0 ? "text-red-700" : "text-emerald-700"}`}>{cnt} membro(s)</span>
                    </div>
                  );
                })}
              </div>
              {funcoes.every((f) => (membroMinisterios[f.ministerio_id] ?? []).length === 0) && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-1">
                  ❌ Nenhuma função da escala tem membros mapeados em <code>membro_ministerios</code>.
                  Verifique se os membros foram vinculados às funções em <strong>Membros → editar → Funções Litúrgicas</strong>.
                </p>
              )}
            </div>

            {/* VERIFICAR 3 & 4: pipeline por função (insights do motor) */}
            {debugInsights.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Verificar 3 & 4 — Pipeline por Função</p>
                {debugInsights.map((ins) => (
                  <div key={ins.ministerio_id} className="rounded border bg-background p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{ins.ministerio_nome}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ins.alocados === 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {ins.alocados}/{ins.solicitados} alocados
                      </span>
                    </div>

                    {/* Funil de eliminação */}
                    <div className="space-y-1 text-[11px]">
                      <div className="flex items-center justify-between bg-muted/50 rounded px-2 py-1">
                        <span className="text-muted-foreground">Total membros ativos</span>
                        <span className="font-bold">{membros.length}</span>
                      </div>
                      <div className={`flex items-center justify-between rounded px-2 py-1 ${(ins.excluidos as any).sem_vinculo > 0 ? "bg-red-50 text-red-800" : "bg-muted/30"}`}>
                        <span>❌ Sem vínculo (membro_ministerios)</span>
                        <span className="font-bold">−{(ins.excluidos as any).sem_vinculo ?? 0}</span>
                      </div>
                      {ins.excluidos.funcao_nao_pode > 0 && (
                        <div className="flex items-center justify-between bg-orange-50 text-orange-800 rounded px-2 py-1">
                          <span>⛔ Restrição "não pode"</span>
                          <span className="font-bold">−{ins.excluidos.funcao_nao_pode}</span>
                        </div>
                      )}
                      {ins.excluidos.atuacao > 0 && (
                        <div className="flex items-center justify-between bg-purple-50 text-purple-800 rounded px-2 py-1">
                          <span>📋 Atuação exigida não atendida</span>
                          <span className="font-bold">−{ins.excluidos.atuacao}</span>
                        </div>
                      )}
                      {ins.excluidos.ja_alocado > 0 && (
                        <div className="flex items-center justify-between bg-blue-50 text-blue-800 rounded px-2 py-1">
                          <span>🔁 Já alocado em outra função</span>
                          <span className="font-bold">−{ins.excluidos.ja_alocado}</span>
                        </div>
                      )}
                      {ins.excluidos.indisponibilidade > 0 && (
                        <div className="flex items-center justify-between bg-amber-50 text-amber-800 rounded px-2 py-1">
                          <span>📅 Indisponível nesta data</span>
                          <span className="font-bold">−{ins.excluidos.indisponibilidade}</span>
                        </div>
                      )}
                      {ins.excluidos.dia_semana > 0 && (
                        <div className="flex items-center justify-between bg-amber-50 text-amber-800 rounded px-2 py-1">
                          <span>📆 Restrição de dia da semana</span>
                          <span className="font-bold">−{ins.excluidos.dia_semana}</span>
                        </div>
                      )}
                      <div className={`flex items-center justify-between rounded px-2 py-1 border font-semibold ${ins.candidatos_avaliados === 0 ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
                        <span>✅ Candidatos elegíveis</span>
                        <span>{ins.candidatos_avaliados}</span>
                      </div>
                    </div>

                    {ins.motivo_vazio && (
                      <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">
                        ❌ Motivo vazio: {ins.motivo_vazio}
                      </div>
                    )}

                    {ins.top_candidatos.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Candidatos encontrados:</p>
                        {ins.top_candidatos.map((c) => (
                          <div key={c.membro_id} className={`flex items-center justify-between text-[11px] rounded px-2 py-1 ${c.escolhido ? "bg-emerald-50 border border-emerald-200" : "bg-muted/40"}`}>
                            <span className={c.escolhido ? "font-semibold" : "text-muted-foreground"}>{c.nome} {c.escolhido ? "✓ (selecionado)" : ""}</span>
                            <span className="text-muted-foreground">score {c.score_final} · {c.dias_sem_servir >= 365 ? "novo" : `${c.dias_sem_servir}d`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {debugInsights.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Clique em "Debug do Motor" novamente para executar a análise do pipeline.
              </p>
            )}

          </div>

          <DialogFooter className="shrink-0 mt-3">
            <Button variant="outline" size="sm" onClick={() => setShowDebugMotor(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmar cancelamento da escala ────────────────────────────────── */}
      {confirmarCancelamento && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setConfirmarCancelamento(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar escala?</AlertDialogTitle>
              <AlertDialogDescription>
                Todos os membros atribuídos serão notificados por e-mail e notificação no app. Esta ação não pode ser desfeita automaticamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmarCancelamento(false)}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => { setConfirmarCancelamento(false); onStatusChange("cancelada"); }}
              >
                Cancelar escala
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ── Remover membro da escala ─────────────────────────────────────────── */}
      {removerPendente && (
        <AlertDialog
          open
          onOpenChange={(o) => {
            if (!o) { setRemoverPendente(null); setMotivoRemocao(""); setPenalidade("nenhuma"); }
          }}
        >
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {escala.status === "publicada" ? "Remover da escala publicada?" : `Remover ${removerPendente.membroNome}?`}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  <strong>{removerPendente.membroNome}</strong> será retirado(a) da função{" "}
                  <strong>{removerPendente.ministerioNome}</strong> nesta escala.
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            {escala.status === "publicada" ? (
              <div className="space-y-4 py-2">
                {/* Motivo */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Motivo (opcional)</p>
                  <textarea
                    value={motivoRemocao}
                    onChange={(e) => setMotivoRemocao(e.target.value)}
                    placeholder="Ex: imprevisto de saúde, viagem..."
                    rows={2}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Abrir vaga */}
                <div
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${abrirVagaChecked ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"}`}
                  onClick={() => setAbrirVagaChecked(!abrirVagaChecked)}
                >
                  <div className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${abrirVagaChecked ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                    {abrirVagaChecked && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-none">Abrir vaga para substituição</p>
                    <p className="text-xs text-muted-foreground mt-1">A vaga ficará visível na aba Substituições para acompanhamento</p>
                  </div>
                </div>

                {/* Penalidade de pontos */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Penalidade de pontos</p>
                  {([
                    { value: "nenhuma",   label: "Nenhuma penalidade",              badge: null },
                    { value: "justificou", label: "Justificou com antecedência",     badge: { text: "0 pts",  cls: "text-muted-foreground" } },
                    { value: "faltou",    label: "Cancelamento em cima da hora",    badge: { text: "−pts",  cls: "text-red-500 font-semibold" } },
                  ] as const).map(({ value, label, badge }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2.5 cursor-pointer py-1"
                      onClick={() => setPenalidade(value)}
                    >
                      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${penalidade === value ? "border-primary" : "border-muted-foreground/40"}`}>
                        {penalidade === value && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm flex-1">{label}</span>
                      {badge && <span className={`text-xs ${badge.cls}`}>{badge.text}</span>}
                    </label>
                  ))}
                </div>

                {/* Notificar vaga */}
                {abrirVagaChecked && (
                  <div className="flex items-center gap-2.5 pt-1">
                    <input
                      id="notif-vaga-check-pub"
                      type="checkbox"
                      checked={notificarVaga}
                      onChange={(e) => setNotificarVaga(e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-primary shrink-0"
                    />
                    <label htmlFor="notif-vaga-check-pub" className="text-xs cursor-pointer text-muted-foreground">
                      Notificar membros disponíveis para <strong className="text-foreground">{removerPendente.ministerioNome}</strong>
                    </label>
                  </div>
                )}
              </div>
            ) : (
              /* Escala em rascunho: dialog simples */
              <div className="flex items-center gap-2 pb-2">
                <input
                  id="notif-vaga-check"
                  type="checkbox"
                  checked={notificarVaga}
                  onChange={(e) => setNotificarVaga(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <label htmlFor="notif-vaga-check" className="text-sm cursor-pointer">
                  Notificar membros disponíveis para <strong>{removerPendente.ministerioNome}</strong>
                </label>
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className={escala.status === "publicada" && abrirVagaChecked ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-destructive text-white hover:bg-destructive/90"}
                onClick={() => {
                  if (!removerPendente) return;
                  if (escala.status === "publicada") {
                    onRemoverPublicada({
                      atribId: removerPendente.atribId,
                      membroId: removerPendente.membroId,
                      motivo: motivoRemocao,
                      abrirVaga: abrirVagaChecked,
                      penalidade,
                    });
                    if (abrirVagaChecked && notificarVaga) {
                      onNotificarVaga({
                        escalaId: escala.id,
                        ministerioId: removerPendente.ministerioId,
                        ministerioNome: removerPendente.ministerioNome,
                      });
                    }
                  } else {
                    onRemoverAtribuicao(removerPendente.atribId);
                    if (notificarVaga) {
                      onNotificarVaga({
                        escalaId: escala.id,
                        ministerioId: removerPendente.ministerioId,
                        ministerioNome: removerPendente.ministerioNome,
                      });
                    }
                  }
                  setRemoverPendente(null);
                  setMotivoRemocao("");
                  setPenalidade("nenhuma");
                }}
              >
                {escala.status === "publicada" && abrirVagaChecked ? "Abrir vaga" : "Remover"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ── Confirmar publicação ──────────────────────────────────────────── */}
      {/* Invariante: o que o coordenador vê na tela é exatamente o que é publicado.
          Se há preview não salvo, sempre salvamos antes de publicar. Nunca existe
          "Publicar sem salvar" — essa opção cria divergência entre tela e banco. */}
      <AlertDialog open={confirmarPublicar} onOpenChange={setConfirmarPublicar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preview.suggestedAssignments.length > 0
                ? "Salvar e publicar escala?"
                : "Publicar escala?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{vagasAbertasInfo}</p>
                {/* Preview com membros não persistidos → avisa e salva antes de publicar */}
                {preview.suggestedAssignments.length > 0 && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-700 dark:text-amber-400">
                    O preview tem membros não salvos no banco. Eles serão <strong>salvos automaticamente</strong> antes da
                    publicação para garantir que o que você vê é o que será publicado.
                  </p>
                )}
                {/* Escala com funções definidas mas sem membros atribuídos */}
                {funcoes.length > 0 && atribuicoes.length === 0 && preview.suggestedAssignments.length === 0 && (
                  <p className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-700 dark:text-red-400 font-medium">
                    ⚠️ Esta escala não tem nenhum membro atribuído. Gere sugestões com o motor ou atribua membros manualmente antes de publicar.
                  </p>
                )}
                <p>
                  Membros escalados serão notificados por e-mail e notificação no app.
                  Esta ação pode ser revertida arquivando a escala.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={async () => {
                // 1. Salva preview do motor PRIMEIRO se tiver mudanças não salvas
                // (salvarRascunho faz DELETE+INSERT — precisa rodar antes de pendingChanges)
                if (preview.dirtyPreview && preview.suggestedAssignments.length > 0) {
                  try {
                    await salvarRascunhoMutation.mutateAsync(preview.suggestedAssignments);
                  } catch {
                    return;
                  }
                }
                // 2. Aplica mudanças manuais pendentes POR CIMA do estado atual do banco
                if (hasPendingMemberChanges) {
                  try {
                    await onApplyPendingMemberChanges();
                  } catch {
                    return;
                  }
                }
                onStatusChange("publicada");
              }}
            >
              <Send className="h-3 w-3 mr-2" />
              {preview.suggestedAssignments.length > 0
                ? "Salvar e publicar"
                : "Publicar e notificar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── SacristiaTab ──────────────────────────────────────────────────────────────

type MembroEscalaS = {
  id: string;
  membro_id: string;
  ministerio_id: string;
  escala_id: string;
  status: string;
  membro: { id: string; nome: string; telefone: string | null };
  ministerio: { id: string; nome: string; cor: string };
};

type EscalaHojeS = {
  id: string;
  titulo: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  solene: boolean;
  status: string;
};

function SacristiaTab({ paroquiaId }: { paroquiaId: string }) {
  const qc = useQueryClient();
  const hojeStr = format(new Date(), "yyyy-MM-dd");
  const [presencaMap, setPresencaMap] = useState<Record<string, "presente" | "faltou" | "pendente">>({});
  const [savingEscalaId, setSavingEscalaId] = useState<string | null>(null);

  const { data: escalasHoje = [], isLoading } = useQuery<EscalaHojeS[]>({
    queryKey: ["sacristia-escalas", paroquiaId, hojeStr],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data } = await supabase
        .from("escalas")
        .select("id, titulo, hora_inicio, hora_fim, local, solene, status")
        .eq("paroquia_id", paroquiaId)
        .eq("data", hojeStr)
        .neq("status", "arquivada")
        .order("hora_inicio");
      return (data ?? []) as EscalaHojeS[];
    },
  });

  const escalaIds = useMemo(() => escalasHoje.map((e) => e.id), [escalasHoje]);

  const { data: membrosEscala = [], isLoading: isLoadingMembros } = useQuery<MembroEscalaS[]>({
    queryKey: ["sacristia-membros", escalaIds],
    enabled: escalaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("escala_membros")
        .select("id, membro_id, ministerio_id, escala_id, status, membros!membro_id(id, nome, telefone), ministerios(id, nome, cor)")
        .in("escala_id", escalaIds);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        membro: r.membros,
        ministerio: r.ministerios,
      })) as MembroEscalaS[];
    },
  });

  const salvarPresencasMutation = useMutation({
    mutationFn: async (escalaId: string) => {
      const membrosDestaEscala = membrosEscala.filter((m: any) => m.escala_id === escalaId);
      if (membrosDestaEscala.length === 0) return;
      const updates = membrosDestaEscala.map((m: MembroEscalaS) => ({
        id: m.id,
        status: presencaMap[m.id] ?? "pendente",
      }));
      const { error } = await supabase.rpc("salvar_presencas_escala", {
        p_escala_id: escalaId,
        p_updates: updates,
      });
      if (error) throw error;
    },
    onMutate: (escalaId) => setSavingEscalaId(escalaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sacristia-membros"] });
      qc.invalidateQueries({ queryKey: ["escala-membros"] });
      qc.invalidateQueries({ queryKey: ["escala-historico"] });
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Presenças salvas.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
    onSettled: () => setSavingEscalaId(null),
  });

  function togglePresenca(id: string, status: "presente" | "faltou") {
    setPresencaMap((prev) => ({
      ...prev,
      [id]: prev[id] === status ? "pendente" : status,
    }));
  }

  const loading = isLoading || isLoadingMembros;

  return (
    <div className="mt-6 max-w-2xl mx-auto space-y-5 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Hoje</p>
          <p className="mt-0.5 text-sm font-medium capitalize text-foreground">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Church className="h-4 w-4 text-primary" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <div className="space-y-2 mt-4">
                {[1, 2, 3].map((j) => <Skeleton key={j} className="h-10 w-full rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : escalasHoje.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma escala publicada para hoje.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {escalasHoje.map((escala) => {
            const membros = membrosEscala.filter((m: any) => m.escala_id === escala.id);
            const presentes = membros.filter((m: MembroEscalaS) => (presencaMap[m.id] ?? "pendente") === "presente").length;
            const isSaving = savingEscalaId === escala.id;

            const grupos: { ministerio: { id: string; nome: string; cor: string }; membros: MembroEscalaS[] }[] = [];
            membros.forEach((m: MembroEscalaS) => {
              const g = grupos.find((x) => x.ministerio.id === m.ministerio.id);
              if (g) g.membros.push(m);
              else grupos.push({ ministerio: m.ministerio, membros: [m] });
            });

            return (
              <div key={escala.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-border bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-base truncate">{escala.titulo}</h2>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {escala.hora_inicio && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {escala.hora_inicio.slice(0, 5)}{escala.hora_fim ? `–${escala.hora_fim.slice(0, 5)}` : ""}
                          </span>
                        )}
                        {escala.local && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{escala.local}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {presentes}/{membros.length} presentes
                        </span>
                      </div>
                    </div>
                    {escala.solene && (
                      <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px] shrink-0">
                        Solene
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {membros.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum membro atribuído.</p>
                  ) : (
                    grupos.map((grupo) => (
                      <div key={grupo.ministerio.id}>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: grupo.ministerio.cor }}>
                          {grupo.ministerio.nome}
                        </p>
                        <div className="space-y-2">
                          {grupo.membros.map((m) => {
                            const status = presencaMap[m.id] ?? "pendente";
                            return (
                              <div
                                key={m.id}
                                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border transition-all ${
                                  status === "presente"
                                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                                    : status === "faltou"
                                    ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                                    : "border-border bg-background"
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate">{m.membro.nome}</p>
                                  {m.membro.telefone && (
                                    <p className="text-[11px] text-muted-foreground">{m.membro.telefone}</p>
                                  )}
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "presente")}
                                    title="Presente"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${status === "presente" ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"}`}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "faltou")}
                                    title="Faltou"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${status === "faltou" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"}`}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                  {membros.length > 0 && (
                    <Button
                      className="w-full mt-2"
                      disabled={isSaving}
                      onClick={() => salvarPresencasMutation.mutate(escala.id)}
                    >
                      {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Salvar presenças
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
