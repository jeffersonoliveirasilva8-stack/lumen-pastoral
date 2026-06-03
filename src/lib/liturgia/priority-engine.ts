/**
 * Motor de prioridade litúrgica — API pública.
 * Resolve a celebração final para uma data, considerando:
 *   1. Calendário romano (computado)
 *   2. Overrides diocesanos (banco)
 *   3. Customizações paroquiais (banco)
 *
 * Regras canônicas:
 *   solenidade > festa > memorial > memorial_facultativo > comemoracao
 *   padroeiro local pode sobrescrever celebrações comuns
 *   celebrações diocesanas podem sobrescrever calendário nacional
 *   nenhuma celebração local pode sobrescrever solenidade universal
 */

import type { LiturgicalDayRecord, LiturgicalResolution } from '@/biblioteca/liturgia/types';
import { resolveCelebrations, getComputedCelebrations } from '@/biblioteca/liturgia/engine/liturgical-engine';
import { getLiturgicalSeason } from '@/biblioteca/liturgia/engine/seasons';
import { supabase } from '@/integrations/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

// ─── Resolução completa com banco ────────────────────────────────────────────

/**
 * Resolve a celebração litúrgica final para uma data e paróquia.
 * Combina calendário computado + banco (diocese + paróquia).
 */
export async function resolveLiturgicalCelebration(
  date: string,
  paroquiaId?: string
): Promise<LiturgicalResolution | null> {
  const all: LiturgicalDayRecord[] = [];

  // 1. Celebrações computadas (sempre disponíveis)
  all.push(...getComputedCelebrations(date));

  // 2. liturgia_base (banco — calendário romano enriquecido com leituras)
  try {
    const { data: base } = await anyDb
      .from('liturgia_base')
      .select('id, data, titulo, subtitulo, santo, grau, cor, tempo_liturgico, evangelho, leitura_1, leitura_2, salmo, e_dia_preceito, e_solene, origem')
      .eq('data', date)
      .limit(10);

    if (base?.length) {
      for (const r of base) all.push(dbRowToRecord(r, 'romano'));
    }
  } catch { /* banco não disponível — usa só computado */ }

  // 3. liturgia_paroquia (overrides paroquiais)
  if (paroquiaId) {
    try {
      const { data: local } = await anyDb
        .from('liturgia_paroquia')
        .select('id, data, titulo, descricao, grau, cor, e_padroeiro')
        .eq('paroquia_id', paroquiaId)
        .eq('data', date)
        .limit(5);

      if (local?.length) {
        for (const r of local) {
          all.push({
            id: r.id,
            date: r.data,
            titulo: r.titulo,
            subtitulo: r.descricao,
            grau: r.grau ?? 'memorial',
            cor: r.cor ?? 'branco',
            tempo_liturgico: getLiturgicalSeason(new Date(date + 'T12:00:00'), parseInt(date.slice(0, 4), 10)),
            e_padroeiro: r.e_padroeiro ?? false,
            origem: 'paroquial',
          });
        }
      }
    } catch { /* ignorar */ }
  }

  if (all.length === 0) return null;
  return resolveCelebrations(all);
}

// ─── Batch: mês inteiro ───────────────────────────────────────────────────────

/**
 * Retorna mapa de resoluções para todos os dias de um mês.
 * Usa uma única query ao banco para o mês inteiro (performance).
 */
export async function resolveMonth(
  year: number,
  month: number,
  paroquiaId?: string
): Promise<Map<string, LiturgicalResolution>> {
  const result = new Map<string, LiturgicalResolution>();
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = lastDay(year, month);

  // Computed para todos os dias do mês
  const computedByDate = new Map<string, LiturgicalDayRecord[]>();
  const days = daysInMonth(year, month);
  for (let d = 1; d <= days; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    computedByDate.set(dateStr, getComputedCelebrations(dateStr));
  }

  // DB overrides (uma query por tabela)
  const dbByDate = new Map<string, LiturgicalDayRecord[]>();

  try {
    const [baseRes, paroqRes] = await Promise.all([
      anyDb.from('liturgia_base').select('id, data, titulo, subtitulo, grau, cor, tempo_liturgico, e_dia_preceito, e_solene, origem').gte('data', start).lte('data', end),
      paroquiaId
        ? anyDb.from('liturgia_paroquia').select('id, data, titulo, descricao, grau, cor, e_padroeiro').eq('paroquia_id', paroquiaId).gte('data', start).lte('data', end)
        : Promise.resolve({ data: [] }),
    ]);

    for (const r of baseRes.data ?? []) {
      const list = dbByDate.get(r.data) ?? [];
      list.push(dbRowToRecord(r, 'romano'));
      dbByDate.set(r.data, list);
    }
    for (const r of (paroqRes as { data: unknown[] }).data ?? []) {
      const row = r as Record<string, unknown>;
      const list = dbByDate.get(row.data as string) ?? [];
      list.push({
        id: row.id as string,
        date: row.data as string,
        titulo: row.titulo as string,
        subtitulo: row.descricao as string | undefined,
        grau: (row.grau as LiturgicalDayRecord['grau']) ?? 'memorial',
        cor: (row.cor as LiturgicalDayRecord['cor']) ?? 'branco',
        tempo_liturgico: getLiturgicalSeason(
          new Date((row.data as string) + 'T12:00:00'),
          year
        ),
        e_padroeiro: (row.e_padroeiro as boolean) ?? false,
        origem: 'paroquial',
      });
      dbByDate.set(row.data as string, list);
    }
  } catch { /* usa só computado */ }

  // Mescla e resolve para cada dia
  for (const [dateStr, computed] of computedByDate) {
    const db = dbByDate.get(dateStr) ?? [];
    const all = [...computed, ...db];
    const resolution = resolveCelebrations(all);
    if (resolution) result.set(dateStr, resolution);
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dbRowToRecord(r: Record<string, unknown>, origem: LiturgicalDayRecord['origem']): LiturgicalDayRecord {
  return {
    id: r.id as string,
    date: r.data as string,
    titulo: r.titulo as string,
    subtitulo: r.subtitulo as string | undefined,
    santo: r.santo as string | undefined,
    grau: (r.grau as LiturgicalDayRecord['grau']) ?? 'memorial',
    cor: (r.cor as LiturgicalDayRecord['cor']) ?? 'verde',
    tempo_liturgico: (r.tempo_liturgico as LiturgicalDayRecord['tempo_liturgico']) ??
      getLiturgicalSeason(new Date((r.data as string) + 'T12:00:00'), parseInt((r.data as string).slice(0, 4), 10)),
    evangelho: r.evangelho as string | undefined,
    leitura_1: r.leitura_1 as string | undefined,
    leitura_2: r.leitura_2 as string | undefined,
    salmo: r.salmo as string | undefined,
    e_dia_preceito: (r.e_dia_preceito as boolean) ?? false,
    e_solene: (r.e_solene as boolean) ?? false,
    origem,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function lastDay(year: number, month: number): string {
  const d = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
