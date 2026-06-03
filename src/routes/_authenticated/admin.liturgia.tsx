import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import {
  CalendarDays, Upload, AlertTriangle, Settings2, Plus,
  Trash2, Pencil, CheckCircle2, XCircle, Loader2, BookOpen,
  FileSpreadsheet, Download,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LiturgicalCard } from "@/components/liturgia/LiturgicalCard";
import { SeasonBadge, RankBadge } from "@/components/liturgia/LiturgicalBadge";
import type { LiturgicalDayRecord, LiturgicalRank, LiturgicalColor } from "@/biblioteca/liturgia/types";
import { RANK_LABEL } from "@/biblioteca/liturgia/constants/ranks";
import { LITURGICAL_COLOR_LABEL } from "@/biblioteca/liturgia/constants/colors";
import { getLiturgicalSeason } from "@/biblioteca/liturgia/engine/seasons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/admin/liturgia")({
  component: AdminLiturgiaPage,
  head: () => ({ meta: [{ title: "Admin — Lumen Pastoral" }] }),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type ParoquiaCelRow = {
  id: string;
  data: string;
  titulo: string;
  descricao?: string;
  grau: LiturgicalRank;
  cor: LiturgicalColor;
  e_padroeiro: boolean;
};

type FormData = {
  data: string;
  titulo: string;
  descricao: string;
  grau: LiturgicalRank;
  cor: LiturgicalColor;
  e_padroeiro: boolean;
};

const EMPTY_FORM: FormData = {
  data: format(new Date(), "yyyy-MM-dd"),
  titulo: "",
  descricao: "",
  grau: "memorial",
  cor: "branco",
  e_padroeiro: false,
};

// ─── Componente principal ─────────────────────────────────────────────────────

function AdminLiturgiaPage() {
  const { profile, roles } = useAuth();
  const qc = useQueryClient();
  const paroquiaId = profile?.paroquia_id;

  const isSuperAdmin = roles.includes("super_admin");
  const isAdmin = roles.includes("admin_paroquial") || isSuperAdmin;

  const [tab, setTab] = useState("personalizacao");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));

  // ── Personalização paroquial ─────────────────────────────────────────────
  const { data: paroCelebracoes = [], isLoading: loadingParo } = useQuery({
    queryKey: ["liturgia-paroquia", paroquiaId, filterYear],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data } = await anyDb
        .from("liturgia_paroquia")
        .select("id, data, titulo, descricao, grau, cor, e_padroeiro")
        .eq("paroquia_id", paroquiaId)
        .gte("data", `${filterYear}-01-01`)
        .lte("data", `${filterYear}-12-31`)
        .order("data");
      return (data ?? []) as ParoquiaCelRow[];
    },
  });

  // ── Registros base (somente leitura para admin) ──────────────────────────
  const { data: baseCount } = useQuery({
    queryKey: ["liturgia-base-count", filterYear],
    queryFn: async () => {
      const { count } = await anyDb
        .from("liturgia_base")
        .select("id", { count: "exact", head: true })
        .eq("ano", parseInt(filterYear, 10));
      return count ?? 0;
    },
  });

  // ── Importações ──────────────────────────────────────────────────────────
  const { data: importacoes = [] } = useQuery({
    queryKey: ["liturgia-importacoes"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data } = await anyDb
        .from("liturgia_importacoes")
        .select("id, ano, arquivo_nome, origem, status, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  // ── Salvar celebração paroquial ──────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (f: FormData) => {
      const row = {
        paroquia_id: paroquiaId,
        data: f.data,
        titulo: f.titulo.trim(),
        descricao: f.descricao.trim() || null,
        grau: f.grau,
        cor: f.cor,
        e_padroeiro: f.e_padroeiro,
      };
      if (editingId) {
        const { error } = await anyDb.from("liturgia_paroquia").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await anyDb.from("liturgia_paroquia").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["liturgia-paroquia"] });
      qc.invalidateQueries({ queryKey: ["liturgia-month"] });
      toast.success(editingId ? "Celebração atualizada." : "Celebração adicionada.");
      setSheetOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("liturgia_paroquia").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["liturgia-paroquia"] });
      qc.invalidateQueries({ queryKey: ["liturgia-month"] });
      toast.success("Celebração removida.");
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  }

  function openEdit(row: ParoquiaCelRow) {
    setEditingId(row.id);
    setForm({
      data: row.data,
      titulo: row.titulo,
      descricao: row.descricao ?? "",
      grau: row.grau,
      cor: row.cor,
      e_padroeiro: row.e_padroeiro,
    });
    setSheetOpen(true);
  }

  if (!isAdmin) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-10">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Admin</p>
          <h1 className="mt-1 font-serif text-2xl sm:text-3xl">Administração Litúrgica</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personalize o calendário litúrgico da paróquia
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-24 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2025, 2026, 2027, 2028, 2029].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={<CalendarDays className="h-4 w-4" />} label="Base romana" value={String(baseCount ?? "–")} sub={`Ano ${filterYear}`} />
        <StatCard icon={<Settings2 className="h-4 w-4" />} label="Personalizações" value={String(paroCelebracoes.length)} sub="desta paróquia" />
        {isSuperAdmin && (
          <StatCard icon={<Upload className="h-4 w-4" />} label="Importações" value={String(importacoes.length)} sub="histórico" />
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="personalizacao">
            <Settings2 className="h-3.5 w-3.5 mr-1.5" />
            Personalização
          </TabsTrigger>
          <TabsTrigger value="planilha">
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
            Importar Planilha
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="importacao">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Importações
            </TabsTrigger>
          )}
          <TabsTrigger value="conflitos">
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
            Conflitos
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Personalização ── */}
        <TabsContent value="personalizacao" className="mt-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-4">
              Adicione celebrações locais: padroeiros, datas especiais da paróquia, etc.
              Celebrações locais NÃO sobrescrevem solenidades universais.
            </p>

            {loadingParo ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
              </div>
            ) : paroCelebracoes.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Nenhuma personalização para {filterYear}.
                <br />
                <button onClick={openNew} className="mt-1 text-primary underline">Adicionar celebração</button>
              </div>
            ) : (
              <div className="space-y-2">
                {paroCelebracoes.map((row) => {
                  const d = new Date(row.data + "T12:00:00");
                  const record: LiturgicalDayRecord = {
                    date: row.data,
                    titulo: row.titulo,
                    subtitulo: row.descricao,
                    grau: row.grau,
                    cor: row.cor,
                    tempo_liturgico: getLiturgicalSeason(d, d.getFullYear()),
                    e_padroeiro: row.e_padroeiro,
                    origem: "paroquial",
                  };
                  return (
                    <div key={row.id} className="flex items-start gap-3">
                      <div className="shrink-0 w-10 text-center pt-1">
                        <p className="text-sm font-bold">{format(d, "d")}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">
                          {format(d, "MMM", { locale: ptBR })}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <LiturgicalCard record={record} compact />
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(row.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Importações (super_admin) ── */}
        {isSuperAdmin && (
          <TabsContent value="importacao" className="mt-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Para importar PDFs do calendário CNBB, execute o script no terminal:
              </p>
              <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto">
{`node scripts/importar-liturgia.js --ano ${filterYear} --verbose
# Dry-run (sem gravar):
node scripts/importar-liturgia.js --ano ${filterYear} --dry-run
# Validar após importar:
node scripts/validar-liturgia.js --ano ${filterYear}`}
              </pre>
              {importacoes.length > 0 && (
                <div className="space-y-1 mt-3">
                  <p className="text-xs font-medium">Histórico de importações</p>
                  {importacoes.map((imp: Record<string, unknown>) => (
                    <div key={imp.id as string}
                      className="flex items-center gap-3 text-xs bg-muted/30 rounded-lg px-3 py-2">
                      {imp.status === "concluido"
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        : imp.status === "erro"
                        ? <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                        : <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                      <span className="font-medium">{imp.arquivo_nome as string ?? "PDF"}</span>
                      <span className="text-muted-foreground">Ano {imp.ano as number}</span>
                      <span className="ml-auto text-muted-foreground capitalize">{imp.status as string}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {/* ── Tab: Importar Planilha ── */}
        <TabsContent value="planilha" className="mt-4">
          <ImportarPlanilhaTab paroquiaId={paroquiaId ?? ""} onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["liturgia-paroquia"] });
            setTab("personalizacao");
          }} />
        </TabsContent>

        {/* ── Tab: Conflitos ── */}
        <TabsContent value="conflitos" className="mt-4">
          <ConflitosTab paroquiaId={paroquiaId ?? ""} year={parseInt(filterYear, 10)} />
        </TabsContent>
      </Tabs>

      {/* ── Dialog: criar/editar ── */}
      <Dialog open={sheetOpen} onOpenChange={(v) => { if (!v) { setSheetOpen(false); setEditingId(null); }}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar celebração" : "Nova celebração local"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Data</Label>
                <Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Título</Label>
                <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ex: N. Sra. da Conceição — Padroeira" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Descrição (opcional)</Label>
                <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  rows={2} className="mt-1 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Grau</Label>
                <Select value={form.grau} onValueChange={(v) => setForm({ ...form, grau: v as LiturgicalRank })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RANK_LABEL) as LiturgicalRank[]).map((r) => (
                      <SelectItem key={r} value={r}>{RANK_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Cor litúrgica</Label>
                <Select value={form.cor} onValueChange={(v) => setForm({ ...form, cor: v as LiturgicalColor })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LITURGICAL_COLOR_LABEL) as LiturgicalColor[]).map((c) => (
                      <SelectItem key={c} value={c}>{LITURGICAL_COLOR_LABEL[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="padroeiro" checked={form.e_padroeiro}
                  onChange={(e) => setForm({ ...form, e_padroeiro: e.target.checked })} />
                <Label htmlFor="padroeiro" className="text-sm cursor-pointer">
                  Dia do Padroeiro (escala reforçada)
                </Label>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>Cancelar</Button>
              <Button className="flex-1" disabled={saveMutation.isPending || !form.titulo.trim()}
                onClick={() => saveMutation.mutate(form)}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm delete ── */}
      <Dialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover celebração?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" className="flex-1" disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remover"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function ConflitosTab({ paroquiaId, year }: { paroquiaId: string; year: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["liturgia-conflitos", paroquiaId, year],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const [base, paro] = await Promise.all([
        anyDb.from("liturgia_base").select("data, titulo, grau").eq("ano", year).eq("grau", "solenidade"),
        anyDb.from("liturgia_paroquia").select("data, titulo, grau").eq("paroquia_id", paroquiaId)
          .gte("data", `${year}-01-01`).lte("data", `${year}-12-31`),
      ]);
      const baseByDate = new Map((base.data ?? []).map((r: Record<string, string>) => [r.data, r]));
      const conflicts: Array<{ data: string; base: unknown; local: unknown }> = [];
      for (const r of (paro.data ?? [])) {
        if (baseByDate.has(r.data)) {
          conflicts.push({ data: r.data, base: baseByDate.get(r.data), local: r });
        }
      }
      return conflicts;
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
        Nenhum conflito litúrgico detectado para {year}.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" />
        {data.length} conflito(s) detectado(s) — celebrações locais na mesma data que solenidades universais.
      </p>
      <p className="text-xs text-muted-foreground">
        As solenidades universais têm prioridade automática. A celebração local será exibida como deslocada.
      </p>
      <div className="space-y-2">
        {data.map((c) => {
          const d = new Date(c.data + "T12:00:00");
          const base = c.base as Record<string, string>;
          const local = c.local as Record<string, string>;
          return (
            <div key={c.data} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs space-y-1">
              <p className="font-semibold">{format(d, "d 'de' MMMM", { locale: ptBR })}</p>
              <p className="text-green-700">✅ Vence: {base.titulo} (Solenidade universal)</p>
              <p className="text-amber-700">⬇️ Deslocada: {local.titulo} ({RANK_LABEL[local.grau as LiturgicalRank] ?? local.grau})</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ImportarPlanilhaTab ──────────────────────────────────────────────────────

type ImportRow = {
  rowNum: number;
  data: string | null;
  titulo: string;
  grau: string;
  cor: string;
  valid: boolean;
  errors: string[];
};

const GRAU_NORMALIZE: Record<string, string> = {
  solenidade: "solenidade", solenidades: "solenidade",
  festa: "festa",
  memorial: "memorial",
  "memorial facultativo": "memorial_facultativo",
  "mem. facultativo": "memorial_facultativo",
  "mem_facultativo": "memorial_facultativo",
  memorial_facultativo: "memorial_facultativo",
  feria: "feria", féria: "feria",
  domingo: "domingo",
};

const COR_NORMALIZE: Record<string, string> = {
  branco: "branco", white: "branco",
  verde: "verde", green: "verde",
  roxo: "roxo", purple: "roxo",
  vermelho: "vermelho", red: "vermelho",
  rosa: "rosa", pink: "rosa",
  preto: "preto", black: "preto",
  dourado: "dourado", gold: "dourado", amarelo: "dourado",
};

function parseDateVal(val: unknown): string | null {
  if (val instanceof Date) {
    const y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, "0"), d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "number") {
    // Excel serial date — aproximação
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + val * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
  }
  if (typeof val === "string") {
    const s = val.trim();
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) {
      const yr = m1[3].length === 2 ? "20" + m1[3] : m1[3];
      return `${yr}-${m1[2].padStart(2,"0")}-${m1[1].padStart(2,"0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, "-");
  }
  return null;
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Data", "Titulo", "Grau", "Cor"],
    ["29/05/2026", "São João da Cruz", "memorial", "branco"],
    ["03/06/2026", "Corpus Christi", "solenidade", "branco"],
    ["08/12/2026", "Nossa Senhora da Conceição", "solenidade", "branco"],
    ["15/08/2026", "Assunção de Nossa Senhora", "solenidade", "branco"],
  ]);
  // Largura das colunas
  ws["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 22 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, "Celebrações");
  XLSX.writeFile(wb, "modelo-liturgia.xlsx");
}

function ImportarPlanilhaTab({ paroquiaId, onSuccess }: { paroquiaId: string; onSuccess: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const parsed: ImportRow[] = raw.map((r, i) => {
        const errors: string[] = [];
        // Detectar coluna de data (case-insensitive)
        const dataKey = Object.keys(r).find((k) => /^dat/i.test(k));
        const dataVal = dataKey ? parseDateVal(r[dataKey]) : null;
        if (!dataVal) errors.push("Data inválida");

        // Detectar coluna de título
        const tituloKey = Object.keys(r).find((k) => /^tit|^san|^nom|^cel/i.test(k));
        const titulo = tituloKey ? String(r[tituloKey]).trim() : "";
        if (!titulo) errors.push("Título obrigatório");

        // Grau (opcional, default memorial)
        const grauKey = Object.keys(r).find((k) => /^gra/i.test(k));
        const grauRaw = grauKey ? String(r[grauKey]).trim().toLowerCase() : "";
        const grau = GRAU_NORMALIZE[grauRaw] ?? "memorial";

        // Cor (opcional, default branco)
        const corKey = Object.keys(r).find((k) => /^cor/i.test(k));
        const corRaw = corKey ? String(r[corKey]).trim().toLowerCase() : "";
        const cor = COR_NORMALIZE[corRaw] ?? "branco";

        return { rowNum: i + 2, data: dataVal, titulo, grau, cor, valid: errors.length === 0, errors };
      });

      setRows(parsed);
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    const valid = rows.filter((r) => r.valid && r.data && r.titulo);
    if (!valid.length || !paroquiaId) return;
    setImporting(true);

    const inserts = valid.map((r) => ({
      paroquia_id: paroquiaId,
      data: r.data!,
      titulo: r.titulo,
      grau: r.grau,
      cor: r.cor,
      e_padroeiro: false,
    }));

    // Inserir em lotes de 100
    let ok = 0, fail = 0;
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100);
      const { error } = await anyDb.from("liturgia_paroquia").upsert(batch, { onConflict: "paroquia_id,data" });
      if (error) fail += batch.length; else ok += batch.length;
    }

    setImporting(false);
    if (fail > 0) toast.error(`${fail} linha(s) com erro ao importar.`);
    if (ok > 0) {
      toast.success(`${ok} celebração(ões) importada(s) com sucesso.`);
      setRows([]);
      onSuccess();
    }
  }

  const validCount  = rows.filter((r) => r.valid).length;
  const invalidCount = rows.filter((r) => !r.valid).length;

  return (
    <div className="space-y-4">
      {/* Instruções + Baixar modelo */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Importar via Planilha</p>
            <p className="text-xs text-muted-foreground mt-1">
              Importe datas de santos e celebrações locais a partir de um arquivo
              <strong> .xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong>.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={downloadTemplate} className="shrink-0">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Baixar modelo
          </Button>
        </div>

        <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Colunas esperadas na planilha:</p>
          <ul className="space-y-0.5 list-inside list-disc">
            <li><strong>Data</strong> — obrigatório. Ex: <code>29/05/2026</code> ou <code>2026-05-29</code></li>
            <li><strong>Titulo</strong> (ou Santo, Nome) — obrigatório. Ex: <code>São João da Cruz</code></li>
            <li><strong>Grau</strong> — opcional. Valores: <code>solenidade · festa · memorial · memorial facultativo</code></li>
            <li><strong>Cor</strong> — opcional. Valores: <code>branco · verde · vermelho · roxo · rosa · preto · dourado</code></li>
          </ul>
        </div>

        <div className="flex gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFile}
          />
          <Button onClick={() => fileRef.current?.click()} className="flex-1">
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            Selecionar planilha
          </Button>
        </div>
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> {validCount} válida(s)
              </span>
              {invalidCount > 0 && (
                <span className="text-red-600 font-medium flex items-center gap-1">
                  <XCircle className="h-4 w-4" /> {invalidCount} com erro
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRows([])}>Limpar</Button>
              <Button size="sm" disabled={validCount === 0 || importing} onClick={handleImport}>
                {importing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Upload className="h-3.5 w-3.5 mr-1.5" />
                }
                Importar {validCount} linha(s)
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8">#</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Data</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Titulo</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Grau</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-20">Cor</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-20">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.rowNum} className={row.valid ? "" : "bg-red-50/50 dark:bg-red-950/10"}>
                    <td className="px-3 py-2 text-muted-foreground">{row.rowNum}</td>
                    <td className="px-3 py-2 font-mono">{row.data ?? <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-2 truncate max-w-[200px]">{row.titulo || <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground capitalize">{RANK_LABEL[row.grau as LiturgicalRank] ?? row.grau}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: { branco: "#d1d5db", verde: "#16a34a", vermelho: "#dc2626", roxo: "#9333ea", rosa: "#ec4899", preto: "#374151", dourado: "#f59e0b" }[row.cor] ?? "#9ca3af" }} />
                        {row.cor}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.valid
                        ? <span className="text-green-600 font-medium">✓</span>
                        : <span className="text-red-600 text-[10px]">{row.errors.join(", ")}</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
