#!/usr/bin/env node
/**
 * scripts/importar-liturgia.js
 * Importa PDFs do calendário litúrgico CNBB e popula liturgia_base no Supabase.
 *
 * Uso:
 *   node scripts/importar-liturgia.js [opções]
 *
 * Opções:
 *   --ano 2026             Importar ano específico (padrão: todos os PDFs encontrados)
 *   --dry-run              Apenas valida, não grava no banco
 *   --force                Sobrescreve registros existentes
 *   --verbose              Log detalhado
 *   --validate-only        Valida sem conectar ao Supabase
 *   --pasta ./pdfs         Pasta com os PDFs (padrão: src/biblioteca/liturgia/importer/)
 *
 * Requer:
 *   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente (ou .env)
 *
 * Exemplo:
 *   node scripts/importar-liturgia.js --ano 2026 --dry-run --verbose
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ─── Argparse simples ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = {
  ano: getArg('--ano'),
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  verbose: args.includes('--verbose'),
  validateOnly: args.includes('--validate-only'),
  pasta: getArg('--pasta') ?? join(PROJECT_ROOT, 'src/biblioteca/liturgia/importer'),
};

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

// ─── Normalização inline (sem importar TS) ────────────────────────────────────
const MONTH_MAP = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function normalizeRank(s) {
  const n = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('solenidade') || n.includes('sol.')) return 'solenidade';
  if (n.includes('festa') || n.includes('fest.')) return 'festa';
  if (n.includes('memorial fac') || n.includes('mem.fac') || n.includes('opt')) return 'memorial_facultativo';
  if (n.includes('memorial') || n.includes('mem.')) return 'memorial';
  if (n.includes('comemora')) return 'comemoracao';
  return null;
}

function normalizeColor(s) {
  const n = s.toLowerCase();
  if (n.includes('verde')) return 'verde';
  if (n.includes('roxo') || n.includes('violeta')) return 'roxo';
  if (n.includes('branco')) return 'branco';
  if (n.includes('vermelho')) return 'vermelho';
  if (n.includes('rosa')) return 'rosa';
  if (n.includes('preto') || n.includes('negro')) return 'preto';
  if (n.includes('doura') || n.includes('ouro')) return 'dourado';
  return null;
}

function parseLine(line, year) {
  let m;

  // "DD de MMMM — Título — Grau — Cor"
  m = line.match(/^(\d{1,2})\s+de\s+([a-záéíóúãõçêâô]+)\.?\s*[—–-]\s*(.+)/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthKey = m[2].toLowerCase().slice(0, 3);
    const month = MONTH_MAP[monthKey] ?? MONTH_MAP[m[2].toLowerCase()];
    if (!month) return null;
    return buildEntry(year, month, day, m[3], line);
  }

  // "DD/MM — Título — Grau — Cor"
  m = line.match(/^(\d{1,2})\/(\d{1,2})\s*[—–-]\s*(.+)/);
  if (m) return buildEntry(year, parseInt(m[2], 10), parseInt(m[1], 10), m[3], line);

  return null;
}

function buildEntry(year, month, day, rest, rawLine) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parts = rest.split(/\s*[—–]\s*/).map(p => p.trim()).filter(Boolean);
  const titulo = parts[0] ?? rest.trim();
  let grau = null, cor = null;
  for (const p of parts) { if (!grau) grau = normalizeRank(p); if (!cor) cor = normalizeColor(p); }
  return { date, titulo: titulo.trim(), grau, cor, raw: rawLine };
}

function parseText(text, year) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  const entries = [];
  let currentYear = year ?? new Date().getFullYear();
  for (const line of lines) {
    const ym = line.match(/\b(20\d{2})\b/);
    if (ym && line.length < 30) { currentYear = parseInt(ym[1], 10); continue; }
    const e = parseLine(line, currentYear);
    if (e) entries.push(e);
  }
  return entries;
}

