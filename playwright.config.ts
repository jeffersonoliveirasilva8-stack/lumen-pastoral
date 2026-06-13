import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts",
  testMatch: ["**/mobile-audit.spec.ts"],
  globalSetup: "./scripts/global-setup.ts",
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
