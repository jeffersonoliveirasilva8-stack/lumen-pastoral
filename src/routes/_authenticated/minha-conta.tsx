import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Phone, User, Save, ShieldCheck, Shield,
  LogOut, Calendar, Mail, Building2, KeyRound, CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MfaSetup } from "@/components/security/MfaSetup";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/minha-conta")({
  component: MinhaConta,
  head: () => ({ meta: [{ title: "Minha Conta — Painel Pastoral" }] }),
});

const ROLE_INFO: Record<string, { label: string; desc: string; color: string; icon: typeof Shield }> = {
  admin_paroquial: {
    label: "Coordenador",
    desc: "Acesso total — gerencia membros, escalas, configurações e equipe.",
    color: "text-red-700 bg-red-50 border-red-200",
    icon: ShieldCheck,
  },
  super_admin: {
    label: "Super Admin",
    desc: "Acesso administrativo da plataforma.",
    color: "text-red-700 bg-red-50 border-red-200",
    icon: ShieldCheck,
  },
  coordenador: {
    label: "Vice-Coordenador",
    desc: "Gerencia escalas e membros. Sem acesso a configurações avançadas.",
    color: "text-blue-700 bg-blue-50 border-blue-200",
    icon: Shield,
  },
  auxiliar: {
    label: "Secretário",
    desc: "Acesso de leitura e confirmação de presenças.",
    color: "text-teal-700 bg-teal-50 border-teal-200",
    icon: User,
  },
};

// Gera cor de fundo para o avatar baseada no nome
function avatarColor(name: string) {
  const colors = [
    "from-blue-500 to-blue-700",
    "from-violet-500 to-violet-700",
    "from-emerald-500 to-emerald-700",
    "from-amber-500 to-amber-700",
    "from-rose-500 to-rose-700",
    "from-teal-500 to-teal-700",
  ];
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) ?? 0)) % colors.length;
  return colors[idx];
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function MinhaConta() {
  const { profile, roles, refreshProfile, isAdmin, isCoordenador } = useAuth();
  const navigate = useNavigate();

  const [telefone, setTelefone] = useState(profile?.telefone ?? "");
  const [nomeCompleto, setNomeCompleto] = useState(profile?.nome_completo ?? "");
  const [savingPerfil, setSavingPerfil] = useState(false);

  // Busca nome da paróquia
  const { data: paroquia } = useQuery({
    queryKey: ["minha-conta-paroquia", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paroquias")
        .select("nome, diocese")
        .eq("id", profile!.paroquia_id!)
        .maybeSingle();
      return data;
    },
  });

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

  async function handleLogout() {
    sessionStorage.removeItem("admin_mfa_token");
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  if (!profile) return null;

  // Determina o role mais alto do usuário
  const topRole = roles.find((r) => r in ROLE_INFO) ?? roles[0] ?? "auxiliar";
  const roleInfo = ROLE_INFO[topRole] ?? ROLE_INFO.auxiliar;
  const RoleIcon = roleInfo.icon;
  const memberSince = profile.created_at
    ? format(new Date(profile.created_at), "MMMM 'de' yyyy", { locale: ptBR })
    : null;
  const gradiente = avatarColor(profile.nome_completo ?? "U");

  return (
    <div className="max-w-xl mx-auto pb-24 space-y-5">

      {/* ── Header da conta ─────────────────────────────────────────── */}
      <div className="rounded-3xl overflow-hidden border border-border bg-card shadow-altar">
        {/* Fundo decorativo */}
        <div className="h-24 bg-gradient-sacro relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, oklch(0.85 0.12 85) 0%, transparent 50%), radial-gradient(circle at 80% 20%, oklch(0.85 0.12 85) 0%, transparent 40%)" }}
          />
        </div>

        {/* Avatar + info */}
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-8 mb-4">
            <div className={`h-20 w-20 rounded-2xl bg-gradient-to-br ${gradiente} flex items-center justify-center shadow-lg border-4 border-card shrink-0`}>
              <span className="text-2xl font-bold text-white leading-none">
                {initials(profile.nome_completo ?? "U")}
              </span>
            </div>
            <div className="pb-1 min-w-0 flex-1">
              <h1 className="font-serif text-xl text-foreground truncate leading-tight">
                {profile.nome_completo}
              </h1>
              <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold mt-1 ${roleInfo.color}`}>
                <RoleIcon className="h-3 w-3" />
                {roleInfo.label}
              </span>
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Paróquia</p>
                <p className="text-xs font-medium truncate">{paroquia?.nome ?? "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">E-mail</p>
                <p className="text-xs font-medium truncate">{profile.email ?? "—"}</p>
              </div>
            </div>
            {memberSince && (
              <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Membro desde</p>
                  <p className="text-xs font-medium capitalize truncate">{memberSince}</p>
                </div>
              </div>
            )}
          </div>

          {/* Permissões do cargo */}
          <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">Nível de acesso</p>
            <p className="text-xs text-foreground/80 leading-relaxed">{roleInfo.desc}</p>
          </div>
        </div>
      </div>

      {/* ── Dados pessoais ──────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Dados pessoais</h2>
            <p className="text-xs text-muted-foreground">Nome e telefone exibidos no painel</p>
          </div>
        </div>
        <form onSubmit={handlePerfil} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mc-nome" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nome completo
            </Label>
            <Input
              id="mc-nome"
              value={nomeCompleto}
              onChange={(e) => setNomeCompleto(e.target.value)}
              placeholder="Seu nome completo"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-telefone" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Telefone
            </Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="mc-telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className="pl-9"
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              E-mail
            </Label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span className="text-sm text-foreground/70 truncate">{profile.email ?? "—"}</span>
              <span className="ml-auto text-[10px] text-muted-foreground shrink-0">verificado</span>
            </div>
          </div>
          <Button type="submit" disabled={savingPerfil} className="w-full">
            {savingPerfil ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar dados pessoais
          </Button>
        </form>
      </section>

      {/* ── Segurança ───────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60">
          <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
            <KeyRound className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Senha</h2>
            <p className="text-xs text-muted-foreground">Redefinição segura por e-mail</p>
          </div>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Por segurança, a troca de senha é feita por um link enviado ao seu e-mail cadastrado.
            O link expira em 1 hora.
          </p>
          <Link to="/esqueci-senha">
            <Button variant="outline" className="w-full">
              <Mail className="h-4 w-4" />
              Enviar link de redefinição
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Autenticação de 2 fatores ───────────────────────────────── */}
      {(isAdmin || isCoordenador) && (
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold">Autenticação de dois fatores</h2>
              <p className="text-xs text-muted-foreground">Obrigatório para acesso ao painel de coordenação</p>
            </div>
          </div>
          <div className="p-5">
            <MfaSetup />
          </div>
        </section>
      )}

      {/* ── Sair da conta ───────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60">
          <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
            <LogOut className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Sessão</h2>
            <p className="text-xs text-muted-foreground">Encerrar acesso ao painel neste dispositivo</p>
          </div>
        </div>
        <div className="p-5">
          <Button
            variant="destructive"
            className="w-full bg-destructive/10 text-destructive hover:bg-destructive/15 border-0"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sair da conta
          </Button>
        </div>
      </section>

    </div>
  );
}
