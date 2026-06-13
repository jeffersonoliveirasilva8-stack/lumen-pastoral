/**
 * global-setup.ts
 * Cria os arquivos de estado de autenticação antes da suíte de testes.
 * Roda UMA VEZ antes de todos os testes (não por worker).
 */
import { chromium, FullConfig } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ADMIN_EMAIL  = process.env.AUDIT_ADMIN_EMAIL  ?? "admin.teste@lumenpastoral.com.br";
const ADMIN_PASS   = process.env.AUDIT_ADMIN_PASS   ?? "Lumen2026@!";
const MEMBER_EMAIL = process.env.AUDIT_MEMBER_EMAIL ?? "membro.teste@lumenpastoral.com.br";
const MEMBER_PASS  = process.env.AUDIT_MEMBER_PASS  ?? "Lumen2026@!";

export const ADMIN_STATE_FILE  = path.join(__dirname, ".admin-state.json");
export const MEMBER_STATE_FILE = path.join(__dirname, ".member-state.json");

async function saveAuthState(
  baseURL: string,
  loginPath: string,
  email: string,
  password: string,
  stateFile: string,
  successPattern: RegExp,
): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, locale: "pt-BR" });
  const page = await context.newPage();

  await page.goto(loginPath, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL(url => successPattern.test(url.pathname), { timeout: 20_000 });
  } catch {
    // Login may redirect differently — save state regardless
  }
  await page.waitForTimeout(1000);

  await context.storageState({ path: stateFile });
  await browser.close();
  console.log(`✅ Auth state saved: ${path.basename(stateFile)}`);
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:8080";

  await saveAuthState(
    baseURL, "/login",
    ADMIN_EMAIL, ADMIN_PASS,
    ADMIN_STATE_FILE,
    /^\/(painel|dashboard|$)/,
  );

  await saveAuthState(
    baseURL, "/membro/login",
    MEMBER_EMAIL, MEMBER_PASS,
    MEMBER_STATE_FILE,
    /portal-membro/,
  );
}
