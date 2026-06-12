import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Phone, Camera, User, Save, ShieldCheck } from "lucide-react";
import { MfaSetup } from "@/components/security/MfaSetup";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/minha-conta")({
  component: MinhaConta,
  head: () => ({ meta: [{ title: "Minha Conta — Painel Pastoral" }] }),
});

function MinhaConta() {
  const { profile, refreshProfile } = useAuth();

  // ── Telefone & Nome ────────────────────────────────────────────────
  const [telefone, setTelefone] = useState(profile?.telefone ?? "");
  const [nomeCompleto, setNomeCompleto] = useState(profile?.nome_completo ?? "");
  const [savingPerfil, setSavingPerfil] = useState(false);

  async function handlePerfil(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeCompleto.trim()) { toast.error("O nome não pode estar vazio."); return; }
    setSavingPerfil(true);
    const { error } = await anyDb
      .from("profiles")
      .update({ nome_completo: nomeCompleto.trim(), telefone: telefone || null })
      .eq("id", (await supabase.auth.getUser()).data.user?.id);
    setSavingPerfil(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    await refreshProfile();
    toast.success("Perfil atualizado.");
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-2xl">Minha Conta</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Gerencie seus dados de acesso e informações pessoais.</p>
      </div>

      {/* Dados pessoais */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" /> Dados pessoais
        </h2>
        <form onSubmit={handlePerfil} className="space-y-3">
          <div>
            <Label htmlFor="mc-nome">Nome completo</Label>
            <Input
              id="mc-nome"
              value={nomeCompleto}
              onChange={(e) => setNomeCompleto(e.target.value)}
              className="mt-1"
              placeholder="Seu nome completo"
            />
          </div>
          <div>
            <Label htmlFor="mc-telefone" className="flex items-center gap-1">
              <Phone className="h-3 w-3" /> Telefone
            </Label>
            <Input
              id="mc-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="mt-1"
              placeholder="(00) 00000-0000"
            />
          </div>
          <div>
            <Label className="text-muted-foreground">E-mail atual</Label>
            <p className="mt-1 text-sm text-foreground/70 rounded-lg border border-border bg-muted/40 px-3 py-2">
              {profile?.email ?? "—"}
            </p>
          </div>
          <Button type="submit" disabled={savingPerfil} className="w-full">
            {savingPerfil ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar dados pessoais
          </Button>
        </form>
      </section>

      {/* Senha — redefinição via e-mail */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Senha de acesso</h2>
        <p className="text-sm text-muted-foreground">
          Para alterar sua senha, use o fluxo de redefinição por e-mail.
        </p>
        <Link to="/esqueci-senha" className="block">
          <Button variant="outline" className="w-full">Redefinir senha por e-mail</Button>
        </Link>
      </section>

      {/* Segurança — 2FA */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Segurança
        </h2>
        <MfaSetup />
      </section>
    </div>
  );
}
