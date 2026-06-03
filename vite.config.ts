import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const isVercel = process.env.VERCEL === "1" || process.env.DEPLOY_TARGET === "vercel";

export default defineConfig(async ({ command }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins: any[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
  ];

  if (isVercel) {
    // Modo SPA: TanStack Router puro (sem SSR) para Vercel
    const { tanstackRouter } = await import("@tanstack/router-plugin/vite");
    plugins.push(tanstackRouter({ target: "react" }));
  } else {
    // Modo SSR: TanStack Start (para Cloudflare Workers)
    plugins.push(tanstackStart({ server: { entry: "server" } }));
  }

  plugins.push(react());

  if (command === "build" && !isVercel) {
    try {
      const { cloudflare } = await import("@cloudflare/vite-plugin");
      plugins.push(cloudflare({ viteEnvironment: { name: "ssr" } }));
    } catch {
      // cloudflare plugin optional
    }
  }

  return {
    plugins,
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "use-sync-external-store/shim/with-selector.js",
        "use-sync-external-store/shim/index.js",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    build: isVercel ? {
      outDir: "dist",
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        input: "index.html",
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom"],
            "vendor-router": ["@tanstack/react-router", "@tanstack/react-query"],
            "vendor-supabase": ["@supabase/supabase-js"],
            "vendor-ui": ["lucide-react", "sonner", "date-fns"],
            "vendor-charts": ["recharts"],
          },
        },
      },
    } : {},
    server: {
      host: "::",
      port: 8080,
    },
  };
});
