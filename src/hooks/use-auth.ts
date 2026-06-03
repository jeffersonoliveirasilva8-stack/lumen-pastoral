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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setRoles([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    const [{ data: profileData }, { data: rolesData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile(profileData as Profile | null);
    setRoles((rolesData ?? []).map((r: { role: string }) => r.role));
    setLoading(false);
  }

  async function refreshProfile() {
    if (!user) return;
    await fetchProfile(user.id);
  }

  // Nível 1 — Coordenação: acesso total ao painel pastoral
  const isAdmin = roles.some((r) => r === "admin_paroquial" || r === "super_admin");
  const isCoordenador = roles.some((r) => r === "coordenador");

  // Nível 2 — Administrador: portal do membro + confirmação de presenças nas suas escalas
  const isAuxiliar = roles.some((r) => r === "auxiliar");

  // Nível 3 — Membro: portal padrão
  // 'servidor' = legado de 'membro'

  // Qualquer papel que deve ir para o portal do membro (não o painel admin)
  // isAuxiliar puro (sem coordenação) → portal com capacidades extras
  const isServidor = roles.length > 0 && roles.every((r) =>
    r === "servidor" || r === "membro" || r === "auxiliar"
  );

  // Flag para capacidades de coordenação/supervisão dentro do portal do membro
  const isAdministrador = isAuxiliar && !isAdmin && !isCoordenador;

  // Qualquer papel com acesso ao painel admin (necessário para guarda do onboarding)
  const hasAdminAccess = isAdmin || isCoordenador || isAuxiliar;

  return { user, profile, loading, roles, isServidor, isAdmin, isCoordenador, isAuxiliar, isAdministrador, hasAdminAccess, refreshProfile };
}
