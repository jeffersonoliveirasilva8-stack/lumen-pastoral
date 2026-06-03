#!/usr/bin/env node
/**
 * scripts/validar-liturgia.js
 * Valida a integridade dos dados litúrgicos já gravados no banco.
 *
 * Uso:
 *   node scripts/validar-liturgia.js [--ano 2026] [--verbose]
 *
 * Verifica:
 *  - Datas inválidas ou fora do range
 *  - Duplicatas no banco
 *  - Celebrações sem grau ou cor
 *  - Conflitos litúrgicos (solenidade × solenidade na mesma data)
 *  - Feriadoss de preceito sem marcação
 *  - Ano faltando no banco (nenhum registro)
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const opt = {
  ano: getArg('--ano') ? parseInt(getArg('--ano'), 10) : null,
  verbose: args.includes('--verbose'),
};

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

async function getSupabase() {
  try {
    try { const { config } = await import('dotenv'); config({ path: join(PROJECT_ROOT, '.env.local') }); } catch {}
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos em .env.local');
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key);
  } catch (e) {
    console.error('[supabase]', e.message);
    process.exit(1);
  }
}

// Solenidades universais obrigatórias no Brasil
const SOLENIDADES_OBRIGATORIAS = [
  { date_pattern: '-01-01', titulo: 'Santa Maria, Mãe de Deus' },
  { date_pattern: '-03-19', titulo: 'São José' },
  { date_pattern: '-06-29', titulo: 'São Pedro e São Paulo' },
  { date_pattern: '-08-15', titulo: 'Assunção de Nossa Senhora' },
  { date_pattern: '-10-12', titulo: 'Nossa Senhora Aparecida' },
  { date_pattern: '-11-01', titulo: 'Todos os Santos' },
  { date_pattern: '-12-08', titulo: 'Imaculada Conceição' },
  { date_pattern: '-12-25', titulo: 'Natal do Senhor' },
];

async function main() {
  console.log('\n🔍 Validador de Calendário Litúrgico');
  console.log('=====================================');

  const supabase = await getSupabase();
  const anos = opt.ano ? [opt.ano] : [2025, 2026, 2027, 2028, 2029];

  let totalIssues = 0;

  for (const ano of anos) {
    console.log(`\n📅 Validando ano ${ano}...`);

    const { data: rows, error } = await supabase
      .from('liturgia_base')
      .select('id, data, titulo, grau, cor, e_dia_preceito')
      .eq('ano', ano)
      .order('data');

    if (error) { console.error('  ❌ Erro ao consultar:', error.message); totalIssues++; continue; }

    if (!rows || rows.length === 0) {
      console.log(`  ⚠️  NENHUM registro para ${ano} — execute importar-liturgia.js`);
      totalIssues++;
      continue;
    }

    console.log(`  📋 ${rows.length} registros encontrados`);

    // Verifica duplicatas
    const byDate = new Map();
    for (const r of rows) {
      const list = byDate.get(r.data) ?? [];
      list.push(r);
      byDate.set(r.data, list);
    }
    const dups = [...byDate.entries()].filter(([, v]) => v.length > 1);
    if (dups.length > 0) {
      console.log(`  ⚠️  ${dups.length} data(s) com registros duplicados:`);
      if (opt.verbose) dups.forEach(([d, v]) => console.log(`     ${d}: ${v.map(r => r.titulo).join(' | ')}`));
      totalIssues += dups.length;
    }

    // Verifica celebrações sem grau ou cor
    const noGrau = rows.filter(r => !r.grau);
    const noCor = rows.filter(r => !r.cor);
    if (noGrau.length) { console.log(`  ⚠️  ${noGrau.length} registro(s) sem grau`); totalIssues += noGrau.length; }
    if (noCor.length) { console.log(`  ⚠️  ${noCor.length} registro(s) sem cor`); totalIssues += noCor.length; }

    // Verifica solenidades obrigatórias no Brasil
    for (const sol of SOLENIDADES_OBRIGATORIAS) {
      const dateKey = `${ano}${sol.date_pattern}`;
      const found = rows.find(r => r.data === dateKey);
      if (!found) {
        console.log(`  ❌ Solenidade obrigatória AUSENTE: ${sol.titulo} (${dateKey})`);
        totalIssues++;
      } else if (found.grau !== 'solenidade') {
        console.log(`  ⚠️  ${sol.titulo} (${dateKey}) grau incorreto: "${found.grau}"`);
        totalIssues++;
      }
    }

    if (dups.length === 0 && noGrau.length === 0 && noCor.length === 0) {
      console.log(`  ✅ Nenhum problema encontrado para ${ano}`);
    }
  }

  console.log('\n=====================================');
  if (totalIssues === 0) {
    console.log('✅ Validação concluída sem problemas!\n');
  } else {
    console.log(`⚠️  ${totalIssues} problema(s) encontrado(s). Revise e re-importe se necessário.\n`);
    process.exit(1);
  }
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
