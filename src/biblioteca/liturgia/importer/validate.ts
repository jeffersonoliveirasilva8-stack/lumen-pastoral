import type { LiturgicalEntry, LiturgicalDayRecord } from '../types';

export interface ValidationResult {
  valid: LiturgicalDayRecord[];
  errors: string[];
  warnings: string[];
  duplicates: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida e normaliza entradas brutas do parser. */
export function validateLiturgicalEntries(
  entries: LiturgicalEntry[]
): ValidationResult {
  const result: ValidationResult = { valid: [], errors: [], warnings: [], duplicates: 0 };
  const seen = new Map<string, number>(); // date → index in valid[]

  for (const entry of entries) {
    const errs: string[] = [];

    // ─── Validação de data ────────────────────────────────────────
    if (!DATE_RE.test(entry.date)) {
      errs.push(`Data inválida: "${entry.date}" (raw: ${entry.raw ?? ''})`);
    } else {
      const d = new Date(entry.date + 'T12:00:00');
      if (isNaN(d.getTime())) {
        errs.push(`Data não parseable: "${entry.date}"`);
      }
    }

    // ─── Validação de título ──────────────────────────────────────
    if (!entry.titulo || entry.titulo.trim().length < 3) {
      errs.push(`Título ausente ou muito curto: "${entry.raw ?? ''}"`);
    }

    if (errs.length > 0) {
      result.errors.push(...errs);
      continue;
    }

    // ─── Warnings ────────────────────────────────────────────────
    if (!entry.grau) {
      result.warnings.push(`Grau não detectado para "${entry.titulo}" (${entry.date})`);
    }
    if (!entry.cor) {
      result.warnings.push(`Cor não detectada para "${entry.titulo}" (${entry.date})`);
    }

    // ─── Deduplicação ─────────────────────────────────────────────
    const key = entry.date;
    if (seen.has(key)) {
      result.duplicates++;
      result.warnings.push(`Duplicata em ${key}: "${entry.titulo}"`);
      // Mantém a entrada com grau maior (se ambas tiverem grau)
      const prevIdx = seen.get(key)!;
      const prev = result.valid[prevIdx];
      if (entry.grau && prev.grau) {
        const WEIGHT: Record<string, number> = {
          solenidade: 5, festa: 4, memorial: 3, memorial_facultativo: 2, comemoracao: 1,
        };
        if ((WEIGHT[entry.grau] ?? 0) > (WEIGHT[prev.grau] ?? 0)) {
          result.valid[prevIdx] = toRecord(entry);
        }
      }
      continue;
    }

    const record = toRecord(entry);
    seen.set(key, result.valid.length);
    result.valid.push(record);
  }

  return result;
}

function toRecord(e: LiturgicalEntry): LiturgicalDayRecord {
  return {
    date: e.date,
    titulo: e.titulo.trim(),
    subtitulo: e.subtitulo,
    santo: e.santo,
    grau: e.grau ?? 'comemoracao',
    cor: e.cor ?? 'verde',
    // Tempo litúrgico será resolvido pelo serviço na consulta
    tempo_liturgico: 'comum',
    evangelho: e.evangelho,
    leitura_1: e.leitura_1,
    leitura_2: e.leitura_2,
    salmo: e.salmo,
    e_dia_preceito: e.e_dia_preceito ?? false,
    origem: e.origem,
  };
}
