import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Search, Users, ChevronRight, Church } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/portal/$token")({
  component: PortalParoquiaPage,
  head: () => ({ meta: [{ title: "Portal da Paróquia — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type ParoquiaInfo = {
  id: string;
  nome: string;
  cidade: string | null;
  diocese: string | null;
};

type MembroItem = {
  id: string;
  nome: string;
};

// ── Page ──────────────────────────────────────────────────────────────────────

function PortalParoquiaPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: paroquia, isLoading: loadingParoquia } = useQuery<ParoquiaInfo | null>({
    queryKey: ["portal-paroquia", token],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("paroquias")
        .select("id, nome, cidade, diocese")
        .eq("token_portal", token)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const { data: membros = [], isLoading: loadingMembros } = useQuery<MembroItem[]>({
    queryKey: ["portal-membros-lista", paroquia?.id],
    enabled: !!paroquia?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membros")
        .select("id, nome")
        .eq("paroquia_id", paroquia!.id)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data as MembroItem[]) ?? [];
    },
  });

  const filtered = membros.filter((m) =>
    m.nome.toLowerCase().includes(search.toLowerCase().trim()),
  );

  // ── Loading ──

  if (loadingParoquia) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Invalid link ──

  if (!paroquia) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Church className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="font-serif text-2xl mb-2">Link inválido</h1>
          <p className="text-sm text-muted-foreground">
            Este link não foi encontrado. Solicite o link correto ao seu coordenador.
          </p>
        </div>
      </div>
    );
  }

  // ── Main ──

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-sidebar text-sidebar-foreground px-4 pt-8 pb-6">
        <div className="max-w-lg mx-auto">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-sidebar-foreground/50 mb-1">
            Portal do Servidor
          </p>
          <h1 className="font-serif text-2xl sm:text-3xl">{paroquia.nome}</h1>
          {(paroquia.cidade || paroquia.diocese) && (
            <p className="text-sm text-sidebar-foreground/60 mt-1">
              {[paroquia.cidade, paroquia.diocese].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-5 pb-12">
        <p className="text-sm text-muted-foreground mb-4">
          Selecione seu nome para acessar suas escalas, confirmar presença e registrar indisponibilidades.
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Buscar por nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm outline-none focus:border-ring"
          />
        </div>

        {/* Members list */}
        {loadingMembros ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Users className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {search.trim() ? "Nenhum membro encontrado para essa busca." : "Nenhum membro cadastrado."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((m) => (
              <button
                key={m.id}
                className="w-full flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3.5 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors active:scale-[0.99]"
                onClick={() =>
                  navigate({ to: "/membro/$token", params: { token: m.id } })
                }
              >
                <span className="font-medium">{m.nome}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
