import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  Plus, Loader2, Calendar, List, ChevronLeft, ChevronRight, ChevronDown,
  MapPin, Clock, Trash2, Pencil, UserPlus, X, Check, Sparkles,
  MoreVertical, FileText, AlertTriangle, Users, ClipboardCheck,
  CheckCircle2, XCircle, Church, History,
} from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  generateEscalaAssignments,
  generateEscalaWithAlertas,
  type AssignmentHistoryEntry,
  type FuncaoRestricao,
} from "@/lib/escala-engine";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/_authenticated/escalas")({
  validateSearch: (search: Record<string, unknown>): { abrir?: string } => ({
    abrir: typeof search.abrir === "string" ? search.abrir : undefined,
  }),
  component: EscalasPage,
  head: () => ({ meta: [{ title: "Escalas — Lumen Pastoral" }] }),
});

import { nomeExibicao } from "@/lib/nome";

// ── Tipos ────────────────────────────────────────────────────────────────────

type Ministerio = { id: string; nome: string; cor: string; categoria?: string | null };
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
  rascunho: { label: "Rascunho", variant: "secondary" },
  publicada: { label: "Publicada", variant: "default" },
  arquivada: { label: "Arquivada", variant: "outline" },
};

type FuncaoPreview = {
  ministerio_id: string;
  nome: string;
  cor: string;
  categoria?: string | null;
  quantidade: number;
  membros: { id: string; nome: string }[];
};
type EscalaPreview = { needed: number; filled: number; funcoes: FuncaoPreview[] };

// ── Componente principal ─────────────────────────────────────────────────────

function EscalasPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { abrir } = Route.useSearch();

  const [view, setView] = useState<"lista" | "calendario" | "sacristia" | "historico">("lista");
  const [calMonth, setCalMonth] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [detailEscala, setDetailEscala] = useState<Escala | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Escala | null>(null);
  const [autoArchiveTriggered, setAutoArchiveTriggered] = useState(false);
  const [selectedEscalaIds, setSelectedEscalaIds] = useState<Set<string>>(new Set());
  const [bulkDeleteEscalasOpen, setBulkDeleteEscalasOpen] = useState(false);
  const [gerarPeriodoOpen, setGerarPeriodoOpen] = useState(false);
  const [gerarInicio, setGerarInicio] = useState(() => format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [gerarFim, setGerarFim] = useState(() => format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const [reorganizarOpen, setReorganizarOpen] = useState(false);
  const [reorganizarEscalaId, setReorganizarEscalaId] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: escalas = [], isLoading } = useQuery({
    queryKey: ["escalas", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio, hora_fim, local, tipo, tipo_missa_id, status, observacoes, solene, tem_adoracao, tem_bispo, token_publico")
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
        .select("id, escala_id, ministerio_id, quantidade, ministerios(id, nome, cor, categoria)")
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
        .select("id, membro_id, ministerio_id, status, membros(id, nome, telefone)")
        .eq("escala_id", detailEscala!.id);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        membro: r.membros,
      })) as EscalaMembro[];
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

  const { data: assignmentHistory = [] } = useQuery<AssignmentHistoryEntry[]>({
    queryKey: ["escala-historico", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const sixMonthsAgo = format(subMonths(new Date(), 6), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("escalas")
        .select("id, data, escala_membros(membro_id, ministerio_id)")
        .eq("paroquia_id", profile!.paroquia_id!)
        .gte("data", sixMonthsAgo);

      if (error || !data) return [];

      return (data as any[]).flatMap((escala) =>
        (escala.escala_membros ?? []).map((entry: any) => ({
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

  const { data: indisponibilidades = [] } = useQuery<{ membro_id: string; data: string }[]>({
    queryKey: ["indisponibilidades", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("indisponibilidades")
        .select("membro_id, data")
        .eq("paroquia_id", profile!.paroquia_id!);
      return (data ?? []) as { membro_id: string; data: string }[];
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

          // ── VALIDAÇÃO PREVENTIVA: Verificar se há membros com vínculos ───
          const minIds = (tipoFuncoes as any[]).map((f) => f.ministerio_id as string);
          const membrosComVinculo = minIds.some((mid) => (membroMinisterios[mid] ?? []).length > 0);
          
          if (!membrosComVinculo) {
            return { autoSugestoes: 0 };
          }

          // Auto-distribuição: rodar o motor e inserir sugestões como "pendente"
          // ── Enriquecer membros com dados adicionais para o motor ───────────
          const membrosComAtuacoes = membros.map((m) => ({
            ...m,
            atuacao_ids: membroAtuacoes[m.id] ?? [],
          }));

          const funcoesPedido = (tipoFuncoes as { ministerio_id: string; quantidade_min: number }[])
            .map((tf) => {
              const min = ministerios.find((m) => m.id === tf.ministerio_id);
              return {
                ministerio_id: tf.ministerio_id,
                quantidade: tf.quantidade_min,
                ministerio: { id: tf.ministerio_id, nome: min?.nome ?? "", cor: min?.cor },
              };
            });

          const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
          const engineConfig = {
            usa_tochas: paroquiaConfig?.usa_tochas ?? false,
            limite_semanal: (regras.limite_semanal as number | undefined) ?? undefined,
            limite_mensal: (regras.limite_mensal as number | undefined) ?? undefined,
            impedir_repeticao_seguida: (regras.impedir_repeticao_consecutiva as boolean | undefined) ?? true,
            prioridade_score: (regras.prioridade_score as boolean | undefined) ?? false,
          };

          const sugestoes = generateEscalaAssignments(
            { titulo: form.titulo, data: form.data, tipo: form.tipo || "missa", observacoes: form.observacoes || null },
            funcoesPedido,
            membrosComAtuacoes,
            membroMinisterios,
            {
              history: assignmentHistory,
              indisponibilidades,
              restricoes: funcaoRestricoes,
              config: engineConfig,
              solene: form.solene,
              tem_adoracao: form.tem_adoracao,
              tem_bispo: form.tem_bispo,
              debug: true,
            }
          );

          if (sugestoes.length > 0) {
            const { error: insertErr } = await anyDb.from("escala_membros").insert(
              sugestoes.map((s) => ({
                escala_id: nova.id,
                membro_id: s.membro_id,
                ministerio_id: s.ministerio_id,
                status: "pendente",
              }))
            );
            if (insertErr) {
              console.error("[ESCALA] Erro ao inserir membros auto:", insertErr);
            } else {
              autoSugestoes = sugestoes.length;
            }
          } else {
            // sem sugestões: membros sem vínculo — nenhuma ação necessária aqui
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
      } else if (autoSugestoes > 0) {
        toast.success(`Escala criada com ${autoSugestoes} membro(s) sugerido(s) automaticamente.`);
      } else {
        toast.success("Escala criada.");
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
      const membro = membros.find((m) => m.id === membro_id);
      const min = ministerios.find((m) => m.id === ministerio_id);
      if (membro?.email && detailEscala) {
        supabase.functions.invoke("send-email", {
          body: {
            template: "escala_atribuida",
            to: membro.email,
            nome: membro.nome,
            paroquia: paroquiaNome,
            escalaTitulo: detailEscala.titulo,
            escalaData: detailEscala.data,
            ministerioNome: min?.nome ?? "",
          },
        });
      }
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const removerAtribuicaoMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("escala_membros").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchAtribuicoes();
      // Sincroniza com portal do membro
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("escalas").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      // Sincroniza com portal do membro quando status é alterado
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      setDetailEscala((prev) => prev ? { ...prev, status: vars.status } : prev);
      toast.success("Status da escala atualizado.");
    },
  });

  const bulkUpdateStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const { error } = await supabase.from("escalas").update({ status }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, { ids, status }) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      // Sincroniza com portal do membro quando múltiplas escalas mudam status
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      setSelectedEscalaIds(new Set());
      toast.success(`${ids.length} escala(s) ${status === "publicada" ? "publicada(s)" : "arquivada(s)"}.`);
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  const reorganizarMutation = useMutation({
    mutationFn: async (escalaId: string) => {
      const escala = escalas.find((e) => e.id === escalaId);
      if (!escala) throw new Error("Escala não encontrada.");

      const { data: funcoesData } = await (supabase as any)
        .from("escala_funcoes")
        .select("ministerio_id, quantidade, ministerios(id, nome, cor)")
        .eq("escala_id", escalaId);

      if (!funcoesData || funcoesData.length === 0)
        throw new Error("Escala sem funções definidas. Adicione funções em Personalização → Tipos de Missa ou manualmente nesta escala.");

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
        ministerio_id: f.ministerio_id,
        quantidade: f.quantidade,
        ministerio: { id: f.ministerio_id, nome: f.ministerios?.nome ?? "", cor: f.ministerios?.cor },
      }));

      const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
      const engineConfig = {
        usa_tochas: paroquiaConfig?.usa_tochas ?? false,
        limite_semanal: (regras.limite_semanal as number | undefined) ?? undefined,
        limite_mensal: (regras.limite_mensal as number | undefined) ?? undefined,
        impedir_repeticao_seguida: (regras.impedir_repeticao_consecutiva as boolean | undefined) ?? true,
      };

      const membrosComAtuacoes = membros.map((m) => ({
        ...m,
        atuacao_ids: membroAtuacoes[m.id] ?? [],
      }));

      const resultado = generateEscalaWithAlertas(
        { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
        funcoesPedido,
        membrosComAtuacoes,
        membroMinisterios,
        {
          history: assignmentHistory.filter((h) => h.date !== escala.data),
          indisponibilidades,
          restricoes: funcaoRestricoes,
          config: engineConfig,
          solene: escala.solene,
          tem_adoracao: escala.tem_adoracao,
          tem_bispo: escala.tem_bispo,
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
      const { error } = await supabase
        .from("escalas")
        .update({ status: "arquivada" })
        .eq("paroquia_id", profile!.paroquia_id!)
        .lt("data", today)
        .not("status", "eq", "arquivada");
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

  const gerarSemanaRapidaMutation = useMutation({
    mutationFn: async ({ dataInicio, dataFim }: { dataInicio: string; dataFim: string }) => {
      if (!profile?.paroquia_id) throw new Error("Paróquia não identificada.");
      if (missasPadrao.length === 0) throw new Error("Nenhuma Missa Padrão cadastrada em Personalização → Missas Padrão.");

      const startDate = new Date(dataInicio + "T00:00:00");
      const endDate = new Date(dataFim + "T00:00:00");

      const created: string[] = [];
      const skipped: string[] = [];
      let totalSugestoes = 0;

      // Acumula atribuições feitas neste batch para que o motor as considere
      // nas escalas seguintes (limites semanais / anti-repetição imediata)
      const batchHistory: AssignmentHistoryEntry[] = [];

      for (const missa of missasPadrao) {
        // Collect all dates in range matching this missa's dia_semana
        const datesForMissa: Date[] = [];
        const cur = new Date(startDate);
        while (cur <= endDate) {
          if (cur.getDay() === missa.dia_semana) datesForMissa.push(new Date(cur));
          cur.setDate(cur.getDate() + 1);
        }

        for (const targetDate of datesForMissa) {
          const dateStr = format(targetDate, "yyyy-MM-dd");

          // Verificar recorrência
          const recorrencia = missa.recorrencia ?? { tipo: "semanal" };
          if (recorrencia.tipo !== "semanal") {
            const weekOfMonth = Math.ceil(targetDate.getDate() / 7);
            const isLast = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate() - targetDate.getDate() < 7;
            const passes = (
              recorrencia.tipo === "quinzenal"     ? [1, 3].includes(weekOfMonth) :
              recorrencia.tipo === "quinzenal_1_3" ? [1, 3].includes(weekOfMonth) :
              recorrencia.tipo === "quinzenal_2_4" ? [2, 4].includes(weekOfMonth) :
              recorrencia.tipo === "mensal_1"      ? weekOfMonth === 1 :
              recorrencia.tipo === "mensal_2"      ? weekOfMonth === 2 :
              recorrencia.tipo === "mensal_3"      ? weekOfMonth === 3 :
              recorrencia.tipo === "mensal_4"      ? weekOfMonth === 4 :
              recorrencia.tipo === "mensal_ultimo" ? isLast :
              recorrencia.tipo === "esporadico"    ? false :
              true
            );
            if (!passes) { skipped.push(missa.nome); continue; }
          }

          // Verificar se escala já existe nessa data para esta missa específica.
          // Usa match exato (título + local) para não confundir duas missas no
          // mesmo dia com nomes similares mas comunidades distintas.
          const tituloGerado = `${missa.nome} — ${format(targetDate, "dd/MM", { locale: ptBR })}`;
          let existingQuery = (supabase as any)
            .from("escalas")
            .select("id")
            .eq("paroquia_id", profile.paroquia_id!)
            .eq("data", dateStr)
            .eq("titulo", tituloGerado);
          if (missa.local) existingQuery = existingQuery.eq("local", missa.local);
          const { data: existing } = await existingQuery.limit(1);

          if (existing && existing.length > 0) { skipped.push(missa.nome); continue; }

          // Criar escala — tituloGerado já calculado acima para o check de duplicata
          const { data: newEscala, error } = await (supabase as any).from("escalas").insert({
            paroquia_id: profile.paroquia_id!,
            titulo: tituloGerado,
            data: dateStr,
            hora_inicio: missa.hora_inicio,
            local: missa.local,
            tipo: missa.tipo_missa_id ? "tipo_missa" : "missa",
            tipo_missa_id: missa.tipo_missa_id,
            solene: missa.solene,
            tem_adoracao: missa.tem_adoracao,
            tem_bispo: missa.tem_bispo,
            status: "rascunho",
            created_by: profile.id,
          }).select("id").single();

          if (error || !newEscala) continue;
          created.push(missa.nome);

          // Determinar funções a injetar
          type FuncaoInjetar = { ministerio_id: string; quantidade_min: number };
          let funcoesParaInjetar: FuncaoInjetar[] = [];

          if (missa.tipo_missa_id) {
            const { data: tipoFuncoes } = await (supabase as any)
              .from("tipo_missa_funcoes")
              .select("ministerio_id, quantidade_min")
              .eq("tipo_missa_id", missa.tipo_missa_id)
              .eq("tipo_vinculo", "obrigatoria");
            funcoesParaInjetar = (tipoFuncoes ?? []) as FuncaoInjetar[];
          } else {
            const { data: padFuncoes } = await (supabase as any)
              .from("missa_padrao_funcoes")
              .select("ministerio_id, quantidade")
              .eq("missa_padrao_id", missa.id);
            funcoesParaInjetar = ((padFuncoes ?? []) as { ministerio_id: string; quantidade: number }[])
              .map((pf) => ({ ministerio_id: pf.ministerio_id, quantidade_min: pf.quantidade }));
          }

          if (funcoesParaInjetar.length > 0) {
            await (supabase as any).from("escala_funcoes").insert(
              funcoesParaInjetar.map((tf) => ({
                escala_id: newEscala.id,
                ministerio_id: tf.ministerio_id,
                quantidade: tf.quantidade_min,
              }))
            );

            if (membros.length > 0) {
              const funcoesPedido = funcoesParaInjetar.map((tf) => {
                const min = ministerios.find((m) => m.id === tf.ministerio_id);
                return {
                  ministerio_id: tf.ministerio_id,
                  quantidade: tf.quantidade_min,
                  ministerio: { id: tf.ministerio_id, nome: min?.nome ?? "", cor: min?.cor },
                };
              });

              const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
              const engineConfig = {
                usa_tochas: paroquiaConfig?.usa_tochas ?? false,
                limite_semanal: (regras.limite_semanal as number | undefined) ?? undefined,
                limite_mensal: (regras.limite_mensal as number | undefined) ?? undefined,
                impedir_repeticao_seguida: (regras.impedir_repeticao_consecutiva as boolean | undefined) ?? true,
            prioridade_score: (regras.prioridade_score as boolean | undefined) ?? false,
              };

              // Membros restritos para esta missa específica → indisponíveis nesta data
              const missaRestricaoIndisp = (membroMissaRestricoes[missa.id] ?? [])
                .map((mid) => ({ membro_id: mid, data: dateStr }));

              const membrosComAtuacoes = membros.map((m) => ({
                ...m,
                atuacao_ids: membroAtuacoes[m.id] ?? [],
              }));

              const sugestoes = generateEscalaAssignments(
                { titulo: `${missa.nome} — ${format(targetDate, "dd/MM", { locale: ptBR })}`, data: dateStr, tipo: missa.tipo_missa_id ? "tipo_missa" : "missa", observacoes: null },
                funcoesPedido,
                membrosComAtuacoes,
                membroMinisterios,
                {
                  history: [...assignmentHistory, ...batchHistory],
                  indisponibilidades: [...indisponibilidades, ...missaRestricaoIndisp],
                  restricoes: funcaoRestricoes,
                  config: engineConfig,
                  solene: missa.solene,
                  tem_adoracao: missa.tem_adoracao,
                  tem_bispo: missa.tem_bispo,
                  debug: false,
                }
              );

              if (sugestoes.length > 0) {
                const { error: batchInsertErr } = await (supabase as any).from("escala_membros").insert(
                  sugestoes.map((s) => ({
                    escala_id: newEscala.id,
                    membro_id: s.membro_id,
                    ministerio_id: s.ministerio_id,
                    status: "pendente",
                  }))
                );
                if (batchInsertErr) {
                  console.error(`[BATCH] Erro ao inserir membros para "${missa.nome}" em ${dateStr}:`, batchInsertErr);
                } else {
                  totalSugestoes += sugestoes.length;
                  // Registra no histórico do batch para as próximas escalas
                  sugestoes.forEach((s) => batchHistory.push({ memberId: s.membro_id, ministerioId: s.ministerio_id, date: dateStr }));
                }
              }
            }
          }
        }
      }

      return { created, skipped, totalSugestoes };
    },
    onSuccess: ({ created, skipped, totalSugestoes }) => {
      qc.invalidateQueries({ queryKey: ["escalas"] });
      qc.invalidateQueries({ queryKey: ["escalas-counts"] });
      qc.invalidateQueries({ queryKey: ["escala-membros"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      setGerarPeriodoOpen(false);
      if (created.length > 0) {
        const sugestoesMsg = totalSugestoes > 0
          ? ` ${totalSugestoes} membro(s) distribuído(s) automaticamente.`
          : " Nenhum membro distribuído — verifique os vínculos em Membros → Funções.";
        toast.success(`${created.length} escala(s) criada(s).${sugestoesMsg}`, { duration: totalSugestoes > 0 ? 4000 : 8000 });
      } else {
        toast.info(skipped.length > 0 ? "Todas as escalas já existem ou foram puladas por recorrência." : "Nenhuma missa padrão ativa encontrada.");
      }
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

  const past = useMemo(
    () => escalas
      .filter((e) => new Date(e.data + "T00:00:00") < new Date(today.toDateString()))
      .sort((a, b) => b.data.localeCompare(a.data)),
    [escalas]
  );

  useEffect(() => {
    if (autoArchiveTriggered || !profile?.paroquia_id) return;
    const hasPast = escalas.some((e) => {
      const eventDate = new Date(e.data + "T00:00:00");
      return eventDate < new Date(today.toDateString()) && e.status !== "arquivada";
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
          .select("escala_id, ministerio_id, membros(id, nome)")
          .in("escala_id", escalaIds),
      ]);
      const counts: Record<string, EscalaPreview> = {};
      ((funcRes.data ?? []) as any[]).forEach((f) => {
        if (!counts[f.escala_id]) counts[f.escala_id] = { needed: 0, filled: 0, funcoes: [] };
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
        if (!counts[m.escala_id]) counts[m.escala_id] = { needed: 0, filled: 0, funcoes: [] };
        counts[m.escala_id].filled += 1;
        const funcao = counts[m.escala_id].funcoes.find((f) => f.ministerio_id === m.ministerio_id);
        if (funcao && m.membros) funcao.membros.push({ id: m.membros.id, nome: m.membros.nome });
      });
      return counts;
    },
  });

  // ── PDF Export ──────────────────────────────────────────────────────────────
  function exportarEscalasPDF(ids: string[]) {
    const selected = escalas.filter((e) => ids.includes(e.id));
    if (selected.length === 0) return;
    const hoje = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    const nomeParoquia = paroquiaConfig?.nome ?? "Pastoral Litúrgica";
    const cabecalhoUrl = paroquiaConfig?.pdf_cabecalho_url ?? null;
    const rodapeUrl    = paroquiaConfig?.pdf_rodape_url    ?? null;

    // Period label from date range of selected escalas
    const dates = selected.map((e) => new Date(e.data + "T00:00:00"));
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const periodoTitle =
      format(minDate, "MMyyyy") === format(maxDate, "MMyyyy")
        ? format(minDate, "MMMM 'de' yyyy", { locale: ptBR }).toUpperCase()
        : `${format(minDate, "MMM", { locale: ptBR })} – ${format(maxDate, "MMM 'de' yyyy", { locale: ptBR })}`.toUpperCase();

    const escalasSections = selected.map((e) => {
      const d = new Date(e.data + "T00:00:00");
      const diaSemana = format(d, "EEEE", { locale: ptBR });
      const dataCompleta = format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
      const preview = escalaCounts[e.id];
      const funcoes = preview?.funcoes ?? [];

      // group by categoria
      const grouped: { categoria: string; funcoes: typeof funcoes }[] = [];
      const uncategorized: typeof funcoes = [];
      funcoes.forEach((f) => {
        if (f.categoria) {
          const g = grouped.find((x) => x.categoria === f.categoria);
          if (g) g.funcoes.push(f);
          else grouped.push({ categoria: f.categoria, funcoes: [f] });
        } else {
          uncategorized.push(f);
        }
      });
      if (uncategorized.length > 0) grouped.push({ categoria: "", funcoes: uncategorized });

      // 4-column paired table: funcao | membro | funcao | membro
      const renderTabela = (fs: typeof funcoes) => {
        const rows: string[] = [];
        for (let i = 0; i < fs.length; i += 2) {
          const f1 = fs[i];
          const f2 = fs[i + 1];
          const m1 = f1.membros.length > 0 ? f1.membros.map((m) => nomeExibicao(m.nome)).join(", ") : "—";
          const v1 = f1.membros.length === 0;
          if (f2) {
            const m2 = f2.membros.length > 0 ? f2.membros.map((m) => nomeExibicao(m.nome)).join(", ") : "—";
            const v2 = f2.membros.length === 0;
            rows.push(`<tr><td class="td-f">${f1.nome}</td><td class="td-m${v1 ? " vaga" : ""}">${m1}</td><td class="td-f td-f2">${f2.nome}</td><td class="td-m${v2 ? " vaga" : ""}">${m2}</td></tr>`);
          } else {
            rows.push(`<tr><td class="td-f">${f1.nome}</td><td class="td-m${v1 ? " vaga" : ""}" colspan="3">${m1}</td></tr>`);
          }
        }
        return `<table class="ft">${rows.join("")}</table>`;
      };

      const funcoesHtml =
        funcoes.length > 0
          ? grouped
              .map((g) =>
                g.categoria
                  ? `<div class="cat-label">${g.categoria}</div>${renderTabela(g.funcoes)}`
                  : renderTabela(g.funcoes)
              )
              .join("")
          : `<p class="sem-funcoes">Nenhuma função definida para esta escala.</p>`;

      return `<div class="ec">
  <div class="eh">
    <div>
      <div class="eh-day">${diaSemana.toUpperCase()}</div>
      <div class="eh-title">${e.titulo}</div>
      <div class="eh-date">${dataCompleta}</div>
      ${e.hora_inicio ? `<div class="eh-time">Missa às ${e.hora_inicio.slice(0, 5)}${e.hora_fim ? ` – ${e.hora_fim.slice(0, 5)}` : ""}${e.local ? ` · ${e.local}` : ""}</div>` : ""}
    </div>
    <div class="eh-badges">
      ${e.solene ? `<span class="b-solene">Solene</span>` : ""}
      <span class="b-status s-${e.status}">${STATUS_CONFIG[e.status]?.label ?? e.status}</span>
    </div>
  </div>
  ${e.observacoes ? `<div class="obs">${e.observacoes}</div>` : ""}
  ${funcoesHtml}
</div>`;
    }).join("\n");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Escalas — ${nomeParoquia}</title>
<style>
@page{margin:1.8cm 1.5cm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;background:#fff;color:#111827;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc-cabecalho{width:100%;display:block}
.doc-header-text{background:#1a1a2e;color:#fff;padding:18px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.doc-header-text .nome{font-size:16px;font-weight:800;letter-spacing:.02em}
.doc-header-text .diocese{font-size:10px;color:rgba(255,255,255,.55);margin-top:3px}
.periodo-bar{background:#111827;color:#f59e0b;text-align:center;padding:10px 24px;font-size:13px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;border-top:2px solid rgba(245,158,11,.4)}
.doc-emit{text-align:right;padding:6px 28px 0;font-size:10px;color:#9ca3af}
.content{padding:16px 0 24px}
.ec{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;page-break-inside:avoid;margin-bottom:16px}
.eh{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;background:#1a1a2e;color:#fff;padding:12px 18px}
.eh-day{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#f59e0b;margin-bottom:3px}
.eh-title{font-size:14px;font-weight:700;line-height:1.3;margin-bottom:2px}
.eh-date{font-size:10px;color:rgba(255,255,255,.5);text-transform:capitalize}
.eh-time{margin-top:6px;display:inline-block;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);color:#fbbf24;border-radius:4px;padding:2px 9px;font-size:9.5px;font-weight:700;letter-spacing:.04em}
.eh-badges{display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;padding-top:2px}
.b-status{padding:2px 9px;border-radius:99px;font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.s-publicada{background:#d1fae5;color:#065f46}
.s-rascunho{background:rgba(255,255,255,.15);color:rgba(255,255,255,.75)}
.s-arquivada{background:rgba(255,255,255,.08);color:rgba(255,255,255,.4)}
.b-solene{background:#fef3c7;color:#92400e;border-radius:99px;padding:2px 9px;font-size:8.5px;font-weight:700}
.obs{padding:7px 18px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:10.5px;color:#78350f;font-style:italic;line-height:1.5}
.cat-label{padding:5px 18px;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#94a3b8}
.ft{width:100%;border-collapse:collapse}
.ft tr+tr td{border-top:1px solid #f1f5f9}
.ft td{padding:7px 14px;font-size:11.5px;vertical-align:middle}
.td-f{color:#64748b;font-weight:600;background:#f8fafc;width:26%;border-right:1px solid #e2e8f0;white-space:nowrap}
.td-f2{border-left:2px solid #e2e8f0}
.td-m{color:#111827;font-weight:700}
.td-m.vaga{color:#cbd5e1;font-weight:400;font-style:italic}
.sem-funcoes{padding:12px 18px;font-size:11px;color:#9ca3af;font-style:italic}
.doc-rodape{display:none}
@media print{
  @page{margin:1.5cm 1.2cm}
  .doc-rodape{display:block;width:100%;page-break-inside:avoid;margin-top:24px}
  .doc-rodape img{width:100%;display:block}
  .ec{margin-bottom:12px}
}
</style>
</head>
<body>
${cabecalhoUrl
  ? `<img class="doc-cabecalho" src="${cabecalhoUrl}" alt="">`
  : `<div class="doc-header-text"><div><div class="nome">${nomeParoquia}</div><div class="diocese">Pastoral Litúrgica</div></div></div>`}
<div class="periodo-bar">ESCALA ${periodoTitle}</div>
<div class="doc-emit">${selected.length} escala${selected.length !== 1 ? "s" : ""} · Emitido em ${hoje}</div>
<div class="content">
${escalasSections}
</div>
${rodapeUrl ? `<div class="doc-rodape"><img src="${rodapeUrl}" alt=""></div>` : ""}
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank");
    if (win) {
      setTimeout(() => { win.focus(); win.print(); URL.revokeObjectURL(url); }, 800);
    }
  }

  const [escalaForm, setEscalaForm] = useState<EscalaForm>(EMPTY_FORM);

  useEffect(() => {
    if (formOpen) setEscalaForm(EMPTY_FORM);
  }, [formOpen]);

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-28">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Escalas</p>
          <h1 className="mt-2 font-serif text-2xl sm:text-4xl">Escalas pastorais</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          <Tabs value={view} onValueChange={(v) => setView(v as "lista" | "calendario" | "sacristia" | "historico")}>
            <TabsList>
              <TabsTrigger value="lista"><List className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Lista</span></TabsTrigger>
              <TabsTrigger value="calendario"><Calendar className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Calendário</span></TabsTrigger>
              <TabsTrigger value="sacristia"><Church className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Sacristia</span></TabsTrigger>
              <TabsTrigger value="historico"><History className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Histórico</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline" size="sm"
            onClick={() => archivePastEscalasMutation.mutate()}
            disabled={archivePastEscalasMutation.isPending}
            title="Arquivar escalas passadas"
          >
            <span className="hidden sm:inline">Arquivar antigas</span>
            <span className="sm:hidden">Arquivar</span>
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => setGerarPeriodoOpen(true)}
            title="Gera escalas automaticamente a partir das Missas Padrão"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline ml-1.5">Gerar semana</span>
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /><span className="hidden sm:inline ml-1">Nova escala</span>
          </Button>
        </div>
      </div>

      {/* Barra de ações em massa — fixa na base */}
      {selectedEscalaIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-md shadow-2xl px-4 py-2.5 max-w-[calc(100vw-2rem)]">
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
        />
      ) : view === "calendario" ? (
        <CalendarioView
          calMonth={calMonth}
          setCalMonth={setCalMonth}
          calDays={calDays}
          escalasForDay={escalasForDay}
          onOpenDetail={(e) => setDetailEscala(e)}
        />
      ) : view === "historico" ? (
        <div className="mt-6 space-y-3">
          {past.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <History className="h-6 w-6 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma escala passada encontrada.</p>
            </div>
          ) : (
            past.map((e) => {
              const d = new Date(e.data + "T00:00:00");
              const counts = escalaCounts[e.id];
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setDetailEscala(e)}
                  className="w-full text-left rounded-2xl border border-border bg-card shadow-sm px-4 py-3.5 hover:bg-muted/40 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{e.titulo}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                        {e.hora_inicio ? ` · ${e.hora_inicio.slice(0, 5)}` : ""}
                        {e.local ? ` · ${e.local}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {e.status === "arquivada" ? "Arquivada" : e.status === "publicada" ? "Realizada" : "Rascunho"}
                      </Badge>
                      {counts && (
                        <p className="text-[10px] text-muted-foreground">
                          {counts.filled}/{counts.needed} membros
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <SacristiaTab paroquiaId={profile?.paroquia_id ?? ""} />
      )}

      {/* ── Dialog período para gerar escalas ──────────────────────────────── */}
      <Dialog open={gerarPeriodoOpen} onOpenChange={setGerarPeriodoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Gerar escalas automaticamente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Data de início</Label>
              <input
                type="date"
                value={gerarInicio}
                onChange={(e) => setGerarInicio(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data de término</Label>
              <input
                type="date"
                value={gerarFim}
                onChange={(e) => setGerarFim(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Serão criadas escalas para todas as Missas Padrão que ocorrem no período selecionado, respeitando recorrência e escalas já existentes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGerarPeriodoOpen(false)}>Cancelar</Button>
            <Button
              disabled={gerarSemanaRapidaMutation.isPending || !gerarInicio || !gerarFim || gerarInicio > gerarFim}
              onClick={() => gerarSemanaRapidaMutation.mutate({ dataInicio: gerarInicio, dataFim: gerarFim })}
            >
              {gerarSemanaRapidaMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Gerar escalas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              atribuicoes={atribuicoes}
              membroMinisterios={membroMinisterios}
              assignmentHistory={assignmentHistory}
              membroAtuacoes={membroAtuacoes}
              indisponibilidades={indisponibilidades}
              funcaoRestricoes={funcaoRestricoes}
              missasPadrao={missasPadrao}
              membroMissaRestricoes={membroMissaRestricoes}
              paroquiaConfig={paroquiaConfig}
              initialEditMode={detailEditMode}
              comunidades={comunidades}
              tiposMissa={tiposMissa}
              isSaving={saveMutation.isPending}
              onSave={(form, onDone) => saveMutation.mutate({ form, editId: detailEscala.id }, { onSuccess: onDone })}
              onDelete={(e) => setDeleteTarget(e)}
              onAddFuncao={(mid, qty) => addFuncaoMutation.mutate({ ministerio_id: mid, quantidade: qty })}
              onRemoveFuncao={(id) => removeFuncaoMutation.mutate(id)}
              paroquiaNome={paroquiaNome}
              onAtribuir={(mid, minid) => atribuirMutation.mutate({ membro_id: mid, ministerio_id: minid })}
              onRemoverAtribuicao={(id) => removerAtribuicaoMutation.mutate(id)}
              onStatusChange={(status) => updateStatusMutation.mutate({ id: detailEscala.id, status })}
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
          <p className="text-xs text-red-600 font-medium">Nenhum Tipo de Missa cadastrado. Configure em Personalização → Tipos de Missa.</p>
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

function ListaView({
  escalas, allEscalas, selectedIds, escalaCounts, onToggleSelect, onSelectAll,
  onOpenDetail, onEdit, onDelete, onCreate, onExportPDF, onReorganizar,
}: {
  escalas: Escala[];
  allEscalas: Escala[];
  selectedIds: Set<string>;
  escalaCounts: Record<string, EscalaPreview>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onOpenDetail: (e: Escala) => void;
  onEdit: (e: Escala, ev: React.MouseEvent) => void;
  onDelete: (e: Escala) => void;
  onCreate: () => void;
  onExportPDF: (id: string) => void;
  onReorganizar: () => void;
}) {
  const allSelected = escalas.length > 0 && escalas.every((e) => selectedIds.has(e.id));
  const publishedCount = escalas.filter((e) => e.status === "publicada").length;
  const draftCount = escalas.filter((e) => e.status === "rascunho").length;
  const archivedCount = escalas.filter((e) => e.status === "arquivada").length;

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
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma escala futura. Veja o calendário ou crie uma nova.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="rounded-3xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Visão geral</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-3xl font-serif">{escalas.length}</p>
              <p className="text-sm text-muted-foreground">Escalas agendadas</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:grid-cols-3">
              <div className="rounded-2xl bg-background p-2">
                <p className="text-foreground">{publishedCount}</p>
                <p>Publicadas</p>
              </div>
              <div className="rounded-2xl bg-background p-2">
                <p className="text-foreground">{draftCount}</p>
                <p>Rascunho</p>
              </div>
              <div className="rounded-2xl bg-background p-2">
                <p className="text-foreground">{archivedCount}</p>
                <p>Arquivadas</p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Membros</p>
            <p className="mt-2 text-sm text-foreground">Redistribuir automaticamente.</p>
          </div>
          <Button variant="outline" onClick={onReorganizar}>
            <Users className="h-4 w-4 mr-1.5" /> Reorganizar
          </Button>
        </div>
      </div>

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

      <div className="rounded-3xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border/40">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => onSelectAll(checked ? escalas.map((e) => e.id) : [])}
            />
            <span className="text-xs text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} selecionada(s)` : "Selecionar todas"}
            </span>
          </label>
          <span className="text-xs text-muted-foreground">{escalas.length} escala(s)</span>
        </div>

        <div className="space-y-3 p-4 animate-fade-in">
          {escalas.map((e, idx) => {
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
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                          e.status === "publicada"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : e.status === "arquivada"
                            ? "bg-slate-100 text-slate-500 border-slate-200"
                            : "bg-slate-50 text-slate-600 border-slate-200"
                        }`}>
                          {cfg.label}
                        </span>
                        {e.solene && (
                          <span className="hidden sm:inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                            Solene
                          </span>
                        )}
                      </div>
                    </div>

                    {pct !== null && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 1 ? "bg-green-500" : pct >= 0.5 ? "bg-amber-400" : "bg-red-400"}`}
                            style={{ width: `${Math.round(pct * 100)}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                          {counts!.filled}/{counts!.needed}
                        </span>
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
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => onOpenDetail(e)}>
                          <ChevronDown className="h-3.5 w-3.5 mr-2 rotate-[-90deg]" />Ver detalhes
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(ev) => onEdit(e, ev)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />Editar
                        </DropdownMenuItem>
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
                                        : f.membros.slice(0, 3).map((m) => (
                                            <span key={m.id} className="inline-flex rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
                                              {nomeExibicao(m.nome)}
                                            </span>
                                          ))
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
  escala, ministerios, membros, funcoes, atribuicoes, membroMinisterios, assignmentHistory,
  membroAtuacoes,
  indisponibilidades, funcaoRestricoes, missasPadrao, membroMissaRestricoes, paroquiaConfig,
  paroquiaNome, initialEditMode, comunidades, tiposMissa, isSaving, onSave,
  onDelete, onAddFuncao, onRemoveFuncao, onAtribuir, onRemoverAtribuicao, onStatusChange,
}: {
  escala: Escala;
  ministerios: Ministerio[];
  membros: Membro[];
  funcoes: EscalaFuncao[];
  atribuicoes: EscalaMembro[];
  membroMinisterios: Record<string, string[]>;
  assignmentHistory: AssignmentHistoryEntry[];
  membroAtuacoes: Record<string, string[]>;
  indisponibilidades: { membro_id: string; data: string }[];
  funcaoRestricoes: FuncaoRestricao[];
  missasPadrao: { id: string; dia_semana: number; hora_inicio: string | null }[];
  membroMissaRestricoes: Record<string, string[]>;
  paroquiaConfig: { regras_escala: any; usa_tochas: boolean } | null | undefined;
  paroquiaNome: string;
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
  onStatusChange: (status: string) => void;
}) {
  const [editMode, setEditMode] = useState(initialEditMode);
  const [escalaForm, setEscalaForm] = useState<EscalaForm>(EMPTY_FORM);

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
  const [suggestedAssignments, setSuggestedAssignments] = useState<{ ministerio_id: string; membro_id: string }[]>([]);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [engineInsights, setEngineInsights] = useState<import("@/lib/escala-engine").InsightFuncao[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [showDebugMotor, setShowDebugMotor] = useState(false);
  const [debugInsights, setDebugInsights] = useState<import("@/lib/escala-engine").InsightFuncao[]>([]);

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
      setSuggestedAssignments([]);
      setGenerateNotice(null);
      setEngineInsights([]);
      setShowInsights(false);
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
              ministerioNome: min?.nome ?? "",
            },
          });
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
      await Promise.all(
        atribuicoes.map((a) =>
          supabase.from("escala_membros").update({ status: presencaMap[a.id] ?? "pendente" }).eq("id", a.id)
        )
      );
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

  const cfg = STATUS_CONFIG[escala.status] ?? STATUS_CONFIG.rascunho;
  const publicUrl = typeof window !== "undefined" && escala.token_publico ? `${window.location.origin}/escala/${escala.token_publico}` : null;
  const dateStr = format(new Date(escala.data + "T00:00:00"), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  const funcaoMinsIds = funcoes.map((f) => f.ministerio_id);
  const ministeriosDisponiveis = ministerios.filter((m) => !funcaoMinsIds.includes(m.id));

  function membrosParaMinisterio(ministerioId: string) {
    const atribuidos = atribuicoes.filter((a) => a.ministerio_id === ministerioId).map((a) => a.membro_id);
    const desteMinisterio = membroMinisterios[ministerioId] ?? [];
    return membros.filter((m) => desteMinisterio.includes(m.id) && !atribuidos.includes(m.id));
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

    const regras = paroquiaConfig?.regras_escala ?? {};
    const config = {
      usa_tochas: paroquiaConfig?.usa_tochas ?? false,
      limite_semanal: regras.limite_semanal ?? undefined,
      limite_mensal: regras.limite_mensal ?? undefined,
      impedir_repeticao_seguida: regras.impedir_repeticao_consecutiva ?? true,
      prioridade_score: regras.prioridade_score ?? false,
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
    const resultado = generateEscalaWithAlertas(
      { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
      funcoes,
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
        config,
        solene: escala.solene,
        tem_adoracao: escala.tem_adoracao,
        tem_bispo: escala.tem_bispo,
      }
    );

    setSuggestedAssignments(resultado.sugestoes);
    setEngineInsights(resultado.insights ?? []);

    const totalSlots = funcoes.reduce((sum, f) => sum + f.quantidade, 0);

    if (resultado.sugestoes.length === 0) {
      const motivo = resultado.alertas[0] ?? "Verifique se os membros têm funções vinculadas e não estão indisponíveis.";
      setGenerateNotice(`Nenhuma sugestão gerada. ${motivo}`);
      return;
    }

    if (resultado.alertas.length > 0) {
      resultado.alertas.forEach((a) => toast.warning(a, { duration: 6000 }));
    }

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

    setGenerateNotice(`${resultado.sugestoes.length} sugestões geradas pelo motor inteligente. Revise e aplique.`);
  }

  function handleClearSuggestions() {
    setSuggestedAssignments([]);
    setGenerateNotice(null);
    setEngineInsights([]);
    setShowInsights(false);
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
        console.error(`  ❌ "${f.ministerio.nome}" (${f.ministerio_id}): NÃO MAPEADO — 0 membros`);
      } else {
        console.log(`  ✓ "${f.ministerio.nome}" (${f.ministerio_id}): ${cnt} membro(s)`);
      }
    });

    // ── Rodar motor com debug=true ────────────────────────────────────────
    const membrosComAtuacoes = membros.map((m) => ({ ...m, atuacao_ids: membroAtuacoes[m.id] ?? [] }));
    const resultado = generateEscalaWithAlertas(
      { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
      funcoes,
      membrosComAtuacoes,
      membroMinisterios,
      { history: assignmentHistory, indisponibilidades, restricoes: funcaoRestricoes, debug: true },
    );

    console.log("=== RESULTADO DO MOTOR ===");
    console.log(`Sugestões: ${resultado.sugestoes.length} | Alertas: ${resultado.alertas.length}`);
    resultado.alertas.forEach((a) => console.warn(`  ${a}`));
    resultado.insights.forEach((ins) => {
      console.group(`FUNÇÃO: ${ins.ministerio_nome}`);
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

  const suggestionsByMinisterio = funcoes.map((funcao) => ({
    funcao,
    assignments: suggestedAssignments.filter((suggestion) => suggestion.ministerio_id === funcao.ministerio_id),
  }));

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
            <div className="flex items-center justify-between pt-1">
              <Badge variant={cfg.variant}>{cfg.label}</Badge>
              <Select value={escala.status} onValueChange={onStatusChange}>
                <SelectTrigger className="h-7 text-xs w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rascunho">Rascunho</SelectItem>
                  <SelectItem value="publicada">Publicar</SelectItem>
                  <SelectItem value="arquivada">Arquivar</SelectItem>
                </SelectContent>
              </Select>
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
          >
            <AlertTriangle className="h-3 w-3" />
            Debug do Motor
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
                        <button
                          className="shrink-0 text-muted-foreground hover:text-destructive transition"
                          onClick={() => onRemoveFuncao(f.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
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
                              <button className="text-muted-foreground hover:text-destructive" onClick={() => onRemoverAtribuicao(a.id)}>
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Atribuir membro */}
                      {atrib.length < f.quantidade && disponiveis.length > 0 && (
                        <div className="flex gap-2 pl-5">
                          <Select
                            value={selectedMembro}
                            onValueChange={(v) => setAddMembroMap((prev) => ({ ...prev, [f.ministerio_id]: v }))}
                          >
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue placeholder="Selecionar membro..." />
                            </SelectTrigger>
                            <SelectContent>
                              {disponiveis.map((m) => (
                                <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                      )}
                      {atrib.length < f.quantidade && disponiveis.length === 0 && (
                        <p className="pl-5 text-xs text-muted-foreground">
                          Nenhum membro disponível neste ministério.
                        </p>
                      )}
                      </div>
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
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleGenerateSuggestions}>
                  <Sparkles className="h-4 w-4 mr-2" /> Atualizar sugestões
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
              </div>
            </div>
            {suggestedAssignments.length > 0 ? (
              <div className="space-y-2">
                {suggestionsByMinisterio.map(({ funcao, assignments }) => {
                  const insight = engineInsights.find((i) => i.ministerio_id === funcao.ministerio_id);
                  return (
                    <div key={funcao.ministerio_id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{funcao.ministerio.nome}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${assignments.length >= funcao.quantidade ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {assignments.length}/{funcao.quantidade}
                        </span>
                      </div>
                      {assignments.length > 0 ? (
                        <ul className="mt-2 space-y-1.5">
                          {assignments.map((s) => {
                            const member = membros.find((m) => m.id === s.membro_id);
                            const ic = insight?.escolhidos.find((c) => c.membro_id === s.membro_id);
                            return (
                              <li key={`${s.ministerio_id}-${s.membro_id}`} className="flex items-start gap-2">
                                <div className="h-5 w-5 mt-0.5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <span className="text-[9px] font-bold text-primary">{ic ? Math.round(ic.score_final) : "—"}</span>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{member?.nome ?? s.membro_id}</p>
                                  {ic && (
                                    <p className="text-[11px] text-muted-foreground">
                                      {ic.dias_sem_servir >= 365 ? "membro novo" : `${ic.dias_sem_servir}d sem servir`}
                                      {" · "}{ic.participacoes_30d === 0 ? "não serviu nos últimos 30d" : `${ic.participacoes_30d}× nos últimos 30d`}
                                    </p>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="mt-2">
                          <p className="text-sm text-amber-700">Nenhum candidato disponível.</p>
                          {insight?.motivo_vazio && (
                            <p className="text-xs text-muted-foreground mt-0.5">{insight.motivo_vazio}</p>
                          )}
                          {insight && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {insight.candidatos_avaliados} avaliado(s) —
                              {insight.excluidos.indisponibilidade > 0 && ` ${insight.excluidos.indisponibilidade} indisponível(eis);`}
                              {insight.excluidos.ja_alocado > 0 && ` ${insight.excluidos.ja_alocado} já alocado(s);`}
                              {insight.excluidos.funcao_nao_pode > 0 && ` ${insight.excluidos.funcao_nao_pode} bloqueado(s) pela função;`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

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
        .select("id, membro_id, ministerio_id, escala_id, status, membros(id, nome, telefone), ministerios(id, nome, cor)")
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
      await Promise.all(
        membrosDestaEscala.map((m: MembroEscalaS) =>
          supabase.from("escala_membros").update({ status: presencaMap[m.id] ?? "pendente" }).eq("id", m.id)
        )
      );
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
