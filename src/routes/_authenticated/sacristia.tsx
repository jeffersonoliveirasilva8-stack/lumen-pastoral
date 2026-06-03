import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, XCircle, Clock, MapPin, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/sacristia")({
  component: SacristiaPage,
  head: () => ({ meta: [{ title: "Modo Sacristia — Lumen Pastoral" }] }),
});

type MembroEscala = {
  id: string;
  membro_id: string;
  ministerio_id: string;
  status: string;
  membro: { id: string; nome: string; telefone: string | null };
  ministerio: { id: string; nome: string; cor: string };
};

type EscalaHoje = {
  id: string;
  titulo: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  solene: boolean;
  status: string;
};

function SacristiaPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const hojeStr = format(new Date(), "yyyy-MM-dd");
  const [presencaMap, setPresencaMap] = useState<Record<string, "presente" | "faltou" | "pendente">>({});
  const [savingEscalaId, setSavingEscalaId] = useState<string | null>(null);

  const { data: escalasHoje = [], isLoading } = useQuery<EscalaHoje[]>({
    queryKey: ["sacristia-escalas", profile?.paroquia_id, hojeStr],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("escalas")
        .select("id, titulo, hora_inicio, hora_fim, local, solene, status")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("data", hojeStr)
        .neq("status", "arquivada")
        .order("hora_inicio");
      return (data ?? []) as EscalaHoje[];
    },
  });

  const escalaIds = useMemo(() => escalasHoje.map((e) => e.id), [escalasHoje]);

  const { data: membrosEscala = [], isLoading: isLoadingMembros } = useQuery<MembroEscala[]>({
    queryKey: ["sacristia-membros", escalaIds],
    enabled: escalaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("escala_membros")
        .select("id, membro_id, ministerio_id, escala_id, status, membros(id, nome, telefone), ministerios(id, nome, cor)")
        .in("escala_id", escalaIds);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        membro: r.membros,
        ministerio: r.ministerios,
      })) as MembroEscala[];
    },
  });

  const salvarPresencasMutation = useMutation({
    mutationFn: async (escalaId: string) => {
      const membrosDestaEscala = membrosEscala.filter((m: any) => m.escala_id === escalaId);
      await Promise.all(
        membrosDestaEscala.map((m: MembroEscala) =>
          supabase.from("escala_membros").update({ status: presencaMap[m.id] ?? "pendente" }).eq("id", m.id)
        )
      );
    },
    onMutate: (escalaId) => setSavingEscalaId(escalaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sacristia-membros"] });
      qc.invalidateQueries({ queryKey: ["escala-membros"] });
      qc.invalidateQueries({ queryKey: ["escala-historico"] });
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Presenças salvas.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
    onSettled: () => setSavingEscalaId(null),
  });

  function togglePresenca(id: string, status: "presente" | "faltou") {
    setPresencaMap((prev) => ({
      ...prev,
      [id]: prev[id] === status ? "pendente" : status,
    }));
  }

  const loading = isLoading || isLoadingMembros;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-2xl mx-auto pb-24">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Operacional</p>
        <h1 className="mt-2 font-serif text-2xl sm:text-4xl">Modo Sacristia</h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">
          {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <div className="space-y-2 mt-4">
                {[1, 2, 3].map((j) => <Skeleton key={j} className="h-10 w-full rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : escalasHoje.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma escala para hoje.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {escalasHoje.map((escala) => {
            const membros = membrosEscala.filter((m: any) => m.escala_id === escala.id);
            const presentes = membros.filter((m: MembroEscala) => (presencaMap[m.id] ?? "pendente") === "presente").length;
            const isSaving = savingEscalaId === escala.id;

            // Agrupa por ministério
            const grupos: { ministerio: { id: string; nome: string; cor: string }; membros: MembroEscala[] }[] = [];
            membros.forEach((m: MembroEscala) => {
              const g = grupos.find((x) => x.ministerio.id === m.ministerio.id);
              if (g) g.membros.push(m);
              else grupos.push({ ministerio: m.ministerio, membros: [m] });
            });

            return (
              <div key={escala.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                {/* Header da escala */}
                <div className="px-5 py-4 border-b border-border bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-base truncate">{escala.titulo}</h2>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {escala.hora_inicio && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {escala.hora_inicio.slice(0, 5)}{escala.hora_fim ? `–${escala.hora_fim.slice(0, 5)}` : ""}
                          </span>
                        )}
                        {escala.local && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {escala.local}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {presentes}/{membros.length} presentes
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {escala.solene && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                          Solene
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lista de membros */}
                <div className="p-4 space-y-4">
                  {membros.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum membro atribuído.</p>
                  ) : (
                    grupos.map((grupo) => (
                      <div key={grupo.ministerio.id}>
                        <p
                          className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
                          style={{ color: grupo.ministerio.cor }}
                        >
                          {grupo.ministerio.nome}
                        </p>
                        <div className="space-y-2">
                          {grupo.membros.map((m) => {
                            const status = presencaMap[m.id] ?? "pendente";
                            return (
                              <div
                                key={m.id}
                                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border transition-all ${
                                  status === "presente"
                                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                                    : status === "faltou"
                                    ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                                    : "border-border bg-background"
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate">{m.membro.nome}</p>
                                  {m.membro.telefone && (
                                    <p className="text-[11px] text-muted-foreground">{m.membro.telefone}</p>
                                  )}
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "presente")}
                                    title="Marcar presente"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                                      status === "presente"
                                        ? "bg-emerald-500 text-white"
                                        : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                                    }`}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "faltou")}
                                    title="Marcar falta"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                                      status === "faltou"
                                        ? "bg-red-500 text-white"
                                        : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"
                                    }`}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}

                  {membros.length > 0 && (
                    <Button
                      className="w-full mt-2"
                      disabled={isSaving}
                      onClick={() => salvarPresencasMutation.mutate(escala.id)}
                    >
                      {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Salvar presenças
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
