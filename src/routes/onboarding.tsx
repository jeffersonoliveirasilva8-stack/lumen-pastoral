import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
  head: () => ({ meta: [{ title: "Configurar paróquia — Lumen Pastoral" }] }),
});

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

function Onboarding() {
  const { user, profile, refreshProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [diocese, setDiocese] = useState("");
  const [contato, setContato] = useState("");
  const [endereco, setEndereco] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
    if (!loading && profile?.paroquia_id) navigate({ to: "/painel" });
  }, [loading, user, profile, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    const baseSlug = slugify(nome) || "paroquia";
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const { data: paroquia, error: pErr } = await supabase
      .from("paroquias")
      .insert({ nome, diocese: diocese || null, contato_email: contato || null, endereco: endereco || null, slug, created_by: user.id })
      .select()
      .single();
    if (pErr || !paroquia) { setSubmitting(false); toast.error(pErr?.message || "Erro ao criar paróquia."); return; }

    const [{ error: rErr }, { error: prErr }] = await Promise.all([
      supabase.from("user_roles").insert({ user_id: user.id, paroquia_id: paroquia.id, role: "admin_paroquial" }),
      supabase.from("profiles").update({ paroquia_id: paroquia.id }).eq("id", user.id),
    ]);
    setSubmitting(false);
    if (rErr || prErr) { toast.error(rErr?.message || prErr?.message || "Erro ao concluir cadastro."); return; }

    await refreshProfile();
    toast.success("Paróquia configurada!");
    navigate({ to: "/painel" });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-sacro text-gold"><Flame className="h-4 w-4" /></div>
          <span className="font-serif text-lg">Lumen Pastoral</span>
        </div>
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Passo final</p>
        <h1 className="mt-2 font-serif text-4xl">Cadastre sua paróquia</h1>
        <p className="mt-2 text-sm text-muted-foreground">Estes dados são privados e isolados de outras paróquias.</p>

        <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-6 shadow-altar">
          <Field label="Nome da paróquia">
            <input required value={nome} onChange={(e) => setNome(e.target.value)} className="input" placeholder="Paróquia N. Sra. Mãe da Igreja" />
          </Field>
          <Field label="Diocese">
            <input value={diocese} onChange={(e) => setDiocese(e.target.value)} className="input" placeholder="Arquidiocese de ..." />
          </Field>
          <Field label="E-mail de contato">
            <input type="email" value={contato} onChange={(e) => setContato(e.target.value)} className="input" placeholder="secretaria@paroquia.org" />
          </Field>
          <Field label="Endereço">
            <input value={endereco} onChange={(e) => setEndereco(e.target.value)} className="input" placeholder="Rua, número, bairro, cidade" />
          </Field>

          <button disabled={submitting} className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Concluir e acessar painel
          </button>
        </form>
      </div>
      <style>{`.input { width: 100%; border-radius: 0.5rem; border: 1px solid var(--color-input); background: var(--color-background); padding: 0.625rem 1rem; font-size: 0.875rem; outline: none; } .input:focus { border-color: var(--color-ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-ring) 20%, transparent); }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
