import { createFileRoute } from "@tanstack/react-router";
import { ModuleTabBar } from "@/components/ui/module-tab-bar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus, Pencil, Trash2, Loader2, Users, Search, X, CalendarDays,
  Upload, ChevronRight, Link2, MessageCircle, Star, User, MoreVertical, Sparkles, RefreshCw, Mail,
  UserCheck, UserX, ClipboardList, FileDown, CheckCircle2, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuditoriaAtivacao } from "@/components/membros/AuditoriaAtivacao";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

function logDbError(context: string, error: unknown) {
  const e = error as Record<string, unknown>;
  if (import.meta.env.DEV) {
    console.error(`[DB ERROR] ${context}`, {
      message: e?.message,
      code: e?.code,
      details: e?.details,
      hint: e?.hint,
      full: error,
    });
  } else {
    console.error(`[DB ERROR] ${context}: ${e?.code ?? "unknown"}`);
  }
  return `${context}: ${e?.message ?? String(error)}`;
}

export const Route = createFileRoute("/_authenticated/membros")({
  validateSearch: (search: Record<string, unknown>): { abrir?: string } => ({
    abrir: typeof search.abrir === "string" ? search.abrir : undefined,
  }),
  component: MembrosPage,
  head: () => ({ meta: [{ title: "Membros — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Ministerio = { id: string; nome: string; cor: string };
type Atuacao = { id: string; nome: string; cor: string; icone: string | null };
type Comunidade = { id: string; nome: string };

type TipoPrioridade = { id: string; nome: string; cor: string; peso_escala: number };

type Membro = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  data_ingresso: string | null;
  observacoes: string | null;
  score: number;
  ativo: boolean;
  conta_ativada: boolean | null;
  prioridade_escala: string;
  prioridade_id: string | null;
  tipo_acesso: string;
  forcar_escalacao_solene: boolean;
  token_acesso: string | null;
  auth_user_id: string | null;
  comunidade_id: string | null;
  sexo: string | null;
  foto_url: string | null;
  ministerios: Ministerio[];
  atuacao_ids: string[];
  restricoes_dia_semana: number[];
};

type Indisponibilidade = {
  id: string;
  membro_id: string;
  data: string;
  motivo: string | null;
  tipo: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  cancelada: boolean;
};

type MissaPadrao = {
  id: string;
  nome: string;
  hora_inicio: string | null;
  dia_semana: number;
  recorrencia?: { tipo: string } | null;
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const MESES_FORM = [
  { value: "01", label: "Janeiro" }, { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" },   { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },    { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },   { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },{ value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },{ value: "12", label: "Dezembro" },
];
const ANO_ATUAL_MEMBROS = new Date().getFullYear();
const ANOS_FORM = Array.from({ length: ANO_ATUAL_MEMBROS - 1989 }, (_, i) => ANO_ATUAL_MEMBROS - i);

const STATUS_SOL_CFG = {
  pendente:  { label: "Pendente",  className: "bg-amber-500/15 text-amber-700 border-amber-300" },
  aprovado:  { label: "Aprovado",  className: "bg-green-500/15 text-green-700 border-green-300" },
  rejeitado: { label: "Rejeitado", className: "bg-destructive/10 text-destructive border-destructive/20" },
} as const;

const RECORRENCIA_LABELS: Record<string, string> = {
  quinzenal:      "Quinzenal",
  quinzenal_1_3:  "1ª e 3ª semanas",
  quinzenal_2_4:  "2ª e 4ª semanas",
  mensal_1:       "1ª semana",
  mensal_2:       "2ª semana",
  mensal_3:       "3ª semana",
  mensal_4:       "4ª semana",
  mensal_ultimo:  "Última semana",
  esporadico:     "Data específica",
};

type FormData = {
  nome: string;
  email: string;
  telefone: string;
  data_nascimento: string;
  data_ingresso: string;
  cpf: string;
  rg: string;
  endereco: string;
  cidade: string;
  cep: string;
  nome_emergencia: string;
  telefone_emergencia: string;
  nome_pais: string;
  contato_pais: string;
  restricoes_horario: string;
  motivo_disponibilidade: string;
  deslocamento: string;
  comunidade_id: string;
  planilha_url: string;
  foto_url: string;
  observacoes: string;
  ativo: boolean;
  prioridade_escala: string;
  prioridade_id: string;
  tipo_acesso: string;
  ministerio_ids: string[];
  atuacao_ids: string[];
  restricoes_dia_semana: number[];
  funcoes_nao_pode_ids: string[];
  missas_nao_pode_ids: string[];
  sexo: string;
};

// ── Tipo para solicitações de cadastro ────────────────────────────────────────
type SolicitacaoMembro = {
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

const PRIORIDADE_NONE = "_none" as const;

const EMPTY_FORM: FormData = {
  nome: "", email: "", telefone: "", data_nascimento: "",
  data_ingresso: "", cpf: "", rg: "", endereco: "", cidade: "", cep: "",
  nome_emergencia: "", telefone_emergencia: "",
  nome_pais: "", contato_pais: "", restricoes_horario: "", motivo_disponibilidade: "", deslocamento: "",
  comunidade_id: "", planilha_url: "", foto_url: "",
  observacoes: "", ativo: true,
  prioridade_escala: "nenhuma",
  prioridade_id: PRIORIDADE_NONE,
  tipo_acesso: "membro",
  ministerio_ids: [], atuacao_ids: [],
  restricoes_dia_semana: [], funcoes_nao_pode_ids: [],
  missas_nao_pode_ids: [],
  sexo: "",
};

const PRIORIDADES = [
  { value: "nenhuma", label: "Nenhuma" },
  { value: "alta", label: "Prioridade alta" },
  { value: "media", label: "Prioridade média" },
  { value: "baixa", label: "Prioridade baixa" },
  { value: "sempre_solenes", label: "Sempre priorizar em solenidades" },
  { value: "coordenador", label: "Coordenador" },
  { value: "mestre_cerimonia", label: "Mestre de cerimônias prioritário" },
];

// ── Multi-check helper ────────────────────────────────────────────────────────

function MultiCheck({
  label, items, selected, onToggle, emptyMsg,
}: {
  label: string;
  items: { id: string; nome: string; cor?: string; icone?: string | null }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyMsg?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground italic">
          {emptyMsg ?? "Nenhum item disponível. Cadastre em Geral."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border p-3 bg-muted/20">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent transition-colors">
            <Checkbox
              checked={selected.includes(item.id)}
              onCheckedChange={() => onToggle(item.id)}
              className="shrink-0"
            />
            <span className="flex items-center gap-1.5 text-xs truncate">
              {item.cor && (
                <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />
              )}
              {item.icone && <span>{item.icone}</span>}
              {item.nome}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── MemberForm ────────────────────────────────────────────────────────────────

function MemberForm({
  form, setForm, ministerios, atuacoes, comunidades, missasPadrao, tiposPrioridade, saving, onSave, onClose,
}: {
  form: FormData;
  setForm: (f: FormData) => void;
  ministerios: Ministerio[];
  atuacoes: Atuacao[];
  comunidades: Comunidade[];
  missasPadrao: MissaPadrao[];
  tiposPrioridade: TipoPrioridade[];
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  function toggleList(key: keyof Pick<FormData, "ministerio_ids" | "atuacao_ids" | "funcoes_nao_pode_ids">, id: string) {
    const cur = form[key] as string[];
    setForm({ ...form, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `fotos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { data: upData, error } = await supabase.storage.from("membros").upload(path, file, { upsert: true });
    if (error) { toast.error("Erro ao enviar foto."); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("membros").getPublicUrl(upData.path);
    setForm({ ...form, foto_url: urlData.publicUrl });
    setUploading(false);
  }

  return (
    <div className="space-y-6 pt-2">

      {/* ── Dados pessoais ──────────────────────────────────────────────────── */}
      <div className="space-y-4">

        {/* Foto */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            className="relative h-16 w-16 shrink-0 rounded-full bg-muted border border-border overflow-hidden flex items-center justify-center hover:opacity-80 transition"
            title="Clique para alterar a foto"
          >
            {form.foto_url ? (
              <img src={form.foto_url} alt="Foto" className="h-full w-full object-cover" />
            ) : (
              <User className="h-7 w-7 text-muted-foreground" />
            )}
            {uploading && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}
          </button>
          <div className="text-xs text-muted-foreground">
            <p className="font-medium">Foto do membro</p>
            <p>JPG, PNG ou WebP · máx. 5 MB</p>
          </div>
          <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome completo *</Label>
          <Input
            id="nome"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="Nome do servidor"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="telefone">Telefone / WhatsApp</Label>
            <Input
              id="telefone"
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              placeholder="(00) 90000-0000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="email@exemplo.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nascimento">Data de nascimento</Label>
            <Input
              id="nascimento"
              type="date"
              value={form.data_nascimento}
              onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sexo">Sexo</Label>
            <select
              id="sexo"
              value={form.sexo}
              onChange={(e) => setForm({ ...form, sexo: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Não informado</option>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-1.5">
            <Label>Mês/ano de ingresso</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={form.data_ingresso ? form.data_ingresso.slice(5, 7) : ""}
                onValueChange={(mes) => {
                  const ano = form.data_ingresso?.slice(0, 4) ?? String(ANO_ATUAL_MEMBROS);
                  setForm({ ...form, data_ingresso: mes && ano ? `${ano}-${mes}-01` : "" });
                }}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Mês" /></SelectTrigger>
                <SelectContent>
                  {MESES_FORM.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select
                value={form.data_ingresso ? form.data_ingresso.slice(0, 4) : ""}
                onValueChange={(ano) => {
                  const mes = form.data_ingresso?.slice(5, 7) ?? "";
                  setForm({ ...form, data_ingresso: mes && ano ? `${ano}-${mes}-01` : "" });
                }}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Ano" /></SelectTrigger>
                <SelectContent>
                  {ANOS_FORM.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rg">RG</Label>
            <Input id="rg" value={form.rg} onChange={(e) => setForm({ ...form, rg: e.target.value })} placeholder="00.000.000-0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpf">CPF</Label>
            <Input id="cpf" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="endereco">Endereço</Label>
          <Input id="endereco" value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Rua, número, complemento" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cidade">Cidade</Label>
            <Input id="cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cep">CEP</Label>
            <Input id="cep" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} placeholder="00000-000" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="obs">Observações</Label>
          <Textarea
            id="obs"
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            placeholder="Informações adicionais..."
            rows={2}
          />
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="ativo-m"
            checked={form.ativo}
            onCheckedChange={(v) => setForm({ ...form, ativo: v })}
          />
          <Label htmlFor="ativo-m">Membro ativo</Label>
        </div>
      </div>

      {/* ── Família ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Família</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nome_pais">Nome dos pais</Label>
            <Input id="nome_pais" value={form.nome_pais} onChange={(e) => setForm({ ...form, nome_pais: e.target.value })} placeholder="Nome completo do(s) responsável(eis)" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contato_pais">Contato dos pais</Label>
            <Input id="contato_pais" value={form.contato_pais} onChange={(e) => setForm({ ...form, contato_pais: e.target.value })} placeholder="Telefone ou e-mail" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nome_emergencia">Contato de emergência</Label>
              <Input id="nome_emergencia" value={form.nome_emergencia} onChange={(e) => setForm({ ...form, nome_emergencia: e.target.value })} placeholder="Nome" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="telefone_emergencia">Telefone emergência</Label>
              <Input id="telefone_emergencia" value={form.telefone_emergencia} onChange={(e) => setForm({ ...form, telefone_emergencia: e.target.value })} placeholder="(00) 90000-0000" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Disponibilidade ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Disponibilidade</p>
          {form.restricoes_dia_semana.length === 0 && form.missas_nao_pode_ids.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
              <CheckCircle2 className="h-3 w-3" /> Qualquer dia
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Restrição: {[...form.restricoes_dia_semana].sort((a, b) => a - b).map((d) => DIAS_SEMANA[d]).join(", ")}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Datas específicas indisponíveis são gerenciadas na aba "Indisponibilidades" após salvar.</p>

        {/* Checklist de missas padrão que o membro não consegue servir */}
        {missasPadrao.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Nenhuma missa padrão cadastrada em Geral. Cadastre os horários para indicar quais este membro não pode servir.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Missas que não consegue servir</Label>
            <div className="space-y-0.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              {missasPadrao.map((m) => {
                const blocked = form.missas_nao_pode_ids.includes(m.id);
                const recLabel = m.recorrencia?.tipo && m.recorrencia.tipo !== "semanal"
                  ? RECORRENCIA_LABELS[m.recorrencia.tipo] ?? m.recorrencia.tipo
                  : null;
                return (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-destructive/10 transition-colors">
                    <Checkbox
                      checked={blocked}
                      onCheckedChange={() => {
                        const cur = form.missas_nao_pode_ids;
                        setForm({ ...form, missas_nao_pode_ids: blocked ? cur.filter((x) => x !== m.id) : [...cur, m.id] });
                      }}
                      className="shrink-0 border-destructive/50 data-[state=checked]:bg-destructive data-[state=checked]:border-destructive"
                    />
                    <span className="text-xs leading-tight flex flex-wrap items-center gap-x-1 gap-y-0.5">
                      <strong className="text-foreground">{DIAS_SEMANA[m.dia_semana]}</strong>
                      {m.hora_inicio && (
                        <span className="text-muted-foreground">· {m.hora_inicio.slice(0, 5)}</span>
                      )}
                      {m.nome && (
                        <span className="text-muted-foreground">— {m.nome}</span>
                      )}
                      {recLabel && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border leading-none">
                          {recLabel}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Marcado = o motor não escalará este membro nesses horários recorrentes.
            </p>
          </div>
        )}

        {/* Motivo de indisponibilidade informado pelo membro */}
        <div className="space-y-1.5">
          <Label htmlFor="motivo_disponibilidade">Motivo de indisponibilidade</Label>
          <Textarea
            id="motivo_disponibilidade"
            value={form.motivo_disponibilidade}
            onChange={(e) => setForm({ ...form, motivo_disponibilidade: e.target.value })}
            placeholder="O membro ainda não informou um motivo..."
            rows={2}
          />
          <p className="text-[11px] text-muted-foreground">Preenchido pelo próprio membro ao completar o cadastro.</p>
        </div>

        {/* Texto livre + auto-detectar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="restricoes_horario">Restrições em texto livre</Label>
            {missasPadrao.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-primary underline"
                onClick={() => {
                  const ids = autoDetectMissaRestricoes(form.restricoes_horario, missasPadrao);
                  if (ids.length === 0) { return; }
                  setForm({
                    ...form,
                    missas_nao_pode_ids: [...new Set([...form.missas_nao_pode_ids, ...ids])],
                  });
                }}
              >
                Auto-detectar horários
              </button>
            )}
          </div>
          <Textarea
            id="restricoes_horario"
            value={form.restricoes_horario}
            onChange={(e) => setForm({ ...form, restricoes_horario: e.target.value })}
            placeholder="Ex: não pode domingos às 8h, não disponível de manhã..."
            rows={2}
          />
          {form.restricoes_horario.trim() && (() => {
            const ids = missasPadrao.length > 0 ? autoDetectMissaRestricoes(form.restricoes_horario, missasPadrao) : [];
            const matched = ids.map((id) => missasPadrao.find((m) => m.id === id)).filter(Boolean);
            const diasDetectados = [...detectarDias(normalizarTexto(form.restricoes_horario))].map(d => DIAS_SEMANA[d]);
            if (diasDetectados.length === 0) return null;
            return (
              <p className="text-[11px] text-muted-foreground">
                {matched.length > 0
                  ? <>Missas detectadas: {matched.map((m) => `${DIAS_SEMANA[m!.dia_semana]}${m!.hora_inicio ? " " + m!.hora_inicio.slice(0, 5) : ""}`).join(", ")}</>
                  : <>Dias detectados: {diasDetectados.join(", ")} — sem missas padrão cadastradas para esses dias.</>}
              </p>
            );
          })()}
        </div>
      </div>

      {/* ── Logística ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Logística</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="deslocamento">Deslocamento</Label>
            <Input id="deslocamento" value={form.deslocamento} onChange={(e) => setForm({ ...form, deslocamento: e.target.value })} placeholder="Ex: carro próprio, ônibus, carona, a pé..." />
          </div>
          {comunidades.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="comunidade_id">Comunidade que mais participa</Label>
              <Select value={form.comunidade_id || "_none"} onValueChange={(v) => setForm({ ...form, comunidade_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione a comunidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— nenhuma —</SelectItem>
                  {comunidades.filter((c) => !!c.id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* ── Atuação Pastoral ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Atuação Pastoral</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Em qual grupo ou ministério pastoral este membro serve — ex: Acólito, Cerimoniário, Coroinha, Filhas de Maria.
          </p>
        </div>
        <MultiCheck
          label=""
          items={atuacoes}
          selected={form.atuacao_ids}
          onToggle={(id) => toggleList("atuacao_ids", id)}
          emptyMsg="Nenhuma atuação cadastrada. Crie em Geral → Funções → Atuações Pastorais."
        />
      </div>

      {/* ── Funções Litúrgicas ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funções Litúrgicas</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Funções específicas que este membro exerce nas celebrações — ex: Missal, Cruz, Vela, Turíbulo, Credência.
          </p>
        </div>
        <MultiCheck
          label=""
          items={ministerios}
          selected={form.ministerio_ids}
          onToggle={(id) => toggleList("ministerio_ids", id)}
          emptyMsg="Nenhuma função cadastrada. Crie em Geral → Funções Litúrgicas."
        />
      </div>

      {/* ── Restrições de Função ─────────────────────────────────────────────── */}
      {ministerios.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funções com restrição</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              O motor nunca atribuirá estas funções litúrgicas a este membro.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            {ministerios.map((m) => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-destructive/10 transition-colors">
                <Checkbox
                  checked={form.funcoes_nao_pode_ids.includes(m.id)}
                  onCheckedChange={() => toggleList("funcoes_nao_pode_ids", m.id)}
                  className="shrink-0 border-destructive/50 data-[state=checked]:bg-destructive data-[state=checked]:border-destructive"
                />
                <span className="flex items-center gap-1.5 text-xs truncate">
                  <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: m.cor }} />
                  {m.nome}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Nível de acesso ─────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-primary" />
          <Label className="text-sm font-medium">Nível de acesso</Label>
        </div>
        <div className="space-y-2 pt-1">
          {([
            {
              value: "membro",
              label: "Membro",
              badge: "Portal",
              badgeColor: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
              desc: "Acessa o portal do servidor.",
              bullets: [
                "Visualiza escalas publicadas e sua equipe",
                "Consulta eventos, formações e retiros",
                "Informa indisponibilidades",
                "Registra ocorrências para coordenação",
              ],
            },
            {
              value: "auxiliar",
              label: "Administrador",
              badge: "Portal + Presença",
              badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
              desc: "Portal do servidor com capacidade de gestão de presença.",
              bullets: [
                "Tudo que o Membro pode fazer",
                "Confirma presença dos membros escalados",
                "Marca falta, atraso ou justificativa",
                "Registra ocorrências litúrgicas",
                "Somente nas celebrações em que estiver escalado",
              ],
            },
            {
              value: "coordenador",
              label: "Coordenação",
              badge: "Acesso completo",
              badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
              desc: "Acesso total ao painel pastoral.",
              bullets: [
                "Gerencia membros, grupos e escalas",
                "Cria e edita agenda pastoral",
                "Define regras e configurações",
                "Gerencia notificações da paróquia",
                "Visualiza relatórios e ranking",
                "Recebe todas as ocorrências e alertas",
              ],
            },
          ] as const).map((nivel) => {
            const selected = form.tipo_acesso === nivel.value;
            return (
              <button
                key={nivel.value}
                type="button"
                onClick={() => setForm({ ...form, tipo_acesso: nivel.value })}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${
                  selected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    {/* Radio indicator */}
                    <span className={`h-3.5 w-3.5 rounded-full border-2 flex-shrink-0 transition ${
                      selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`} />
                    <span className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                      {nivel.label}
                    </span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${nivel.badgeColor}`}>
                    {nivel.badge}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground ml-5 mb-1.5">{nivel.desc}</p>
                {selected && (
                  <ul className="ml-5 space-y-0.5">
                    {nivel.bullets.map((b, i) => (
                      <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0 text-primary">✓</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Escalação ────────────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
        <div className="flex items-center gap-2">
          <Star className="h-3.5 w-3.5 text-primary" />
          <Label className="text-sm font-medium">Prioridade na escala</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Define como o motor trata este membro em solenidades e eventos especiais.
        </p>
        {tiposPrioridade.length > 0 ? (
          <Select
            value={form.prioridade_id}
            onValueChange={(v) => setForm({ ...form, prioridade_id: v })}
          >
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sem prioridade específica" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PRIORIDADE_NONE}>Sem prioridade específica</SelectItem>
              {tiposPrioridade.filter((p) => !!p.id).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.cor }} />
                    {p.nome}
                    <span className="text-xs text-muted-foreground">(peso {p.peso_escala})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={form.prioridade_escala}
            onValueChange={(v) => setForm({ ...form, prioridade_escala: v })}
          >
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Ações ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={saving || !form.nome.trim()}
          onClick={onSave}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

// ── ImportDialog ──────────────────────────────────────────────────────────────

type ImportStep = "upload" | "map" | "preview";
type RawRow = string[];
type MappedRow = {
  nome: string; email: string; telefone: string;
  data_nascimento: string; data_ingresso: string; score: string;
  rg: string; cpf: string; endereco: string; cidade: string; cep: string;
  nome_pais: string; contato_pais: string;
  nome_emergencia: string; telefone_emergencia: string;
  restricoes_horario: string; deslocamento: string;
  funcoes_raw: string; funcoes_ids: string[]; funcoes_unmatched: string[];
  atuacao_raw: string; atuacao_ids: string[]; atuacao_unmatched: string[];
  nao_pode_raw: string; nao_pode_ids: string[]; nao_pode_unmatched: string[];
  _status: "new" | "duplicate"; _dupWith: string; _existingId: string | null;
};
type DupAction = "skip" | "update";
type SavedTemplate = { name: string; mapping: Record<string, string> };

// ── Similaridade textual ──────────────────────────────────────────────────────

type FuzzySuggestion = { id: string; nome: string; score: number };
type FuzzyItem = { original: string; suggestions: FuzzySuggestion[] };

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function strSimilarity(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (!q || !t) return 0;
  if (q === t) return 1;
  // Containment: target está dentro da query (ex: "turíbulo" em "não sabe turíbulo")
  if (q.includes(t)) return 0.82 + 0.18 * (t.length / q.length);
  // Containment inversa
  if (t.includes(q)) return 0.80 + 0.20 * (q.length / t.length);
  // Sobreposição por palavras
  const qWords = new Set(q.split(/\s+/));
  const tWords = t.split(/\s+/);
  const overlap = tWords.filter((w) => qWords.has(w)).length;
  if (overlap > 0) return Math.min(0.79, 0.45 + 0.34 * (overlap / tWords.length));
  // Levenshtein normalizado
  const maxLen = Math.max(q.length, t.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(q, t) / maxLen;
}

function findFuzzy(text: string, ministerios: { id: string; nome: string }[], topN = 4): FuzzySuggestion[] {
  return ministerios
    .map((m) => ({ id: m.id, nome: m.nome, score: strSimilarity(text, m.nome) }))
    .filter((s) => s.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

const TEMPLATE_KEY = "liturgia_import_template";
function loadTemplates(): SavedTemplate[] {
  try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "[]"); } catch { return []; }
}
function persistTemplate(name: string, mapping: Record<string, string>) {
  const all = loadTemplates().filter((t) => t.name !== name);
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify([...all, { name, mapping }]));
}
function deleteTemplate(name: string) {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(loadTemplates().filter((t) => t.name !== name)));
}

const FIELD_LABELS: Record<string, string> = {
  nome: "Nome *",
  email: "E-mail",
  telefone: "Telefone",
  data_nascimento: "Data de nascimento",
  data_ingresso: "Mês/ano de ingresso",
  score: "Pontuação (score)",
  rg: "RG",
  cpf: "CPF",
  endereco: "Endereço",
  cidade: "Cidade",
  cep: "CEP",
  nome_pais: "Nome dos pais",
  contato_pais: "Contato dos pais",
  nome_emergencia: "Contato de emergência (nome)",
  telefone_emergencia: "Contato de emergência (tel.)",
  restricoes_horario: "Restrições de horário",
  deslocamento: "Deslocamento",
  funcoes: "Funções litúrgicas (separadas por vírgula)",
  atuacao: "Atuação pastoral (separadas por vírgula)",
  funcoes_nao_pode: "Funções com restrição — não pode/não sabe (texto livre)",
};

const AUTO_MAP: { field: string; matches: string[] }[] = [
  { field: "nome",                matches: ["nome", "name", "servidor", "membro"] },
  { field: "email",               matches: ["email", "e-mail", "mail"] },
  { field: "telefone",            matches: ["tel", "fone", "cel", "whatsapp", "contato"] },
  { field: "data_nascimento",     matches: ["nasc", "nascimento", "birthday"] },
  { field: "data_ingresso",       matches: ["ingress", "entrada", "inicio", "início"] },
  { field: "score",               matches: ["score", "pontuação", "pontuacao", "ponto"] },
  { field: "rg",                  matches: ["rg"] },
  { field: "cpf",                 matches: ["cpf"] },
  { field: "endereco",            matches: ["endereço", "endereco", "rua", "logradouro"] },
  { field: "cidade",              matches: ["cidade", "city", "municipio"] },
  { field: "cep",                 matches: ["cep", "zip"] },
  { field: "nome_pais",           matches: ["nome_pais", "pais", "responsavel", "responsável", "pai_mae"] },
  { field: "contato_pais",        matches: ["contato_pais", "tel_pais", "fone_pais", "tel_resp"] },
  { field: "nome_emergencia",     matches: ["emergencia_nome", "emergência_nome", "contato_emer", "nome_emerg"] },
  { field: "telefone_emergencia", matches: ["emergencia_tel", "emergência_tel", "tel_emerg", "fone_emerg"] },
  { field: "restricoes_horario",  matches: ["restricao_horario", "restrição", "horario_restrict", "disponib"] },
  { field: "deslocamento",        matches: ["desloc", "transporte", "locomoção", "locomocao"] },
  { field: "funcoes",             matches: ["func", "minist", "cargo", "role"] },
  { field: "atuacao",             matches: ["pastoral", "atua", "atuação", "atuacao", "grupo pastoral"] },
  { field: "funcoes_nao_pode",   matches: ["nao_pode", "não pode", "restricao", "restrição", "restrito", "proibid", "nao sabe", "não sabe", "dificuldade"] },
];

function autoDetect(headers: string[]): Record<string, string> {
  const auto: Record<string, string> = {};
  headers.forEach((h, i) => {
    const hl = h.toLowerCase().trim();
    for (const { field, matches } of AUTO_MAP) {
      if (!auto[field] && matches.some((m) => hl.includes(m))) {
        auto[field] = String(i);
        break;
      }
    }
  });
  return auto;
}

function ImportDialog({
  open, onClose, existingMembros, paroquiaId, onImported,
}: {
  open: boolean; onClose: () => void;
  existingMembros: Membro[]; paroquiaId: string; onImported: () => void;
}) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [dupAction, setDupAction] = useState<DupAction>("skip");
  const [importing, setImporting] = useState(false);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [fuzzyItems, setFuzzyItems] = useState<FuzzyItem[]>([]);
  const [fuzzyMappings, setFuzzyMappings] = useState<Record<string, string | "ignore">>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: ministeriosList = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["ministerios-import", paroquiaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ministerios").select("id, nome")
        .eq("paroquia_id", paroquiaId).eq("ativo", true);
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const { data: atuacoesList = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["atuacoes-import", paroquiaId],
    queryFn: async () => {
      const { data } = await anyDb
        .from("atuacoes_pastorais").select("id, nome")
        .eq("paroquia_id", paroquiaId).eq("ativo", true);
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  useEffect(() => {
    if (!open) {
      setStep("upload"); setHeaders([]); setRows([]);
      setMapping({}); setMappedRows([]); setDupAction("skip"); setTemplateName("");
      setFuzzyItems([]); setFuzzyMappings({});
    } else {
      setTemplates(loadTemplates());
    }
  }, [open]);

  async function handleFile(file: File) {
    try {
      const XLSX = await import("xlsx");
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<RawRow>(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd" });
      const nonEmpty = data.filter((r) => r.some((c) => c?.toString().trim()));
      if (nonEmpty.length < 2) { toast.error("Arquivo sem dados suficientes."); return; }
      const hdrs = nonEmpty[0].map((h) => h?.toString() ?? "");
      setHeaders(hdrs);
      setRows(nonEmpty.slice(1));
      setMapping(autoDetect(hdrs));
      setStep("map");
    } catch {
      toast.error("Não foi possível ler o arquivo. Verifique se é CSV ou XLSX válido.");
    }
  }

  function buildPreview() {
    const byName = new Map(existingMembros.map((m) => [m.nome.toLowerCase().trim(), m.id]));
    const byEmail = new Map(existingMembros.filter((m) => m.email).map((m) => [m.email!.toLowerCase().trim(), m.id]));
    const minLookup = new Map(ministeriosList.map((m) => [m.nome.toLowerCase().trim(), m.id]));
    const atuLookup = new Map(atuacoesList.map((a) => [a.nome.toLowerCase().trim(), a.id]));
    const result: MappedRow[] = [];
    for (const row of rows) {
      const get = (f: string) => {
        const idx = mapping[f];
        return idx !== undefined ? (row[Number(idx)] ?? "").toString().trim() : "";
      };
      const nome = get("nome");
      if (!nome) continue;
      const email = get("email");

      const funcoes_raw = get("funcoes");
      const funcoes_ids: string[] = [];
      const funcoes_unmatched: string[] = [];
      if (funcoes_raw) {
        funcoes_raw.split(/[,;]/).map((f) => f.trim()).filter(Boolean).forEach((fn) => {
          const id = minLookup.get(fn.toLowerCase());
          if (id) funcoes_ids.push(id); else funcoes_unmatched.push(fn);
        });
      }

      const atuacao_raw = get("atuacao");
      const atuacao_ids: string[] = [];
      const atuacao_unmatched: string[] = [];
      if (atuacao_raw) {
        atuacao_raw.split(/[,;]/).map((a) => a.trim()).filter(Boolean).forEach((an) => {
          const id = atuLookup.get(an.toLowerCase());
          if (id) atuacao_ids.push(id); else atuacao_unmatched.push(an);
        });
      }

      // Funções com restrição: tenta exact match, resto vai para fuzzy
      const nao_pode_raw = get("funcoes_nao_pode");
      const nao_pode_ids: string[] = [];
      const nao_pode_unmatched: string[] = [];
      if (nao_pode_raw) {
        nao_pode_raw.split(/[,;]/).map((f) => f.trim()).filter(Boolean).forEach((fn) => {
          const id = minLookup.get(fn.toLowerCase());
          if (id) nao_pode_ids.push(id); else nao_pode_unmatched.push(fn);
        });
      }

      const idByName = byName.get(nome.toLowerCase());
      const idByEmail = email ? byEmail.get(email.toLowerCase()) : undefined;
      const existingId = idByName ?? idByEmail ?? null;
      result.push({
        nome, email, telefone: get("telefone"),
        data_nascimento: get("data_nascimento"), data_ingresso: get("data_ingresso"),
        score: get("score"),
        rg: get("rg"), cpf: get("cpf"), endereco: get("endereco"),
        cidade: get("cidade"), cep: get("cep"),
        nome_pais: get("nome_pais"), contato_pais: get("contato_pais"),
        nome_emergencia: get("nome_emergencia"), telefone_emergencia: get("telefone_emergencia"),
        restricoes_horario: get("restricoes_horario"), deslocamento: get("deslocamento"),
        funcoes_raw, funcoes_ids, funcoes_unmatched,
        atuacao_raw, atuacao_ids, atuacao_unmatched,
        nao_pode_raw, nao_pode_ids, nao_pode_unmatched,
        _status: existingId ? "duplicate" : "new",
        _dupWith: existingId ? (idByName ? nome : email) : "",
        _existingId: existingId,
      });
    }

    // Computa fuzzy matches para textos não reconhecidos em funcoes_nao_pode
    const uniqueUnmatched = [...new Set(result.flatMap((r) => r.nao_pode_unmatched))];
    const newFuzzyItems: FuzzyItem[] = uniqueUnmatched.map((original) => ({
      original,
      suggestions: findFuzzy(original, ministeriosList),
    }));
    setFuzzyItems(newFuzzyItems);
    setFuzzyMappings({});

    setMappedRows(result);
    setStep("preview");
  }

  async function doImport() {
    setImporting(true);
    const toInsert = mappedRows.filter((r) => r._status === "new");
    const toUpdate = dupAction === "update" ? mappedRows.filter((r) => r._status === "duplicate" && r._existingId) : [];
    if (toInsert.length === 0 && toUpdate.length === 0) {
      toast.info("Nenhum membro para importar."); setImporting(false); return;
    }
    let insertErr: string | null = null;
    let updateErrors = 0;

    if (toInsert.length > 0) {
      // Generate IDs client-side to avoid INSERT...RETURNING which triggers RLS recursion
      const idsForInsert = toInsert.map(() => crypto.randomUUID());
      const { error } = await anyDb.from("membros").insert(
        toInsert.map((r, idx) => ({
          id: idsForInsert[idx],
          paroquia_id: paroquiaId,
          nome: r.nome,
          email: r.email || null,
          telefone: r.telefone || null,
          data_nascimento: r.data_nascimento || null,
          data_ingresso: r.data_ingresso || null,
          score: r.score ? Number(r.score) || 0 : 0,
          rg: r.rg || null,
          cpf: r.cpf || null,
          endereco: r.endereco || null,
          cidade: r.cidade || null,
          cep: r.cep || null,
          nome_pais: r.nome_pais || null,
          contato_pais: r.contato_pais || null,
          nome_emergencia: r.nome_emergencia || null,
          telefone_emergencia: r.telefone_emergencia || null,
          restricoes_horario: r.restricoes_horario || null,
          deslocamento: r.deslocamento || null,
          ativo: true,
        }))
      );
      if (error) { insertErr = (error as { message: string }).message; }
      else {
        const funcRows: { membro_id: string; ministerio_id: string }[] = [];
        const atuRows: { membro_id: string; atuacao_id: string }[] = [];
        const restricRows: { membro_id: string; ministerio_id: string; tipo: string }[] = [];
        toInsert.forEach((r, idx) => {
          const mid = idsForInsert[idx];
          r.funcoes_ids.forEach((fid) => funcRows.push({ membro_id: mid, ministerio_id: fid }));
          r.atuacao_ids.forEach((aid) => atuRows.push({ membro_id: mid, atuacao_id: aid }));
          // Exact matches
          r.nao_pode_ids.forEach((fid) => restricRows.push({ membro_id: mid, ministerio_id: fid, tipo: "nao_pode" }));
          // Fuzzy-confirmed matches
          r.nao_pode_unmatched.forEach((txt) => {
            const mapped = fuzzyMappings[txt];
            if (mapped && mapped !== "ignore") restricRows.push({ membro_id: mid, ministerio_id: mapped, tipo: "nao_pode" });
          });
        });
        if (funcRows.length > 0) await supabase.from("membro_ministerios").insert(funcRows);
        if (atuRows.length > 0) await anyDb.from("membro_atuacoes").insert(atuRows).throwOnError().catch(() => {});
        if (restricRows.length > 0) await anyDb.from("membro_funcao_restricoes").insert(restricRows).throwOnError().catch(() => {});
      }
    }

    for (const r of toUpdate) {
      const patch: Record<string, unknown> = {};
      if (r.email) patch.email = r.email;
      if (r.telefone) patch.telefone = r.telefone;
      if (r.data_nascimento) patch.data_nascimento = r.data_nascimento;
      if (r.data_ingresso) patch.data_ingresso = r.data_ingresso;
      if (r.score) patch.score = Number(r.score) || 0;
      if (r.rg) patch.rg = r.rg;
      if (r.cpf) patch.cpf = r.cpf;
      if (r.endereco) patch.endereco = r.endereco;
      if (r.cidade) patch.cidade = r.cidade;
      if (r.cep) patch.cep = r.cep;
      if (r.nome_pais) patch.nome_pais = r.nome_pais;
      if (r.contato_pais) patch.contato_pais = r.contato_pais;
      if (r.nome_emergencia) patch.nome_emergencia = r.nome_emergencia;
      if (r.telefone_emergencia) patch.telefone_emergencia = r.telefone_emergencia;
      if (r.restricoes_horario) patch.restricoes_horario = r.restricoes_horario;
      if (r.deslocamento) patch.deslocamento = r.deslocamento;
      if (Object.keys(patch).length > 0) {
        const { error } = await anyDb.from("membros").update(patch).eq("id", r._existingId!);
        if (error) updateErrors++;
      }
      if (r.funcoes_ids.length > 0 && r._existingId) {
        await anyDb.from("membro_ministerios").upsert(
          r.funcoes_ids.map((fid) => ({ membro_id: r._existingId!, ministerio_id: fid })),
          { onConflict: "membro_id,ministerio_id", ignoreDuplicates: true },
        );
      }
      // Restrições (nao_pode) para membros atualizados
      if (r._existingId) {
        const restricIds: string[] = [
          ...r.nao_pode_ids,
          ...r.nao_pode_unmatched.map((txt) => fuzzyMappings[txt]).filter((v): v is string => !!v && v !== "ignore"),
        ];
        if (restricIds.length > 0) {
          await anyDb.from("membro_funcao_restricoes").upsert(
            restricIds.map((fid) => ({ membro_id: r._existingId!, ministerio_id: fid, tipo: "nao_pode" })),
            { onConflict: "membro_id,ministerio_id", ignoreDuplicates: true },
          ).throwOnError().catch(() => {});
        }
      }
    }

    setImporting(false);
    if (insertErr) { toast.error(insertErr); return; }
    const parts: string[] = [];
    if (toInsert.length > 0) parts.push(`${toInsert.length} inserido(s)`);
    if (toUpdate.length > 0) parts.push(`${toUpdate.length - updateErrors} atualizado(s)`);
    toast.success("Importação concluída: " + parts.join(", ") + ".");
    onImported();
    onClose();
  }

  const newCount = mappedRows.filter((r) => r._status === "new").length;
  const dupCount = mappedRows.filter((r) => r._status === "duplicate").length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar membros</DialogTitle>
        </DialogHeader>

        {/* Indicadores de passo */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {(["upload", "map", "preview"] as ImportStep[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={step === s ? "text-foreground font-semibold" : ""}>
                {s === "upload" ? "1. Arquivo" : s === "map" ? "2. Colunas" : "3. Revisão"}
              </span>
            </span>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 space-y-4">
          {/* ── Passo 1: Upload ── */}
          {step === "upload" && (
            <div>
              <div
                className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground mt-1">CSV ou XLSX (Excel)</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {/* ── Passo 2: Mapeamento ── */}
          {step === "map" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Associe as colunas da planilha aos campos do sistema. <strong>Nome</strong> é obrigatório.
              </p>

              {templates.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Templates salvos</p>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((t) => (
                      <div key={t.name} className="flex items-center gap-1">
                        <button type="button"
                          className="text-xs px-2.5 py-1 rounded-md border border-border bg-background hover:bg-accent transition"
                          onClick={() => setMapping(t.mapping)}
                        >{t.name}</button>
                        <button type="button"
                          className="text-muted-foreground hover:text-destructive transition"
                          onClick={() => { deleteTemplate(t.name); setTemplates(loadTemplates()); }}
                        ><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {Object.entries(FIELD_LABELS).map(([field, label]) => (
                  <div key={field} className={field === "funcoes" ? "col-span-2" : ""}>
                    <Label className="text-xs">{label}</Label>
                    {field === "funcoes" && ministeriosList.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Disponíveis: {ministeriosList.map((m) => m.nome).join(", ")}
                      </p>
                    )}
                    <select
                      value={mapping[field] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                    >
                      <option value="">— ignorar —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={String(i)}>{h || `Coluna ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border overflow-x-auto">
                <p className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border bg-muted/30">
                  Pré-visualização (3 primeiras linhas)
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {headers.map((h, i) => <th key={i} className="px-3 py-1.5 text-left font-medium">{h || `Col ${i + 1}`}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 3).map((row, ri) => (
                      <tr key={ri} className="border-b border-border last:border-0">
                        {headers.map((_, ci) => <td key={ci} className="px-3 py-1.5 text-muted-foreground">{row[ci] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2">
                <input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Nome do template..."
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring" />
                <Button type="button" variant="outline" size="sm"
                  disabled={!templateName.trim()}
                  onClick={() => {
                    persistTemplate(templateName.trim(), mapping);
                    setTemplates(loadTemplates());
                    setTemplateName("");
                    toast.success("Template salvo.");
                  }}
                >Salvar template</Button>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setStep("upload")}>Voltar</Button>
                <Button disabled={!mapping.nome} onClick={buildPreview}>
                  Continuar <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Passo 3: Preview ── */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500" />{newCount} novos
                </span>
                {dupCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />{dupCount} duplicados
                  </span>
                )}
              </div>

              {dupCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    {dupCount} membro(s) já cadastrado(s) — o que fazer?
                  </p>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dupAction" value="skip" checked={dupAction === "skip"} onChange={() => setDupAction("skip")} />
                      Ignorar duplicados
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dupAction" value="update" checked={dupAction === "update"} onChange={() => setDupAction("update")} />
                      Atualizar dados (e-mail, tel, datas, score)
                    </label>
                  </div>
                </div>
              )}

              {/* ── Painel de similaridade: funções com restrição ── */}
              {fuzzyItems.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                      Correspondência de funções com restrição
                    </p>
                    <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-0.5">
                      Textos da planilha não reconhecidos. Selecione a função correspondente ou ignore.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {fuzzyItems.map((item) => {
                      const chosen = fuzzyMappings[item.original];
                      return (
                        <div key={item.original} className="rounded-md bg-white dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800 px-3 py-2 space-y-1.5">
                          <p className="text-xs font-medium text-foreground">
                            Texto: <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">{item.original}</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {item.suggestions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setFuzzyMappings((prev) => ({ ...prev, [item.original]: s.id }))}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                  chosen === s.id
                                    ? "bg-blue-600 text-white border-blue-600"
                                    : "bg-background text-foreground border-border hover:border-blue-400 hover:bg-blue-50"
                                }`}
                              >
                                {s.nome}
                                <span className={`text-[10px] ${chosen === s.id ? "text-blue-200" : "text-muted-foreground"}`}>
                                  {Math.round(s.score * 100)}%
                                </span>
                              </button>
                            ))}
                            {item.suggestions.length === 0 && (
                              <span className="text-xs text-muted-foreground italic">Nenhuma sugestão encontrada</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setFuzzyMappings((prev) => ({ ...prev, [item.original]: "ignore" }))}
                              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                chosen === "ignore"
                                  ? "bg-muted text-muted-foreground border-border"
                                  : "bg-background text-muted-foreground border-dashed border-border hover:border-destructive hover:text-destructive"
                              }`}
                            >
                              Ignorar
                            </button>
                          </div>
                          {chosen && chosen !== "ignore" && (
                            <p className="text-[11px] text-blue-700 dark:text-blue-300">
                              ✓ Mapeado para: <strong>{ministeriosList.find((m) => m.id === chosen)?.nome}</strong>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-blue-600 dark:text-blue-400">
                    {Object.keys(fuzzyMappings).length}/{fuzzyItems.length} texto(s) resolvido(s)
                    {Object.keys(fuzzyMappings).length < fuzzyItems.length && " — textos não resolvidos serão ignorados na importação."}
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Nome</th>
                        <th className="px-3 py-2 text-left font-medium">E-mail</th>
                        <th className="px-3 py-2 text-left font-medium">Telefone</th>
                        <th className="px-3 py-2 text-left font-medium">Score</th>
                        {mapping.funcoes && <th className="px-3 py-2 text-left font-medium">Funções</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mappedRows.map((r, i) => (
                        <tr key={i} className={`border-b border-border last:border-0 ${r._status === "duplicate" ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                          <td className="px-3 py-1.5">
                            {r._status === "new"
                              ? <span className="text-green-600 font-medium">Novo</span>
                              : <span className="text-amber-600 font-medium">Dup.</span>}
                          </td>
                          <td className="px-3 py-1.5 font-medium">{r.nome}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.email || "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.telefone || "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.score || "—"}</td>
                          {mapping.funcoes && (
                            <td className="px-3 py-1.5">
                              {r.funcoes_ids.length > 0 && (
                                <span className="text-green-600 text-xs">
                                  {ministeriosList.filter((m) => r.funcoes_ids.includes(m.id)).map((m) => m.nome).join(", ")}
                                </span>
                              )}
                              {r.funcoes_unmatched.length > 0 && (
                                <span className="text-amber-600 text-xs ml-1" title="Não encontradas">
                                  ⚠ {r.funcoes_unmatched.join(", ")}
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setStep("map")}>Voltar</Button>
                <Button
                  disabled={importing || (newCount === 0 && (dupAction === "skip" || dupCount === 0))}
                  onClick={doImport}
                >
                  {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {dupAction === "update" && dupCount > 0
                    ? `Importar ${newCount} + atualizar ${dupCount}`
                    : `Importar ${newCount} membro(s)`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Auto-parse de restrições de horário ──────────────────────────────────────

function normalizarTexto(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâãä]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ç]/g, "c")
    .replace(/[ñ]/g, "n");
}

// Extrai os dias da semana (0=Dom … 6=Sáb) mencionados em um texto livre.
// Divide o texto em tokens para evitar problemas com word-boundary (\b) e Unicode.
function detectarDias(norm: string): Set<number> {
  const dias = new Set<number>();

  // Frases compostas (verificar antes de tokenizar)
  if (/fim\s+de\s+semana|fds/.test(norm))          { dias.add(0); dias.add(6); }
  if (/dias?\s+ut[ei]is?|dias?\s+de\s+semana/.test(norm)) [1,2,3,4,5].forEach(d => dias.add(d));

  // Divide em tokens por qualquer coisa que não seja letra ou dígito
  const tokens = norm.split(/[^a-z0-9]+/).filter(t => t.length > 0);

  const MAPA: Record<string, number> = {
    dom: 0, domingo: 0, domingos: 0,
    seg: 1, segunda: 1, segundas: 1,
    ter: 2, terca: 2, tercas: 2,
    qua: 3, quarta: 3, quartas: 3,
    qui: 4, quinta: 4, quintas: 4,
    sex: 5, sexta: 5, sextas: 5,
    sab: 6, sabado: 6, sabados: 6,
  };

  for (const t of tokens) {
    const d = MAPA[t];
    if (d !== undefined) dias.add(d);
  }

  return dias;
}

function parseDiasRestricao(text: string): number[] {
  if (!text.trim()) return [];
  return [...detectarDias(normalizarTexto(text))].sort((a, b) => a - b);
}

// Detecta quais missas padrão um texto de restrição menciona.
// Lógica híbrida: dias mencionados SEM horário bloqueiam TODAS as missas daquele dia;
// dias COM horário explícito bloqueiam somente aquela missa específica.
function autoDetectMissaRestricoes(text: string, missas: MissaPadrao[]): string[] {
  if (!text.trim() || missas.length === 0) return [];

  const norm = normalizarTexto(text);

  const MAPA_DIA: Record<string, number> = {
    dom: 0, domingo: 0, domingos: 0,
    seg: 1, segunda: 1, segundas: 1,
    ter: 2, terca: 2, tercas: 2,
    qua: 3, quarta: 3, quartas: 3,
    qui: 4, quinta: 4, quintas: 4,
    sex: 5, sexta: 5, sextas: 5,
    sab: 6, sabado: 6, sabados: 6,
  };

  // Dias gerais (sem horário específico) — bloqueia todas as missas daquele dia
  const generalDays = new Set<number>();

  // Frases compostas — sempre gerais
  if (/fim\s+de\s+semana|fds/.test(norm))                      { generalDays.add(0); generalDays.add(6); }
  if (/dias?\s+ut[ei]is?|dias?\s+de\s+semana/.test(norm))      [1, 2, 3, 4, 5].forEach(d => generalDays.add(d));

  // Tokeniza: extrai palavras e padrões de horário em ordem
  type Tok = { kind: "dia"; dia: number } | { kind: "time"; hora: string } | { kind: "other" };
  const tokenRe = /(\d{1,2})h(\d{2})?|(\d{1,2}):(\d{2})|[a-z]+/g;
  const tokens: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(norm)) !== null) {
    const raw = m[0];
    if (raw in MAPA_DIA) {
      tokens.push({ kind: "dia", dia: MAPA_DIA[raw] });
    } else if (/^\d/.test(raw)) {
      const h   = (m[1] ?? m[3] ?? "0").padStart(2, "0");
      const min = m[2] ?? m[4] ?? "00";
      tokens.push({ kind: "time", hora: `${h}:${min}` });
    } else {
      tokens.push({ kind: "other" });
    }
  }

  // Para cada token de dia, procura o próximo token até encontrar outro dia ou um horário.
  // Se achar horário primeiro → restrição específica; se achar outro dia (ou fim) → geral.
  const specificPairs: Array<{ dia: number; hora: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.kind !== "dia") continue;

    let foundTime: string | undefined;
    for (let j = i + 1; j < tokens.length; j++) {
      const next = tokens[j];
      if (next.kind === "dia") break;      // próximo dia encontrado — sem horário para o atual
      if (next.kind === "time") { foundTime = next.hora; break; }
    }

    if (foundTime !== undefined) {
      specificPairs.push({ dia: tok.dia, hora: foundTime });
    } else {
      generalDays.add(tok.dia);
    }
  }

  if (generalDays.size === 0 && specificPairs.length === 0) return [];

  const result = new Set<string>();
  for (const missa of missas) {
    const dia  = Number(missa.dia_semana);
    const hora = missa.hora_inicio ? missa.hora_inicio.slice(0, 5) : null;

    if (generalDays.has(dia)) { result.add(missa.id); continue; }

    for (const pair of specificPairs) {
      if (pair.dia === dia && hora !== null && hora === pair.hora) {
        result.add(missa.id);
        break;
      }
    }
  }

  return [...result];
}

// ── BulkEditForm ──────────────────────────────────────────────────────────────

type BulkEditForm = {
  // Dados pessoais
  changeSexo: boolean;
  sexo: string;
  changeTipoAcesso: boolean;
  tipo_acesso: string;
  changeComunidade: boolean;
  comunidade_id: string;
  changeIngresso: boolean;
  data_ingresso: string;
  // Escala
  changePrioridade: boolean;
  prioridade: string;
  changeRestricoesDia: boolean;
  restricoes_dia_semana: number[];
  changeMissasRestricao: boolean;
  missasRestricaoMode: "adicionar" | "substituir";
  missas_nao_pode_ids: string[];
  // Funções litúrgicas
  changeFuncoes: boolean;
  funcoesMode: "adicionar" | "substituir";
  funcao_ids: string[];
  // Atuação pastoral
  changeAtuacoes: boolean;
  atuacoesMode: "adicionar" | "substituir";
  atuacao_ids: string[];
  // Restrições de função
  changeRestricoes: boolean;
  restricoesMode: "adicionar" | "substituir";
  restricao_ids: string[];
};

const EMPTY_BULK_EDIT: BulkEditForm = {
  changeSexo: false,
  sexo: "",
  changeTipoAcesso: false,
  tipo_acesso: "membro",
  changeComunidade: false,
  comunidade_id: "",
  changeIngresso: false,
  data_ingresso: "",
  changePrioridade: false,
  prioridade: "nenhuma",
  changeRestricoesDia: false,
  restricoes_dia_semana: [],
  changeMissasRestricao: false,
  missasRestricaoMode: "adicionar",
  missas_nao_pode_ids: [],
  changeFuncoes: false,
  funcoesMode: "adicionar",
  funcao_ids: [],
  changeAtuacoes: false,
  atuacoesMode: "adicionar",
  atuacao_ids: [],
  changeRestricoes: false,
  restricoesMode: "adicionar",
  restricao_ids: [],
};

// ── MembrosPage ───────────────────────────────────────────────────────────────

function MembrosPage() {
  const { profile, isAdmin, isCoordenador } = useAuth();
  const isLimitedCoord = isCoordenador && !isAdmin;
  const qc = useQueryClient();
  const { abrir: abrirMembroId } = Route.useSearch();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Membro | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterMin, setFilterMin] = useState("todos");
  const [filterSituacao, setFilterSituacao] = useState("ativos");
  const [filterSexo, setFilterSexo] = useState("todos");
  const [filterDisponibilidade, setFilterDisponibilidade] = useState("todas");
  const [filterAtuacao, setFilterAtuacao] = useState("todas");
  const [filterComunidade, setFilterComunidade] = useState("todas");
  const [filterPrioridade, setFilterPrioridade] = useState("todas");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [bulkSendProgress, setBulkSendProgress] = useState(0);
  const [bulkSendTotal, setBulkSendTotal] = useState(0);
  const [bulkSendRunning, setBulkSendRunning] = useState(false);
  const [bulkSendLog, setBulkSendLog] = useState<{ nome: string; ok: boolean }[]>([]);
  const [newIndisp, setNewIndisp] = useState("");
  const [newIndispMotivo, setNewIndispMotivo] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState<BulkEditForm>(EMPTY_BULK_EDIT);

  // ── Estado das solicitações ────────────────────────────────────────────
  const [solSelecionada, setSolSelecionada] = useState<SolicitacaoMembro | null>(null);
  const [solMotivoRejeicao, setSolMotivoRejeicao] = useState("");
  const [showSolRejeitar, setShowSolRejeitar] = useState(false);

  const pid = profile?.paroquia_id ?? null;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: missasPadrao = [] } = useQuery<MissaPadrao[]>({
    queryKey: ["missas-padrao-all", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await anyDb
        .from("missas_padrao")
        .select("id, nome, hora_inicio, dia_semana, recorrencia")
        .eq("paroquia_id", pid!)
        .eq("ativo", true)
        .order("dia_semana")
        .order("hora_inicio");
      return (data ?? []) as MissaPadrao[];
    },
  });

  const { data: paroquiaInfo } = useQuery<{ slug: string | null; nome: string } | null>({
    queryKey: ["paroquia-info", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await anyDb
        .from("paroquias").select("slug, nome").eq("id", pid!).maybeSingle();
      return data ?? null;
    },
  });
  const paroquiaSlug = paroquiaInfo?.slug ?? null;
  const paroquia = paroquiaInfo;

  const { data: ministerios = [] } = useQuery({
    queryKey: ["ministerios", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await supabase
        .from("ministerios").select("id, nome, cor")
        .eq("paroquia_id", pid!).eq("ativo", true).order("ordem");
      return (data ?? []) as Ministerio[];
    },
  });

  const { data: atuacoes = [] } = useQuery({
    queryKey: ["atuacoes_pastorais", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("atuacoes_pastorais").select("id, nome, cor, icone")
        .eq("paroquia_id", pid!).eq("ativo", true).order("ordem");
      if (error) return [];
      return (data ?? []) as Atuacao[];
    },
  });

  const { data: comunidades = [] } = useQuery<Comunidade[]>({
    queryKey: ["comunidades", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunidades").select("id, nome")
        .eq("paroquia_id", pid!).eq("ativo", true).order("nome");
      return (data ?? []) as Comunidade[];
    },
  });

  const { data: tiposPrioridade = [] } = useQuery<TipoPrioridade[]>({
    queryKey: ["tipos_prioridade", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await anyDb
        .from("tipos_prioridade").select("id, nome, cor, peso_escala")
        .eq("paroquia_id", pid!).eq("ativo", true).order("ordem");
      return (data ?? []) as TipoPrioridade[];
    },
  });

  const { data: membros = [], isLoading, isError, error: membrosQueryError } = useQuery({
    queryKey: ["membros", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data: rawMembros, error } = await anyDb
        .from("membros")
        .select("id, nome, email, telefone, data_nascimento, data_ingresso, observacoes, score, ativo, conta_ativada, forcar_escalacao_solene, prioridade_escala, prioridade_id, tipo_acesso, token_acesso, auth_user_id, comunidade_id, sexo, foto_url, restricoes_dia_semana")
        .eq("paroquia_id", pid!).order("nome");
      if (error) throw error;
      const rows = (rawMembros ?? []) as any[];
      const ids = rows.map((m: any) => m.id);
      if (ids.length === 0) return [];
      const [mmsRes, atuRes] = await Promise.all([
        supabase
          .from("membro_ministerios")
          .select("membro_id, ministerio_id, ministerios(id, nome, cor)")
          .in("membro_id", ids),
        anyDb.from("membro_atuacoes").select("membro_id, atuacao_id").in("membro_id", ids),
      ]);
      const mmMap: Record<string, Ministerio[]> = {};
      (mmsRes.data ?? []).forEach((r: any) => {
        if (!mmMap[r.membro_id]) mmMap[r.membro_id] = [];
        if (r.ministerios) mmMap[r.membro_id].push(r.ministerios);
      });
      const atuMap: Record<string, string[]> = {};
      (atuRes.data ?? []).forEach((r: any) => {
        if (!atuMap[r.membro_id]) atuMap[r.membro_id] = [];
        atuMap[r.membro_id].push(r.atuacao_id);
      });
      return rows.map((m: any) => ({
        ...m,
        score: m.score ?? 0,
        conta_ativada: m.conta_ativada ?? null,
        prioridade_escala: m.prioridade_escala ?? "nenhuma",
        auth_user_id: m.auth_user_id ?? null,
        comunidade_id: m.comunidade_id ?? null,
        ministerios: mmMap[m.id] ?? [],
        atuacao_ids: atuMap[m.id] ?? [],
        prioridade_id: m.prioridade_id ?? null,
        tipo_acesso: m.tipo_acesso ?? "membro",
        foto_url: m.foto_url ?? null,
        restricoes_dia_semana: m.restricoes_dia_semana ?? [],
      })) as Membro[];
    },
  });

  // ── Solicitações ──────────────────────────────────────────────────────
  const { data: solicitacoes = [], isLoading: loadingSol } = useQuery<SolicitacaoMembro[]>({
    queryKey: ["solicitacoes", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("solicitacoes_membros")
        .select("*")
        .eq("paroquia_id", pid!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const solPendentes  = solicitacoes.filter((s) => s.status === "pendente");

  const aprovarSolMutation = useMutation({
    mutationFn: async (sol: SolicitacaoMembro) => {
      const d = sol.dados_json ?? {};
      const data_ingresso = d.ingresso_mes && d.ingresso_ano
        ? `${d.ingresso_ano}-${String(d.ingresso_mes).padStart(2, "0")}-01`
        : d.data_ingresso || null;
      const nome_pais = [d.nome_mae, d.nome_pai].filter(Boolean).join(" / ") || null;
      const contato_pais = [d.contato_mae, d.contato_pai].filter(Boolean).join(" / ") || null;

      const { data: novoMembro, error: memberErr } = await anyDb
        .from("membros")
        .insert({
          paroquia_id: sol.paroquia_id,
          nome: sol.nome, email: sol.email, telefone: sol.telefone,
          data_nascimento: d.data_nascimento || null, data_ingresso,
          tipo_acesso: "membro", ativo: true, score: 0,
          foto_url: sol.foto_url || null,
          sexo: d.sexo || null, cpf: d.cpf || null, rg: d.rg || null,
          endereco: d.endereco || null, cidade: d.cidade || null,
          comunidade_id: d.comunidade_id || null,
          nome_pais, contato_pais,
          deslocamento: d.possui_conducao === "sim" ? "Possui condução própria" : null,
          restricoes_horario: d.horarios_indisponivel || d.motivo_indisponibilidade || null,
          motivo_disponibilidade: d.motivo_indisponibilidade || null,
          observacoes: d.observacoes || null,
        })
        .select("id").single();
      if (memberErr) throw memberErr;

      // Associa atuações pastorais (ex: Acólito, Cerimoniário)
      const atuacao_ids: string[] = Array.isArray(d.atuacao_ids) ? d.atuacao_ids : [];
      if (atuacao_ids.length > 0 && novoMembro?.id) {
        await anyDb.from("membro_atuacoes").insert(
          atuacao_ids.map((aid: string) => ({ membro_id: novoMembro.id, atuacao_id: aid, paroquia_id: sol.paroquia_id }))
        );
      }

      // Registra restrições de missas padrão (missas que não consegue servir)
      const missas_nao_pode_ids: string[] = Array.isArray(d.missas_nao_pode_ids) ? d.missas_nao_pode_ids : [];
      if (missas_nao_pode_ids.length > 0 && novoMembro?.id) {
        try {
          await anyDb.from("membro_missa_restricoes").insert(
            missas_nao_pode_ids.map((mid: string) => ({ membro_id: novoMembro.id, missa_padrao_id: mid }))
          );
        } catch { /* tabela pode não existir — não-fatal */ }
      }

      // Envia magic link
      if (sol.email) {
        try {
          await supabase.auth.signInWithOtp({
            email: sol.email,
            options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + "/membro/ativar-conta" },
          });
        } catch { /* non-fatal */ }
      }

      const { data: authData } = await supabase.auth.getUser();
      const { error: updErr } = await anyDb
        .from("solicitacoes_membros")
        .update({ status: "aprovado", aprovado_por: authData.user?.id ?? null, aprovado_em: new Date().toISOString() })
        .eq("id", sol.id);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes", pid] });
      qc.invalidateQueries({ queryKey: ["solicitacoes-pendentes-count", pid] });
      qc.invalidateQueries({ queryKey: ["membros", pid] });
      toast.success("Membro aprovado! Link de acesso enviado por e-mail.");
      setSolSelecionada(null);
    },
    onError: (e: Error) => toast.error("Erro ao aprovar: " + e.message),
  });

  const rejeitarSolMutation = useMutation({
    mutationFn: async ({ sol, motivo }: { sol: SolicitacaoMembro; motivo: string }) => {
      const { error } = await anyDb
        .from("solicitacoes_membros")
        .update({ status: "rejeitado", motivo_rejeicao: motivo.trim() || null })
        .eq("id", sol.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes", pid] });
      qc.invalidateQueries({ queryKey: ["solicitacoes-pendentes-count", pid] });
      toast.success("Solicitação rejeitada.");
      setSolSelecionada(null);
      setShowSolRejeitar(false);
      setSolMotivoRejeicao("");
    },
    onError: (e: Error) => toast.error("Erro ao rejeitar: " + e.message),
  });

  // Abre membro via search param ?abrir=id (vindo de links profundos do painel)
  useEffect(() => {
    if (!abrirMembroId || !membros.length || sheetOpen) return;
    const found = membros.find((m) => m.id === abrirMembroId);
    if (found) openEdit(found);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirMembroId, membros.length]);

  const filtered = useMemo(() => {
    let list = membros;
    if (filterSituacao === "ativos") list = list.filter((m) => m.ativo);
    if (filterSituacao === "inativos") list = list.filter((m) => !m.ativo);
    if (filterSituacao === "com_acesso") list = list.filter((m) => m.ativo && m.conta_ativada === true);
    if (filterSituacao === "sem_acesso") list = list.filter((m) => m.ativo && m.conta_ativada !== true);
    if (filterSexo !== "todos") list = list.filter((m) => m.sexo === filterSexo);
    if (filterDisponibilidade === "sem_restricoes") list = list.filter((m) => m.restricoes_dia_semana.length === 0);
    if (filterDisponibilidade === "com_restricoes") list = list.filter((m) => m.restricoes_dia_semana.length > 0);
    if (filterMin !== "todos") list = list.filter((m) => m.ministerios.some((mn) => mn.id === filterMin));
    if (filterAtuacao !== "todas") list = list.filter((m) => m.atuacao_ids.includes(filterAtuacao));
    if (filterComunidade !== "todas") list = list.filter((m) => m.comunidade_id === filterComunidade);
    if (filterPrioridade !== "todas") list = list.filter((m) => m.prioridade_escala === filterPrioridade);
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((m) =>
        m.nome.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.telefone?.includes(q)
      );
    }
    return list;
  }, [membros, debouncedSearch, filterMin, filterSituacao, filterSexo, filterDisponibilidade, filterAtuacao, filterComunidade, filterPrioridade]);

  async function handleExportExcel() {
    const XLSX = await import("xlsx");
    const rows = filtered.map((m) => ({
      "Nome": m.nome,
      "E-mail": m.email ?? "",
      "Telefone": m.telefone ?? "",
      "Sexo": m.sexo === "M" ? "Masculino" : m.sexo === "F" ? "Feminino" : "",
      "Nasc.": m.data_nascimento ?? "",
      "Ingresso": m.data_ingresso ?? "",
      "Funções": m.ministerios.map((mn) => mn.nome).join(", "),
      "Pastorais": m.atuacao_ids.map((id) => atuacoes.find((a) => a.id === id)?.nome ?? "").filter(Boolean).join(", "),
      "Situação": m.ativo ? "Ativo" : "Inativo",
      "Score": m.score,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Membros");
    XLSX.writeFile(wb, `membros_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportPDF() {
    const cols = ["Nome", "E-mail", "Telefone", "Sexo", "Funções", "Pastorais", "Situação", "Score"];
    const rows = filtered.map((m) => [
      m.nome,
      m.email ?? "",
      m.telefone ?? "",
      m.sexo === "M" ? "M" : m.sexo === "F" ? "F" : "",
      m.ministerios.map((mn) => mn.nome).join(", "),
      m.atuacao_ids.map((id) => atuacoes.find((a) => a.id === id)?.nome ?? "").filter(Boolean).join(", "),
      m.ativo ? "Ativo" : "Inativo",
      m.score,
    ]);
    const now = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Membros</title><style>
      *{box-sizing:border-box;font-family:sans-serif;font-size:11px}
      body{margin:20px;color:#111}
      h2{font-size:15px;margin:0 0 4px}
      p.sub{color:#666;margin:0 0 14px;font-size:10px}
      table{width:100%;border-collapse:collapse}
      th{background:#1e293b;color:#fff;text-align:left;padding:5px 7px}
      td{padding:4px 7px;border-bottom:1px solid #e2e8f0}
      tr:nth-child(even) td{background:#f8fafc}
      @media print{@page{size:landscape}}
    </style></head><body>
      <h2>Membros — Lumen Pastoral</h2>
      <p class="sub">Gerado em ${now} · ${filtered.length} membro(s) exibido(s)</p>
      <table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permita pop-ups para gerar o PDF."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!pid) throw new Error("Paróquia não identificada. Recarregue a página.");

      const payload = {
        nome: form.nome.trim(),
        email: form.email.trim().toLowerCase() || null,
        telefone: form.telefone || null,
        data_nascimento: form.data_nascimento || null,
        data_ingresso: form.data_ingresso || null,
        cpf: form.cpf || null,
        rg: form.rg || null,
        foto_url: form.foto_url || null,
        endereco: form.endereco || null,
        cidade: form.cidade || null,
        cep: form.cep || null,
        nome_emergencia: form.nome_emergencia || null,
        telefone_emergencia: form.telefone_emergencia || null,
        nome_pais: form.nome_pais || null,
        contato_pais: form.contato_pais || null,
        restricoes_horario: form.restricoes_horario || null,
        motivo_disponibilidade: form.motivo_disponibilidade || null,
        deslocamento: form.deslocamento || null,
        comunidade_id: form.comunidade_id || null,
        planilha_url: form.planilha_url || null,
        observacoes: form.observacoes || null,
        ativo: form.ativo,
        prioridade_escala: form.prioridade_escala,
        forcar_escalacao_solene: form.prioridade_escala === "sempre_solenes",
        prioridade_id: (form.prioridade_id && form.prioridade_id !== PRIORIDADE_NONE) ? form.prioridade_id : null,
        tipo_acesso: form.tipo_acesso || "membro",
        sexo: form.sexo || null,
      };

      let membroId = editId;

      if (editId) {
        const { error } = await anyDb.from("membros").update(payload).eq("id", editId);
        if (error) throw new Error(logDbError("UPDATE membros", error));
      } else {
        // Use client-side UUID to avoid INSERT...RETURNING which triggers RLS recursion
        const newId = crypto.randomUUID();
        const { error } = await anyDb
          .from("membros")
          .insert({ id: newId, ...payload, paroquia_id: pid });
        if (error) throw new Error(logDbError("INSERT membros", error));
        membroId = newId;
      }

      // Sync ministérios
      const { error: delErr } = await supabase
        .from("membro_ministerios").delete().eq("membro_id", membroId!);
      if (delErr) throw new Error(logDbError("DELETE membro_ministerios", delErr));
      if (form.ministerio_ids.length > 0) {
        const { error: insErr } = await supabase.from("membro_ministerios").insert(
          form.ministerio_ids.map((mid) => ({ membro_id: membroId!, ministerio_id: mid }))
        );
        if (insErr) throw new Error(logDbError("INSERT membro_ministerios", insErr));
      }

      // Sync atuacoes (graceful — tabela pode não ter migration aplicada ainda)
      try {
        await anyDb.from("membro_atuacoes").delete().eq("membro_id", membroId!);
        if (form.atuacao_ids.length > 0) {
          await anyDb.from("membro_atuacoes").insert(
            form.atuacao_ids.map((aid) => ({ membro_id: membroId!, atuacao_id: aid }))
          );
        }
      } catch { /* migration ainda não aplicada */ }

      // Sync restrições de dia da semana
      try {
        await anyDb.from("membros").update({ restricoes_dia_semana: form.restricoes_dia_semana }).eq("id", membroId!);
      } catch { /* coluna ainda não existe */ }

      // Sync restrições de função (blocklist only)
      try {
        await anyDb.from("membro_funcao_restricoes").delete().eq("membro_id", membroId!);
        const restricoes = form.funcoes_nao_pode_ids.map((id) => ({ membro_id: membroId!, ministerio_id: id, tipo: "nao_pode" }));
        if (restricoes.length > 0) {
          await anyDb.from("membro_funcao_restricoes").insert(restricoes);
        }
      } catch { /* migration ainda não aplicada */ }

      // Sync restrições de horário de missa padrão
      try {
        await anyDb.from("membro_missa_restricoes").delete().eq("membro_id", membroId!);
        if (form.missas_nao_pode_ids.length > 0) {
          await anyDb.from("membro_missa_restricoes").insert(
            form.missas_nao_pode_ids.map((id) => ({ membro_id: membroId!, missa_padrao_id: id }))
          );
        }
      } catch { /* migration ainda não aplicada */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membros"] });
      toast.success(editId ? "Membro atualizado com sucesso." : "Membro cadastrado com sucesso.");
      closeSheet();
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("membros").delete().eq("id", id);
      if (error) throw new Error(logDbError("DELETE membros", error));
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["membros"] });
      // Remove the deleted member from selectedIds to prevent stale FK violations
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      toast.success("Membro removido.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await anyDb.from("membros").delete().in("id", ids);
      if (error) throw new Error(logDbError("BULK DELETE membros", error));
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ["membros"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast.success(`${ids.length} membro(s) removido(s).`);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const bulkToggleAtivoMutation = useMutation({
    mutationFn: async ({ ids, ativo }: { ids: string[]; ativo: boolean }) => {
      const { error } = await anyDb.from("membros").update({ ativo }).in("id", ids);
      if (error) throw new Error(logDbError("BULK UPDATE membros.ativo", error));
    },
    onSuccess: (_, { ids, ativo }) => {
      qc.invalidateQueries({ queryKey: ["membros"] });
      setSelectedIds(new Set());
      toast.success(`${ids.length} membro(s) ${ativo ? "ativado(s)" : "desativado(s)"}.`);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const bulkEditMutation = useMutation({
    mutationFn: async ({ ids, bf }: { ids: string[]; bf: BulkEditForm }) => {
      // Guard: selectedIds can go stale if a member is deleted individually after being
      // selected (deleteMutation does not clear selectedIds for that specific ID).
      // Validate all IDs still exist before any write to prevent FK violations.
      const { data: existCheck } = await anyDb.from("membros").select("id").in("id", ids);
      const validIds: string[] = (existCheck ?? []).map((m: any) => m.id as string);
      const missingIds = ids.filter((id) => !validIds.includes(id));
      if (missingIds.length > 0) {
        console.warn("[BULK EDIT] membro_id FK guard — IDs ausentes em membros:", {
          membro_ids_recebidos: ids,
          membro_ids_validos: validIds,
          membro_ids_ausentes: missingIds,
          ministerios: bf.funcao_ids,
          payload: bf,
        });
      }
      if (validIds.length === 0) return;

      // ── Campos diretos no membros ───────────────────────────────────────────
      const directPayload: Record<string, unknown> = {};
      if (bf.changeSexo)       directPayload.sexo          = bf.sexo || null;
      if (bf.changeTipoAcesso) directPayload.tipo_acesso   = bf.tipo_acesso;
      if (bf.changeComunidade) directPayload.comunidade_id = bf.comunidade_id || null;
      if (bf.changeIngresso)   directPayload.data_ingresso = bf.data_ingresso || null;
      if (bf.changeRestricoesDia) directPayload.restricoes_dia_semana = bf.restricoes_dia_semana;

      if (Object.keys(directPayload).length > 0) {
        const { error } = await anyDb.from("membros").update(directPayload).in("id", validIds);
        if (error) throw new Error(logDbError("BULK UPDATE membros", error));
      }

      // ── Missas que não pode servir ──────────────────────────────────────────
      if (bf.changeMissasRestricao) {
        if (bf.missasRestricaoMode === "substituir") {
          await anyDb.from("membro_missa_restricoes").delete().in("membro_id", validIds);
          if (bf.missas_nao_pode_ids.length > 0) {
            const rows = validIds.flatMap((mid) =>
              bf.missas_nao_pode_ids.map((mpid) => ({ membro_id: mid, missa_padrao_id: mpid })),
            );
            await anyDb.from("membro_missa_restricoes").insert(rows);
          }
        } else if (bf.missas_nao_pode_ids.length > 0) {
          const rows = validIds.flatMap((mid) =>
            bf.missas_nao_pode_ids.map((mpid) => ({ membro_id: mid, missa_padrao_id: mpid })),
          );
          await anyDb.from("membro_missa_restricoes").upsert(rows, { onConflict: "membro_id,missa_padrao_id", ignoreDuplicates: true });
        }
      }

      if (bf.changePrioridade) {
        const { error } = await anyDb
          .from("membros")
          .update({ prioridade_escala: bf.prioridade, forcar_escalacao_solene: bf.prioridade === "sempre_solenes" })
          .in("id", validIds);
        if (error) throw new Error(logDbError("BULK UPDATE prioridade", error));
      }
      if (bf.changeFuncoes) {
        if (bf.funcoesMode === "substituir") {
          const { error } = await supabase.from("membro_ministerios").delete().in("membro_id", validIds);
          if (error) throw new Error(logDbError("BULK DELETE membro_ministerios", error));
          if (bf.funcao_ids.length > 0) {
            const rows = validIds.flatMap((mid) => bf.funcao_ids.map((fid) => ({ membro_id: mid, ministerio_id: fid })));
            const { error: insErr } = await supabase.from("membro_ministerios").insert(rows);
            if (insErr) throw new Error(logDbError("BULK INSERT membro_ministerios", insErr));
          }
        } else if (bf.funcao_ids.length > 0) {
          const rows = validIds.flatMap((mid) => bf.funcao_ids.map((fid) => ({ membro_id: mid, ministerio_id: fid })));
          console.log("[BULK UPSERT membro_ministerios] payload", { membro_ids: validIds, ministerio_ids: bf.funcao_ids, rows });
          const { error } = await supabase.from("membro_ministerios").upsert(rows, { onConflict: "membro_id,ministerio_id", ignoreDuplicates: true });
          if (error) throw new Error(logDbError("BULK UPSERT membro_ministerios", error));
        }
      }
      if (bf.changeAtuacoes) {
        if (bf.atuacoesMode === "substituir") {
          await anyDb.from("membro_atuacoes").delete().in("membro_id", validIds);
          if (bf.atuacao_ids.length > 0) {
            const rows = validIds.flatMap((mid) => bf.atuacao_ids.map((aid) => ({ membro_id: mid, atuacao_id: aid })));
            await anyDb.from("membro_atuacoes").insert(rows);
          }
        } else if (bf.atuacao_ids.length > 0) {
          const rows = validIds.flatMap((mid) => bf.atuacao_ids.map((aid) => ({ membro_id: mid, atuacao_id: aid })));
          await anyDb.from("membro_atuacoes").upsert(rows, { onConflict: "membro_id,atuacao_id", ignoreDuplicates: true });
        }
      }
      if (bf.changeRestricoes) {
        if (bf.restricoesMode === "substituir") {
          await anyDb.from("membro_funcao_restricoes").delete().eq("tipo", "nao_pode").in("membro_id", validIds);
          if (bf.restricao_ids.length > 0) {
            const rows = validIds.flatMap((mid) => bf.restricao_ids.map((rid) => ({ membro_id: mid, ministerio_id: rid, tipo: "nao_pode" })));
            await anyDb.from("membro_funcao_restricoes").insert(rows);
          }
        } else if (bf.restricao_ids.length > 0) {
          const rows = validIds.flatMap((mid) => bf.restricao_ids.map((rid) => ({ membro_id: mid, ministerio_id: rid, tipo: "nao_pode" })));
          await anyDb.from("membro_funcao_restricoes").upsert(rows, { onConflict: "membro_id,ministerio_id", ignoreDuplicates: true });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membros"] });
      setSelectedIds(new Set());
      setBulkEditOpen(false);
      setBulkEditForm(EMPTY_BULK_EDIT);
      toast.success("Membros atualizados com sucesso.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const syncRestricoesMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await anyDb
        .from("membros")
        .select("id, restricoes_horario")
        .eq("paroquia_id", pid!)
        .not("restricoes_horario", "is", null);
      if (error) throw error;
      const updates = ((data ?? []) as { id: string; restricoes_horario: string }[])
        .filter((m) => m.restricoes_horario?.trim());
      for (const m of updates) {
        const dias = parseDiasRestricao(m.restricoes_horario);
        await anyDb.from("membros").update({ restricoes_dia_semana: dias }).eq("id", m.id);
      }
      return updates.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["membros"] });
      toast.success(`Restrições de dias sincronizadas em ${count} membro(s).`);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const syncMissaRestricoesMutation = useMutation({
    mutationFn: async () => {
      if (!pid) throw new Error("Paróquia não identificada.");
      if (missasPadrao.length === 0) return 0;

      const { data, error } = await anyDb
        .from("membros")
        .select("id, restricoes_horario")
        .eq("paroquia_id", pid)
        .not("restricoes_horario", "is", null);
      if (error) throw error;

      const comRestricao = ((data ?? []) as { id: string; restricoes_horario: string }[])
        .filter((m) => m.restricoes_horario?.trim());

      let atualizado = 0;
      for (const m of comRestricao) {
        const ids = autoDetectMissaRestricoes(m.restricoes_horario, missasPadrao);
        try {
          await anyDb.from("membro_missa_restricoes").delete().eq("membro_id", m.id);
          if (ids.length > 0) {
            await anyDb.from("membro_missa_restricoes").insert(
              ids.map((missaId) => ({ membro_id: m.id, missa_padrao_id: missaId }))
            );
          }
          atualizado++;
        } catch { /* tabela ainda não migrada */ }
      }
      return atualizado;
    },
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Horários detectados e salvos em ${count} membro(s).`
          : "Nenhum membro com texto de restrição encontrado."
      );
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const { data: indisponibilidades = [], refetch: refetchIndisp } = useQuery<Indisponibilidade[]>({
    queryKey: ["indisponibilidades-membro", editId],
    enabled: !!editId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("indisponibilidades")
        .select("id, membro_id, data, motivo, tipo, hora_inicio, hora_fim, cancelada")
        .eq("membro_id", editId!)
        .order("data");
      return (data ?? []).map((r: any) => ({
        ...r, tipo: r.tipo ?? "dia", cancelada: r.cancelada ?? false,
      })) as Indisponibilidade[];
    },
  });

  const addIndispMutation = useMutation({
    mutationFn: async ({ data, motivo }: { data: string; motivo: string }) => {
      const payload = { paroquia_id: pid!, membro_id: editId!, data, motivo: motivo || null };
      console.log("[INSERT indisponibilidades] payload", payload);
      const { error } = await supabase.from("indisponibilidades").insert(payload);
      if (error) throw new Error(logDbError("INSERT indisponibilidades", error));
    },
    onSuccess: () => { refetchIndisp(); setNewIndisp(""); setNewIndispMotivo(""); },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const removeIndispMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("indisponibilidades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refetchIndisp(),
  });

  async function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  }

  async function openEdit(m: Membro) {
    setEditId(m.id);

    let atuacaoIds: string[] = [];
    let naoPodeIds: string[] = [];
    let extra: Record<string, unknown> = {};

    let missasNaoPodeIds: string[] = [];
    try {
      const [aRes, rRes, extRes, mmrRes] = await Promise.all([
        anyDb.from("membro_atuacoes").select("atuacao_id").eq("membro_id", m.id),
        anyDb.from("membro_funcao_restricoes").select("ministerio_id, tipo").eq("membro_id", m.id),
        anyDb.from("membros").select("cpf, rg, foto_url, endereco, cidade, cep, nome_emergencia, telefone_emergencia, nome_pais, contato_pais, restricoes_horario, motivo_disponibilidade, deslocamento, comunidade_id, planilha_url, restricoes_dia_semana").eq("id", m.id).maybeSingle(),
        anyDb.from("membro_missa_restricoes").select("missa_padrao_id").eq("membro_id", m.id),
      ]);
      atuacaoIds = (aRes.data ?? []).map((r: any) => r.atuacao_id as string);
      naoPodeIds = (rRes.data ?? []).filter((r: any) => r.tipo === "nao_pode").map((r: any) => r.ministerio_id as string);
      extra = extRes.data ?? {};
      missasNaoPodeIds = (mmrRes.data ?? []).map((r: any) => r.missa_padrao_id as string);
    } catch { /* tabelas ainda não existem */ }

    setForm({
      nome: m.nome,
      email: m.email ?? "",
      telefone: m.telefone ?? "",
      data_nascimento: m.data_nascimento ?? "",
      data_ingresso: m.data_ingresso ?? "",
      cpf: (extra.cpf as string) ?? "",
      rg: (extra.rg as string) ?? "",
      foto_url: (extra.foto_url as string) ?? "",
      endereco: (extra.endereco as string) ?? "",
      cidade: (extra.cidade as string) ?? "",
      cep: (extra.cep as string) ?? "",
      nome_emergencia: (extra.nome_emergencia as string) ?? "",
      telefone_emergencia: (extra.telefone_emergencia as string) ?? "",
      nome_pais: (extra.nome_pais as string) ?? "",
      contato_pais: (extra.contato_pais as string) ?? "",
      restricoes_horario: (extra.restricoes_horario as string) ?? "",
      motivo_disponibilidade: (extra.motivo_disponibilidade as string) ?? "",
      deslocamento: (extra.deslocamento as string) ?? "",
      comunidade_id: (extra.comunidade_id as string) ?? "",
      planilha_url: (extra.planilha_url as string) ?? "",
      observacoes: m.observacoes ?? "",
      ativo: m.ativo,
      prioridade_escala: m.prioridade_escala ?? "nenhuma",
      prioridade_id: (m.prioridade_id || PRIORIDADE_NONE),
      tipo_acesso: m.tipo_acesso ?? "membro",
      ministerio_ids: m.ministerios.map((mn) => mn.id),
      atuacao_ids: atuacaoIds,
      restricoes_dia_semana: (extra.restricoes_dia_semana as number[]) ?? [],
      funcoes_nao_pode_ids: naoPodeIds,
      missas_nao_pode_ids: missasNaoPodeIds,
      sexo: m.sexo ?? "",
    });
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  }

  if (isLimitedCoord) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-28">
      {/* Abas do módulo Membros */}
      <ModuleTabBar tabs={[
        { label: "Membros", to: "/membros", isActive: true  },
        { label: "Ranking", to: "/ranking", isActive: false },
      ]} />

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Membros</h1>
          <p className="page-header-sub">
            {membros.filter(m => m.ativo).length} ativo{membros.filter(m => m.ativo).length !== 1 ? "s" : ""}
            {membros.filter(m => !m.ativo).length > 0 && ` · ${membros.filter(m => !m.ativo).length} inativo${membros.filter(m => !m.ativo).length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 rounded-xl">
                <MoreVertical className="h-4 w-4" />
                <span className="hidden sm:inline ml-1">Ações</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={syncMissaRestricoesMutation.isPending || missasPadrao.length === 0}
                onClick={() => syncMissaRestricoesMutation.mutate()}
              >
                {syncMissaRestricoesMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
                Auto-detectar restrições
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={syncRestricoesMutation.isPending}
                onClick={() => syncRestricoesMutation.mutate()}
              >
                {syncRestricoesMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
                Sincronizar dias
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-2" />Importar planilha
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="h-9 rounded-xl" onClick={openCreate}>
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline ml-1">Novo membro</span>
          </Button>
        </div>
      </div>

      {/* ── Tabs: Membros | Solicitações | Auditoria ── */}
      <Tabs defaultValue="membros" className="mt-5">
        <TabsList className="h-auto p-1 gap-0.5 bg-muted/60 rounded-xl w-full sm:w-auto">
          <TabsTrigger value="membros" className="rounded-lg text-xs px-3 py-1.5 data-[state=active]:shadow-sm">
            Membros
            <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-muted-foreground/20 text-[9px] font-bold px-1">
              {membros.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="solicitacoes" className="rounded-lg text-xs px-3 py-1.5 gap-1.5 data-[state=active]:shadow-sm">
            <ClipboardList className="h-3 w-3" />
            Solicitações
            {solPendentes.length > 0 && (
              <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-1">
                {solPendentes.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="auditoria" className="rounded-lg text-xs px-3 py-1.5 gap-1.5 data-[state=active]:shadow-sm">
            <AlertCircle className="h-3 w-3" />
            Auditoria
          </TabsTrigger>
        </TabsList>

        <TabsContent value="membros">
        {/* Busca + Filtros */}
        {(() => {
          const hasFilters = filterMin !== "todos" || filterAtuacao !== "todas" || filterComunidade !== "todas" || filterPrioridade !== "todas" || filterSituacao !== "ativos" || filterSexo !== "todos" || filterDisponibilidade !== "todas";
          return (
            <div className="mt-3 space-y-2.5">
              {/* Barra de busca destacada */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-10 pr-9 h-11 rounded-2xl border-border/80 bg-card shadow-sm text-sm placeholder:text-muted-foreground/60"
                  placeholder="Buscar por nome, e-mail ou telefone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition" onClick={() => setSearch("")}>
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>

              {/* Filtros — chips horizontais roláveis */}
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                <Select value={filterSituacao} onValueChange={(v) => { setFilterSituacao(v); setSelectedIds(new Set()); }}>
                  <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[160px] ${filterSituacao !== "ativos" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativos">Ativos</SelectItem>
                    <SelectItem value="inativos">Inativos</SelectItem>
                    <SelectItem value="com_acesso">Com acesso</SelectItem>
                    <SelectItem value="sem_acesso">Sem acesso</SelectItem>
                    <SelectItem value="todos">Todos</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterSexo} onValueChange={(v) => { setFilterSexo(v); setSelectedIds(new Set()); }}>
                  <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[130px] ${filterSexo !== "todos" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                    <SelectValue placeholder="Sexo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="M">Masculino</SelectItem>
                    <SelectItem value="F">Feminino</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterDisponibilidade} onValueChange={(v) => { setFilterDisponibilidade(v); setSelectedIds(new Set()); }}>
                  <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[180px] ${filterDisponibilidade !== "todas" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                    <SelectValue placeholder="Disponibilidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Disponibilidade</SelectItem>
                    <SelectItem value="sem_restricoes">Todos os dias</SelectItem>
                    <SelectItem value="com_restricoes">Com restrições</SelectItem>
                  </SelectContent>
                </Select>

                {ministerios.length > 0 && (
                  <Select value={filterMin} onValueChange={(v) => { setFilterMin(v); setSelectedIds(new Set()); }}>
                    <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[160px] ${filterMin !== "todos" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                      <SelectValue placeholder="Função" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas as funções</SelectItem>
                      {ministerios.filter((m) => !!m.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}

                {atuacoes.length > 0 && (
                  <Select value={filterAtuacao} onValueChange={(v) => { setFilterAtuacao(v); setSelectedIds(new Set()); }}>
                    <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[160px] ${filterAtuacao !== "todas" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                      <SelectValue placeholder="Atuação" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas as atuações</SelectItem>
                      {atuacoes.filter((a) => !!a.id).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}

                {comunidades.length > 0 && (
                  <Select value={filterComunidade} onValueChange={(v) => { setFilterComunidade(v); setSelectedIds(new Set()); }}>
                    <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[160px] ${filterComunidade !== "todas" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                      <SelectValue placeholder="Comunidade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      {comunidades.filter((c) => !!c.id).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}

                <Select value={filterPrioridade} onValueChange={(v) => { setFilterPrioridade(v); setSelectedIds(new Set()); }}>
                  <SelectTrigger className={`h-8 rounded-full px-3 text-xs shrink-0 gap-1 border max-w-[160px] ${filterPrioridade !== "todas" ? "border-primary/50 bg-primary/5 text-primary" : "border-border bg-card"}`}>
                    <SelectValue placeholder="Prioridade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {PRIORIDADES.filter((p) => p.value !== "nenhuma").map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                    <SelectItem value="nenhuma">Sem prioridade</SelectItem>
                  </SelectContent>
                </Select>

                {hasFilters && (
                  <button
                    className="h-8 shrink-0 flex items-center gap-1 rounded-full px-3 text-xs text-destructive border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition whitespace-nowrap"
                    onClick={() => { setFilterMin("todos"); setFilterAtuacao("todas"); setFilterComunidade("todas"); setFilterPrioridade("todas"); setFilterSituacao("ativos"); setFilterSexo("todos"); setFilterDisponibilidade("todas"); setSelectedIds(new Set()); }}
                  >
                    <X className="h-3 w-3" />Limpar
                  </button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-8 shrink-0 flex items-center gap-1 rounded-full px-3 text-xs border border-border bg-card hover:bg-muted transition whitespace-nowrap ml-auto">
                      <FileDown className="h-3.5 w-3.5" /> Exportar
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleExportExcel}>
                      Exportar Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportPDF}>
                      Exportar PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })()}

      {/* Lista */}
      {isLoading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-destructive">Erro ao carregar membros</p>
          <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-3 py-2 text-left whitespace-pre-wrap break-all">
            {(membrosQueryError as { message?: string })?.message ?? String(membrosQueryError)}
          </p>
          <p className="text-xs text-muted-foreground">
            Execute <strong>PATCH_MEMBROS_EXPANDIDO.sql</strong> no Supabase SQL Editor para corrigir.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-8 empty-state">
          <div className="empty-state-icon">
            <Users className="h-5 w-5" />
          </div>
          <p className="empty-state-title">
            {membros.length === 0 ? "Nenhum membro cadastrado" : "Nenhum resultado"}
          </p>
          <p className="empty-state-desc">
            {membros.length === 0
              ? "Cadastre o primeiro membro da sua comunidade pastoral."
              : "Nenhum membro corresponde aos filtros aplicados. Tente ajustar os critérios."}
          </p>
          {membros.length === 0 && (
            <Button className="mt-2 rounded-xl" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Cadastrar primeiro membro
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Barra de meta + selecionar todos */}
          <div className="mt-4 flex items-center justify-between px-1 pb-3 border-b border-border/40">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id))}
                onCheckedChange={(checked) => {
                  if (checked) setSelectedIds(new Set(filtered.map((m) => m.id)));
                  else setSelectedIds(new Set());
                }}
              />
              <span className="text-xs text-muted-foreground">Selecionar todos</span>
            </label>
            {filterSituacao === "sem_acesso" && filtered.length > 0 && (
              <button
                className="text-xs text-amber-700 dark:text-amber-400 hover:underline"
                onClick={() => setSelectedIds(new Set(filtered.map((m) => m.id)))}
              >
                Selecionar todos sem acesso ({filtered.length})
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">{filtered.length}</span>
              <span className="text-xs text-muted-foreground">
                {filtered.length === membros.length ? "membros" : `de ${membros.length}`}
              </span>
              {filtered.length !== membros.filter((m) => m.ativo).length && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground">{membros.filter((m) => m.ativo).length} ativos</span>
                </>
              )}
            </div>
          </div>

          {/* Grid de cards */}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 animate-fade-in">
            {filtered.map((m) => {
              const initials = m.nome.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
              const comunidadeNome = comunidades.find((c) => c.id === m.comunidade_id)?.nome;
              const mAtuacoes = atuacoes.filter((a) => m.atuacao_ids.includes(a.id));
              const isSelected = selectedIds.has(m.id);
              return (
                <div
                  key={m.id}
                  className={`relative rounded-2xl border p-4 transition-all duration-150 hover:shadow-sm cursor-pointer group ${
                    isSelected
                      ? "border-primary/50 bg-primary/[0.03] shadow-sm ring-1 ring-primary/20"
                      : "border-border bg-card hover:border-border/80 hover:bg-muted/20"
                  } ${!m.ativo ? "opacity-55" : ""}`}
                  onClick={() => openEdit(m)}
                >
                  {/* Checkbox seleção */}
                  <div className="absolute top-3.5 left-3.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedIds);
                        if (checked) next.add(m.id); else next.delete(m.id);
                        setSelectedIds(next);
                      }}
                    />
                  </div>

                  {/* Cabeçalho: avatar + nome + menu */}
                  <div className="flex items-start gap-3 pl-7">
                    <div className={`h-11 w-11 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold tracking-wide ring-2 ring-border/50 ${!m.foto_url ? (m.ativo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground") : ""}`}>
                      {m.foto_url ? (
                        <img src={m.foto_url} alt={m.nome} className="h-full w-full object-cover" />
                      ) : (
                        initials
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm leading-snug truncate">{m.nome}</span>
                        {m.conta_ativada === true ? (
                          <span title="Conta ativada" className="h-4 w-4 rounded-full bg-green-500/15 text-green-600 flex items-center justify-center shrink-0">
                            <UserCheck className="h-2.5 w-2.5" />
                          </span>
                        ) : m.ativo && m.conta_ativada === false ? (
                          <span title="Aguardando ativação de conta" className="h-4 w-4 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                            <UserX className="h-2.5 w-2.5" />
                          </span>
                        ) : null}
                      </div>
                      {m.email ? (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{m.email}</p>
                      ) : m.telefone ? (
                        <p className="text-xs text-muted-foreground mt-0.5">{m.telefone}</p>
                      ) : null}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${m.ativo ? "text-green-600" : "text-muted-foreground/60"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${m.ativo ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                          {m.ativo ? "Ativo" : "Inativo"}
                        </span>
                        {m.tipo_acesso !== "membro" && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            m.tipo_acesso === "coordenador"
                              ? "bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300"
                              : "bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/40 dark:text-blue-300"
                          }`}>
                            {m.tipo_acesso === "coordenador" ? "Coord." : "Admin."}
                          </span>
                        )}
                        {comunidadeNome && (
                          <span className="text-[10px] text-muted-foreground/60 truncate">{comunidadeNome}</span>
                        )}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-0.5 -mr-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => openEdit(m)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />Editar membro
                        </DropdownMenuItem>
                        {m.email && m.token_acesso && (
                          <DropdownMenuItem onClick={async () => {
                            const { AccessInvitationService } = await import("@/lib/invitation-service");
                            const { ok, error } = await AccessInvitationService.sendEmail({
                              email:       m.email!,
                              nome:        m.nome,
                              paroquiaNome: paroquia?.nome ?? "Pastoral",
                              tokenAcesso: m.token_acesso!,
                              template:    "reenvio_ativacao",
                            });
                            if (ok) {
                              toast.success(`Link de acesso enviado para ${m.email}`);
                            } else {
                              toast.error("Erro ao enviar link: " + (error ?? ""));
                            }
                          }}>
                            <Mail className="h-3.5 w-3.5 mr-2 text-primary" />
                            Enviar link de acesso
                          </DropdownMenuItem>
                        )}
                        {m.token_acesso && (
                          <>
                            <DropdownMenuItem onClick={async () => {
                              const { AccessInvitationService } = await import("@/lib/invitation-service");
                              AccessInvitationService.copy(m.token_acesso!);
                              toast.success("Link copiado!");
                            }}>
                              <Link2 className="h-3.5 w-3.5 mr-2" />Copiar link de acesso
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={async () => {
                              const { AccessInvitationService } = await import("@/lib/invitation-service");
                              AccessInvitationService.whatsApp(m.token_acesso!, m.nome);
                            }}>
                              <MessageCircle className="h-3.5 w-3.5 mr-2 text-green-600" />Enviar WhatsApp
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(m)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />Excluir membro
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </div>
                  </div>

                  {/* Funções litúrgicas */}
                  {m.ministerios.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {m.ministerios.slice(0, 3).map((min) => (
                        <span
                          key={min.id}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: min.cor + "22", color: min.cor, border: `1px solid ${min.cor}44` }}
                        >
                          {min.nome}
                        </span>
                      ))}
                      {m.ministerios.length > 3 && (
                        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted">
                          +{m.ministerios.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Rodapé: score + atuações */}
                  <div className="mt-2.5 pt-2.5 border-t border-border/40 flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-base font-bold text-primary tabular-nums leading-none">{m.score}</span>
                      <span className="text-[10px] text-muted-foreground">pts</span>
                    </div>
                    {mAtuacoes.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {mAtuacoes.slice(0, 2).map((a) => (
                          <span key={a.id} className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300">
                            {a.icone && <span>{a.icone}</span>}
                            {a.nome}
                          </span>
                        ))}
                        {mAtuacoes.length > 2 && (
                          <span className="text-[9px] text-muted-foreground">+{mAtuacoes.length - 2}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Barra de ações em massa — fixa na base */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-md shadow-2xl px-4 py-2.5 max-w-[calc(100vw-2rem)]">
              <span className="text-sm font-semibold whitespace-nowrap">
                <span className="text-primary">{selectedIds.size}</span> selecionado(s)
              </span>
              <div className="h-4 w-px bg-border mx-0.5 shrink-0" />
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setBulkEditForm(EMPTY_BULK_EDIT); setBulkEditOpen(true); }}>
                  Editar em massa
                </Button>
                {(() => {
                  const selecionados = [...selectedIds].map((id) => membros.find((m) => m.id === id)).filter(Boolean) as Membro[];
                  const comPendencia = selecionados.filter((m) => m.email && m.token_acesso && m.conta_ativada === false);
                  if (comPendencia.length === 0) return null;
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-amber-400/60 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                      onClick={() => {
                        setBulkSendLog([]);
                        setBulkSendProgress(0);
                        setBulkSendTotal(comPendencia.length);
                        setBulkSendOpen(true);
                      }}
                    >
                      <Mail className="h-3 w-3 mr-1" />
                      Enviar acesso ({comPendencia.length})
                    </Button>
                  );
                })()}
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulkToggleAtivoMutation.isPending} onClick={() => bulkToggleAtivoMutation.mutate({ ids: [...selectedIds], ativo: true })}>
                  Ativar
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulkToggleAtivoMutation.isPending} onClick={() => bulkToggleAtivoMutation.mutate({ ids: [...selectedIds], ativo: false })}>
                  Desativar
                </Button>
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-3 w-3 mr-1" />Excluir
                </Button>
                <button
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

        </TabsContent>{/* fim membros */}

        {/* ── Tab: Solicitações ── */}
        <TabsContent value="solicitacoes" className="mt-4">
          <SolicitacoesTab
            solicitacoes={solicitacoes}
            loading={loadingSol}
            selecionada={solSelecionada}
            onSelecionar={setSolSelecionada}
            motivo={solMotivoRejeicao}
            onMotivo={setSolMotivoRejeicao}
            showRejeitar={showSolRejeitar}
            onShowRejeitar={setShowSolRejeitar}
            onAprovar={(sol) => aprovarSolMutation.mutate(sol)}
            onRejeitar={(sol, motivo) => rejeitarSolMutation.mutate({ sol, motivo })}
            aprovando={aprovarSolMutation.isPending}
            rejeitando={rejeitarSolMutation.isPending}
            paroquiaId={pid ?? ""}
          />
        </TabsContent>

        {/* ── Tab: Auditoria de ativação ── */}
        <TabsContent value="auditoria">
          <AuditoriaAtivacao paroquia={paroquia} />
        </TabsContent>

      </Tabs>{/* fim tabs */}

      {/* Diálogo de envio em massa */}
      <Dialog open={bulkSendOpen} onOpenChange={(o) => { if (!bulkSendRunning) setBulkSendOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar acesso em lote</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!bulkSendRunning && bulkSendProgress === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Serão enviados links de acesso para{" "}
                  <strong>{bulkSendTotal}</strong> membro(s) que ainda não ativaram a conta.
                </p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                  Os envios são feitos um a um — aguarde a conclusão sem fechar esta janela.
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setBulkSendOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={async () => {
                      const selecionados = [...selectedIds]
                        .map((id) => membros.find((m) => m.id === id))
                        .filter(Boolean) as Membro[];
                      const pendentes = selecionados.filter(
                        (m) => m.email && m.token_acesso && m.conta_ativada === false,
                      );
                      setBulkSendRunning(true);
                      setBulkSendLog([]);
                      let done = 0;
                      const { AccessInvitationService } = await import("@/lib/invitation-service");
                      for (const m of pendentes) {
                        const { ok } = await AccessInvitationService.sendEmail({
                          email: m.email!,
                          nome: m.nome,
                          paroquiaNome: paroquia?.nome ?? "Pastoral",
                          tokenAcesso: m.token_acesso!,
                          template: "reenvio_ativacao",
                        });
                        done++;
                        setBulkSendProgress(done);
                        setBulkSendLog((prev) => [...prev, { nome: m.nome, ok }]);
                        // Pausa de 400ms entre envios para evitar rate limit
                        await new Promise((r) => setTimeout(r, 400));
                      }
                      setBulkSendRunning(false);
                    }}
                  >
                    <Mail className="h-4 w-4 mr-1" />
                    Enviar agora
                  </Button>
                </div>
              </div>
            )}

            {(bulkSendRunning || bulkSendProgress > 0) && (
              <div className="space-y-3">
                {/* Barra de progresso */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{bulkSendRunning ? "Enviando…" : "Concluído"}</span>
                    <span>{bulkSendProgress} / {bulkSendTotal}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: bulkSendTotal > 0 ? `${(bulkSendProgress / bulkSendTotal) * 100}%` : "0%" }}
                    />
                  </div>
                </div>

                {/* Log de envios */}
                <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-border bg-muted/30 p-2">
                  {bulkSendLog.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {item.ok ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                      )}
                      <span className={item.ok ? "text-foreground" : "text-destructive"}>{item.nome}</span>
                    </div>
                  ))}
                  {bulkSendRunning && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      <span>Enviando próximo…</span>
                    </div>
                  )}
                </div>

                {!bulkSendRunning && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground text-center">
                      {bulkSendLog.filter((l) => l.ok).length} enviado(s) com sucesso
                      {bulkSendLog.filter((l) => !l.ok).length > 0 && ` · ${bulkSendLog.filter((l) => !l.ok).length} com falha`}
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setBulkSendOpen(false);
                        setBulkSendProgress(0);
                        setBulkSendLog([]);
                        setSelectedIds(new Set());
                      }}
                    >
                      Fechar
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Sheet adicionar/editar */}
      <Sheet open={sheetOpen} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent className="overflow-y-auto w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editId ? "Editar membro" : "Novo membro"}</SheetTitle>
          </SheetHeader>
          <MemberForm
            form={form}
            setForm={setForm}
            ministerios={ministerios}
            atuacoes={atuacoes}
            comunidades={comunidades}
            missasPadrao={missasPadrao}
            tiposPrioridade={tiposPrioridade}
            saving={saveMutation.isPending}
            onSave={() => saveMutation.mutate()}
            onClose={closeSheet}
          />

          {/* Indisponibilidades — só ao editar */}
          {editId && (
            <div className="mt-6 border-t border-border pt-5 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Indisponibilidades</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Datas em que este membro não pode ser escalado.
              </p>
              {indisponibilidades.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhuma indisponibilidade cadastrada.</p>
              ) : (
                <div className="space-y-1.5">
                  {indisponibilidades.map((ind) => {
                    const isPast = ind.data < new Date().toISOString().slice(0, 10);
                    return (
                      <div key={ind.id} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                        ind.cancelada ? "opacity-40 border-border" : isPast ? "border-border opacity-60" : "border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/10"
                      }`}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-medium ${isPast || ind.cancelada ? "" : "text-amber-900 dark:text-amber-200"}`}>
                              {new Date(ind.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}
                            </span>
                            {ind.tipo === "periodo" && ind.hora_inicio && (
                              <span className="text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 px-1.5 py-0.5 rounded">
                                {ind.hora_inicio.slice(0, 5)}{ind.hora_fim ? `–${ind.hora_fim.slice(0, 5)}` : ""}
                              </span>
                            )}
                            {ind.cancelada && (
                              <span className="text-[10px] text-red-500">cancelada</span>
                            )}
                          </div>
                          {ind.motivo && <span className="text-xs text-muted-foreground">{ind.motivo}</span>}
                        </div>
                        {!ind.cancelada && (
                          <button
                            onClick={() => removeIndispMutation.mutate(ind.id)}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          ><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <Input type="date" className="flex-1 h-8 text-sm" value={newIndisp} onChange={(e) => setNewIndisp(e.target.value)} />
                <Input placeholder="Motivo *" className="flex-1 h-8 text-sm" value={newIndispMotivo} onChange={(e) => setNewIndispMotivo(e.target.value)} />
                <Button
                  size="sm" className="h-8 shrink-0"
                  disabled={!newIndisp || !newIndispMotivo.trim() || addIndispMutation.isPending}
                  onClick={() => addIndispMutation.mutate({ data: newIndisp, motivo: newIndispMotivo })}
                >
                  {addIndispMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Bulk edit dialog */}
      <Dialog open={bulkEditOpen} onOpenChange={(o) => !o && setBulkEditOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar {selectedIds.size} membro(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1 pt-1">

            {/* ── Dados pessoais ────────────────────────── */}
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Dados pessoais</p>

            {/* Sexo */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={bulkEditForm.changeSexo} onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeSexo: !!v }))} />
                <span className="text-sm font-medium">Alterar sexo</span>
              </label>
              {bulkEditForm.changeSexo && (
                <div className="pl-6">
                  <select
                    value={bulkEditForm.sexo}
                    onChange={(e) => setBulkEditForm((f) => ({ ...f, sexo: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">Não informado</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                </div>
              )}
            </div>

            {/* Tipo de acesso */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={bulkEditForm.changeTipoAcesso} onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeTipoAcesso: !!v }))} />
                <span className="text-sm font-medium">Alterar nível de acesso</span>
              </label>
              {bulkEditForm.changeTipoAcesso && (
                <div className="pl-6 flex flex-col gap-1.5">
                  {[
                    { value: "membro", label: "Membro — portal padrão" },
                    { value: "auxiliar", label: "Administrador — gestão de escalas" },
                    { value: "coordenador", label: "Coordenação — acesso operacional" },
                  ].map((op) => (
                    <label key={op.value} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="radio" checked={bulkEditForm.tipo_acesso === op.value} onChange={() => setBulkEditForm((f) => ({ ...f, tipo_acesso: op.value }))} />
                      {op.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Comunidade */}
            {comunidades.length > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={bulkEditForm.changeComunidade} onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeComunidade: !!v }))} />
                  <span className="text-sm font-medium">Alterar comunidade</span>
                </label>
                {bulkEditForm.changeComunidade && (
                  <div className="pl-6">
                    <Select value={bulkEditForm.comunidade_id} onValueChange={(v) => setBulkEditForm((f) => ({ ...f, comunidade_id: v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sem comunidade" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Sem comunidade</SelectItem>
                        {comunidades.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* Data de ingresso */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={bulkEditForm.changeIngresso} onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeIngresso: !!v }))} />
                <span className="text-sm font-medium">Alterar mês/ano de ingresso</span>
              </label>
              {bulkEditForm.changeIngresso && (
                <div className="pl-6 grid grid-cols-2 gap-2">
                  <Select
                    value={bulkEditForm.data_ingresso ? bulkEditForm.data_ingresso.slice(5, 7) : ""}
                    onValueChange={(mes) => {
                      const ano = bulkEditForm.data_ingresso?.slice(0, 4) ?? String(ANO_ATUAL_MEMBROS);
                      setBulkEditForm((f) => ({ ...f, data_ingresso: mes && ano ? `${ano}-${mes}-01` : "" }));
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Mês" /></SelectTrigger>
                    <SelectContent>
                      {MESES_FORM.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value={bulkEditForm.data_ingresso ? bulkEditForm.data_ingresso.slice(0, 4) : ""}
                    onValueChange={(ano) => {
                      const mes = bulkEditForm.data_ingresso?.slice(5, 7) ?? "";
                      setBulkEditForm((f) => ({ ...f, data_ingresso: mes && ano ? `${ano}-${mes}-01` : "" }));
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Ano" /></SelectTrigger>
                    <SelectContent>
                      {ANOS_FORM.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* ── Escala ───────────────────────────────── */}
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold pt-2 border-t border-border">Escala</p>

            {/* Prioridade */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={bulkEditForm.changePrioridade}
                  onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changePrioridade: !!v }))}
                />
                <span className="text-sm font-medium">Alterar prioridade de escala</span>
              </label>
              {bulkEditForm.changePrioridade && (
                <div className="pl-6">
                  <Select
                    value={bulkEditForm.prioridade}
                    onValueChange={(v) => setBulkEditForm((f) => ({ ...f, prioridade: v }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORIDADES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Restrições de dia da semana */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={bulkEditForm.changeRestricoesDia} onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeRestricoesDia: !!v }))} />
                <span className="text-sm font-medium">Restrições de dia da semana</span>
              </label>
              {bulkEditForm.changeRestricoesDia && (
                <div className="pl-6 space-y-1.5">
                  <p className="text-xs text-muted-foreground">Substitui os dias atuais de todos os selecionados.</p>
                  <div className="grid grid-cols-2 gap-1">
                    {["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"].map((dia, idx) => (
                      <label key={idx} className="flex items-center gap-2 cursor-pointer text-xs px-2 py-1.5 rounded-lg hover:bg-muted transition">
                        <Checkbox
                          checked={bulkEditForm.restricoes_dia_semana.includes(idx)}
                          onCheckedChange={() => setBulkEditForm((f) => ({
                            ...f,
                            restricoes_dia_semana: f.restricoes_dia_semana.includes(idx)
                              ? f.restricoes_dia_semana.filter((d) => d !== idx)
                              : [...f.restricoes_dia_semana, idx],
                          }))}
                        />
                        {dia}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Missas que não pode servir */}
            {missasPadrao.length > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={bulkEditForm.changeMissasRestricao} onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeMissasRestricao: !!v }))} />
                  <span className="text-sm font-medium">Missas que não consegue servir</span>
                </label>
                {bulkEditForm.changeMissasRestricao && (
                  <div className="space-y-2 pl-6">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input type="radio" checked={bulkEditForm.missasRestricaoMode === "adicionar"} onChange={() => setBulkEditForm((f) => ({ ...f, missasRestricaoMode: "adicionar" }))} />
                        Adicionar às existentes
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input type="radio" checked={bulkEditForm.missasRestricaoMode === "substituir"} onChange={() => setBulkEditForm((f) => ({ ...f, missasRestricaoMode: "substituir" }))} />
                        Substituir tudo
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-1 rounded-lg border border-border bg-muted/20 p-2.5">
                      {missasPadrao.map((mp) => (
                        <label key={mp.id} className="flex items-center gap-2 cursor-pointer text-xs px-1.5 py-1 rounded hover:bg-muted">
                          <Checkbox
                            checked={bulkEditForm.missas_nao_pode_ids.includes(mp.id)}
                            onCheckedChange={() => setBulkEditForm((f) => ({
                              ...f,
                              missas_nao_pode_ids: f.missas_nao_pode_ids.includes(mp.id)
                                ? f.missas_nao_pode_ids.filter((x) => x !== mp.id)
                                : [...f.missas_nao_pode_ids, mp.id],
                            }))}
                          />
                          {mp.nome}{mp.hora_inicio ? ` · ${mp.hora_inicio.slice(0, 5)}` : ""}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Funções / Pastoral ───────────────────── */}
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold pt-2 border-t border-border">Funções e pastoral</p>

            {/* Funções litúrgicas */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={bulkEditForm.changeFuncoes}
                  onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeFuncoes: !!v }))}
                />
                <span className="text-sm font-medium">Alterar funções litúrgicas</span>
              </label>
              {bulkEditForm.changeFuncoes && (
                <div className="space-y-3 pl-6">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        checked={bulkEditForm.funcoesMode === "adicionar"}
                        onChange={() => setBulkEditForm((f) => ({ ...f, funcoesMode: "adicionar" }))}
                      />
                      Adicionar às existentes
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        checked={bulkEditForm.funcoesMode === "substituir"}
                        onChange={() => setBulkEditForm((f) => ({ ...f, funcoesMode: "substituir" }))}
                      />
                      Substituir tudo
                    </label>
                  </div>
                  {bulkEditForm.funcoesMode === "substituir" && (
                    <p className="text-xs text-destructive">As funções atuais serão removidas e substituídas pelas selecionadas.</p>
                  )}
                  <MultiCheck
                    label=""
                    items={ministerios}
                    selected={bulkEditForm.funcao_ids}
                    onToggle={(id) => setBulkEditForm((f) => ({
                      ...f,
                      funcao_ids: f.funcao_ids.includes(id)
                        ? f.funcao_ids.filter((x) => x !== id)
                        : [...f.funcao_ids, id],
                    }))}
                  />
                </div>
              )}
            </div>

            {/* Atuação pastoral */}
            {atuacoes.length > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={bulkEditForm.changeAtuacoes}
                    onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeAtuacoes: !!v }))}
                  />
                  <span className="text-sm font-medium">Alterar atuação pastoral</span>
                </label>
                {bulkEditForm.changeAtuacoes && (
                  <div className="space-y-3 pl-6">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="radio"
                          checked={bulkEditForm.atuacoesMode === "adicionar"}
                          onChange={() => setBulkEditForm((f) => ({ ...f, atuacoesMode: "adicionar" }))}
                        />
                        Adicionar às existentes
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="radio"
                          checked={bulkEditForm.atuacoesMode === "substituir"}
                          onChange={() => setBulkEditForm((f) => ({ ...f, atuacoesMode: "substituir" }))}
                        />
                        Substituir tudo
                      </label>
                    </div>
                    {bulkEditForm.atuacoesMode === "substituir" && (
                      <p className="text-xs text-destructive">As atuações atuais serão removidas e substituídas pelas selecionadas.</p>
                    )}
                    <MultiCheck
                      label=""
                      items={atuacoes}
                      selected={bulkEditForm.atuacao_ids}
                      onToggle={(id) => setBulkEditForm((f) => ({
                        ...f,
                        atuacao_ids: f.atuacao_ids.includes(id)
                          ? f.atuacao_ids.filter((x) => x !== id)
                          : [...f.atuacao_ids, id],
                      }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Funções com restrição */}
            {ministerios.length > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={bulkEditForm.changeRestricoes}
                    onCheckedChange={(v) => setBulkEditForm((f) => ({ ...f, changeRestricoes: !!v }))}
                  />
                  <span className="text-sm font-medium">Funções com restrição (não pode exercer)</span>
                </label>
                {bulkEditForm.changeRestricoes && (
                  <div className="space-y-3 pl-6">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input type="radio" checked={bulkEditForm.restricoesMode === "adicionar"} onChange={() => setBulkEditForm((f) => ({ ...f, restricoesMode: "adicionar" }))} />
                        Adicionar às existentes
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input type="radio" checked={bulkEditForm.restricoesMode === "substituir"} onChange={() => setBulkEditForm((f) => ({ ...f, restricoesMode: "substituir" }))} />
                        Substituir tudo
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      {ministerios.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-destructive/10 transition-colors">
                          <Checkbox
                            checked={bulkEditForm.restricao_ids.includes(m.id)}
                            onCheckedChange={() => setBulkEditForm((f) => ({
                              ...f,
                              restricao_ids: f.restricao_ids.includes(m.id)
                                ? f.restricao_ids.filter((x) => x !== m.id)
                                : [...f.restricao_ids, m.id],
                            }))}
                            className="shrink-0 border-destructive/50 data-[state=checked]:bg-destructive data-[state=checked]:border-destructive"
                          />
                          <span className="flex items-center gap-1.5 text-xs truncate">
                            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: m.cor }} />
                            {m.nome}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-3 border-t border-border">
            <Button variant="outline" className="flex-1" onClick={() => setBulkEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              disabled={
                bulkEditMutation.isPending || (
                  !bulkEditForm.changeSexo && !bulkEditForm.changeTipoAcesso &&
                  !bulkEditForm.changeComunidade && !bulkEditForm.changeIngresso &&
                  !bulkEditForm.changePrioridade && !bulkEditForm.changeRestricoesDia &&
                  !bulkEditForm.changeMissasRestricao && !bulkEditForm.changeFuncoes &&
                  !bulkEditForm.changeAtuacoes && !bulkEditForm.changeRestricoes
                )
              }
              onClick={() => bulkEditMutation.mutate({ ids: [...selectedIds], bf: bulkEditForm })}
            >
              {bulkEditMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Aplicar a {selectedIds.size} membro(s)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import */}
      {pid && (
        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          existingMembros={membros}
          paroquiaId={pid}
          onImported={() => qc.invalidateQueries({ queryKey: ["membros"] })}
        />
      )}

      {/* Confirm bulk delete */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !o && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {selectedIds.size} membro(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e removerá todas as atribuições em escalas desses membros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
            >
              {bulkDeleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover {selectedIds.size} membro(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.nome}</strong> será removido permanentemente, incluindo todas as atribuições em escalas.
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

// ── SolicitacoesTab ───────────────────────────────────────────────────────────

type SolicitacoesTabProps = {
  solicitacoes: SolicitacaoMembro[];
  loading: boolean;
  selecionada: SolicitacaoMembro | null;
  onSelecionar: (s: SolicitacaoMembro | null) => void;
  motivo: string;
  onMotivo: (v: string) => void;
  showRejeitar: boolean;
  onShowRejeitar: (v: boolean) => void;
  onAprovar: (s: SolicitacaoMembro) => void;
  onRejeitar: (s: SolicitacaoMembro, motivo: string) => void;
  aprovando: boolean;
  rejeitando: boolean;
  paroquiaId: string;
};

function SolicitacoesTab({
  solicitacoes, loading,
  selecionada, onSelecionar,
  motivo, onMotivo,
  showRejeitar, onShowRejeitar,
  onAprovar, onRejeitar,
  aprovando, rejeitando,
}: SolicitacoesTabProps) {
  const { data: paroquia } = useQuery<{ nome: string; slug: string | null; id: string } | null>({
    queryKey: ["paroquia-inscricao-link-membros", solicitacoes[0]?.paroquia_id],
    enabled: solicitacoes.length > 0,
    queryFn: async () => {
      const { data } = await anyDb
        .from("paroquias")
        .select("id, nome, slug")
        .eq("id", solicitacoes[0].paroquia_id)
        .maybeSingle();
      return data ?? null;
    },
  });

  const inscricaoUrl = paroquia
    ? `${window.location.origin}/inscricao/${paroquia.slug ?? paroquia.id}`
    : null;

  const pendentes  = solicitacoes.filter((s) => s.status === "pendente");
  const aprovadas  = solicitacoes.filter((s) => s.status === "aprovado");
  const rejeitadas = solicitacoes.filter((s) => s.status === "rejeitado");

  const [aba, setAba] = useState<"pendente" | "aprovado" | "rejeitado">("pendente");

  const lista = aba === "pendente" ? pendentes : aba === "aprovado" ? aprovadas : rejeitadas;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 mt-4">
      {/* Link de inscrição */}
      {inscricaoUrl && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Link de inscrição — compartilhe para receber novos cadastros
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-xs text-muted-foreground font-mono truncate flex-1">{inscricaoUrl}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(inscricaoUrl); }}
              className="shrink-0 text-xs text-primary hover:underline font-medium"
            >
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* Sub-tabs: Pendentes / Aprovadas / Rejeitadas */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-full sm:w-auto">
        {([
          { key: "pendente", label: "Pendentes", count: pendentes.length },
          { key: "aprovado", label: "Aprovadas", count: aprovadas.length },
          { key: "rejeitado", label: "Rejeitadas", count: rejeitadas.length },
        ] as const).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setAba(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              aba === key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full text-[9px] font-bold px-1 ${
                key === "pendente" && aba === "pendente" ? "bg-amber-500 text-white" :
                key === "pendente" ? "bg-amber-500/20 text-amber-700" : "bg-muted text-muted-foreground"
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lista */}
      {lista.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {aba === "pendente" ? "Nenhuma solicitação pendente." :
             aba === "aprovado" ? "Nenhuma solicitação aprovada ainda." :
             "Nenhuma solicitação rejeitada."}
          </p>
        </div>
      ) : (
        <div className="rounded-[1.75rem] border border-border bg-card overflow-hidden divide-y divide-border">
          {lista.map((sol) => {
            const cfg = STATUS_SOL_CFG[sol.status];
            const isSelected = selecionada?.id === sol.id;
            return (
              <div key={sol.id} className={`transition ${isSelected ? "bg-muted/30" : ""}`}>
                {/* Linha de resumo */}
                <button
                  className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-muted/40 transition"
                  onClick={() => onSelecionar(isSelected ? null : sol)}
                >
                  {sol.foto_url ? (
                    <img src={sol.foto_url} alt={sol.nome} className="h-10 w-10 rounded-full object-cover border border-border shrink-0" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold shrink-0 text-muted-foreground">
                      {sol.nome.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-snug">{sol.nome}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      {sol.email && <span className="text-xs text-muted-foreground truncate">{sol.email}</span>}
                      {sol.telefone && <span className="text-xs text-muted-foreground">{sol.telefone}</span>}
                    </div>
                    {sol.dados_json?.comunidade_nome && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{sol.dados_json.comunidade_nome}</p>
                    )}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${cfg.className}`}>
                    {cfg.label}
                  </span>
                </button>

                {/* Detalhe expandido */}
                {isSelected && (
                  <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4">
                    {/* Dados resumidos */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {[
                        { l: "Sexo", v: sol.dados_json?.sexo === "M" ? "Masculino" : sol.dados_json?.sexo === "F" ? "Feminino" : null },
                        { l: "Nascimento", v: sol.dados_json?.data_nascimento },
                        { l: "CPF", v: sol.dados_json?.cpf },
                        { l: "Cidade", v: [sol.dados_json?.cidade, sol.dados_json?.bairro].filter(Boolean).join(" / ") || null },
                        { l: "Atuação", v: Array.isArray(sol.dados_json?.atuacao_nomes) && sol.dados_json.atuacao_nomes.length > 0 ? (sol.dados_json.atuacao_nomes as string[]).join(", ") : null },
                        { l: "Ingresso", v: sol.dados_json?.ingresso_mes && sol.dados_json?.ingresso_ano ? `${sol.dados_json.ingresso_mes}/${sol.dados_json.ingresso_ano}` : null },
                        { l: "Mãe", v: [sol.dados_json?.nome_mae, sol.dados_json?.contato_mae].filter(Boolean).join(" — ") || null },
                        { l: "Pai", v: [sol.dados_json?.nome_pai, sol.dados_json?.contato_pai].filter(Boolean).join(" — ") || null },
                        { l: "Condução", v: sol.dados_json?.possui_conducao === "sim" ? "Sim" : sol.dados_json?.possui_conducao === "nao" ? "Não" : null },
                        { l: "Missas que não pode", v: (sol.dados_json?.missas_nao_pode_ids as string[] ?? []).length > 0 ? `${(sol.dados_json.missas_nao_pode_ids as string[]).length} missa(s) selecionada(s)` : null },
                      ].filter((p) => p.v).map(({ l, v }) => (
                        <div key={l}>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</p>
                          <p className="font-medium text-foreground mt-0.5">{v}</p>
                        </div>
                      ))}
                    </div>
                    {sol.dados_json?.observacoes && (
                      <p className="text-xs text-muted-foreground italic">{sol.dados_json.observacoes}</p>
                    )}

                    {/* Ações */}
                    {sol.status === "pendente" && (
                      <div className="space-y-2 pt-1">
                        {!showRejeitar ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl"
                              disabled={aprovando}
                              onClick={() => onAprovar(sol)}
                            >
                              {aprovando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
                              onClick={() => onShowRejeitar(true)}
                            >
                              <UserX className="h-3.5 w-3.5" />
                              Rejeitar
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                            <textarea
                              rows={2}
                              value={motivo}
                              onChange={(e) => onMotivo(e.target.value)}
                              placeholder="Motivo da rejeição (opcional)…"
                              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none placeholder:text-muted-foreground"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
                                disabled={rejeitando}
                                onClick={() => onRejeitar(sol, motivo)}
                              >
                                {rejeitando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Confirmar rejeição
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { onShowRejeitar(false); onMotivo(""); }}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {sol.status === "aprovado" && (
                      <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                        <UserCheck className="h-3.5 w-3.5 shrink-0" />
                        Aprovado — membro criado e link de acesso enviado.
                      </div>
                    )}
                    {sol.status === "rejeitado" && sol.motivo_rejeicao && (
                      <p className="text-xs text-destructive italic">{sol.motivo_rejeicao}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
