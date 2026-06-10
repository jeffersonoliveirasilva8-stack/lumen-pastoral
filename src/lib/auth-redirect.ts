/**
 * auth-redirect.ts
 *
 * Helper centralizado de redirect pós-login.
 * Usado por TODOS os fluxos de autenticação:
 *   - Email/senha (login.tsx)
 *   - Google OAuth (auth.callback.tsx)
 *   - Magic Link (membro/login.tsx)
 *   - Recuperação de sessão (_authenticated.tsx)
 *
 * Lógica de destino:
 *   super_admin | admin_paroquial | coordenador → /painel
 *   servidor | membro | auxiliar (puro)         → /portal-membro/home
 *   sem roles + membro ativo (auto-link)        → /portal-membro/home
 *   sem roles + sem membro                      → /membro/login
 *   membro desativado                           → /acesso-negado
 *   sem paróquia (admin novo)                   → /onboarding
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PostLoginRoute =
  | "/painel"
  | "/portal-membro/home"
  | "/onboarding"
  | "/membro/login"
  | "/acesso-negado";

export async function getPostLoginRoute(
  supabase: SupabaseClient,
): Promise<PostLoginRoute> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "/membro/login";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // Busca roles e perfil em paralelo
    const [{ data: rolesData }, { data: profileData }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", user.id),
      db.from("profiles").select("paroquia_id").eq("id", user.id).maybeSingle(),
    ]);

    const roles: string[] = (rolesData ?? []).map((r: { role: string }) => r.role);

    // Roles de coordenação → painel admin
    const isAdmin = roles.some((r) => r === "admin_paroquial" || r === "super_admin");
    const isCoordenador = roles.some((r) => r === "coordenador");

    if (isAdmin || isCoordenador) {
      // Admin sem paróquia → onboarding
      if (!profileData?.paroquia_id) return "/onboarding";
      return "/painel";
    }

    // Roles de membro/servidor/auxiliar → portal do membro
    const isMembroRole = roles.some((r) =>
      r === "membro" || r === "servidor" || r === "auxiliar",
    );

    if (isMembroRole) {
      // Verifica se membro está ativo
      const { data: membroData } = await db
        .from("membros")
        .select("ativo")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (membroData && membroData.ativo === false) return "/acesso-negado";
      return "/portal-membro/home";
    }

    // Sem roles — tenta auto-link pelo email
    if (roles.length === 0) {
      try {
        const { data: linkResult } = await db.rpc("portal_auto_link_by_email");
        if (linkResult?.success) return "/portal-membro/home";
      } catch {
        // RPC pode não existir — continua para fallback
      }

      // Verifica se existe membro ativo com este email
      if (user.email) {
        const { data: membroByEmail } = await db
          .from("membros")
          .select("ativo, paroquia_id")
          .ilike("email", user.email.trim())
          .eq("ativo", true)
          .maybeSingle();

        if (membroByEmail) return "/portal-membro/home";
      }

      // Sem vínculo identificado → login do membro para escolher paróquia
      return "/membro/login";
    }

    return "/membro/login";
  } catch {
    return "/membro/login";
  }
}
