/**
 * auth-redirect.ts
 *
 * Helper centralizado de redirect pós-login.
 * Usado por TODOS os fluxos de autenticação:
 *   - Email/senha (login.tsx)
 *   - Magic Link (membro/login.tsx)
 *   - Recuperação de sessão (_authenticated.tsx)
 *
 * Mapeamento tipo_acesso → user_roles (após migration 102):
 *   coordenador  → admin_paroquial  → /auth/admin-mfa
 *   administrador→ admin_paroquial  → /auth/admin-mfa
 *   vice         → coordenador      → /auth/admin-mfa
 *   auxiliar     → lider            → /portal-membro/home  (Secretário)
 *   membro       → servidor (105)   → /portal-membro/home
 *   servidor     → servidor (105)   → /portal-membro/home
 *   (sem roles)  → —                → /portal-membro/home  (via auth_user_id)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PostLoginRoute =
  | "/painel"
  | "/portal-membro/home"
  | "/onboarding"
  | "/membro/login"
  | "/membro/primeiro-acesso"
  | "/acesso-negado"
  | "/auth/admin-mfa";

async function _resolveRoute(supabase: SupabaseClient): Promise<PostLoginRoute> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "/membro/login";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const [{ data: rolesData }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const roles: string[] = (rolesData ?? []).map((r: { role: string }) => r.role);

    // ── Roles de coordenação/admin → MFA obrigatório ─────────────────────────
    // admin_paroquial: coordenador, administrador (migration 102)
    // coordenador:     vice (migration 102)
    // super_admin:     super admin global
    const isAdmin = roles.some((r) => r === "admin_paroquial" || r === "super_admin");
    const isCoordenador = roles.some((r) => r === "coordenador");

    if (isAdmin || isCoordenador) {
      return "/auth/admin-mfa";
    }

    // ── Roles de portal do membro ─────────────────────────────────────────────
    // servidor: membro/servidor após migration 105 (restauração)
    // lider:    auxiliar (Secretário) após migration 102
    // membro:   legado (antes das migrations de enum cleanup)
    // auxiliar: legado (antes das migrations de enum cleanup)
    const isPortalRole = roles.some((r) =>
      r === "servidor" || r === "lider" || r === "membro" || r === "auxiliar",
    );

    if (isPortalRole) {
      const { data: membroData } = await db
        .from("membros")
        .select("ativo, conta_ativada")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (membroData?.ativo === false) return "/acesso-negado";
      if (membroData?.conta_ativada === false) return "/membro/primeiro-acesso";
      return "/portal-membro/home";
    }

    // ── Sem roles ou role desconhecido — tenta localizar o membro ─────────────
    // Cobre: membros cujos roles foram apagados pela migration 102,
    // primeiros acessos (auth_user_id ainda não vinculado), e qualquer
    // combinação futura de roles não mapeada acima.
    {
      // 1. Já vinculado — busca direta por auth_user_id (mais confiável)
      const { data: membroById } = await db
        .from("membros")
        .select("ativo, conta_ativada")
        .eq("auth_user_id", user.id)
        .eq("ativo", true)
        .maybeSingle();

      if (membroById) {
        if (membroById.conta_ativada === false) return "/membro/primeiro-acesso";
        return "/portal-membro/home";
      }

      // 2. Não vinculado — tenta auto-link pelo RPC (SECURITY DEFINER, bypassa RLS)
      try {
        const { data: linkResult } = await db.rpc("portal_auto_link_by_email");
        if (linkResult?.success) {
          const { data: linked } = await db
            .from("membros")
            .select("conta_ativada")
            .eq("auth_user_id", user.id)
            .maybeSingle();
          if (linked?.conta_ativada === false) return "/membro/primeiro-acesso";
          if (linked?.conta_ativada === true) return "/portal-membro/home";
          return "/membro/primeiro-acesso";
        }
      } catch {
        // RPC pode não existir ou falhar — continua para fallback
      }

      // 3. Fallback por email (membro sem auth_user_id)
      if (user.email) {
        const { data: membroByEmail } = await db
          .from("membros")
          .select("ativo, conta_ativada, paroquia_id")
          .ilike("email", user.email.trim())
          .eq("ativo", true)
          .maybeSingle();

        if (membroByEmail) {
          if (membroByEmail.conta_ativada === false) return "/membro/primeiro-acesso";
          return "/portal-membro/home";
        }
      }
    }

    // Sem vínculo identificado → tela de login do membro
    return "/membro/login";
  } catch {
    return "/membro/login";
  }
}

/** Wrapper com timeout de 10s — nunca trava o login independente da velocidade da rede */
export async function getPostLoginRoute(
  supabase: SupabaseClient,
): Promise<PostLoginRoute> {
  const timeout = new Promise<PostLoginRoute>((resolve) =>
    setTimeout(() => resolve("/membro/login"), 10_000),
  );
  return Promise.race([_resolveRoute(supabase), timeout]);
}
