import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { KeyRound, Pencil, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/credenciais")({
  component: CredenciaisPage,
});

type GatewayCredential = {
  id: string;
  gateway: "mercadopago" | "stripe" | "asaas";
  label: string;
  is_active: boolean;
  public_key: string | null;
  webhook_url: string | null;
  sandbox: boolean;
};

const GATEWAY_META: Record<string, { name: string; color: string; hint: string }> = {
  mercadopago: {
    name: "Mercado Pago",
    color: "bg-blue-600",
    hint: "Access Token começa com APP_USR-… ou TEST-…",
  },
  stripe: {
    name: "Stripe",
    color: "bg-purple-600",
    hint: "Public Key começa com pk_live_… ou pk_test_…",
  },
  asaas: {
    name: "Asaas",
    color: "bg-green-600",
    hint: "API Key disponível em Minha Conta → Integrações",
  },
};

const EMPTY_FORM = {
  label: "",
  public_key: "",
  webhook_url: "",
  sandbox: true,
};

function CredenciaisPage() {
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<GatewayCredential | null>(null);
  const [activateTarget, setActivateTarget] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ["gateway_credentials"],
    queryFn: async () => {
      const { data, error } = await db
        .from("gateway_credentials")
        .select("*")
        .order("gateway");
      if (error) throw error;
      return data as GatewayCredential[];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (values: typeof form & { gateway: string }) => {
      const { gateway, ...rest } = values;
      const existing = credentials.find((c) => c.gateway === gateway);
      if (existing) {
        const { error } = await db
          .from("gateway_credentials")
          .update({ ...rest, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("gateway_credentials")
          .insert({ gateway, ...rest });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway_credentials"] });
      setEditTarget(null);
      toast.success("Credenciais salvas");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: async (gateway: string) => {
      const { error } = await db.rpc("set_active_gateway", { p_gateway: gateway });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway_credentials"] });
      setActivateTarget(null);
      toast.success("Gateway ativo atualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openEdit(gw: GatewayCredential) {
    setEditTarget(gw);
    setForm({
      label: gw.label,
      public_key: gw.public_key ?? "",
      webhook_url: gw.webhook_url ?? "",
      sandbox: gw.sandbox,
    });
  }

  function openNew(gateway: string) {
    const meta = GATEWAY_META[gateway];
    setEditTarget({ id: "", gateway: gateway as GatewayCredential["gateway"], label: meta.name, is_active: false, public_key: null, webhook_url: null, sandbox: true });
    setForm({ label: meta.name, public_key: "", webhook_url: "", sandbox: true });
  }

  const GATEWAYS = ["mercadopago", "stripe", "asaas"] as const;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Credenciais de Gateway</h1>
        <p className="text-sm text-white/50 mt-0.5">
          Configure as chaves públicas e URLs de webhook dos gateways de pagamento. As chaves secretas devem ser configuradas nos Secrets da Edge Function no Supabase.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="space-y-4">
          {GATEWAYS.map((gw) => {
            const meta = GATEWAY_META[gw];
            const cred = credentials.find((c) => c.gateway === gw);

            return (
              <Card key={gw} className="bg-[#0F1E33] border-white/10 text-white">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded ${meta.color} grid place-items-center`}>
                        <KeyRound className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-sm text-white">{meta.name}</CardTitle>
                        <CardDescription className="text-xs text-white/40">{meta.hint}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {cred?.is_active ? (
                        <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-white/20 text-white/40 text-[10px]">
                          Inativo
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {cred ? (
                    <>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        <div>
                          <span className="text-white/40">Chave pública</span>
                          <p className="text-white/80 font-mono truncate">{cred.public_key || "—"}</p>
                        </div>
                        <div>
                          <span className="text-white/40">Webhook URL</span>
                          <p className="text-white/80 font-mono truncate">{cred.webhook_url || "—"}</p>
                        </div>
                        <div className="mt-1">
                          <span className="text-white/40">Modo</span>
                          <p className={cred.sandbox ? "text-yellow-400" : "text-green-400"}>
                            {cred.sandbox ? "Sandbox (testes)" : "Produção"}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                          onClick={() => openEdit(cred)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Editar
                        </Button>
                        {!cred.is_active && (
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                            onClick={() => setActivateTarget(gw)}
                          >
                            Tornar ativo
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 py-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                      <span className="text-xs text-white/50">Ainda não configurado.</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-white/20 text-white/70 hover:text-white hover:bg-white/10 ml-auto"
                        onClick={() => openNew(gw)}
                      >
                        Configurar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="bg-[#0F1E33] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editTarget ? GATEWAY_META[editTarget.gateway]?.name : ""} — Configurar
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Label</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                className="bg-white/5 border-white/10 text-white"
                placeholder="Ex: Mercado Pago Principal"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Chave pública / Public Key</Label>
              <Input
                value={form.public_key}
                onChange={(e) => setForm((f) => ({ ...f, public_key: e.target.value }))}
                className="bg-white/5 border-white/10 text-white font-mono text-xs"
                placeholder={editTarget ? GATEWAY_META[editTarget.gateway]?.hint : ""}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Webhook URL</Label>
              <Input
                value={form.webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
                className="bg-white/5 border-white/10 text-white font-mono text-xs"
                placeholder="https://…/functions/v1/webhook-payment"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-xs text-white/70">Modo sandbox</p>
                <p className="text-[11px] text-white/40">Desative para processar pagamentos reais</p>
              </div>
              <Switch
                checked={form.sandbox}
                onCheckedChange={(v) => setForm((f) => ({ ...f, sandbox: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              className="text-white/50"
              onClick={() => setEditTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={upsertMutation.isPending}
              onClick={() =>
                editTarget &&
                upsertMutation.mutate({ ...form, gateway: editTarget.gateway })
              }
            >
              {upsertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate confirm */}
      <AlertDialog open={!!activateTarget} onOpenChange={(o) => !o && setActivateTarget(null)}>
        <AlertDialogContent className="bg-[#0F1E33] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Ativar gateway?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              O gateway <strong className="text-white">{activateTarget ? GATEWAY_META[activateTarget]?.name : ""}</strong> será ativado e todos os outros desativados. Isso afeta imediatamente os novos checkouts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 text-white/60 hover:text-white hover:bg-white/10">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => activateTarget && activateMutation.mutate(activateTarget)}
            >
              Ativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
