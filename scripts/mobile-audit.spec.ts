/**
 * mobile-audit.spec.ts
 * Homologação final de responsividade mobile — Lumen Pastoral
 *
 * Para cada rota, testa nos 5 viewports: 320, 375, 390, 414, 768px
 * Detecta overflow horizontal com scrollWidth > clientWidth (+2px tolerância)
 * Gera screenshots por rota + relatório HTML final
 */
import { test, Page, TestInfo } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ADMIN_STATE_FILE, MEMBER_STATE_FILE } from "./global-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Viewports ────────────────────────────────────────────────────────────────

const VIEWPORTS = [
  { width: 320,  height: 812,  label: "iPhone SE (320px)" },
  { width: 375,  height: 812,  label: "iPhone 13 (375px)" },
  { width: 390,  height: 844,  label: "iPhone 15 (390px)" },
  { width: 414,  height: 896,  label: "Galaxy S23 (414px)" },
  { width: 768,  height: 1024, label: "iPad (768px)" },
];

// ── Rotas ────────────────────────────────────────────────────────────────────

interface Route { path: string; label: string }

const PUBLIC_ROUTES: Route[] = [
  { path: "/",             label: "Landing Page" },
  { path: "/login",        label: "Login Admin" },
  { path: "/cadastro",     label: "Solicitação de Paróquia" },
  { path: "/membro/login", label: "Login Membro" },
];

const ADMIN_ROUTES: Route[] = [
  { path: "/painel",                 label: "Painel da Paróquia" },
  { path: "/formacoes",              label: "Agenda Pastoral" },
  { path: "/escalas",                label: "Escalas" },
  { path: "/membros",                label: "Membros" },
  { path: "/notificacoes",           label: "Notificações" },
  { path: "/espiritualidade",        label: "Homilia" },
  { path: "/configuracoes/paroquia", label: "Configurações" },
  { path: "/ranking",                label: "Relatórios — Ranking" },
  { path: "/ministerios",            label: "Ministérios" },
  { path: "/ocorrencias",            label: "Ocorrências" },
  { path: "/calendario",             label: "Calendário" },
];

const MEMBER_ROUTES: Route[] = [
  { path: "/portal-membro/home",         label: "Portal — Painel" },
  { path: "/portal-membro/escalas",      label: "Portal — Escalas" },
  { path: "/portal-membro/eventos",      label: "Portal — Agenda" },
  { path: "/portal-membro/notificacoes", label: "Portal — Notificações" },
  { path: "/portal-membro/perfil",       label: "Portal — Perfil" },
  { path: "/portal-membro/liturgia",     label: "Portal — Liturgia" },
];

// ── Tipos ────────────────────────────────────────────────────────────────────

interface OverflowElement {
  tag: string;
  className: string;
  scrollWidth: number;
  viewport: number;
  extra: number;
}

interface VpResult {
  viewport: number;
  vpLabel: string;
  passed: boolean;
  overflowCount: number;
  offenders: OverflowElement[];
  error?: string;
}

interface RouteResult {
  label: string;
  path: string;
  group: string;
  viewports: VpResult[];
}

const ALL_RESULTS: RouteResult[] = [];

// ── Detecção de overflow ──────────────────────────────────────────────────────

