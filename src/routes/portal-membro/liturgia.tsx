/**
 * LiturgiaDiariaPage — Lectionary digital
 * Design: contemplativo, mobile-first, tipografia litúrgica
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Play, ChevronLeft, BookOpen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useLiturgiaProximos, refLeitura1, refSalmo, refLeitura2, refEvangelho,
} from "@/hooks/use-liturgia";
import { useHomiliaRecente } from "@/hooks/use-homilia";
import type { LiturgiaRow } from "@/hooks/use-liturgia";
import type { HomiliaRow } from "@/hooks/use-homilia";

export const Route = createFileRoute("/portal-membro/liturgia")({
  component: LiturgiaDiariaPage,
  head: () => ({ meta: [{ title: "Liturgia do Dia" }] }),
});

// ── Paleta litúrgica ──────────────────────────────────────────────────────────

const COR: Record<string, { hex: string; bg: string; text: string; border: string }> = {
  verde:    { hex: "#2d6a4f", bg: "bg-green-50",  text: "text-green-900",  border: "border-green-200" },
  roxo:     { hex: "#5b21b6", bg: "bg-violet-50", text: "text-violet-900", border: "border-violet-200" },
  branco:   { hex: "#78716c", bg: "bg-stone-50",  text: "text-stone-800",  border: "border-stone-200" },
  vermelho: { hex: "#991b1b", bg: "bg-red-50",    text: "text-red-900",    border: "border-red-200" },
  rosa:     { hex: "#9d174d", bg: "bg-pink-50",   text: "text-pink-900",   border: "border-pink-200" },
  preto:    { hex: "#292524", bg: "bg-neutral-50", text: "text-neutral-900", border: "border-neutral-300" },
  dourado:  { hex: "#92400e", bg: "bg-amber-50",  text: "text-amber-900",  border: "border-amber-200" },
};

const TEMPO_LABEL: Record<string, string> = {
  advento: "Tempo do Advento", natal: "Tempo do Natal",
  quaresma: "Tempo da Quaresma", triduo: "Tríduo Pascal",
  pascoa: "Tempo Pascal", comum: "Tempo Comum",
};

const GRAU_LABEL: Record<string, string> = {
  solenidade: "Solenidade", festa: "Festa",
  memorial: "Memória Obrigatória", memorial_facultativo: "Memória Facultativa",
  comemoracao: "Comemoração",
};

// ── Utilitários ───────────────────────────────────────────────────────────────

function parags(txt: string): string[] {
  return txt.split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 3);
}

/**
 * Parseia o salmo em antífonas ("R.") e estrofes (grupos de versículos).
 * Preserva a quebra de linhas para renderização em estrofe como na CNBB.
 */
type SalmoBloco =
  | { tipo: "antifona"; texto: string }
  | { tipo: "estrofe"; linhas: string[] };

function parseSalmo(txt: string): SalmoBloco[] {
  const pars = txt.split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean);
  const resultado: SalmoBloco[] = [];

  for (const par of pars) {
    const ehAntifona = /^(R[./]|\*)\s*/i.test(par.split("\n")[0].trim());
    if (ehAntifona) {
      resultado.push({ tipo: "antifona", texto: par.replace(/^(R[./]|\*)\s*/i, "").trim() });
    } else {
      const linhas = par.split("\n").map((l) => l.trim()).filter(Boolean);
      if (linhas.length > 0) resultado.push({ tipo: "estrofe", linhas });
    }
  }

  if (!resultado.some((b) => b.tipo === "antifona")) {
    return [{ tipo: "estrofe", linhas: txt.split("\n").map((l) => l.trim()).filter(Boolean) }];
  }
  return resultado;
}

function getPaleta(cor: string) {
  return COR[cor] ?? COR.verde;
}

// ── Label de seção ────────────────────────────────────────────────────────────

