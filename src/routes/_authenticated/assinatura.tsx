import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CreditCard, Clock, CheckCircle2, XCircle, AlertTriangle,
  FileText, ExternalLink, MessageCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/assinatura")({
  component: AssinaturaPage,
});

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  trial:     { label: "Teste",     variant: "secondary" },
  active:    { label: "Ativo",     variant: "default" },
  past_due:  { label: "Vencido",   variant: "destructive" },
  suspended: { label: "Suspenso",  variant: "destructive" },
  blocked:   { label: "Bloqueado", variant: "destructive" },
  canceled:  { label: "Cancelado", variant: "outline" },
};

const INVOICE_STATUS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  paid:    { label: "Pago",      icon: CheckCircle2,   color: "text-emerald-600" },
  pending: { label: "Pendente",  icon: Clock,          color: "text-amber-600" },
  failed:  { label: "Falhou",    icon: XCircle,        color: "text-red-600" },
  refunded:{ label: "Reembolsado", icon: AlertTriangle, color: "text-slate-500" },
};

const WHATSAPP_NUMBER = "5511999999999"; // TODO: substituir pelo número real

function AssinaturaPage() {
  const { profile } = useAuth();

  const { data: subscription, isLoading: loadingSub } = useQuery({
    queryKey: ["subscription-detail", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("*, plans(name, slug, price_brl, max_members, max_admins)")
        .eq("paroquia_id", profile!.paroquia_id)
        .maybeSingle();
      return data as any;
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("invoices")
        .select("*")
        .eq("paroquia_id", profile!.paroquia_id)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as any[];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["plans-full"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plans")
        .select("id, name, slug, price_brl, description")
        .order("price_brl", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const { data: planFeatures = [] } = useQuery({
    queryKey: ["plan-features-all"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plan_features")
        .select("*");
      return (data ?? []) as any[];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["plan-change-history", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plan_change_history")
        .select("*, old_plan:plans!old_plan_id(name), new_plan:plans!new_plan_id(name)")
        .eq("paroquia_id", profile!.paroquia_id)
        .order("changed_at", { ascending: false })
        .limit(20);
      return (data ?? []) as any[];
    },
  });

  const sub = subscription;
  const subBadge = sub ? (STATUS_BADGE[sub.sub_status] ?? STATUS_BADGE.active) : null;
  const periodEnd = sub?.current_period_end ?? sub?.trial_ends_at;

  function whatsappLink(planName: string) {
    const msg = encodeURIComponent(`Olá! Gostaria de assinar o plano ${planName} do Lumen Pastoral.`);
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assinatura</h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie seu plano e histórico de faturas.</p>
      </div>

      {/* Plano atual */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Plano atual</h2>
        </div>

        {loadingSub ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
        ) : sub ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <p className="text-xl font-bold">{sub.plans?.name ?? "Gratuito"}</p>
              {subBadge && (
                <Badge variant={subBadge.variant} className="mt-1">{subBadge.label}</Badge>
              )}
              {periodEnd && (
                <p className="text-xs text-muted-foreground mt-2">
                  {sub.sub_status === "trial" ? "Teste até " : "Renovação em "}
                  {format(parseISO(periodEnd), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">
                {sub.plans?.price_brl === 0
                  ? "Grátis"
                  : sub.plans?.price_brl
                  ? `R$ ${Number(sub.plans.price_brl).toFixed(2).replace(".", ",")}`
                  : "—"}
              </p>
              {sub.plans?.price_brl > 0 && (
                <p className="text-xs text-muted-foreground">/mês</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma assinatura encontrada.</p>
        )}
      </section>

      {/* Grade de planos */}
      <section className="space-y-4">
        <h2 className="font-semibold text-sm">Planos disponíveis</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan: any) => {
            const features = planFeatures.filter((f: any) => f.plan_id === plan.id);
            const isCurrent = sub?.plans?.slug === plan.slug;
            return (
              <div
                key={plan.id}
                className={`rounded-2xl border p-5 flex flex-col gap-4 transition ${
                  isCurrent ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-base">{plan.name}</p>
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5">Atual</span>
                    )}
                  </div>
                  <p className="text-xl font-bold mt-1">
                    {plan.price_brl === 0
                      ? "Grátis"
                      : `R$ ${Number(plan.price_brl).toFixed(2).replace(".", ",")}`}
                    {plan.price_brl > 0 && <span className="text-xs font-normal text-muted-foreground">/mês</span>}
                  </p>
                  {plan.description && (
                    <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                  )}
                </div>

                {features.length > 0 && (
                  <ul className="space-y-1.5 flex-1">
                    {features.slice(0, 6).map((f: any) => (
                      <li key={f.id} className="flex items-center gap-2 text-xs text-foreground/80">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        {f.feature_label ?? f.feature_key}
                      </li>
                    ))}
                  </ul>
                )}

                <a
                  href={whatsappLink(plan.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    isCurrent
                      ? "bg-muted text-muted-foreground cursor-default pointer-events-none"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  <MessageCircle className="h-4 w-4" />
                  {isCurrent ? "Plano atual" : "Assinar"}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* Faturas */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Faturas</h2>
        </div>

        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-6 text-center">
            Nenhuma fatura encontrada.
          </p>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground text-xs font-semibold">
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-left px-4 py-3">Valor</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any, i: number) => {
                  const info = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.pending;
                  const Icon = info.icon;
                  return (
                    <tr key={inv.id} className={`border-t border-border/60 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-4 py-3 text-foreground/80">
                        {format(parseISO(inv.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {inv.amount_brl != null
                          ? `R$ ${Number(inv.amount_brl).toFixed(2).replace(".", ",")}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-medium ${info.color}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {info.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {inv.pdf_url ? (
                          <a
                            href={inv.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Baixar
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Histórico de mudanças de plano */}
      {history.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-semibold text-sm">Histórico de mudanças de plano</h2>
          <div className="rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground text-xs font-semibold">
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-left px-4 py-3">De</th>
                  <th className="text-left px-4 py-3">Para</th>
                  <th className="text-left px-4 py-3">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h: any, i: number) => (
                  <tr key={h.id} className={`border-t border-border/60 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                    <td className="px-4 py-3 text-foreground/80">
                      {format(parseISO(h.changed_at), "dd/MM/yyyy", { locale: ptBR })}
                    </td>
                    <td className="px-4 py-3">{h.old_plan?.name ?? "—"}</td>
                    <td className="px-4 py-3 font-medium">{h.new_plan?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{h.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
