import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Calendar, ShieldCheck, Users, ChevronRight, CheckCircle,
  Flame, Bell, Star, BookOpen, LayoutDashboard, Trophy,
  ArrowRight, Zap, Lock, Globe,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Lumen Pastoral — Plataforma de gestão pastoral para paróquias" },
      { name: "description", content: "Gestão de escalas pastorais, acolitato e ministérios. Multi-paróquia, em nuvem, com regras litúrgicas inteligentes." },
      { property: "og:title", content: "Lumen Pastoral — Plataforma pastoral inteligente" },
      { property: "og:description", content: "Escalas automáticas, portal do servidor, liturgia integrada. Tudo em uma plataforma segura para paróquias e dioceses." },
    ],
  }),
});

// ── SVG mockup da interface — representação visual do produto ─────────
function ProductMockup() {
  return (
    <svg
      viewBox="0 0 560 360"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full drop-shadow-2xl"
      role="img"
      aria-label="Prévia do painel Lumen Pastoral"
    >
      {/* Window chrome */}
      <rect width="560" height="360" rx="12" fill="#ffffff" />
      <rect width="560" height="36" rx="12" fill="#f8fafc" />
      <rect y="24" width="560" height="12" fill="#f8fafc" />
      <circle cx="20" cy="18" r="5" fill="#ef4444" opacity=".7" />
      <circle cx="36" cy="18" r="5" fill="#f59e0b" opacity=".7" />
      <circle cx="52" cy="18" r="5" fill="#22c55e" opacity=".7" />
      <rect x="80" y="10" width="180" height="16" rx="8" fill="#e2e8f0" />

      {/* Sidebar */}
      <rect x="0" y="36" width="130" height="324" fill="#0f172a" />
      {/* Logo area */}
      <rect x="12" y="50" width="32" height="32" rx="8" fill="#1e293b" />
      <text x="28" y="72" textAnchor="middle" fontSize="14" fill="#c9a227">✦</text>
      <rect x="52" y="55" width="64" height="8" rx="4" fill="#334155" />
      <rect x="52" y="68" width="44" height="6" rx="3" fill="#1e293b" />

      {/* Nav items */}
      {[
        { y: 100, label: "Painel", active: true },
        { y: 126, label: "Escalas", active: false },
        { y: 152, label: "Membros", active: false },
        { y: 178, label: "Liturgia", active: false },
        { y: 204, label: "Pastoral", active: false },
      ].map((item) => (
        <g key={item.y}>
          {item.active && <rect x="8" y={item.y - 2} width="114" height="22" rx="8" fill="#1e293b" />}
          {item.active && <rect x="8" y={item.y - 2} width="3" height="22" rx="1.5" fill="#c9a227" />}
          <rect x="22" y={item.y + 5} width="8" height="8" rx="2" fill={item.active ? "#c9a227" : "#334155"} />
          <rect x="36" y={item.y + 6} width={item.active ? 56 : 48} height="6" rx="3" fill={item.active ? "#e2e8f0" : "#334155"} />
        </g>
      ))}

      {/* Main area */}
      {/* Header */}
      <rect x="130" y="36" width="430" height="40" fill="#f8fafc" />
      <rect x="144" y="48" width="120" height="8" rx="4" fill="#cbd5e1" />
      <rect x="490" y="47" width="56" height="20" rx="6" fill="#0f172a" />
      <rect x="496" y="53" width="44" height="8" rx="4" fill="#475569" />

      {/* Liturgy color bar */}
      <rect x="130" y="76" width="430" height="3" fill="#16a34a" opacity=".7" />

      {/* Metric cards row */}
      {[
        { x: 144, color: "#3b82f6", label: "Escalas", val: "12" },
        { x: 254, color: "#22c55e", label: "Membros", val: "38" },
        { x: 364, color: "#c9a227", label: "Score", val: "94%" },
        { x: 474, color: "#7c3aed", label: "Eventos", val: "3" },
      ].map((c) => (
        <g key={c.x}>
          <rect x={c.x} y="90" width="96" height="60" rx="10" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
          <rect x={c.x + 10} y="100" width="20" height="20" rx="6" fill={c.color} opacity=".12" />
          <rect x={c.x + 14} y="106" width="12" height="8" rx="2" fill={c.color} />
          <rect x={c.x + 10} y="126" width="36" height="10" rx="4" fill="#0f172a" />
          <rect x={c.x + 10} y="140" width="28" height="6" rx="3" fill="#cbd5e1" />
        </g>
      ))}

      {/* Schedule preview */}
      <rect x="144" y="164" width="230" height="180" rx="10" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="156" y="176" width="80" height="8" rx="4" fill="#0f172a" />
      <rect x="156" y="188" width="50" height="6" rx="3" fill="#94a3b8" />
      {[
        { y: 206, color: "#3b82f6", w: 120 },
        { y: 222, color: "#22c55e", w: 90 },
        { y: 238, color: "#c9a227", w: 140 },
        { y: 254, color: "#7c3aed", w: 100 },
        { y: 270, color: "#ef4444", w: 110 },
        { y: 286, color: "#3b82f6", w: 80 },
        { y: 302, color: "#22c55e", w: 130 },
      ].map((row) => (
        <g key={row.y}>
          <rect x="156" y={row.y} width="8" height="8" rx="2" fill={row.color} opacity=".8" />
          <rect x="170" y={row.y + 1} width={row.w} height="6" rx="3" fill="#e2e8f0" />
          <rect x="314" y={row.y + 1} width="40" height="6" rx="3" fill="#f1f5f9" />
        </g>
      ))}

      {/* Right panel — liturgy + ranking */}
      <rect x="388" y="164" width="172" height="80" rx="10" fill="#0f172a" />
      <rect x="400" y="176" width="60" height="8" rx="4" fill="#334155" />
      <rect x="400" y="188" width="148" height="6" rx="3" fill="#1e293b" />
      <circle cx="406" cy="220" r="8" fill="#16a34a" opacity=".3" />
      <rect x="420" y="214" width="120" height="6" rx="3" fill="#334155" />
      <rect x="420" y="224" width="80" height="6" rx="3" fill="#1e293b" />

      {/* Ranking mini */}
      <rect x="388" y="254" width="172" height="90" rx="10" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="400" y="264" width="60" height="8" rx="4" fill="#0f172a" />
      {["🥇", "🥈", "🥉"].map((emoji, i) => (
        <g key={i}>
          <text x="402" y={286 + i * 16} fontSize="10">{emoji}</text>
          <rect x="416" y={280 + i * 16} width={80 - i * 15} height="6" rx="3" fill="#e2e8f0" />
          <rect x="504" y={280 + i * 16} width="40" height="6" rx="3" fill="#fef3c7" />
        </g>
      ))}

      {/* Bottom gradient overlay */}
      <defs>
        <linearGradient id="fadeBottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="70%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect x="130" y="200" width="430" height="160" fill="url(#fadeBottom)" />
    </svg>
  );
}

