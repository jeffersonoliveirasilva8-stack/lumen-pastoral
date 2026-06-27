import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  nome_completo: string | null;
  email: string | null;
  telefone: string | null;
  avatar_url: string | null;
  paroquia_id: string | null;
  created_at: string;
  updated_at: string;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function start() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
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
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setRoles([]);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const [{ data: profileData }, { data: rolesData }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("user_roles").select("role").eq("user_id", userId),
      ]);
      setProfile(profileData as Profile | null);
      setRoles((rolesData ?? []).map((r: { role: string }) => r.role));
    } catch {
      setProfile(null);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshProfile() {
    if (!user) return;
    await fetchProfile(user.id);
  }

  // Nível 1 — Coordenador pleno: admin_paroquial / super_admin → acesso total
  const isAdmin = roles.some((r) => r === "admin_paroquial" || r === "super_admin");

  // Nível 2 — Vice-Coordenador: role='coordenador' em user_roles → acesso a escalas/membros/sacristia
  // (NÃO confundir com tipo_acesso='coordenador' — aqui é o role da tabela user_roles)
  const isCoordenador = roles.some((r) => r === "coordenador");

  // Nível 3 — Secretário/Auxiliar: role='lider' em user_roles → sacristia apenas
  // (tipo_acesso='auxiliar' no membro → role='lider' via admin_set_membro_acesso)
  const isLider = roles.some((r) => r === "lider");

  // Legado: 'auxiliar' nunca existiu no enum — isAuxiliar sempre foi false; mantido por compatibilidade
  const isAuxiliar = isLider;

  // Vai para o portal do membro (não o painel admin)
  const isServidor = roles.length > 0 && roles.every((r) =>
    r === "servidor" || r === "membro"
  );

  // Secretário puro → acesso ao painel admin só para sacristia das próprias escalas
  const isAdministrador = isLider && !isAdmin && !isCoordenador;

  // Qualquer papel com acesso ao painel admin
  const hasAdminAccess = isAdmin || isCoordenador || isLider;

  return { user, profile, loading, roles, isServidor, isAdmin, isCoordenador, isLider, isAuxiliar, isAdministrador, hasAdminAccess, refreshProfile };
}
