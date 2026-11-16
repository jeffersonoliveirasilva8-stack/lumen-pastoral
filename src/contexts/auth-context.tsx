import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
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

interface AuthState {
  user: User | null;
  profile: Profile | null;
  roles: string[];
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isCoordenador: boolean;
  isLider: boolean;
  isServidor: boolean;
  isAuxiliar: boolean;
  hasAdminAccess: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    roles: [],
    loading: true,
  });

  // Tracks which userId is currently being fetched — prevents duplicate queries.
  // When a fetch is in-flight for userId X, any concurrent call for X is a no-op.
  // A call for a different userId Y proceeds and the X fetch is discarded on completion.
  const fetchingForRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    if (fetchingForRef.current === userId) return;
    fetchingForRef.current = userId;

    try {
      const [{ data: profileData }, { data: rolesData }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("user_roles").select("role").eq("user_id", userId),
      ]);

      // Abort if the user changed while we were awaiting — stale data for old user
      if (fetchingForRef.current !== userId) return;

      setState((prev) => ({
        ...prev,
        profile: profileData as Profile | null,
        roles: (rolesData ?? []).map((r: { role: string }) => r.role),
        loading: false,
      }));
    } catch {
      if (fetchingForRef.current !== userId) return;
      setState((prev) => ({ ...prev, profile: null, roles: [], loading: false }));
    } finally {
      if (fetchingForRef.current === userId) {
        fetchingForRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function start() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!isMounted) return;
        const user = session?.user ?? null;
        setState((prev) => ({ ...prev, user }));
        if (user) {
          await fetchProfile(user.id);
        } else {
          setState((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (isMounted) setState((prev) => ({ ...prev, loading: false }));
      }
    }

    start();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      const nextUser = session?.user ?? null;

      if (event === "SIGNED_OUT") {
        // Clear in-flight fetch and all state immediately on logout
        fetchingForRef.current = null;
        setState({ user: null, profile: null, roles: [], loading: false });
        return;
      }

      if (event === "TOKEN_REFRESHED") {
        // JWT renewed — only update user object, profile data is unchanged
        setState((prev) => ({ ...prev, user: nextUser }));
        return;
      }

      // SIGNED_IN / USER_UPDATED / INITIAL_SESSION / MFA_CHALLENGE_VERIFIED
      setState((prev) => ({
        user: nextUser,
        // Clear stale profile if a different account signed in
        profile: prev.user?.id === nextUser?.id ? prev.profile : null,
        roles: prev.user?.id === nextUser?.id ? prev.roles : [],
        loading: prev.user?.id === nextUser?.id ? prev.loading : true,
      }));

      if (nextUser) {
        fetchProfile(nextUser.id);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    // Clear the dedup lock to force a fresh fetch even for the same userId
    fetchingForRef.current = null;
    await fetchProfile(state.user.id);
  }, [state.user, fetchProfile]);

  const { roles } = state;
  const isSuperAdmin = roles.some((r) => r === "super_admin");
  const isAdmin = roles.some((r) => r === "admin_paroquial" || r === "super_admin");
  const isCoordenador = roles.some((r) => r === "coordenador");
  const isLider = roles.some((r) => r === "lider");
  const isServidor =
    roles.length > 0 && roles.every((r) => r === "servidor" || r === "membro");
  const isAuxiliar = isLider && !isAdmin && !isCoordenador;
  const hasAdminAccess = isAdmin || isCoordenador || isLider;

  const value: AuthContextValue = {
    ...state,
    isSuperAdmin,
    isAdmin,
    isCoordenador,
    isLider,
    isServidor,
    isAuxiliar,
    hasAdminAccess,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