// ── Mobile mockup para a seção do portal do membro ───────────────────
function MobileMockup() {
  return (
    <svg
      viewBox="0 0 200 380"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-[180px] drop-shadow-xl mx-auto"
      role="img"
      aria-label="Portal do membro no celular"
    >
      {/* Phone frame */}
      <rect width="200" height="380" rx="32" fill="#1e293b" />
      <rect x="8" y="8" width="184" height="364" rx="26" fill="#f8fafc" />
      {/* Notch */}
      <rect x="70" y="8" width="60" height="20" rx="10" fill="#0f172a" />

      {/* Status bar */}
      <rect x="20" y="34" width="30" height="6" rx="3" fill="#cbd5e1" />
      <rect x="150" y="34" width="30" height="6" rx="3" fill="#cbd5e1" />

      {/* Liturgy color strip */}
      <rect x="8" y="48" width="184" height="3" rx="1.5" fill="#9333ea" />

      {/* Header */}
      <rect x="20" y="56" width="100" height="8" rx="4" fill="#0f172a" />
      <rect x="20" y="68" width="60" height="6" rx="3" fill="#94a3b8" />

      {/* Greeting */}
      <rect x="20" y="84" width="40" height="6" rx="3" fill="#94a3b8" />
      <rect x="20" y="94" width="110" height="14" rx="6" fill="#0f172a" />
      <rect x="20" y="112" width="80" height="8" rx="4" fill="#c9a227" opacity=".6" />

      {/* Quick actions */}
      {[20, 65, 110, 155].map((x) => (
        <g key={x}>
          <rect x={x} y="128" width="35" height="35" rx="10" fill="#f1f5f9" />
          <rect x={x + 10} y="138" width="15" height="15" rx="4" fill="#cbd5e1" />
          <rect x={x + 5} y="156" width="25" height="5" rx="2.5" fill="#e2e8f0" />
        </g>
      ))}

      {/* Next escala card */}
      <rect x="16" y="174" width="168" height="68" rx="12" fill="#ffffff" stroke="#3b82f6" strokeWidth="2" />
      <rect x="16" y="174" width="4" height="68" rx="2" fill="#3b82f6" />
      <rect x="28" y="184" width="32" height="32" rx="8" fill="#3b82f6" opacity=".1" />
      <rect x="34" y="192" width="20" height="18" rx="4" fill="#3b82f6" opacity=".5" />
      <rect x="68" y="184" width="80" height="8" rx="4" fill="#0f172a" />
      <rect x="68" y="196" width="56" height="6" rx="3" fill="#94a3b8" />
      <rect x="68" y="208" width="40" height="6" rx="3" fill="#94a3b8" />
      <rect x="130" y="184" width="42" height="18" rx="6" fill="#22c55e" opacity=".15" />
      <rect x="136" y="189" width="30" height="8" rx="4" fill="#16a34a" opacity=".8" />
      <rect x="28" y="224" width="60" height="6" rx="3" fill="#94a3b8" />
      <rect x="128" y="224" width="44" height="6" rx="3" fill="#e2e8f0" />

      {/* Liturgy card */}
      <rect x="16" y="252" width="168" height="50" rx="12" fill="#0f172a" />
      <rect x="16" y="252" width="168" height="3" rx="1.5" fill="#9333ea" />
      <rect x="28" y="262" width="80" height="8" rx="4" fill="#334155" />
      <rect x="28" y="274" width="120" height="6" rx="3" fill="#1e293b" />
      <rect x="28" y="284" width="56" height="6" rx="3" fill="#1e293b" />
      <rect x="148" y="270" width="24" height="20" rx="6" fill="#9333ea" opacity=".4" />

      {/* Bottom nav */}
      <rect x="8" y="322" width="184" height="50" rx="0" fill="#ffffff" />
      <rect x="8" y="322" width="184" height="1" fill="#e2e8f0" />
      <rect x="8" y="364" width="184" height="16" rx="0" fill="#f8fafc" />
      {[30, 76, 100, 124, 170].map((x, i) => (
        <g key={x}>
          <rect x={x - 10} y="332" width="20" height="16" rx="4" fill={i === 2 ? "#0f172a" : "#e2e8f0"} opacity={i === 2 ? 1 : 0.6} />
          <rect x={x - 12} y="352" width="24" height="5" rx="2.5" fill={i === 0 ? "#0f172a" : "#e2e8f0"} />
        </g>
      ))}
      {/* Active indicator */}
      <rect x="18" y="322" width="20" height="3" rx="1.5" fill="#0f172a" />
    </svg>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-sacro shadow-sm shrink-0">
              <Flame className="h-4 w-4 text-gold" />
            </div>
            <span className="font-serif text-base sm:text-lg font-semibold tracking-tight truncate">Lumen Pastoral</span>
          </Link>
          <nav className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Link
              to="/membro/login"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition"
            >
              <Users className="h-3.5 w-3.5" />
              Portal do servidor
            </Link>
            <Link
              to="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition"
            >
              Coordenação
            </Link>
            <Link
              to="/cadastro"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition"
            >
              Começar grátis
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Radial glow */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_50%_-5%,oklch(0.93_0.05_85/0.55),transparent)]" />
        {/* Grid texture */}
        <div
          className="absolute inset-0 -z-10 opacity-[0.025]"
          style={{ backgroundImage: "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
        />

        <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 sm:pt-24 lg:pt-28">
          <div className="flex flex-col items-center text-center">
            {/* Pill badge */}
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-soft px-3.5 py-1.5 text-xs font-semibold tracking-wide text-primary mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" />
              Plataforma para paróquias e dioceses
            </span>

            {/* Headline */}
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.05] text-foreground max-w-4xl">
              Gestão pastoral<br />
              <span className="relative">
                <span className="relative z-10">que serve à missão.</span>
                <span
                  className="absolute bottom-1 left-0 w-full h-3 -z-10 opacity-30 rounded"
                  style={{ background: "var(--gradient-gold)" }}
                />
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-muted-foreground">
              Escalas inteligentes, ministérios coordenados e calendário litúrgico integrado.
              Tudo em uma plataforma segura e multi-paróquia — para acólitos, cerimoniários e toda a coordenação pastoral.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md">
              <Link
                to="/cadastro"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground shadow-altar hover:opacity-90 active:scale-[0.98] transition"
              >
                Criar conta da paróquia
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-7 py-3.5 text-sm font-semibold text-foreground hover:bg-muted active:scale-[0.98] transition"
              >
                Já tenho conta
              </Link>
            </div>

            {/* Trust signals */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-5 text-xs text-muted-foreground">
              {[
                { icon: Lock, text: "Dados seguros por padrão" },
                { icon: Globe, text: "Multi-paróquia em nuvem" },
                { icon: Zap, text: "Escalas em segundos" },
              ].map(({ icon: Icon, text }) => (
                <span key={text} className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-gold shrink-0" />
                  {text}
                </span>
              ))}
            </div>
          </div>

          {/* Product mockup */}
          <div className="mt-14 mx-auto max-w-3xl rounded-2xl border border-border/60 shadow-altar overflow-hidden">
            <ProductMockup />
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-border/60 bg-muted/30 py-10">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { value: "100%", label: "Web e mobile", sub: "PWA para celular" },
              { value: "∞", label: "Membros", sub: "Sem limite de escala" },
              { value: "7", label: "Cores litúrgicas", sub: "Motor automático" },
              { value: "1", label: "Login para tudo", sub: "Coordenação e servidor" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="font-serif text-4xl font-bold text-foreground">{stat.value}</p>
                <p className="mt-1 text-sm font-semibold text-foreground/80">{stat.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features principais ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-14">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold mb-3">Funcionalidades</p>
          <h2 className="font-serif text-3xl sm:text-4xl text-foreground">Tudo que a coordenação precisa</h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
            Desenvolvido para a realidade das paróquias brasileiras — da missa cotidiana às solenidades.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              icon: Calendar,
              color: "bg-blue-500/10 text-blue-600",
              title: "Escalas inteligentes",
              desc: "Motor automático com balanceamento, regras litúrgicas, solenidades, novenas e Tríduos. Geração em um clique.",
              items: ["Balanceamento automático", "Solenidades e Tríduos", "Regras por ministério", "Publicação com notificação"],
            },
            {
              icon: Users,
              color: "bg-emerald-500/10 text-emerald-600",
              title: "Gestão de membros",
              desc: "Cadastro completo de acólitos e cerimoniários com perfis, funções e histórico de participação.",
              items: ["Portal de ativação por e-mail", "Ranking de participação", "Histórico de escalas", "Controle de funções"],
            },
            {
              icon: BookOpen,
              color: "bg-purple-500/10 text-purple-600",
              title: "Liturgia integrada",
              desc: "Calendário litúrgico automático com cores, tempo litúrgico e homilias diárias integradas.",
              items: ["Calendário litúrgico 2024-2030", "7 cores e tempos litúrgicos", "Homilia do dia", "Leituras do dia"],
            },
            {
              icon: Bell,
              color: "bg-rose-500/10 text-rose-600",
              title: "Notificações e avisos",
              desc: "Central de notificações com avisos urgentes, confirmações de presença e comunicados pastorais.",
              items: ["Confirmação de escala", "Avisos urgentes", "Comunicados em massa", "WhatsApp integrado"],
            },
            {
              icon: Trophy,
              color: "bg-amber-500/10 text-amber-600",
              title: "Ranking e formação",
              desc: "Sistema de pontuação para incentivar presença e participação em formações e eventos pastorais.",
              items: ["Score por participação", "Ranking da pastoral", "Eventos com pontuação", "Certificados"],
            },
            {
              icon: ShieldCheck,
              color: "bg-slate-500/10 text-slate-600",
              title: "Multi-paróquia seguro",
              desc: "Cada paróquia com dados isolados, papéis e permissões. Pronto para coordenação diocesana.",
              items: ["Isolamento por paróquia (RLS)", "MFA para administradores", "Auditoria de ações", "Backup automático"],
            },
          ].map((feat) => (
            <div key={feat.title} className="rounded-2xl border border-border bg-card p-6 flex flex-col hover:border-primary/20 hover:shadow-sm transition">
              <div className={`grid h-11 w-11 place-items-center rounded-xl mb-4 ${feat.color}`}>
                <feat.icon className="h-5 w-5" />
              </div>
              <h3 className="font-serif text-xl text-foreground mb-2">{feat.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">{feat.desc}</p>
              <ul className="space-y-1.5">
                {feat.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-gold shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Portal do membro — mobile showcase ── */}
      <section className="bg-gradient-sacro py-20 overflow-hidden">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold mb-3">Portal do servidor</p>
              <h2 className="font-serif text-3xl sm:text-4xl text-white leading-snug">
                O servidor na palma<br />da mão.
              </h2>
              <p className="mt-5 text-sm sm:text-base leading-relaxed text-white/60 max-w-md">
                Acólitos e cerimoniários têm um portal exclusivo no celular — sem app para instalar.
                Acesso às escalas, liturgia do dia e comunicados em tempo real.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { icon: Calendar, text: "Próxima escala sempre em destaque, com horário e função" },
                  { icon: Bell, text: "Notificações de escala e avisos urgentes da coordenação" },
                  { icon: BookOpen, text: "Liturgia do dia com cores e homilia integrada" },
                  { icon: Star, text: "Ranking de participação com pontuação gamificada" },
                  { icon: LayoutDashboard, text: "Confirmação de presença diretamente pelo celular" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="h-3.5 w-3.5 text-gold" />
                    </div>
                    <span className="text-sm text-white/80 leading-relaxed">{text}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  to="/membro/login"
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15 active:scale-[0.98] transition"
                >
                  <Users className="h-4 w-4" />
                  Acessar portal do servidor
                </Link>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <div className="relative w-64">
                {/* Glow behind phone */}
                <div className="absolute inset-0 -z-10 bg-gold/20 blur-3xl rounded-full scale-75 translate-y-8" />
                <MobileMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Como funciona ── */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center mb-14">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold mb-3">Como funciona</p>
          <h2 className="font-serif text-3xl sm:text-4xl text-foreground">Em 4 passos simples</h2>
        </div>
        <div className="grid gap-8 md:grid-cols-4">
          {[
            { step: "01", title: "Cadastre sua paróquia", desc: "Crie a conta em minutos. Nome, diocese e primeiro coordenador." },
            { step: "02", title: "Convide os servidores", desc: "Envie o link de ativação por e-mail ou WhatsApp. O membro ativa a conta sozinho." },
            { step: "03", title: "Configure as regras", desc: "Defina ministérios, funções, regras litúrgicas e frequência das missas." },
            { step: "04", title: "Gere as escalas", desc: "Um clique distribui automaticamente os servidores respeitando todas as regras." },
          ].map((s, i) => (
            <div key={s.step} className="relative text-center">
              {i < 3 && (
                <div className="hidden md:block absolute top-7 left-[60%] w-[40%] h-[1px] bg-border" />
              )}
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-soft border border-gold/20 mb-4">
                <span className="font-serif text-lg font-bold text-primary/80">{s.step}</span>
              </div>
              <h3 className="font-semibold text-sm text-foreground mb-2">{s.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl bg-gradient-sacro p-10 sm:p-14 text-center relative overflow-hidden">
          {/* Decorative dots */}
          <div className="absolute inset-0 -z-0 opacity-5"
            style={{ backgroundImage: "radial-gradient(circle, oklch(0.85 0.12 85) 1px, transparent 1px)", backgroundSize: "28px 28px" }}
          />
          <div className="relative z-10">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 mb-6 mx-auto">
              <Flame className="h-8 w-8 text-gold" />
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-white mb-4">
              Pronto para transformar<br className="hidden sm:block" /> a coordenação da sua paróquia?
            </h2>
            <p className="text-white/60 text-sm sm:text-base max-w-xl mx-auto mb-8 leading-relaxed">
              Cadastre sua paróquia e comece a usar hoje. Sem instalação, sem taxa de adesão.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/cadastro"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-bold text-primary shadow-gold hover:bg-white/95 active:scale-[0.98] transition"
              >
                Criar conta gratuita
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-8 py-3.5 text-sm font-semibold text-white hover:bg-white/15 active:scale-[0.98] transition"
              >
                Já tenho conta — Entrar
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-sacro shrink-0">
                <Flame className="h-3.5 w-3.5 text-gold" />
              </div>
              <div>
                <p className="font-serif text-sm font-semibold">Lumen Pastoral</p>
                <p className="text-[10px] text-muted-foreground">Plataforma de gestão pastoral</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <Link to="/login" className="hover:text-foreground transition">Coordenação</Link>
              <Link to="/membro/login" className="hover:text-foreground transition">Portal do servidor</Link>
              <Link to="/cadastro" className="hover:text-foreground transition">Cadastrar paróquia</Link>
            </nav>
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Lumen Pastoral
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}