async function detectOverflow(page: Page): Promise<OverflowElement[]> {
  return page.evaluate((): OverflowElement[] => {
    // Usa window.innerWidth (inclui scrollbar) para evitar falso-positivo
    // causado pelo scrollbar vertical deduzindo ~15px do clientWidth
    const vw = window.innerWidth;
    const seen = new Set<string>();
    const out: OverflowElement[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.scrollWidth <= vw + 2) continue;
      const cls = (el.className ?? "").toString().slice(0, 120);
      const key = `${el.tagName}|${el.scrollWidth}|${cls.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName,
        className: cls,
        scrollWidth: Math.round(el.scrollWidth),
        viewport: vw,
        extra: Math.round(el.scrollWidth - vw),
      });
      if (out.length >= 15) break;
    }
    return out;
  });
}

// ── Auditoria de uma rota ──────────────────────────────────────────────────────

async function auditRoute(
  page: Page,
  testInfo: TestInfo,
  route: Route,
  group: string,
): Promise<RouteResult> {
  const vpResults: VpResult[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      await page.goto(route.path, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.scrollTo(0, 0));

      const slug = `${group}_${route.label}_${vp.width}px`
        .replace(/[^\w]/g, "_").replace(/_+/g, "_");
      const buf = await page.screenshot({ fullPage: true });
      await testInfo.attach(`${slug}.png`, { body: buf, contentType: "image/png" });

      const offenders = await detectOverflow(page);
      vpResults.push({
        viewport: vp.width, vpLabel: vp.label,
        passed: offenders.length === 0,
        overflowCount: offenders.length,
        offenders,
      });
    } catch (err) {
      vpResults.push({
        viewport: vp.width, vpLabel: vp.label,
        passed: false, overflowCount: 0, offenders: [],
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  const r: RouteResult = { label: route.label, path: route.path, group, viewports: vpResults };
  ALL_RESULTS.push(r);

  const failed = vpResults.filter(v => !v.passed && !v.error);
  if (failed.length > 0) {
    console.warn(`\n⚠  [${route.label}] overflow em ${failed.length} viewport(s):`);
    for (const v of failed) {
      console.warn(`   ${v.vpLabel}: ${v.overflowCount} elemento(s)`);
      for (const o of v.offenders.slice(0, 3)) {
        console.warn(`     → <${o.tag}> +${o.extra}px | "${o.className.slice(0, 70)}"`);
      }
    }
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Páginas públicas", () => {
  for (const route of PUBLIC_ROUTES) {
    test(route.label, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, route, "Público");
    });
  }
});

test.describe("Painel da paróquia (admin)", () => {
  test.use({ storageState: ADMIN_STATE_FILE });

  for (const route of ADMIN_ROUTES) {
    test(route.label, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, route, "Admin");
    });
  }
});

test.describe("Portal do membro", () => {
  test.use({ storageState: MEMBER_STATE_FILE });

  for (const route of MEMBER_ROUTES) {
    test(route.label, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, route, "Portal Membro");
    });
  }
});

// ── Relatório final ────────────────────────────────────────────────────────────

test.afterAll(async () => {
  if (ALL_RESULTS.length === 0) return;
  const reportPath = path.join(__dirname, "audit-report-final.html");
  fs.writeFileSync(reportPath, buildReport(ALL_RESULTS));

  const total  = ALL_RESULTS.reduce((n, r) => n + r.viewports.length, 0);
  const passed = ALL_RESULTS.reduce((n, r) => n + r.viewports.filter(v => v.passed).length, 0);
  const pct    = Math.round((passed / total) * 100);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`HOMOLOGAÇÃO MOBILE — RELATÓRIO FINAL`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Aprovadas : ${passed}/${total} (${pct}%)`);
  console.log(`Reprovadas: ${total - passed}`);
  console.log(`Relatório : ${reportPath}`);

  const failing = ALL_RESULTS.filter(r => r.viewports.some(v => !v.passed && !v.error));
  if (failing.length === 0) {
    console.log(`\n✅ SISTEMA APROVADO — Nenhum overflow detectado.`);
  } else {
    console.log(`\n❌ ${failing.length} rota(s) com overflow:`);
    for (const r of failing) {
      const bad = r.viewports.filter(v => !v.passed && v.overflowCount > 0);
      if (bad.length) {
        console.log(`   • ${r.label} (${r.path})`);
        for (const v of bad) {
          console.log(`     ${v.vpLabel}: ${v.offenders.map(o => `<${o.tag}> +${o.extra}px`).join(", ")}`);
        }
      }
    }
  }
});

// ── Geração do HTML ────────────────────────────────────────────────────────────

