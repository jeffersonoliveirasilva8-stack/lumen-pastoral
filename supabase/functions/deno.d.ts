// Declarações globais do runtime Deno para Edge Functions Supabase.
// Este arquivo é incluído via tsconfig.json (supabase/functions/) para
// evitar erros de "Deno não encontrado" no VS Code.

declare namespace Deno {
  function serve(handler: (req: Request) => Promise<Response>): void;
  namespace env {
    function get(key: string): string | undefined;
  }
}
