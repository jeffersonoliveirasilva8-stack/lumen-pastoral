// Hook de gerenciamento do preview de escala — Sprint 2
// Responsabilidades: engineSnapshots, suggestedAssignments, dirtyPreview,
// previewHash, lastGeneratedAt, persistência localStorage com TTL 24h.

import { useState, useEffect, useCallback, useRef } from "react";
import type { InsightFuncao } from "@/biblioteca/escala-engine";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type JustificativaMotorV3 = {
  v: "3";
  modo: "comum" | "solene_principal";
  score: number;
  participacoes_30d: number;
  dias_sem_servir: number;
  pool: 1 | 2 | 3 | 4;
  forcado: boolean;
};

export type SugestaoItem = {
  ministerio_id: string;
  membro_id: string;
  membro_nome: string;
  ministerio_nome: string;
  origem: "motor" | "manual";
  score_motor: number | null;
  substituido_de: string | null;    // membro_id original sugerido pelo motor
  substituido_nome: string | null;  // nome do membro original (para exibição)
  justificativa: JustificativaMotorV3 | null;
};

export type EscalaPreviewState = {
  engineSnapshots: Record<string, InsightFuncao>;   // ministerio_id → snapshot imutável
  suggestedAssignments: SugestaoItem[];              // mutável pelo coordenador
  dirtyPreview: boolean;
  lastGeneratedAt: Date | null;
  previewHash: string | null;
  hashDivergiu: boolean;
};

// ── Hash leve (djb2) ─────────────────────────────────────────────────────────

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // converte para uint32
  }
  return hash.toString(16);
}

export function computePreviewHash(params: {
  membroIds: string[];
  vinculos: Array<{ membro_id: string; ministerio_id: string }>;
  indisponibilidades: Array<{ membro_id: string; data: string }>;
  escalaData: string;
}): string {
  const membrosStr  = [...params.membroIds].sort().join(",");
  const vinculosStr = params.vinculos
    .map((v) => `${v.membro_id}:${v.ministerio_id}`)
    .sort().join(",");
  const indispsStr  = params.indisponibilidades
    .map((i) => `${i.membro_id}:${i.data}`)
    .sort().join(",");
  return djb2(`${membrosStr}|${vinculosStr}|${indispsStr}|${params.escalaData}`);
}

// ── Persistência localStorage ─────────────────────────────────────────────────

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

type StoredPreview = {
  suggestedAssignments: SugestaoItem[];
  engineSnapshots: Record<string, InsightFuncao>;
  previewHash: string;
  savedAt: string; // ISO
};

function storageKey(userId: string, escalaId: string): string {
  return `lumen_preview_v1_${userId}_${escalaId}`;
}

