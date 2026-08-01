import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Users, Calendar, Search, Loader2 } from "lucide-react";
// Simple debounce hook
function useSearchDebounce(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const debouncedTerm = useSearchDebounce(term, 300);
  const { profile } = useAuth();
  const navigate = useNavigate();

  // Cmd+K / Ctrl+K listener
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Reset term when closed
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const enabled = open && !!profile?.paroquia_id && debouncedTerm.length >= 2;

  const { data: membros = [], isFetching: fetchingMembros } = useQuery({
    queryKey: ["gs-membros", debouncedTerm, profile?.paroquia_id],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membros")
        .select("id, nome_completo")
        .eq("paroquia_id", profile!.paroquia_id)
        .ilike("nome_completo", `%${debouncedTerm}%`)
        .limit(5);
      return (data ?? []) as { id: string; nome_completo: string }[];
    },
  });

  const { data: escalas = [], isFetching: fetchingEscalas } = useQuery({
    queryKey: ["gs-escalas", debouncedTerm, profile?.paroquia_id],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("escalas")
        .select("id, nome")
        .eq("paroquia_id", profile!.paroquia_id)
        .ilike("nome", `%${debouncedTerm}%`)
        .limit(5);
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const isFetching = fetchingMembros || fetchingEscalas;
  const hasResults = membros.length > 0 || escalas.length > 0;

  function goTo(path: string) {
    setOpen(false);
    navigate({ to: path as any });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar membros, escalas..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {debouncedTerm.length < 2 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Digite pelo menos 2 caracteres para buscar.
            </div>
          ) : !hasResults && !isFetching ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum resultado para "{debouncedTerm}".
            </div>
          ) : (
            <div className="py-2">
              {membros.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Membros
                  </p>
                  {membros.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => goTo(`/membros`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-muted/60 transition"
                    >
                      <div className="h-7 w-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                        <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Membro" />
                      </div>
                      <span className="truncate font-medium">{m.nome_completo}</span>
                    </button>
                  ))}
                </div>
              )}

              {escalas.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Escalas
                  </p>
                  {escalas.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => goTo(`/escalas`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-muted/60 transition"
                    >
                      <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                        <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-label="Escala" />
                      </div>
                      <span className="truncate font-medium">{e.nome}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
          <span><kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↵</kbd> selecionar</span>
          <span><kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">ESC</kbd> fechar</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
