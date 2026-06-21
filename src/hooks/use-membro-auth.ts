import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export type MembroAuth = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  data_ingresso: string | null;
  score: number;
  paroquia_id: string;
  paroquia_nome: string;
  paroquia_slug: string | null;
  foto_url: string | null;
  tipo_acesso: string;
  conta_ativada: boolean;
  perfil_completo: boolean;
  ministerios: { id: string; nome: string; cor: string }[];
};

// Nível no portal: "administrador" tem aba de coordenação; "membro" é o padrão
export type PortalNivel = "administrador" | "membro";

type UseMembroAuth = {
  user: User | null;
  membro: MembroAuth | null;
  loading: boolean;
  linking: boolean;
  nivel: PortalNivel;
  isAdministrador: boolean;
  /** true se membro tem tipo_acesso auxiliar/coordenador/administrador OU está na tabela coordenadores */
  isCoordenador: boolean;
  refreshMembro: () => Promise<void>;
};

const MEMBRO_SELECT = `
  id, nome, email, telefone, data_nascimento, data_ingresso,
  score, paroquia_id, foto_url, tipo_acesso, conta_ativada, perfil_completo,
  paroquias(nome, slug),
  membro_ministerios(ministerios(id, nome, cor))
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMembro(data: any): MembroAuth {
  return {
    id: data.id,
    nome: data.nome,
    email: data.email,
    telefone: data.telefone,
    data_nascimento: data.data_nascimento,
    data_ingresso: data.data_ingresso,
    score: data.score ?? 0,
    paroquia_id: data.paroquia_id,
    paroquia_nome: data.paroquias?.nome ?? "",
    paroquia_slug: data.paroquias?.slug ?? null,
    foto_url: data.foto_url,
    tipo_acesso: data.tipo_acesso ?? "membro",
    conta_ativada: data.conta_ativada ?? false,
    perfil_completo: data.perfil_completo ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ministerios: (data.membro_ministerios ?? []).map((mm: any) => mm.ministerios).filter(Boolean),
  };
}

const ADMIN_ROLES = ["admin_paroquial", "super_admin", "coordenador"] as const;

export function useMembroAuth(): UseMembroAuth {
  const [user, setUser] = useState<User | null>(null);
  const [membro, setMembro] = useState<MembroAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [isInCoordTable, setIsInCoordTable] = useState(false);

  async function fetchCoordStatus(membroId: string, paroquiaId: string, tipoAcesso: string) {
    if (["auxiliar", "coordenador", "administrador"].includes(tipoAcesso)) {
      setIsInCoordTable(true);
      return;
    }
    const { data } = await anyDb
      .from("coordenadores")
      .select("id")
      .eq("membro_id", membroId)
      .eq("paroquia_id", paroquiaId)
      .eq("ativo", true)
      .maybeSingle();
    setIsInCoordTable(!!data);
  }

  // Carrega membro: tenta por auth_user_id (rápido) e depois por email (fallback)
  async function loadMembro(userId: string, userEmail?: string): Promise<boolean> {
    // 1. Busca por auth_user_id — funciona para membros já vinculados
    const { data: byId } = await anyDb
      .from("membros")
      .select(MEMBRO_SELECT)
      .eq("auth_user_id", userId)
      .eq("ativo", true)
      .maybeSingle();

    if (byId) {
      setMembro(mapMembro(byId));
      fetchCoordStatus(byId.id, byId.paroquia_id, byId.tipo_acesso);
      return true;
    }

    // 2. Busca por email — funciona para primeiro acesso (requer política "membro_read_own")
    const email = userEmail ?? (await supabase.auth.getUser()).data.user?.email;
    if (!email) {
      setMembro(null);
      return false;
    }

    const { data: byEmail } = await anyDb
      .from("membros")
      .select(MEMBRO_SELECT)
      .ilike("email", email.trim())
      .eq("ativo", true)
      .maybeSingle();

    if (byEmail) {
      // ── CORREÇÍO CRÍTICA: link SÍNCRONO via RPC, setMembro APÓS o link ────
      // IMPORTANTE: setMembro() é chamado DEPOIS do RPC, não antes.
      // Se setMembro() fosse chamado primeiro, React re-renderizaria imediatamente
      // com auth_user_id=NULL no banco → as queries de comunidades/atuações
      // disparariam antes do link estar concluído → RLS retornaria vazio.
      // Chamando o RPC primeiro, garantimos que quando React re-renderizar,
      // auth_user_id já está definido no banco e as políticas RLS passam.
      try {
        const { error: linkError } = await anyDb.rpc("portal_auto_link_by_email");
        if (linkError) {
          // RPC falhou — tenta fallback direto
          throw linkError;
        }
      } catch {
        await anyDb
          .from("membros")
          .update({ auth_user_id: userId })
          .eq("id", byEmail.id)
          .catch(() => {/* silencioso — fallback melhor esforço */});
      }

      // Re-fetch após o link: auth_user_id já está definido → policies RLS passam
      const { data: refreshed } = await anyDb
        .from("membros")
        .select(MEMBRO_SELECT)
        .eq("auth_user_id", userId)
        .eq("ativo", true)
        .maybeSingle();

      const membroData = refreshed ?? byEmail;
      setMembro(mapMembro(membroData));
      fetchCoordStatus(membroData.id, membroData.paroquia_id, membroData.tipo_acesso);
      return true;
    }

    setMembro(null);
    return false;
  }

  async function tryLink(userId: string, userEmail?: string): Promise<void> {
    setLinking(true);
    try {
      // Primeiro tenta RPC (bypassa RLS, mais confiável se existir)
      const { data: rpcData } = await anyDb.rpc("portal_auto_link_by_email");
      if (rpcData?.success) {
        await loadMembro(userId, userEmail);
        setLinking(false);
        return;
      }
    } catch {
      // RPC pode não existir ou falhar — continua para loadMembro com email
    }

    // Fallback: loadMembro já faz busca por email internamente
    await loadMembro(userId, userEmail);
    setLinking(false);
  }

  async function fetchRoles(userId: string): Promise<void> {
    const { data } = await anyDb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    setUserRoles((data ?? []).map((r: { role: string }) => r.role));
  }

  async function init(userId: string, userEmail?: string) {
    await Promise.all([
      loadMembro(userId, userEmail).then((found) => {
        if (!found) return tryLink(userId, userEmail);
      }),
      fetchRoles(userId),
    ]);
    setLoading(false);
  }

  async function refreshMembro() {
    if (user) await loadMembro(user.id, user.email ?? undefined);
  }

  useEffect(() => {
    let isMounted = true;

    async function start() {
      try {
        // Detecta magic link no hash ANTES de getSession().
        // Se o hash tiver access_token, a sessão está sendo estabelecida
        // assincronamente pelo cliente Supabase. Não marcar loading=false
        // ainda: onAuthStateChange SIGNED_IN vai cuidar disso.
        const hasAuthHash = typeof window !== "undefined" &&
          window.location.hash.includes("access_token=");

        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          await init(u.id, u.email ?? undefined);
        } else if (!hasAuthHash) {
          // Sem sessão e sem hash pendente → definitivamente não logado
          if (isMounted) setLoading(false);
        }
        // Se !u && hasAuthHash: mantém loading=true até SIGNED_IN chegar
      } catch {
        if (isMounted) setLoading(false);
      }
    }

    start();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        Promise.all([
          loadMembro(u.id, u.email ?? undefined).catch(() => null),
          fetchRoles(u.id).catch(() => null),
        ]).finally(() => { if (isMounted) setLoading(false); });
      } else {
        setMembro(null);
        setUserRoles([]);
        setIsInCoordTable(false);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nível 2 — Administrador: tipo_acesso "auxiliar" no membros (fonte primária)
  // user_roles é mantido como fallback para usuários sem membro vinculado.
  const isAdministrador =
    membro?.tipo_acesso === "auxiliar" ||
    (userRoles.includes("auxiliar") && !ADMIN_ROLES.some((r) => userRoles.includes(r)));

  const isCoordenador = isAdministrador || isInCoordTable;

  const nivel: PortalNivel = isAdministrador ? "administrador" : "membro";

  return { user, membro, loading, linking, nivel, isAdministrador, isCoordenador, refreshMembro };
}