// ─── Carregar pdf-parse ───────────────────────────────────────────────────────
async function extractPdfText(filePath) {
  try {
    // pdf-parse 2.x expõe named export no ESM
    const mod = await import('pdf-parse');
    const pdfParse = mod.pdf ?? mod.default ?? mod;
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (e) {
    console.error(`[pdf] Erro ao ler ${filePath}:`, e.message);
    return null;
  }
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────
async function getSupabase() {
  if (opt.validateOnly) return null;
  try {
    // Tenta carregar .env
    try {
      const { config } = await import('dotenv');
      config({ path: join(PROJECT_ROOT, '.env.local') });
    } catch {}

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos');

    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key);
  } catch (e) {
    console.error('[supabase]', e.message);
    return null;
  }
}

async function upsertEntries(supabase, entries, ano) {
  if (!supabase || opt.dryRun) return { inserted: entries.length, updated: 0, errors: [] };

  const rows = entries.map(e => ({
    data: e.date,
    ano,
    titulo: e.titulo,
    grau: e.grau ?? 'comemoracao',
    cor: e.cor ?? 'verde',
    origem: 'romano',
  }));

  const { error } = await supabase
    .from('liturgia_base')
    .upsert(rows, { onConflict: 'data', ignoreDuplicates: !opt.force });

  if (error) return { inserted: 0, updated: 0, errors: [error.message] };
  return { inserted: rows.length, updated: 0, errors: [] };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n📖 Importador de Calendário Litúrgico CNBB');
  console.log('==========================================');
  if (opt.dryRun) console.log('🔵 DRY-RUN: nenhuma escrita no banco\n');

  // Descobrir PDFs
  let pdfFiles = [];
  try {
    pdfFiles = readdirSync(opt.pasta)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .map(f => join(opt.pasta, f));
  } catch (e) {
    console.error('Pasta não encontrada:', opt.pasta);
    process.exit(1);
  }

  if (opt.ano) {
    pdfFiles = pdfFiles.filter(f => f.includes(opt.ano));
  }

  if (pdfFiles.length === 0) {
    console.log('⚠️  Nenhum PDF encontrado em', opt.pasta);
    process.exit(0);
  }

  console.log(`📁 ${pdfFiles.length} PDF(s) encontrado(s)\n`);

  const supabase = await getSupabase();
  let totalInserted = 0, totalErrors = 0, totalWarnings = 0;

  for (const filePath of pdfFiles) {
    const fileName = filePath.split(/[/\\]/).pop();
    console.log(`\n📄 Processando: ${fileName}`);

    // Detecta ano no nome do arquivo
    const yearMatch = fileName.match(/\b(20\d{2})\b/);
    const ano = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
    console.log(`   Ano detectado: ${ano}`);

    const text = await extractPdfText(filePath);
    if (!text) { console.log('   ❌ Falha ao extrair texto'); totalErrors++; continue; }

    const entries = parseText(text, ano);
    console.log(`   📋 ${entries.length} entradas extraídas`);

    // Validação
    const valid = entries.filter(e => e.titulo && e.titulo.length >= 3);
    const invalid = entries.length - valid.length;
    const noRank = valid.filter(e => !e.grau).length;

    if (invalid > 0) console.log(`   ⚠️  ${invalid} entradas inválidas descartadas`);
    if (noRank > 0) console.log(`   ⚠️  ${noRank} entradas sem grau detectado`);
    totalWarnings += invalid + noRank;

    if (opt.verbose) {
      valid.slice(0, 5).forEach(e => console.log(`      • ${e.date} — ${e.titulo} [${e.grau ?? '?'}] [${e.cor ?? '?'}]`));
      if (valid.length > 5) console.log(`      … e mais ${valid.length - 5} entradas`);
    }

    const { inserted, errors } = await upsertEntries(supabase, valid, ano);
    console.log(`   ✅ ${inserted} registros ${opt.dryRun ? '(simulados)' : 'gravados'}`);
    if (errors.length) { console.log(`   ❌ Erros:`, errors); totalErrors += errors.length; }
    totalInserted += inserted;
  }

  console.log('\n==========================================');
  console.log(`✅ Total gravado: ${totalInserted}`);
  if (totalWarnings) console.log(`⚠️  Avisos: ${totalWarnings}`);
  if (totalErrors) console.log(`❌ Erros: ${totalErrors}`);
  console.log('');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
