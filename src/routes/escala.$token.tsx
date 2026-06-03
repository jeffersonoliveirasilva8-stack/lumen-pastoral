import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Calendar, Clock, MapPin, Users, Share2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/escala/$token")({
  component: PortalPublicoPage,
  head: () => ({ meta: [{ title: "Escala — Portal do Servidor" }] }),
});

type EscalaPublica = {
  id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  tipo: string;
  observacoes: string | null;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
};

type FuncaoPublica = {
  ministerio_id: string;
  ministerio_nome: string;
  ministerio_cor: string;
  quantidade: number;
  membros: { id: string; nome: string }[];
};

function PortalPublicoPage() {
  const { token } = Route.useParams();

  const { data: escala, isLoading: loadingEscala, error } = useQuery<EscalaPublica | null>({
    queryKey: ["escala-publica", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio, hora_fim, local, tipo, observacoes, solene, tem_adoracao, tem_bispo")
        .eq("token_publico", token)
        .eq("status", "publicada")
        .maybeSingle();
      if (error) throw error;
      return data as EscalaPublica | null;
    },
  });

  const { data: funcoes = [], isLoading: loadingFuncoes } = useQuery<FuncaoPublica[]>({
    queryKey: ["escala-publica-funcoes", escala?.id],
    enabled: !!escala?.id,
    queryFn: async () => {
      // Funções
      const { data: funcoesData } = await supabase
        .from("escala_funcoes")
        .select("ministerio_id, quantidade, ministerios(id, nome, cor)")
        .eq("escala_id", escala!.id);

      // Atribuições
      const { data: membrosData } = await supabase
        .from("escala_membros")
        .select("ministerio_id, membros(id, nome)")
        .eq("escala_id", escala!.id);

      const mMap: Record<string, { id: string; nome: string }[]> = {};
      (membrosData ?? []).forEach((r: any) => {
        if (!mMap[r.ministerio_id]) mMap[r.ministerio_id] = [];
        if (r.membros) mMap[r.ministerio_id].push(r.membros);
      });

      return ((funcoesData ?? []) as any[]).map((f) => ({
        ministerio_id: f.ministerio_id,
        ministerio_nome: f.ministerios?.nome ?? "",
        ministerio_cor: f.ministerios?.cor ?? "#6B7280",
        quantidade: f.quantidade,
        membros: mMap[f.ministerio_id] ?? [],
      })) as FuncaoPublica[];
    },
  });

  const isLoading = loadingEscala || loadingFuncoes;

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!escala || error) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Calendar className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="font-serif text-2xl mb-2">Escala não encontrada</h1>
          <p className="text-sm text-muted-foreground">
            Este link pode estar expirado ou a escala foi despublicada.
          </p>
        </div>
      </div>
    );
  }

  const dateStr = format(new Date(escala.data + "T12:00:00"), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const publicUrl = typeof window !== "undefined" ? window.location.href : "";

  const totalVagas = funcoes.reduce((s, f) => s + f.quantidade, 0);
  const totalPreenchidas = funcoes.reduce((s, f) => s + f.membros.length, 0);
  const completa = totalPreenchidas >= totalVagas;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-sidebar text-sidebar-foreground px-4 py-6 sm:py-10">
        <div className="max-w-lg mx-auto">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-sidebar-foreground/50 mb-1">Portal do Servidor</p>
          <h1 className="font-serif text-2xl sm:text-3xl leading-snug">{escala.titulo}</h1>

          <div className="mt-4 space-y-1.5 text-sm text-sidebar-foreground/80">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 opacity-60" />
              <span className="capitalize">{dateStr}</span>
            </div>
            {escala.hora_inicio && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 opacity-60" />
                <span>
                  {escala.hora_inicio.slice(0, 5)}
                  {escala.hora_fim && ` — ${escala.hora_fim.slice(0, 5)}`}
                </span>
              </div>
            )}
            {escala.local && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 opacity-60" />
                <span>{escala.local}</span>
              </div>
            )}
          </div>

          {/* Badges litúrgicos */}
          {(escala.solene || escala.tem_adoracao || escala.tem_bispo) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {escala.solene && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Solene</span>}
              {escala.tem_adoracao && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/20">Com Adoração</span>}
              {escala.tem_bispo && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/20">Presença do Bispo</span>}
            </div>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Status de preenchimento */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Preenchimento</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{totalPreenchidas}/{totalVagas}</span>
            <Badge variant={completa ? "default" : "secondary"} className="text-xs">
              {completa ? "Completa" : "Incompleta"}
            </Badge>
          </div>
        </div>

        {/* Funções */}
        {funcoes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">Funções ainda não definidas para esta escala.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {funcoes.map((f) => (
              <div key={f.ministerio_id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: f.ministerio_cor }}
                  />
                  <span className="font-medium text-sm flex-1">{f.ministerio_nome}</span>
                  <span className="text-xs text-muted-foreground">{f.membros.length}/{f.quantidade}</span>
                </div>
                <div className="px-4 py-3">
                  {f.membros.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Nenhum servidor escalado.</p>
                  ) : (
                    <ul className="space-y-1">
                      {f.membros.map((m) => (
                        <li key={m.id} className="text-sm">{m.nome}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {escala.observacoes && (
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Observações</p>
            <p className="text-sm">{escala.observacoes}</p>
          </div>
        )}

        {/* Compartilhar */}
        <div className="pt-2 pb-6">
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              window.open(
                `https://wa.me/?text=${encodeURIComponent(`*${escala.titulo}*\n📅 ${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}\n\nVeja a escala: ${publicUrl}`)}`,
                "_blank"
              )
            }
          >
            <Share2 className="h-4 w-4 mr-2" /> Compartilhar no WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}