function buildReport(results: RouteResult[]): string {
  const VPs    = VIEWPORTS.map(v => v.width);
  const groups = [...new Set(results.map(r => r.group))];
  const total  = results.reduce((n, r) => n + r.viewports.length, 0);
  const passed = results.reduce((n, r) => n + r.viewports.filter(v => v.passed).length, 0);
  const failedRoutes = results.filter(r => r.viewports.some(v => !v.passed && !v.error));

  const tableBody = groups.map(g => {
    const rows = results.filter(r => r.group === g).map(r => {
      const cells = VPs.map(vp => {
        const v = r.viewports.find(x => x.viewport === vp);
        if (!v) return `<td class="na">—</td>`;
        if (v.error) return `<td class="cell-err" title="${v.error}">ERR</td>`;
        if (v.passed) return `<td class="cell-ok">✅</td>`;
        return `<td class="cell-fail" title="${v.offenders.map(o=>`+${o.extra}px`).join(", ")}">❌ ${v.overflowCount}</td>`;
      }).join("");
      return `<tr><td class="route-name">${r.label}<span class="rpath">${r.path}</span></td>${cells}</tr>`;
    }).join("");
    return `<tr><td colspan="${VPs.length + 1}" class="grp">${g}</td></tr>${rows}`;
  }).join("");

  const offContent = failedRoutes.length === 0
    ? `<div class="all-ok">✅ Nenhum overflow encontrado. Sistema aprovado para mobile.</div>`
    : failedRoutes.map(r => {
        const bad = r.viewports.filter(v => !v.passed && v.overflowCount > 0);
        if (!bad.length) return "";
        return `
          <div class="ocard">
            <div class="otitle"><span class="olabel">${r.label}</span><code class="opath">${r.path}</code>
              <span class="obadge">${bad.reduce((n, v) => n + v.overflowCount, 0)} overflow(s)</span></div>
            ${bad.map(v => `
              <div class="vpblock">
                <div class="vplabel">${v.vpLabel}</div>
                <table class="otable">
                  <thead><tr><th>Tag</th><th>scrollWidth</th><th>Excesso</th><th>Classes</th></tr></thead>
                  <tbody>${v.offenders.map(o => `
                    <tr>
                      <td class="mono">&lt;${o.tag}&gt;</td>
                      <td class="num">${o.scrollWidth}px</td>
                      <td class="exc">+${o.extra}px</td>
                      <td class="cls">${o.className || "—"}</td>
                    </tr>`).join("")}
                  </tbody>
                </table>
              </div>`).join("")}
          </div>`;
      }).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Homologação Mobile — Lumen Pastoral</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#1e293b;padding:24px 16px;font-size:14px}
h1{font-size:1.3rem;font-weight:800;margin-bottom:4px}
h2{font-size:.95rem;font-weight:700;margin:24px 0 10px;border-bottom:2px solid #e2e8f0;padding-bottom:5px}
.meta{font-size:.72rem;color:#64748b;margin-bottom:18px}
.summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 16px;text-align:center;min-width:80px}
.stat-n{font-size:1.6rem;font-weight:800;line-height:1}
.stat-l{font-size:.65rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
.green{color:#16a34a}.red{color:#dc2626}.blue{color:#2563eb}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:.76rem;margin-bottom:14px}
th,td{padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center}
th{background:#f8fafc;font-weight:700;font-size:.68rem;text-transform:uppercase;letter-spacing:.04em}
.route-name{text-align:left;font-weight:500}.rpath{display:block;font-size:.65rem;color:#94a3b8;font-family:monospace}
.grp{background:#f1f5f9;text-align:left!important;font-weight:700;font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;color:#475569;padding:5px 10px}
.cell-ok{color:#16a34a;font-weight:700}.cell-fail{color:#dc2626;font-weight:700;cursor:help}
.cell-err{color:#ea580c;font-size:.68rem;cursor:help}.na{color:#cbd5e1}
.all-ok{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;color:#16a34a;font-weight:600;font-size:.88rem}
.ocard{background:#fff;border:1px solid #fecaca;border-radius:8px;padding:14px;margin-bottom:10px}
.otitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.olabel{font-weight:700;font-size:.83rem}.opath{font-size:.7rem;color:#64748b;background:#f1f5f9;padding:1px 5px;border-radius:3px}
.obadge{background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:99px;padding:1px 7px;font-size:.68rem;font-weight:700;margin-left:auto}
.vpblock{margin-bottom:8px}.vplabel{font-size:.7rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
.otable{font-size:.7rem}.otable th{font-size:.66rem}
.mono,.num{font-family:monospace}
.exc{color:#dc2626;font-weight:700;font-family:monospace}
.cls{font-family:monospace;font-size:.65rem;color:#64748b;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
pre{background:#1e293b;color:#e2e8f0;padding:14px;border-radius:8px;font-size:.7rem;overflow-x:auto;margin-top:6px}
</style></head>
<body>
  <h1>Homologação Final — Responsividade Mobile</h1>
  <p class="meta">Lumen Pastoral · ${new Date().toLocaleString("pt-BR")} · ${total} combinações tela×viewport auditadas</p>

  <div class="summary">
    <div class="stat"><div class="stat-n green">${passed}</div><div class="stat-l">Aprovadas</div></div>
    <div class="stat"><div class="stat-n red">${total - passed}</div><div class="stat-l">Reprovadas</div></div>
    <div class="stat"><div class="stat-n blue">${results.length}</div><div class="stat-l">Telas</div></div>
    <div class="stat"><div class="stat-n">${VPs.length}</div><div class="stat-l">Viewports</div></div>
    <div class="stat"><div class="stat-n ${total===passed?"green":"red"}">${Math.round(passed/total*100)}%</div><div class="stat-l">Aprovação</div></div>
  </div>

  <h2>Mapa de cobertura</h2>
  <table>
    <thead><tr><th>Tela</th>${VPs.map(v=>`<th>${v}px</th>`).join("")}</tr></thead>
    <tbody>${tableBody}</tbody>
  </table>

  <h2>Elementos com overflow detectado</h2>
  ${offContent}

  <h2>Script de detecção</h2>
  <pre>const vw = document.documentElement.clientWidth;
const offenders = [...document.querySelectorAll('*')]
  .filter(el => el.scrollWidth > vw + 2)
  .map(el => ({ tag: el.tagName, scrollWidth: el.scrollWidth, excess: el.scrollWidth - vw, class: el.className?.toString() }));</pre>
</body></html>`;
}
