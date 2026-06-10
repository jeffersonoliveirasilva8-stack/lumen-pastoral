import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, AlertCircle, User, Phone, Calendar,
  MapPin, Users, ChevronRight, Flame,
} from "lucide-react";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { checkProfileCompleteness } from "@/lib/profile-completeness";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/completar-cadastro")({
  component: CompletarCadastroPage,
  head: () => ({ meta: [{ title: "Completar Cadastro — Portal do Servidor" }] }),
});

type AtuacaoOpt = { id: string; nome: string; cor: string };
type ComunidadeOpt = { id: string; nome: string };

function CompletarCadastroPage() {
  const { membro } = useMembroAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Campos do formulário
  const [telefone, setTelefone] = useState("");
  const [dataNasc, setDataNasc] = useState("");
  const [sexo, setSexo] = useState("");
  const [comunidadeId, setComunidadeId] = useState("");
  const [atuacaoIds, setAtuacaoIds] = useState<string[]>([]);

  // Busca dados extras do membro (sexo, comunidade_id, atuações)
  const { data: extra, isLoading: loadingExtra } = useQuery({
    queryKey: ["completar-extra", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const [membroRes, atuacoesRes] = await Promise.all([
        anyDb
          .from("membros")
          .select("sexo, comunidade_id, telefone, data_nascimento")
          .eq("id", membro!.id)
          .single(),
        anyDb
          .from("membro_atuacoes")
          .select("atuacao_id")
          .eq("membro_id", membro!.id),
      ]);
      return {
        sexo: membroRes.data?.sexo ?? "",
        comunidade_id: membroRes.data?.comunidade_id ?? "",
        telefone: membroRes.data?.telefone ?? "",
        data_nascimento: membroRes.data?.data_nascimento ?? "",
        atuacao_ids: (atuacoesRes.data ?? []).map(
          (a: { atuacao_id: string }) => a.atuacao_id,
        ),
      };
    },
  });

  // Opções para seletores
  const { data: comunidades = [] } = useQuery<ComunidadeOpt[]>({
    queryKey: ["completar-comunidades", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunidades")
        .select("id, nome")
        .eq("paroquia_id", membro!.paroquia_id)
        .order("nome");
      return data ?? [];
    },
  });

  const { data: atuacoes = [] } = useQuery<AtuacaoOpt[]>({
    queryKey: ["completar-atuacoes", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome, cor")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      return data ?? [];
    },
  });

  // Pré-preenche formulário com dados existentes
  useEffect(() => {
    if (extra) {
      setTelefone(membro?.telefone ?? extra.telefone ?? "");
      setDataNasc(membro?.data_nascimento ?? extra.data_nascimento ?? "");
      setSexo(extra.sexo ?? "");
      setComunidadeId(extra.comunidade_id ?? "");
      setAtuacaoIds(extra.atuacao_ids ?? []);
    }
  }, [extra, membro]);

  function toggleAtuacao(id: string) {
    setAtuacaoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const completeness = checkProfileCompleteness({
    nome: membro?.nome,
    telefone,
    data_nascimento: dataNasc,
    sexo,
    comunidade_id: comunidadeId,
    has_atuacao: atuacaoIds.length > 0,
  });

  async function handleSalvar() {
    if (!membro) return;

    if (!telefone.trim()) { toast.error("Telefone é obrigatório."); return; }
    if (!dataNasc) { toast.error("Data de nascimento é obrigatória."); return; }
    if (!sexo) { toast.error("Selecione o sexo."); return; }
    if (!comunidadeId && comunidades.length > 0) {
      toast.error("Selecione a comunidade."); return;
    }
    if (atuacaoIds.length === 0 && atuacoes.length > 0) {
      toast.error("Selecione ao menos uma atuação pastoral."); return;
    }

    setSaving(true);
    try {
      // Salva campos pessoais
      const { error: errMembro } = await anyDb
        .from("membros")
        .update({
          telefone: telefone.trim() || null,
          data_nascimento: dataNasc || null,
          sexo: sexo || null,
          comunidade_id: comunidadeId || null,
        })
        .eq("id", membro.id);
      if (errMembro) throw errMembro;

      // Sincroniza atuações pastorais: remove todas e reinserye
      await anyDb.from("membro_atuacoes").delete().eq("membro_id", membro.id);

      if (atuacaoIds.length > 0) {
        const inserts = atuacaoIds.map((aid) => ({
          membro_id: membro.id,
          atuacao_id: aid,
          paroquia_id: membro.paroquia_id,
        }));
        const { error: errAt } = await anyDb.from("membro_atuacoes").insert(inserts);
        if (errAt) throw errAt;
      }

      // Invalida queries de completude e membro
      qc.invalidateQueries({ queryKey: ["profile-completeness"] });
      qc.invalidateQueries({ queryKey: ["completar-extra"] });

      toast.success("Cadastro completado com sucesso!");
      navigate({ to: "/portal-membro/home" });
    } catch (e: unknown) {
      toast.error("Erro ao salvar: " + ((e as Error).message ?? "tente novamente."));
    } finally {
      setSaving(false);
    }
  }

  if (loadingExtra || !membro) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto pb-24">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-white shadow-sm">
            <Flame className="h-3.5 w-3.5" />
          </div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Portal do Servidor
          </p>
        </div>
        <h1 className="font-serif text-2xl">Completar Cadastro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Olá, {membro.nome.split(" ")[0]}! Algumas informações ainda estão
          pendentes. Preencha os campos abaixo para continuar usando o sistema.
        </p>
      </div>

      {/* Barra de progresso */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Completude do perfil
          </p>
          <span
            className={`text-xs font-bold ${
              completeness.percentage === 100
                ? "text-green-600"
                : completeness.percentage >= 60
                ? "text-amber-600"
                : "text-destructive"
            }`}
          >
            {completeness.percentage}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              completeness.percentage === 100
                ? "bg-green-500"
                : completeness.percentage >= 60
                ? "bg-amber-500"
                : "bg-destructive"
            }`}
            style={{ width: `${completeness.percentage}%` }}
          />
        </div>
        {completeness.missingFields.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {completeness.missingFields.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20"
              >
                <AlertCircle className="h-3 w-3" />
                {f}
              </span>
            ))}
          </div>
        )}
        {completeness.complete && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-semibold">Perfil completo — pronto para salvar!</span>
          </div>
        )}
      </div>

      {/* Formulário */}
      <div className="space-y-5">
        {/* Telefone */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            <Phone className="h-3 w-3" /> Telefone / WhatsApp *
          </label>
          <input
            type="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(00) 00000-0000"
            className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>

        {/* Data de nascimento */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            <Calendar className="h-3 w-3" /> Data de nascimento *
          </label>
          <input
            type="date"
            value={dataNasc}
            onChange={(e) => setDataNasc(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>

        {/* Sexo */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            <User className="h-3 w-3" /> Sexo *
          </label>
          <div className="flex gap-3">
            {[{ v: "M", label: "Masculino" }, { v: "F", label: "Feminino" }].map(
              ({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSexo(v)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition ${
                    sexo === v
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Comunidade */}
        {comunidades.length > 0 && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              <MapPin className="h-3 w-3" /> Comunidade *
            </label>
            <select
              value={comunidadeId}
              onChange={(e) => setComunidadeId(e.target.value)}
              className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 appearance-none"
            >
              <option value="">Selecione a comunidade…</option>
              {comunidades.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Atuação pastoral */}
        {atuacoes.length > 0 && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              <Users className="h-3 w-3" /> Atuação Pastoral *
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Selecione ao menos uma função que você exerce na pastoral.
            </p>
            <div className="flex flex-wrap gap-2">
              {atuacoes.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAtuacao(a.id)}
                  className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition ${
                    atuacaoIds.includes(a.id)
                      ? "text-white border-transparent"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  style={
                    atuacaoIds.includes(a.id)
                      ? { backgroundColor: a.cor, borderColor: a.cor }
                      : {}
                  }
                >
                  {atuacaoIds.includes(a.id) && <span>✓</span>}
                  {a.nome}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Aviso */}
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
        <p className="font-semibold mb-0.5">Por que isso é necessário?</p>
        <p>
          O Motor Inteligente de Escalas utiliza sua comunidade e atuação
          pastoral para atribuir você às missas corretamente. Sem esses dados,
          você não será incluído nas escalas automaticamente.
        </p>
      </div>

      {/* Botão */}
      <button
        type="button"
        disabled={saving}
        onClick={handleSalvar}
        className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        Salvar e continuar
      </button>
    </div>
  );
}
