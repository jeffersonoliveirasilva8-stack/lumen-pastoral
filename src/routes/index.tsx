import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, ShieldCheck, Flame, Users, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Lumen Pastoral — Plataforma de gestão pastoral para paróquias" },
      { name: "description", content: "Gestão de escalas pastorais, acolitato e ministérios. Multi-paróquia, em nuvem, com regras litúrgicas inteligentes." },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-sacro text-gold">
              <Flame className="h-4 w-4" />
            </div>
            <span className="font-serif text-lg font-semibold tracking-tight">Lumen Pastoral</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/login" className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Entrar
            </Link>
            <Link to="/cadastro" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-altar hover:opacity-90">
              Criar paróquia <ChevronRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.93_0.05_85/0.6),transparent)]" />
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-soft px-3 py-1 text-xs font-medium tracking-wide text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Plataforma para paróquias e dioceses
          </span>
          <h1 className="mt-6 font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl md:text-7xl">
            Gestão litúrgica<br />que serve à comunidade.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Escalas inteligentes, ministérios coordenados e regras litúrgicas — tudo em uma única
            plataforma multi-paróquia, segura e em nuvem.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/cadastro" className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90">
              Criar conta da paróquia
            </Link>
            <Link to="/login" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-muted">
              Acesso coordenação
            </Link>
            <Link to="/membro/login" className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-6 py-3 text-sm font-semibold text-primary hover:bg-primary/10">
              <Users className="h-4 w-4" />
              Portal do servidor
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Calendar, title: "Escalas inteligentes", desc: "Motor com balanceamento, regras litúrgicas e tratamento de solenidades, novenas e Tríduos." },
            { icon: Users, title: "Multi-paróquia", desc: "Cada paróquia com seus dados, papéis e configurações isolados. Pronto para dioceses." },
            { icon: ShieldCheck, title: "Seguro por padrão", desc: "Autenticação, papéis e isolamento por linha (RLS). Backup e sincronização em nuvem." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-gold-soft text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-serif text-xl text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Lumen Pastoral · Plataforma de gestão pastoral
      </footer>
    </div>
  );
}
