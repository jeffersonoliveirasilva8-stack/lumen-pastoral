/**
 * auth-redirect.ts
 *
 * Helper centralizado de redirect pós-login.
 * Usado por TODOS os fluxos de autenticação:
 *   - Email/senha (login.tsx)
 *   - Magic Link (membro/login.tsx)
 *   - Recuperação de sessão (_authenticated.tsx)
 *
 * Lógica de destino:
 *   super_admin | admin_paroquial | coordenador → /auth/admin-mfa (MFA customizado)
 *   servidor | membro | auxiliar (puro)         → /portal-membro/home
 *   sem roles + membro ativo (auto-link)        → /portal-membro/home
 *   sem roles + sem membro                      → /membro/login
 *   membro desativado                           → /acesso-negado
 *   sem paróquia (admin novo)                   → /onboarding (após MFA)
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

    // Busca roles em paralelo com perfil
    const [{ data: rolesData }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const roles: string[] = (rolesData ?? []).map((r: { role: string }) => r.role);

    // Roles de coordenação → MFA customizado primeiro
    const isAdmin = roles.some((r) => r === "admin_paroquial" || r === "super_admin");
    const isCoordenador = roles.some((r) => r === "coordenador");

    if (isAdmin || isCoordenador) {
      // Sempre exige MFA para admin/coordenador (código 6 dígitos via e-mail)
      return "/auth/admin-mfa";
    }

    // Roles de membro/servidor/auxiliar → portal do membro
    const isMembroRole = roles.some((r) =>
      r === "membro" || r === "servidor" || r === "auxiliar",
    );

    if (isMembroRole) {
      const { data: membroData } = await db
        .from("membros")
        .select("ativo, conta_ativada")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (membroData?.ativo === false) return "/acesso-negado";
      if (membroData?.conta_ativada === false) return "/membro/primeiro-acesso";
      return "/portal-membro/home";
    }

    // Sem roles — tenta auto-link pelo email
    if (roles.length === 0) {
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
          // RLS pode bloquear a leitura antes das policies serem aplicadas —
          // primeiro-acesso detecta sessão e carrega por email.
          return "/membro/primeiro-acesso";
        }
      } catch {
        // RPC pode não existir — continua para fallback
      }

      // Verifica se existe membro ativo com este email (fallback sem RPC)
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

      // Sem vínculo identificado → login do membro para escolher paróquia
      return "/membro/login";
    }

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
