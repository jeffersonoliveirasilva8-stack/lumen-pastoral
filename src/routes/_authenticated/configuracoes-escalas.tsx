import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Loader2, Settings, Save, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/configuracoes-escalas")({
  component: ConfiguracaoEscalas,
  head: () => ({ meta: [{ title: "Config. Escalas — Lumen Pastoral" }] }),
});

type ConfigEscalas = {
  confirmacao_ativa: boolean;
  confirmacao_horas_antes: number;
  substituicao_ativa: boolean;
  substituicao_horas_antes: number;
  auto_pontuar: boolean;
  pontuacao_presenca: number;
  pontuacao_falta: number;
  pontuacao_atraso: number;
  pontuacao_justificou: number;
};

const DEFAULTS: ConfigEscalas = {
  confirmacao_ativa: false,
  confirmacao_horas_antes: 72,
  substituicao_ativa: false,
  substituicao_horas_antes: 48,
  auto_pontuar: false,
  pontuacao_presenca: 1,
  pontuacao_falta: -2,
  pontuacao_atraso: -1,
  pontuacao_justificou: 0,
};

function ConfiguracaoEscalas() {
  const { profile } = useAuth();
  const paroquiaId = profile?.paroquia_id ?? null;
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigEscalas>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);

  const { data: config, isLoading } = useQuery<ConfigEscalas>({
    queryKey: ["config-escalas", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("paroquia_config_escalas")
        .select("*")
        .eq("paroquia_id", paroquiaId)
        .maybeSingle();
      if (error) throw error;
      return data ?? DEFAULTS;
    },
  });

  useEffect(() => {
    if (config) {
      setForm({
        confirmacao_ativa:        config.confirmacao_ativa,
        confirmacao_horas_antes:  config.confirmacao_horas_antes,
        substituicao_ativa:       config.substituicao_ativa,
        substituicao_horas_antes: config.substituicao_horas_antes,
        auto_pontuar:             config.auto_pontuar,
        pontuacao_presenca:       config.pontuacao_presenca,
        pontuacao_falta:          config.pontuacao_falta,
        pontuacao_atraso:         config.pontuacao_atraso,
        pontuacao_justificou:     config.pontuacao_justificou,
      });
      setDirty(false);
    }
  }, [config]);

  function update<K extends keyof ConfigEscalas>(key: K, value: ConfigEscalas[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await anyDb
        .from("paroquia_config_escalas")
        .upsert({
          paroquia_id: paroquiaId,
          ...form,
        }, { onConflict: "paroquia_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config-escalas", paroquiaId] });
      toast.success("Configurações salvas.");
      setDirty(false);
    },
    onError: (e: Error) => toast.error("Erro ao salvar: " + e.message),
  });

  async function handleRecalcular() {
    setRecalcLoading(true);
    try {
      const { data, error } = await anyDb.rpc("admin_recalcular_scores_paroquia", {
        p_paroquia_id: paroquiaId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error);
      toast.success(`Scores recalculados para ${data.membros_atualizados} membros.`);
      qc.invalidateQueries({ queryKey: ["membros"] });
    } catch (e: any) {
      toast.error("Erro ao recalcular: " + e.message);
    } finally {
      setRecalcLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:px-6 space-y-8 pb-10">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif">Configurações de Escalas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defina as regras de confirmação, substituições e pontuação da sua paróquia.
        </p>
      </div>

      {/* Seção: Confirmação */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Confirmação de presença</h2>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Exigir confirmação</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Membros precisam confirmar ou recusar antes da missa.
            </p>
          </div>
          <Switch
            checked={form.confirmacao_ativa}
            onCheckedChange={(v) => update("confirmacao_ativa", v)}
          />
        </div>

        {form.confirmacao_ativa && (
          <div className="space-y-1 border-t border-border/40 pt-4">
            <Label className="text-xs text-muted-foreground">Horas de antecedência mínima</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={168}
                value={form.confirmacao_horas_antes}
                onChange={(e) => update("confirmacao_horas_antes", Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 rounded-xl"
              />
              <span className="text-sm text-muted-foreground">horas antes da escala</span>
            </div>
            <p className="text-xs text-muted-foreground/60">
              Ex: 72h = membro deve confirmar até 3 dias antes.
            </p>
          </div>
        )}
      </section>

      {/* Seção: Substituições */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Módulo de substituições</h2>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Permitir substituições</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Membros podem solicitar trocas de escala entre si.
            </p>
          </div>
          <Switch
            checked={form.substituicao_ativa}
            onCheckedChange={(v) => update("substituicao_ativa", v)}
          />
        </div>

        {form.substituicao_ativa && (
          <div className="space-y-1 border-t border-border/40 pt-4">
            <Label className="text-xs text-muted-foreground">Horas mínimas antes da escala</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={168}
                value={form.substituicao_horas_antes}
                onChange={(e) => update("substituicao_horas_antes", Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 rounded-xl"
              />
              <span className="text-sm text-muted-foreground">horas antes da escala</span>
            </div>
            <p className="text-xs text-muted-foreground/60">
              Solicitações após este prazo serão bloqueadas.
            </p>
          </div>
        )}
      </section>

      {/* Seção: Pontuação */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pontuação automática</h2>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Pontuar automaticamente</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Score dos membros é atualizado ao registrar presença/falta.
            </p>
          </div>
          <Switch
            checked={form.auto_pontuar}
            onCheckedChange={(v) => update("auto_pontuar", v)}
          />
        </div>

        {form.auto_pontuar && (
          <div className="border-t border-border/40 pt-4 space-y-3">
            <p className="text-xs text-muted-foreground/70">
              Configure os pontos para cada resultado de presença.
              Use valores negativos para penalidades.
            </p>

            {[
              { key: "pontuacao_presenca" as const,  label: "Presente",    color: "text-green-600" },
              { key: "pontuacao_falta" as const,     label: "Faltou",      color: "text-red-600" },
              { key: "pontuacao_atraso" as const,    label: "Atrasado",    color: "text-orange-600" },
              { key: "pontuacao_justificou" as const,label: "Justificou",  color: "text-amber-600" },
            ].map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-3">
                <span className={`text-sm font-medium w-20 shrink-0 ${color}`}>{label}</span>
                <Input
                  type="number"
                  min={-99}
                  max={99}
                  value={form[key]}
                  onChange={(e) => update(key, parseInt(e.target.value) || 0)}
                  className="w-20 rounded-xl text-center"
                />
                <span className="text-xs text-muted-foreground">pontos</span>
              </div>
            ))}

            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2.5 mt-2">
              <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 dark:text-blue-400">
                Após ativar ou alterar a pontuação, clique em "Recalcular scores" para
                aplicar aos dados históricos.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={recalcLoading}
              onClick={handleRecalcular}
            >
              {recalcLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
              Recalcular scores da paróquia
            </Button>
          </div>
        )}
      </section>

      {/* Botão salvar */}
      <Button
        className="w-full rounded-xl"
        disabled={!dirty || saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar configurações
      </Button>
    </div>
  );
}
