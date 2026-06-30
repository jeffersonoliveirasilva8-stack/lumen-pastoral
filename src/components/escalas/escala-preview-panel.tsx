// Painel de revisão e ajuste das sugestões do motor V3.
// Mostra um card por função com o membro sugerido, score, motivo, e permite
// troca manual ou remoção. Controla indicadores de dirty e hash divergido.

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Trash2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InsightFuncao } from "@/biblioteca/escala-engine";
import type { SugestaoItem } from "@/hooks/use-escala-preview";

// ── Tipos de prop ─────────────────────────────────────────────────────────────

type MembroDisponivel = {
  id: string;
  nome: string;
};

type FuncaoInfo = {
  ministerio_id: string;
  ministerio_nome: string;
  quantidade: number;
};

type Props = {
  funcoes: FuncaoInfo[];
  sugestoes: SugestaoItem[];
  engineSnapshots: Record<string, InsightFuncao>;
  membrosDisponiveis: (ministerio_id: string) => MembroDisponivel[];
  dirtyPreview: boolean;
  hashDivergiu: boolean;
  lastGeneratedAt: Date | null;
  isSalvando: boolean;
  onTrocar: (ministerio_id: string, novo: { membro_id: string; membro_nome: string }) => void;
  onRemover: (ministerio_id: string, membro_id: string) => void;
  onSalvarRascunho: () => void;
  onLimpar: () => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatScore(score: number | null): string {
  if (score === null) return "—";
  return score.toFixed(1);
}

function poolLabel(pool: 1 | 2 | 3 | 4 | 5 | undefined): string {
  if (!pool) return "";
  return ["", "Livre", "Sem semana", "Sem mês", "Forçado", "Intervalo mín."][pool] ?? "";
}

// ── Componente ────────────────────────────────────────────────────────────────

export function EscalaPreviewPanel({
  funcoes,
  sugestoes,
  engineSnapshots,
  membrosDisponiveis,
  dirtyPreview,
  hashDivergiu,
  lastGeneratedAt,
  isSalvando,
  onTrocar,
  onRemover,
  onSalvarRascunho,
  onLimpar,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // Agrupa sugestões por ministerio_id
  const porFuncao = new Map<string, SugestaoItem[]>();
  for (const s of sugestoes) {
    const arr = porFuncao.get(s.ministerio_id) ?? [];
    arr.push(s);
    porFuncao.set(s.ministerio_id, arr);
  }

  return (
    <div className="space-y-3">
      {/* Header com metadata e ações globais */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Sugestões do motor</span>
          {dirtyPreview && (
            <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px]">
              não salvo
            </Badge>
          )}
          {lastGeneratedAt && (
            <span className="text-[10px] text-muted-foreground">
              {lastGeneratedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={dirtyPreview ? "default" : "outline"}
            className="h-7 text-xs"
            disabled={sugestoes.length === 0 || isSalvando}
            onClick={onSalvarRascunho}
          >
            {isSalvando ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
            {dirtyPreview ? "● Salvar Rascunho" : "Salvar Rascunho"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onLimpar}>
            Limpar
          </Button>
        </div>
      </div>

      {/* Banner de dados alterados */}
      {hashDivergiu && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Membros, vínculos ou disponibilidades foram alterados desde a última geração. Considere gerar novamente.
        </div>
      )}

      {/* Cards por função */}
      {funcoes.map((funcao) => {
        const items = porFuncao.get(funcao.ministerio_id) ?? [];
        const snapshot = engineSnapshots[funcao.ministerio_id];
        const vagas = funcao.quantidade;
        const preenchidas = items.length;
        const isComplete = preenchidas >= vagas;
        const isOpen = expanded[funcao.ministerio_id] ?? false;

        return (
          <div
            key={funcao.ministerio_id}
            className={`rounded-lg border ${isComplete ? "border-border" : "border-amber-300 dark:border-amber-700"} bg-card`}
          >
            <Collapsible open={isOpen} onOpenChange={() => toggleExpand(funcao.ministerio_id)}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40 rounded-lg transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    {isComplete
                      ? <UserCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      : <UserX className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    }
                    <span className="text-sm font-medium truncate">{funcao.ministerio_nome}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {preenchidas}/{vagas}
                    </span>
                  </div>
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="px-3 pb-3 space-y-2">
                  {/* Linhas de membros alocados */}
                  {items.length > 0 ? items.map((item) => (
                    <MembroRow
                      key={`${item.ministerio_id}-${item.membro_id}`}
                      item={item}
                      candidatos={membrosDisponiveis(funcao.ministerio_id)}
                      onTrocar={(novo) => onTrocar(funcao.ministerio_id, novo)}
                      onRemover={() => onRemover(funcao.ministerio_id, item.membro_id)}
                    />
                  )) : (
                    <p className="text-xs text-muted-foreground italic">Nenhum membro sugerido para esta função.</p>
                  )}

                  {/* Insights compactos do snapshot */}
                  {snapshot && (
                    <div className="mt-1 pt-1 border-t border-border/40 text-[10px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{snapshot.candidatos_avaliados} avaliados</span>
                      {snapshot.excluidos.indisponibilidade > 0 && (
                        <span>{snapshot.excluidos.indisponibilidade} indisponíveis</span>
                      )}
                      {snapshot.excluidos.acima_limite > 0 && (
                        <span>{snapshot.excluidos.acima_limite} acima do limite</span>
                      )}
                      {snapshot.motivo_vazio && (
                        <span className="text-amber-600">{snapshot.motivo_vazio}</span>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-componente: linha de membro ───────────────────────────────────────────

function MembroRow({
  item,
  candidatos,
  onTrocar,
  onRemover,
}: {
  item: SugestaoItem;
  candidatos: MembroDisponivel[];
  onTrocar: (novo: { membro_id: string; membro_nome: string }) => void;
  onRemover: () => void;
}) {
  const [trocando, setTrocando] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {/* Indicador de origem */}
      <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${item.origem === "motor" ? "bg-blue-500" : "bg-violet-500"}`} title={item.origem === "motor" ? "Sugerido pelo motor" : "Alocação manual"} />

      <div className="flex-1 min-w-0">
        {trocando ? (
          <Select
            onValueChange={(val) => {
              const candidato = candidatos.find((c) => c.id === val);
              if (candidato) onTrocar({ membro_id: candidato.id, membro_nome: candidato.nome });
              setTrocando(false);
            }}
            onOpenChange={(open) => { if (!open) setTrocando(false); }}
            defaultOpen
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Selecionar membro..." />
            </SelectTrigger>
            <SelectContent>
              {candidatos.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.nome}
                </SelectItem>
              ))}
              {candidatos.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">Nenhum disponível</div>
              )}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm truncate">{item.membro_nome}</span>
            {item.score_motor !== null && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatScore(item.score_motor)}
              </span>
            )}
            {item.justificativa && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {poolLabel(item.justificativa.pool)}
              </span>
            )}
            {item.substituido_nome && (
              <span className="text-[10px] text-muted-foreground shrink-0 italic">
                (era {item.substituido_nome})
              </span>
            )}
          </div>
        )}
      </div>

      {!trocando && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Trocar membro"
            onClick={() => setTrocando(true)}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive hover:text-destructive"
            title="Remover da escala"
            onClick={onRemover}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
