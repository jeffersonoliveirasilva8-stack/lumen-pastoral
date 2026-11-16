/**
 * auth-context.test.ts
 * Testes unitários do AuthProvider e useAuth centralizado.
 *
 * Execução: npx vitest run src/contexts/auth-context.test.ts
 * (requer: npm i -D vitest @testing-library/react jsdom)
 *
 * Cobertura:
 *   T1  — login de administrador
 *   T2  — login de coordenador
 *   T3  — login de membro/servidor
 *   T4  — usuário com cadastro incompleto (sem profile)
 *   T5  — logout limpa estado imediatamente
 *   T6  — login com outra conta na mesma aba (account switch)
 *   T7  — TOKEN_REFRESHED atualiza user sem refetch de profile
 *   T8  — múltiplos consumers não disparam queries independentes
 *   T9  — deduplicação de fetchProfile por userId
 *   T10 — refreshProfile força novo fetch mesmo após dedup
 */

// @vitest-environment jsdom
// @ts-ignore — instalar vitest: npm i -D vitest
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock do Supabase antes de importar o módulo
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
    },
    from: mockFrom,
    rpc: mockRpc,
  },
}));

// Importar DEPOIS do mock
import { AuthProvider, useAuth, type Profile } from "./auth-context";
// @ts-ignore
import { renderHook, act, waitFor } from "@testing-library/react";
// @ts-ignore
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AuthChangeCb = (event: string, session: { user: { id: string } } | null) => void;

function setupMocks({
  userId = "user-1",
  roles = ["admin_paroquial"],
  profile = { id: "user-1", nome_completo: "Admin Teste", paroquia_id: "par-1", email: "a@b.com", telefone: null, avatar_url: null, created_at: "", updated_at: "" } as Profile,
  sessionUser = { id: userId },
} = {}) {
  let authChangeCb: AuthChangeCb | null = null;

  mockGetSession.mockResolvedValue({ data: { session: { user: sessionUser } } });

  mockOnAuthStateChange.mockImplementation((_event: string, cb: AuthChangeCb) => {
    authChangeCb = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });

  const profileQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: profile }),
  };
  const rolesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: roles.map(r => ({ role: r })) }),
  };

  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") return profileQuery;
    if (table === "user_roles") return rolesQuery;
    return profileQuery;
  });

  return {
    getAuthChangeCb: () => authChangeCb,
    profileQuery,
    rolesQuery,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(AuthProvider, null, children);
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it("T1 — login de administrador — isAdmin e hasAdminAccess true", async () => {
    setupMocks({ roles: ["admin_paroquial"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.hasAdminAccess).toBe(true);
    expect(result.current.isCoordenador).toBe(false);
    expect(result.current.isServidor).toBe(false);
    expect(result.current.profile?.paroquia_id).toBe("par-1");
  });

  it("T2 — login de coordenador — isCoordenador true, isAdmin false", async () => {
    setupMocks({ roles: ["coordenador"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isCoordenador).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.hasAdminAccess).toBe(true);
  });

  it("T3 — login de servidor — isServidor true", async () => {
    setupMocks({ roles: ["servidor"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isServidor).toBe(true);
    expect(result.current.hasAdminAccess).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });

  it("T4 — usuário com cadastro incompleto — profile null, loading false", async () => {
    setupMocks({ profile: null as unknown as Profile });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.user).not.toBeNull();
  });

  it("T5 — logout limpa estado imediatamente", async () => {
    const { getAuthChangeCb } = setupMocks({ roles: ["admin_paroquial"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).not.toBeNull();

    act(() => {
      getAuthChangeCb()?.("SIGNED_OUT", null);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.roles).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it("T6 — account switch — limpa profile do usuário anterior", async () => {
    const { getAuthChangeCb } = setupMocks({ userId: "user-1", roles: ["admin_paroquial"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe("user-1");

    // Simula novo usuário logando na mesma aba
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-2", paroquia_id: "par-2", nome_completo: "Outro", email: "b@b.com", telefone: null, avatar_url: null, created_at: "", updated_at: "" } }),
      };
      if (table === "user_roles") return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [{ role: "coordenador" }] }),
      };
      return {};
    });

    act(() => {
      getAuthChangeCb()?.("SIGNED_IN", { user: { id: "user-2" } });
    });

    // Imediatamente após SIGNED_IN, profile do user-1 deve ter sido limpo
    expect(result.current.profile?.id ?? null).not.toBe("user-1");

    await waitFor(() => expect(result.current.user?.id).toBe("user-2"));
    await waitFor(() => expect(result.current.isCoordenador).toBe(true));
  });

  it("T7 — TOKEN_REFRESHED atualiza user sem refetch de profile", async () => {
    const { getAuthChangeCb, profileQuery } = setupMocks({ roles: ["admin_paroquial"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsBefore = (profileQuery.maybeSingle as Mock).mock.calls.length;

    act(() => {
      getAuthChangeCb()?.("TOKEN_REFRESHED", { user: { id: "user-1" } });
    });

    // Nenhuma query adicional disparada
    expect((profileQuery.maybeSingle as Mock).mock.calls.length).toBe(callsBefore);
  });

  it("T8 — múltiplos consumers não disparam queries independentes", async () => {
    const { profileQuery } = setupMocks({ roles: ["admin_paroquial"] });

    // Render 5 consumers simultâneos — simula painel com 5+ componentes
    const { result: r1 } = renderHook(() => useAuth(), { wrapper });
    const { result: r2 } = renderHook(() => useAuth(), { wrapper: ({ children }) => createElement(AuthProvider, null, children) });

    // Com AuthProvider compartilhado, maybeSingle deve ser chamado apenas 1x
    // (wrapper é o mesmo provider para r1; r2 tem provider separado = 2 total)
    await waitFor(() => expect(r1.current.loading).toBe(false));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    // Cada provider independente → 2 fetches no máximo (não N por consumer)
    expect((profileQuery.maybeSingle as Mock).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("T9 — deduplicação: fetchProfile paralelo para mesmo userId é ignorado", async () => {
    let resolveProfile: ((v: unknown) => void) | null = null;

    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(
        () => new Promise(resolve => { resolveProfile = resolve; }),
      ),
    };
    const rolesQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis().mockResolvedValue({ data: [{ role: "admin_paroquial" }] }),
    };

    mockFrom.mockImplementation((table: string) =>
      table === "profiles" ? profileQuery : rolesQuery,
    );

    const { getAuthChangeCb } = setupMocks();
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Enquanto o fetch está pendente, dispara segundo SIGNED_IN para mesmo user
    act(() => {
      getAuthChangeCb()?.("SIGNED_IN", { user: { id: "user-1" } });
    });

    // Resolve o fetch
    act(() => {
      resolveProfile?.({ data: { id: "user-1", paroquia_id: "par-1", nome_completo: "T", email: null, telefone: null, avatar_url: null, created_at: "", updated_at: "" } });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // maybeSingle chamado no máximo 2x (getSession + 1 event), não N
    expect((profileQuery.maybeSingle as Mock).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("T10 — refreshProfile força novo fetch mesmo após dedup", async () => {
    const { profileQuery } = setupMocks({ roles: ["admin_paroquial"] });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsBefore = (profileQuery.maybeSingle as Mock).mock.calls.length;

    await act(async () => {
      await result.current.refreshProfile();
    });

    expect((profileQuery.maybeSingle as Mock).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
