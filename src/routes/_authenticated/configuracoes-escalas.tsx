import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Loader2, Settings, Save } from "lucide-react";
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

export type ConfigEscalas = {
  confirmacao_ativa: boolean;
  confirmacao_horas_antes: number;
  substituicao_ativa: boolean;
  substituicao_horas_antes: number;
  auto_pontuar: boolean;
  // Escalas de missa
  pontuacao_presenca: number;
  pontuacao_presenca_solene: number;
  pontuacao_presenca_bispo: number;
  pontuacao_falta: number;
  pontuacao_justificou: number;
  pontuacao_atraso: number;
  pontuacao_ocorrencia_grave: number;
  // Agenda pastoral
  pontuacao_formacao: number;
  pontuacao_reuniao: number;
  pontuacao_retiro: number;
  pontuacao_adoracao: number;
  pontuacao_ensaio: number;
  pontuacao_encontro: number;
  pontuacao_compromisso: number;
  pontuacao_evento: number;
  // Substituições
  pontuacao_substituicao_aceita: number;
  pontuacao_substituicao_recusada: number;
};

export const DEFAULTS: ConfigEscalas = {
  confirmacao_ativa: false,
  confirmacao_horas_antes: 72,
  substituicao_ativa: false,
  substituicao_horas_antes: 48,
  auto_pontuar: false,
  // Escalas de missa
  pontuacao_presenca: 1,
  pontuacao_presenca_solene: 3,
  pontuacao_presenca_bispo: 5,
  pontuacao_falta: -2,
  pontuacao_justificou: 0,
  pontuacao_atraso: -1,
  pontuacao_ocorrencia_grave: -10,
  // Agenda pastoral
  pontuacao_formacao: 2,
  pontuacao_reuniao: 1,
  pontuacao_retiro: 5,
  pontuacao_adoracao: 2,
  pontuacao_ensaio: 1,
  pontuacao_encontro: 2,
  pontuacao_compromisso: 2,
  pontuacao_evento: 3,
  // Substituições
  pontuacao_substituicao_aceita: 3,
  pontuacao_substituicao_recusada: -1,
};

function ConfiguracaoEscalas() {
  const { profile } = useAuth();
  const paroquiaId = profile?.paroquia_id ?? null;
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigEscalas>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

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
        confirmacao_ativa:               config.confirmacao_ativa,
        confirmacao_horas_antes:         config.confirmacao_horas_antes,
        substituicao_ativa:              config.substituicao_ativa,
        substituicao_horas_antes:        config.substituicao_horas_antes,
        auto_pontuar:                    config.auto_pontuar,
        // Escalas de missa
        pontuacao_presenca:              config.pontuacao_presenca              ?? DEFAULTS.pontuacao_presenca,
        pontuacao_presenca_solene:       config.pontuacao_presenca_solene       ?? DEFAULTS.pontuacao_presenca_solene,
        pontuacao_presenca_bispo:        config.pontuacao_presenca_bispo        ?? DEFAULTS.pontuacao_presenca_bispo,
        pontuacao_falta:                 config.pontuacao_falta                 ?? DEFAULTS.pontuacao_falta,
        pontuacao_justificou:            config.pontuacao_justificou            ?? DEFAULTS.pontuacao_justificou,
        pontuacao_atraso:                config.pontuacao_atraso                ?? DEFAULTS.pontuacao_atraso,
        pontuacao_ocorrencia_grave:      config.pontuacao_ocorrencia_grave      ?? DEFAULTS.pontuacao_ocorrencia_grave,
        // Agenda pastoral
        pontuacao_formacao:              config.pontuacao_formacao              ?? DEFAULTS.pontuacao_formacao,
        pontuacao_reuniao:               config.pontuacao_reuniao               ?? DEFAULTS.pontuacao_reuniao,
        pontuacao_retiro:                config.pontuacao_retiro                ?? DEFAULTS.pontuacao_retiro,
        pontuacao_adoracao:              config.pontuacao_adoracao              ?? DEFAULTS.pontuacao_adoracao,
        pontuacao_ensaio:                config.pontuacao_ensaio                ?? DEFAULTS.pontuacao_ensaio,
        pontuacao_encontro:              config.pontuacao_encontro              ?? DEFAULTS.pontuacao_encontro,
        pontuacao_compromisso:           config.pontuacao_compromisso           ?? DEFAULTS.pontuacao_compromisso,
        pontuacao_evento:                config.pontuacao_evento                ?? DEFAULTS.pontuacao_evento,
        // Substituições
        pontuacao_substituicao_aceita:   config.pontuacao_substituicao_aceita   ?? DEFAULTS.pontuacao_substituicao_aceita,
        pontuacao_substituicao_recusada: config.pontuacao_substituicao_recusada ?? DEFAULTS.pontuacao_substituicao_recusada,
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
          confirmacao_ativa: form.confirmacao_ativa,
          confirmacao_horas_antes: form.confirmacao_horas_antes,
          substituicao_ativa: form.substituicao_ativa,
          substituicao_horas_antes: form.substituicao_horas_antes,
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
          Defina as regras de confirmação e substituições da sua paróquia.
        </p>
      </div>

      {/* Confirmação */}
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
          </div>
        )}
      </section>

      {/* Substituições */}
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
          </div>
        )}
      </section>

      {/* Salvar */}
      <Button
        className="w-full rounded-xl"
        disabled={!dirty || saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        {saveMutation.isPending
          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          : <Save className="h-4 w-4 mr-2" />}
        Salvar configurações
      </Button>
    </div>
  );
}
