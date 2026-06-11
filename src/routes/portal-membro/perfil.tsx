import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Loader2, User, Save, Star, Calendar, Phone, Shield, Camera } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MfaSetup } from "@/components/security/MfaSetup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const FOTO_BUCKET = "membros-fotos";

export const Route = createFileRoute("/portal-membro/perfil")({
  component: PortalMembroPerfil,
  head: () => ({ meta: [{ title: "Meu Perfil — Portal do Servidor" }] }),
});

type MembroCompleto = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  data_ingresso: string | null;
  cpf: string | null;
  rg: string | null;
  endereco: string | null;
  cidade: string | null;
  cep: string | null;
  nome_pai: string | null;
  nome_mae: string | null;
  nome_emergencia: string | null;
  telefone_emergencia: string | null;
  observacoes: string | null;
  foto_url: string | null;
  score: number;
  atuacoes: { id: string; nome: string; cor: string }[];
};

type FormData = {
  nome: string;
  telefone: string;
  data_nascimento: string;
  cpf: string;
  rg: string;
  endereco: string;
  cidade: string;
  cep: string;
  nome_pai: string;
  nome_mae: string;
  nome_emergencia: string;
  telefone_emergencia: string;
  observacoes: string;
};

function PortalMembroPerfil() {
  const { membro, refreshMembro } = useMembroAuth();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [localFotoUrl, setLocalFotoUrl] = useState<string | null>(null);

  const { data: membroData, isLoading } = useQuery<MembroCompleto | null>({
    queryKey: ["pm-perfil", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("membros")
        .select(`
          id, nome, email, telefone, data_nascimento, data_ingresso,
          cpf, rg, endereco, cidade, cep,
          nome_pai, nome_mae,
          nome_emergencia, telefone_emergencia,
          observacoes, foto_url, score,
          membro_atuacoes(atuacoes_pastorais(id, nome, cor))
        `)
        .eq("id", membro!.id)
        .single();
      if (error) throw error;
      return {
        ...data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        atuacoes: (data.membro_atuacoes ?? []).map((ma: any) => ma.atuacoes_pastorais).filter(Boolean),
      };
    },
  });

  const [form, setForm] = useState<FormData>({
    nome: "", telefone: "", data_nascimento: "",
    cpf: "", rg: "", endereco: "", cidade: "", cep: "",
    nome_pai: "", nome_mae: "",
    nome_emergencia: "", telefone_emergencia: "", observacoes: "",
  });

  useEffect(() => {
    if (membroData) {
      setForm({
        nome: membroData.nome ?? "",
        telefone: membroData.telefone ?? "",
        data_nascimento: membroData.data_nascimento ?? "",
        cpf: membroData.cpf ?? "",
        rg: membroData.rg ?? "",
        endereco: membroData.endereco ?? "",
        cidade: membroData.cidade ?? "",
        cep: membroData.cep ?? "",
        nome_pai: membroData.nome_pai ?? "",
        nome_mae: membroData.nome_mae ?? "",
        nome_emergencia: membroData.nome_emergencia ?? "",
        telefone_emergencia: membroData.telefone_emergencia ?? "",
        observacoes: membroData.observacoes ?? "",
      });
      setLocalFotoUrl(membroData.foto_url ?? null);
    }
  }, [membroData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Nome é obrigatório.");
      if (form.data_nascimento) {
        const hoje = new Date().toISOString().slice(0, 10);
        if (form.data_nascimento > hoje) throw new Error("Data de nascimento não pode ser no futuro.");
      }

      const payload = {
        nome: form.nome.trim(),
        telefone: form.telefone || null,
        data_nascimento: form.data_nascimento || null,
        cpf: form.cpf || null,
        rg: form.rg || null,
        endereco: form.endereco || null,
        cidade: form.cidade || null,
        cep: form.cep || null,
        nome_pai: form.nome_pai || null,
        nome_mae: form.nome_mae || null,
        nome_emergencia: form.nome_emergencia || null,
        telefone_emergencia: form.telefone_emergencia || null,
        observacoes: form.observacoes || null,
      };

      // Tenta RPC SECURITY DEFINER (garante sync mesmo sem auth_user_id correto).
      // PGRST202 = função não encontrada → patch SQL ainda não aplicado → fallback direto.
      const { data: result, error: rpcError } = await anyDb.rpc("atualizar_perfil_membro", {
        p_nome:                payload.nome,
        p_telefone:            payload.telefone,
        p_data_nascimento:     payload.data_nascimento,
        p_cpf:                 payload.cpf,
        p_rg:                  payload.rg,
        p_endereco:            payload.endereco,
        p_cidade:              payload.cidade,
        p_cep:                 payload.cep,
        p_nome_pai:            payload.nome_pai,
        p_nome_mae:            payload.nome_mae,
        p_nome_emergencia:     payload.nome_emergencia,
        p_telefone_emergencia: payload.telefone_emergencia,
        p_observacoes:         payload.observacoes,
      });

      if (!rpcError) {
        if (result && !result.success) throw new Error(result.error ?? "Erro ao salvar perfil.");
        return;
      }

      // Fallback: UPDATE direto (funciona quando PATCH_O ainda não foi aplicado)
      if (rpcError.code === "PGRST202" || rpcError.message?.includes("atualizar_perfil_membro")) {
        const { error: updateError } = await anyDb
          .from("membros")
          .update(payload)
          .eq("id", membro!.id);
        if (updateError) throw updateError;
        return;
      }

      throw rpcError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-perfil"] });
      refreshMembro();
      toast.success("Perfil atualizado.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !membro) return;

    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Foto deve ter no máximo ${maxMb}MB.`);
      return;
    }

    setUploadingPhoto(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${membro.id}/foto.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(FOTO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      toast.error("Erro ao enviar foto: " + upErr.message);
      setUploadingPhoto(false);
      return;
    }

    const { data: urlData } = supabase.storage.from(FOTO_BUCKET).getPublicUrl(path);
    const url = urlData.publicUrl + `?t=${Date.now()}`;

    const { error: dbErr } = await anyDb
      .from("membros")
      .update({ foto_url: url })
      .eq("id", membro.id);

    setUploadingPhoto(false);
    if (dbErr) {
      toast.error("Foto enviada mas falhou ao salvar URL.");
    } else {
      setLocalFotoUrl(url);
      qc.invalidateQueries({ queryKey: ["pm-perfil"] });
      refreshMembro();
      toast.success("Foto atualizada.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function set(key: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  if (isLoading || !membroData) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fotoDisplay = localFotoUrl ?? membroData.foto_url;

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto pb-24">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
        <h1 className="mt-1.5 font-serif text-3xl">Meu Perfil</h1>
      </div>

      {/* Status card */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {/* Avatar / foto */}
          <div className="relative shrink-0">
            <div className="h-20 w-20 sm:h-16 sm:w-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
              {fotoDisplay ? (
                <img src={fotoDisplay} alt="Foto" className="h-full w-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-primary" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:opacity-90 transition disabled:opacity-60"
              title="Alterar foto"
            >
              {uploadingPhoto
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Camera className="h-3 w-3" />
              }
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>

          <div className="min-w-0 text-center sm:text-left">
            <p className="font-semibold truncate">{membroData.nome}</p>
            <p className="text-xs text-muted-foreground">{membroData.email}</p>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1 text-xs">
                <Star className="h-3 w-3 text-amber-500" />
                <span className="font-medium">{membroData.score} pts</span>
              </div>
              {membroData.data_ingresso && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>Desde {format(new Date(membroData.data_ingresso + "T12:00:00"), "MMM yyyy", { locale: ptBR })}</span>
                </div>
              )}
            </div>
            {membroData.atuacoes.length > 0 && (
              <div className="mt-2">
                <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1">Atuação Pastoral</p>
                <div className="flex flex-wrap gap-1">
                  {membroData.atuacoes.map((a) => (
                    <span
                      key={a.id}
                      className="text-[10px] px-1.5 py-px rounded-full font-medium"
                      style={{ backgroundColor: a.cor + "25", color: a.cor }}
                    >
                      {a.nome}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit form */}
      <form
        onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}
        className="space-y-5"
      >
        {/* Dados pessoais */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <User className="h-3.5 w-3.5" /> Dados pessoais
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="nome">Nome completo</Label>
              <Input id="nome" value={form.nome} onChange={set("nome")} className="mt-1" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="telefone" className="flex items-center gap-1"><Phone className="h-3 w-3" />Telefone</Label>
                <Input id="telefone" value={form.telefone} onChange={set("telefone")} className="mt-1" placeholder="(00) 00000-0000" />
              </div>
              <div>
                <Label htmlFor="data_nascimento">Nascimento</Label>
                <Input id="data_nascimento" type="date" value={form.data_nascimento} onChange={set("data_nascimento")} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cpf">CPF</Label>
                <Input id="cpf" value={form.cpf} onChange={set("cpf")} className="mt-1" placeholder="000.000.000-00" />
              </div>
              <div>
                <Label htmlFor="rg">RG</Label>
                <Input id="rg" value={form.rg} onChange={set("rg")} className="mt-1" placeholder="00.000.000-0" />
              </div>
            </div>
          </div>
        </section>

        {/* Filiação */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Filiação
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="nome_pai">Nome do pai</Label>
              <Input id="nome_pai" value={form.nome_pai} onChange={set("nome_pai")} className="mt-1" placeholder="Nome completo do pai" />
            </div>
            <div>
              <Label htmlFor="nome_mae">Nome da mãe</Label>
              <Input id="nome_mae" value={form.nome_mae} onChange={set("nome_mae")} className="mt-1" placeholder="Nome completo da mãe" />
            </div>
          </div>
        </section>

        {/* Endereço */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Endereço
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="endereco">Endereço</Label>
              <Input id="endereco" value={form.endereco} onChange={set("endereco")} className="mt-1" placeholder="Rua, número, complemento" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" value={form.cidade} onChange={set("cidade")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cep">CEP</Label>
                <Input id="cep" value={form.cep} onChange={set("cep")} className="mt-1" placeholder="00000-000" />
              </div>
            </div>
          </div>
        </section>

        {/* Emergência */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" /> Contato de emergência
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nome_emergencia">Nome</Label>
              <Input id="nome_emergencia" value={form.nome_emergencia} onChange={set("nome_emergencia")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="telefone_emergencia">Telefone</Label>
              <Input id="telefone_emergencia" value={form.telefone_emergencia} onChange={set("telefone_emergencia")} className="mt-1" />
            </div>
          </div>
        </section>

        {/* Observações */}
        <section>
          <Label htmlFor="observacoes">Observações</Label>
          <Textarea
            id="observacoes"
            value={form.observacoes}
            onChange={set("observacoes")}
            className="mt-1"
            rows={3}
            placeholder="Informações adicionais…"
          />
        </section>

        <Button type="submit" disabled={saveMutation.isPending} className="w-full">
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar alterações
        </Button>
      </form>

      {/* ── Segurança ── */}
      <div className="mt-8">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" /> Segurança
          </p>
          <MfaSetup />
        </div>
      </div>
    </div>
  );
}