function SecaoLabel({ texto, cor }: { texto: string; cor: string }) {
  const { hex } = getPaleta(cor);
  return (
    <div className="flex items-center gap-3 mb-5">
      <p
        className="text-[10px] font-bold uppercase tracking-[0.35em] shrink-0 whitespace-nowrap"
        style={{ color: hex }}
      >
        {texto}
      </p>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── Texto bíblico com expansão ────────────────────────────────────────────────

function BlocoTexto({
  referencia, texto, tipo, cor,
}: {
  referencia: string | null;
  texto: string | null;
  tipo: "leitura" | "salmo" | "evangelho";
  cor: string;
}) {
  const { hex } = getPaleta(cor);
  const temTexto = !!texto;
  const isSalmo  = tipo === "salmo";
  const isGospel = tipo === "evangelho";

  const salmoData = useMemo(
    () => (isSalmo && texto ? parseSalmo(texto) : null),
    [isSalmo, texto]
  );
  const blocos = useMemo(
    () => (!isSalmo && texto ? parags(texto) : null),
    [isSalmo, texto]
  );

  const textoCls = "text-[15px] leading-[1.85] text-foreground/90";

  if (!referencia) return null;

  return (
    <div className={isGospel ? "rounded-2xl overflow-hidden border border-border/60" : ""}>
      {/* Cabeçalho do Evangelho */}
      {isGospel && (
        <div
          className="px-5 py-4 flex items-center justify-between gap-3"
          style={{ backgroundColor: hex + "12", borderLeft: `4px solid ${hex}` }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] mb-1" style={{ color: hex }}>
              ✝ Evangelho
            </p>
            <p className="font-serif font-semibold text-lg text-foreground">
              {referencia}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground/60 italic leading-snug">
              Glória a vós,<br />Senhor!
            </p>
          </div>
        </div>
      )}

      {/* Referência para leituras normais */}
      {!isGospel && (
        <p className="font-serif mb-4 text-lg text-foreground">
          {referencia}
        </p>
      )}

      {/* Texto */}
      <div className={isGospel ? "px-5 py-5" : ""}>
        {temTexto ? (
          <>
            {isSalmo && salmoData ? (
              <div className="space-y-5">
                {salmoData.map((bloco, i) =>
                  bloco.tipo === "antifona" ? (
                    /* Antífona */
                    <div
                      key={i}
                      className="rounded-xl px-4 py-3 text-center"
                      style={{ backgroundColor: hex + "10", border: `1px solid ${hex}30` }}
                    >
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest mr-2 opacity-50"
                        style={{ color: hex }}
                      >R.</span>
                      <span
                        className="font-serif font-medium text-[15px] leading-relaxed"
                        style={{ color: hex }}
                      >
                        {bloco.texto}
                      </span>
                    </div>
                  ) : (
                    /* Estrofe — cada linha é um versículo */
                    <div
                      key={i}
                      className="space-y-1 pl-4 border-l-2"
                      style={{ borderColor: hex + "40" }}
                    >
                      {bloco.linhas.map((linha, j) => (
                        <p key={j} className={textoCls}>{linha}</p>
                      ))}
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {blocos?.map((p, i) => (
                  <p key={i} className={textoCls}>{p}</p>
                ))}
              </div>
            )}

            {/* Resposta litúrgica */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/40">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: hex }}>
                {isGospel ? "Palavra da Salvação" : "Palavra do Senhor"}
              </p>
              <p className="text-[11px] font-serif italic text-muted-foreground">
                {isGospel ? "Glória a vós, Senhor!" : "Graças a Deus!"}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm italic text-muted-foreground/50 py-2">
            Texto em breve — sincronização ocorre às 02:30 UTC.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Aclamação ao Evangelho ────────────────────────────────────────────────────

function Aclamacao({ tempo, cor }: { tempo: string; cor: string }) {
  const { hex } = getPaleta(cor);
  const isQuaresma = tempo === "quaresma" || tempo === "triduo";
  return (
    <div className="text-center py-5">
      <p className="font-serif text-xl sm:text-2xl font-semibold" style={{ color: hex }}>
        {isQuaresma ? "Louvor e glória a vós, Senhor Jesus!" : "Aleluia, aleluia, aleluia!"}
      </p>
    </div>
  );
}

// ── Homilia ───────────────────────────────────────────────────────────────────

function HomiliaVideo({ homilia, cor }: { homilia: HomiliaRow | null; cor: string }) {
  const [player, setPlayer] = useState(false);
  const { hex } = getPaleta(cor);
  const hoje = format(new Date(), "yyyy-MM-dd");

  // Determina se é de hoje ou fallback de dia anterior
  const isHoje   = homilia?.data === hoje;
  const dataLabel = homilia
    ? isHoje
      ? format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: ptBR })
      : format(new Date(homilia.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })
    : null;

  return (
    <section>
      <SecaoLabel texto={isHoje ? "Homilia do Dia" : "Homilia Recente"} cor={cor} />

      {homilia ? (
        <div className="space-y-4">
          {/* Autor + data */}
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Play className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-none">
                {homilia.autor ?? "Padre Paulo Ricardo"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">{dataLabel}</p>
            </div>
          </div>

          {/* Badge quando for de dia anterior */}
          {!isHoje && (
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 inline-block">
              Homilia de hoje ainda não disponível — exibindo a mais recente
            </p>
          )}

          {/* Vídeo */}
          <div className="rounded-2xl overflow-hidden border border-border/50">
            {player ? (
              <div className="aspect-video">
                <iframe
                  src={`https://www.youtube.com/embed/${homilia.video_id}?autoplay=1&rel=0&modestbranding=1`}
                  title={homilia.titulo}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  className="w-full h-full"
                  loading="lazy"
                />
              </div>
            ) : (
              <button
                type="button"
                className="relative w-full aspect-video group block text-left"
                onClick={() => setPlayer(true)}
              >
                {homilia.thumbnail_url ? (
                  <img
                    src={homilia.thumbnail_url}
                    alt={homilia.titulo}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                  <div
                    className="h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
                    style={{ backgroundColor: hex }}
                  >
                    <Play className="h-5 w-5 text-white ml-0.5" />
                  </div>
                </div>
              </button>
            )}
          </div>

          {/* Título */}
          {homilia.titulo && (
            <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
              {homilia.titulo}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center space-y-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Play className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Homilia indisponível
          </p>
          <p className="text-xs text-muted-foreground/70 max-w-xs mx-auto leading-relaxed">
            Sincronização automática às 03:30 UTC (00:30 horário de Brasília).
          </p>
        </div>
      )}
    </section>
  );
}

// ── Card dia compacto ─────────────────────────────────────────────────────────

function DiaCompacto({ row }: { row: LiturgiaRow }) {
  const cor = row.cor ?? "verde";
  const { hex, bg, border } = getPaleta(cor);
  const ev  = refEvangelho(row);
  const d   = new Date(row.data + "T12:00:00");
  const label = format(d, "EEEE", { locale: ptBR });

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-4 space-y-1.5`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] capitalize" style={{ color: hex }}>
        {label} · {format(d, "d MMM", { locale: ptBR })}
      </p>
      <p className="font-serif text-sm text-foreground leading-snug line-clamp-2">{row.titulo}</p>
      {ev && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-semibold" style={{ color: hex }}>Ev.</span> {ev}
        </p>
      )}
    </div>
  );
}

// ── Rodapé com fonte ──────────────────────────────────────────────────────────

function RodapeAtribuicao() {
  return (
    <footer className="mt-12 pt-6 border-t border-border/40 text-center space-y-1 pb-8">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-[0.25em]">
        Fonte das leituras
      </p>
      <p className="text-xs text-muted-foreground/70">
        Textos litúrgicos © CNBB — Conferência Nacional dos Bispos do Brasil
      </p>
    </footer>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton_() {
  return (
    <div className="px-5 py-8 sm:px-8 max-w-prose mx-auto space-y-10">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-px flex-1" />
          </div>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ))}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

function LiturgiaDiariaPage() {
  const { data: liturgias = [], isLoading } = useLiturgiaProximos(3);
  const { data: homiliaRecente }            = useHomiliaRecente();

  // Aba ativa do menu horizontal de leituras
  const [abaAtiva, setAbaAtiva] = useState<string>("ev");

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const hoje   = format(new Date(), "yyyy-MM-dd");
  const amanha = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const dep    = format(addDays(new Date(), 2), "yyyy-MM-dd");

  const lit    = liturgias.find((l) => l.data === hoje)   ?? null;
  const litAmn = liturgias.find((l) => l.data === amanha) ?? null;
  const litDep = liturgias.find((l) => l.data === dep)    ?? null;
  const homHoje = homiliaRecente ?? null;

  const cor   = lit?.cor ?? "verde";
  const tempo = lit?.tempo_liturgico ?? "comum";
  const { hex, bg, border, text } = getPaleta(cor);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-1 w-full bg-muted animate-pulse" />
        <Skeleton_ />
      </div>
    );
  }

  if (!lit) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center">
        <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-4" />
        <p className="font-serif text-xl text-foreground mb-2">Liturgia indisponível</p>
        <p className="text-sm text-muted-foreground/70 max-w-xs">
          A sincronização ocorre às 02:30 UTC.
        </p>
        <Link to="/portal-membro/home" className="mt-5 text-sm text-primary hover:underline">
          ← Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">

      {/* ── Faixa de cor litúrgica ── */}
      <div className="h-1 w-full" style={{ backgroundColor: hex }} />

      {/* ── Cabeçalho ── */}
      <header className={`${bg} ${border} border-b px-5 pt-5 pb-6 sm:px-8`}>
        <div className="max-w-prose mx-auto">

          {/* Navegação */}
          <div className="mb-5">
            <Link
              to="/portal-membro/home"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Início
            </Link>
          </div>

          {/* Data */}
          <p className="text-[11px] uppercase tracking-[0.28em] font-medium mb-2" style={{ color: hex + "99" }}>
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>

          {/* Celebração */}
          <h1 className="page-header-title">
            {lit.titulo}
          </h1>
          {lit.santo && <p className="text-sm text-muted-foreground italic mt-0.5">{lit.santo}</p>}

          {/* Tags litúrgicas */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {tempo && (
              <span
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${text} ${border} ${bg}`}
              >
                {TEMPO_LABEL[tempo] ?? tempo}
              </span>
            )}
            {lit.grau && GRAU_LABEL[lit.grau] && (
              <span className="text-[11px] text-muted-foreground">
                {GRAU_LABEL[lit.grau]}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium"
              style={{ color: hex }}
            >
              <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: hex }} />
              Cor {lit.cor ? lit.cor.charAt(0).toUpperCase() + lit.cor.slice(1) : "—"}
            </span>
            {lit.e_dia_preceito && (
              <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                Dia de Preceito
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Conteúdo principal ── */}
      <main className="max-w-prose mx-auto px-5 sm:px-8 py-8 space-y-10 pb-24">

        {/* ── HOMILIA NO TOPO ── */}
        <HomiliaVideo homilia={homHoje} cor={cor} />

        {/* ── Menu horizontal de leituras ── */}
        {(() => {
          type Aba = { id: string; label: string; ref: string | null; texto: string | null; tipo: "leitura" | "salmo" | "evangelho" };
          const abas = [
            { id: "l1",    label: "1ª Leitura",  ref: refLeitura1(lit),  texto: lit.leitura_1_texto, tipo: "leitura"   },
            { id: "salmo", label: "Salmo",        ref: refSalmo(lit),     texto: lit.salmo_texto,     tipo: "salmo"     },
            ...(refLeitura2(lit) ? [{ id: "l2", label: "2ª Leitura", ref: refLeitura2(lit), texto: lit.leitura_2_texto, tipo: "leitura" }] : []),
            { id: "ev",    label: "Evangelho",    ref: refEvangelho(lit), texto: lit.evangelho_texto, tipo: "evangelho" },
          ].filter((a) => !!a.ref) as Aba[];

          const abaAtual = abas.find((a) => a.id === abaAtiva) ?? abas[abas.length - 1];

          return (
            <section className="space-y-5">
              {/* Tabs de navegação */}
              <div className="overflow-x-auto -mx-5 px-5 scrollbar-none">
                <div className="flex gap-1.5 min-w-max pb-1">
                  {abas.map((aba) => {
                    const isAtivo = abaAtiva === aba.id;
                    return (
                      <button
                        key={aba.id}
                        type="button"
                        onClick={() => setAbaAtiva(aba.id)}
                        className="flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all"
                        style={isAtivo
                          ? { backgroundColor: hex, color: "#fff" }
                          : { backgroundColor: "transparent", color: hex, border: `1px solid ${hex}40` }
                        }
                      >
                        {aba.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Conteúdo da aba ativa */}
              {abaAtual && (
                <div>
                  {abaAtual.tipo === "evangelho" && <Aclamacao tempo={tempo} cor={cor} />}
                  <BlocoTexto
                    referencia={abaAtual.ref}
                    texto={abaAtual.texto}
                    tipo={abaAtual.tipo}
                    cor={cor}
                  />
                </div>
              )}
            </section>
          );
        })()}

        {/* Próximos dias */}
        {(litAmn || litDep) && (
          <section>
            <SecaoLabel texto="Próximos Dias" cor={cor} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {litAmn && <DiaCompacto row={litAmn} />}
              {litDep  && <DiaCompacto row={litDep} />}
            </div>
          </section>
        )}

        {/* Rodapé com fonte */}
        <RodapeAtribuicao />
      </main>
    </div>
  );
}
