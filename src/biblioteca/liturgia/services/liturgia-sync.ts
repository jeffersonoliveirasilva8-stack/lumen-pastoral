import type { LiturgicalDayRecord } from '../types';
import { getComputedCelebrations } from '../engine/liturgical-engine';
import { getLiturgicalSeason } from '../engine/seasons';

/** Resultado de uma operação de upsert. */
export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface LiturgiaSyncAdapter {
  /** Verifica se já existe registro para a data. */
  exists(date: string): Promise<boolean>;
  /** Insere nova celebração. */
  insert(record: LiturgicalDayRecord): Promise<void>;
  /** Atualiza celebração existente. */
  update(date: string, record: Partial<LiturgicalDayRecord>): Promise<void>;
  /** Busca IDs já existentes em um range. */
  getExistingDates(start: string, end: string): Promise<string[]>;
}

/**
 * Sincroniza o calendário computado para o banco (população inicial).
 * Apenas inserções — não sobrescreve dados manuais no banco.
 * Use `force=true` para atualizar registros existentes.
 */
export async function syncYearToDb(
  year: number,
  adapter: LiturgiaSyncAdapter,
  options?: { force?: boolean; dryRun?: boolean }
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const existingDates = new Set(await adapter.getExistingDates(start, end));

  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const celebrations = getComputedCelebrations(dateStr);

      for (const rec of celebrations) {
        try {
          if (existingDates.has(dateStr) && !options?.force) {
            result.skipped++;
            continue;
          }

          if (options?.dryRun) {
            result.inserted++;
            continue;
          }

          if (existingDates.has(dateStr) && options?.force) {
            await adapter.update(dateStr, rec);
            result.updated++;
          } else {
            await adapter.insert(rec);
            result.inserted++;
            existingDates.add(dateStr);
          }
        } catch (e) {
          result.errors.push(`${dateStr}: ${String(e)}`);
        }
      }

      // Dias sem celebração especial também recebem o tempo litúrgico
      if (celebrations.length === 0 && !existingDates.has(dateStr)) {
        const d = new Date(dateStr + 'T12:00:00');
        const season = getLiturgicalSeason(d, year);
        const weekdayRecord: LiturgicalDayRecord = {
          date: dateStr,
          titulo: 'Feria',
          grau: 'comemoracao',
          cor: season === 'advento' || season === 'quaresma' ? 'roxo'
             : season === 'triduo' ? 'vermelho'
             : season === 'pascoa' || season === 'natal' ? 'branco'
             : 'verde',
          tempo_liturgico: season,
          origem: 'romano',
        };
        if (!options?.dryRun) {
          try {
            await adapter.insert(weekdayRecord);
            result.inserted++;
          } catch (e) {
            result.errors.push(`${dateStr} feria: ${String(e)}`);
          }
        }
      }
    }
  }

  return result;
}