function loadFromStorage(userId: string, escalaId: string): StoredPreview | null {
  try {
    const raw = localStorage.getItem(storageKey(userId, escalaId));
    if (!raw) return null;
    const parsed: StoredPreview & { savedAt: string } = JSON.parse(raw);
    const age = Date.now() - new Date(parsed.savedAt).getTime();
    if (age > TTL_MS) {
      localStorage.removeItem(storageKey(userId, escalaId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(userId: string, escalaId: string, data: StoredPreview): void {
  try {
    localStorage.setItem(storageKey(userId, escalaId), JSON.stringify(data));
  } catch {
    // localStorage cheio ou indisponível — ignorar silenciosamente
  }
}

function clearStorage(userId: string, escalaId: string): void {
  try {
    localStorage.removeItem(storageKey(userId, escalaId));
  } catch {
    // ignorar
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEscalaPreview(params: {
  escalaId: string;
  userId: string;
  currentHash: string | null; // hash calculado com os dados atuais do banco
}) {
  const { escalaId, userId, currentHash } = params;

  const [engineSnapshots, setEngineSnapshots] = useState<Record<string, InsightFuncao>>({});
  const [suggestedAssignments, setSuggestedAssignments] = useState<SugestaoItem[]>([]);
  const [dirtyPreview, setDirtyPreview] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Detecta se o hash atual diverge do hash no momento da geração
  const hashDivergiu = !!(previewHash && currentHash && previewHash !== currentHash);

  // Salva no localStorage com debounce de 1.5s após qualquer mutação
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistRef  = useRef({ suggestedAssignments, engineSnapshots, previewHash });

  useEffect(() => {
    persistRef.current = { suggestedAssignments, engineSnapshots, previewHash };
  }, [suggestedAssignments, engineSnapshots, previewHash]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { suggestedAssignments: sa, engineSnapshots: es, previewHash: ph } = persistRef.current;
      if (sa.length > 0 && ph) {
        saveToStorage(userId, escalaId, {
          suggestedAssignments: sa,
          engineSnapshots: es,
          previewHash: ph,
          savedAt: new Date().toISOString(),
        });
      }
    }, 1500);
  }, [userId, escalaId]);

  // Restaura do localStorage ao montar
  useEffect(() => {
    if (restored) return;
    const stored = loadFromStorage(userId, escalaId);
    if (stored && stored.suggestedAssignments.length > 0) {
      setEngineSnapshots(stored.engineSnapshots);
      setSuggestedAssignments(stored.suggestedAssignments);
      setPreviewHash(stored.previewHash);
      setLastGeneratedAt(new Date(stored.savedAt));
      // Restaurado do localStorage = dados NÃO estão no banco ainda.
      // dirtyPreview = true garante que "Publicar" vai salvar antes de mudar status.
      setDirtyPreview(true);
    }
    setRestored(true);
  }, [userId, escalaId, restored]);

  // Dispara save no beforeunload quando há dirty
  useEffect(() => {
    const handler = () => {
      if (persistRef.current.suggestedAssignments.length > 0 && persistRef.current.previewHash) {
        const { suggestedAssignments: sa, engineSnapshots: es, previewHash: ph } = persistRef.current;
        saveToStorage(userId, escalaId, {
          suggestedAssignments: sa,
          engineSnapshots: es,
          previewHash: ph!,
          savedAt: new Date().toISOString(),
        });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [userId, escalaId]);

  // ── Ações públicas ────────────────────────────────────────────────────────

  const setGeracaoCompleta = useCallback((
    snapshots: Record<string, InsightFuncao>,
    assignments: SugestaoItem[],
    hash: string,
  ) => {
    setEngineSnapshots(snapshots);
    setSuggestedAssignments(assignments);
    setPreviewHash(hash);
    setLastGeneratedAt(new Date());
    setDirtyPreview(true);
    // Persiste imediatamente após geração
    saveToStorage(userId, escalaId, {
      suggestedAssignments: assignments,
      engineSnapshots: snapshots,
      previewHash: hash,
      savedAt: new Date().toISOString(),
    });
  }, [userId, escalaId]);

  const trocarMembro = useCallback((
    ministerio_id: string,
    novo: { membro_id: string; membro_nome: string },
  ) => {
    // Captura o snapshot antes de entrar no setter para lookup do score do novo membro.
    // top_candidatos inclui todos os avaliados, não só os escolhidos.
    const snapshotAtual = persistRef.current.engineSnapshots[ministerio_id];
    const novoScore = snapshotAtual?.top_candidatos.find(
      (c) => c.membro_id === novo.membro_id,
    )?.score_final ?? null;

    setSuggestedAssignments((prev) =>
      prev.map((a) =>
        a.ministerio_id === ministerio_id
          ? {
              ...a,
              membro_id:        novo.membro_id,
              membro_nome:      novo.membro_nome,
              origem:           "manual" as const,
              substituido_de:   a.origem === "motor" ? a.membro_id : a.substituido_de,
              substituido_nome: a.origem === "motor" ? a.membro_nome : a.substituido_nome,
              score_motor:      novoScore !== null ? Math.round(novoScore) : null,
              justificativa:    null, // justificativa do motor não se aplica à troca manual
            }
          : a,
      ),
    );
    setDirtyPreview(true);
    scheduleSave();
  }, [scheduleSave]);

  // Adiciona uma alocação manual para vaga descoberta
  const adicionarManual = useCallback((item: Omit<SugestaoItem, "origem" | "substituido_de" | "substituido_nome" | "justificativa">) => {
    setSuggestedAssignments((prev) => [
      ...prev,
      { ...item, origem: "manual", substituido_de: null, substituido_nome: null, justificativa: null },
    ]);
    setDirtyPreview(true);
    scheduleSave();
  }, [scheduleSave]);

  // Remove uma alocação do preview (vaga fica em aberto)
  const removerDoPreview = useCallback((ministerio_id: string, membro_id: string) => {
    setSuggestedAssignments((prev) =>
      prev.filter((a) => !(a.ministerio_id === ministerio_id && a.membro_id === membro_id)),
    );
    setDirtyPreview(true);
    scheduleSave();
  }, [scheduleSave]);

  // Substitui snapshots de uma função específica (regeneração parcial)
  const atualizarFuncao = useCallback((
    ministerio_id: string,
    novoSnapshot: InsightFuncao,
    novasAssignments: SugestaoItem[],
  ) => {
    setEngineSnapshots((prev) => ({ ...prev, [ministerio_id]: novoSnapshot }));
    setSuggestedAssignments((prev) => [
      ...prev.filter((a) => a.ministerio_id !== ministerio_id),
      ...novasAssignments,
    ]);
    setDirtyPreview(true);
    scheduleSave();
  }, [scheduleSave]);

  const limparPreview = useCallback(() => {
    setEngineSnapshots({});
    setSuggestedAssignments([]);
    setPreviewHash(null);
    setLastGeneratedAt(null);
    setDirtyPreview(false);
    clearStorage(userId, escalaId);
  }, [userId, escalaId]);

  const marcarSalvo = useCallback(() => {
    setDirtyPreview(false);
    clearStorage(userId, escalaId);
  }, [userId, escalaId]);

  return {
    // Estado
    engineSnapshots,
    suggestedAssignments,
    dirtyPreview,
    lastGeneratedAt,
    previewHash,
    hashDivergiu,
    // Ações
    setGeracaoCompleta,
    trocarMembro,
    adicionarManual,
    removerDoPreview,
    atualizarFuncao,
    limparPreview,
    marcarSalvo,
  };
}
