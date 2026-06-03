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
  refreshMembro: () => Promise<void>;
};

const MEMBRO_SELECT = `
  id, nome, email, telefone, data_nascimento, data_ingresso,
  score, paroquia_id, foto_url, tipo_acesso,
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
      setMembro(mapMembro(byEmail));
      // Vincula auth_user_id em background (requer política "membro_self_link")
      anyDb
        .from("membros")
        .update({ auth_user_id: userId })
        .eq("id", byEmail.id)
        .then(() => {/* best-effort */});
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
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          await init(u.id, u.email ?? undefined);
        } else {
          if (isMounted) setLoading(false);
        }
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

  const nivel: PortalNivel = isAdministrador ? "administrador" : "membro";

  return { user, membro, loading, linking, nivel, isAdministrador, refreshMembro };
}
