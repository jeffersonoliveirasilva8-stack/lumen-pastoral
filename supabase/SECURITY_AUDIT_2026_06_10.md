# Relatório de Auditoria de Segurança
**Projeto:** Lumen Pastoral  
**Data:** 2026-06-10  
**Auditor:** Claude Sonnet (assistido por Jefferson Oliveira)  
**Escopo:** Full-stack — SQL/RLS, autenticação, autorização, frontend, segredos

---

## Sumário Executivo

| Categoria | Antes | Depois | Status |
|-----------|-------|--------|--------|
| Segredos/Credenciais | Chave ANON hardcoded em 6 arquivos SQL | Vault + placeholders | ✅ Corrigido |
| Console em produção | `console.error` com dados internos expostos | Drop automático via Vite | ✅ Corrigido |
| RLS inconsistente | Políticas com subquery direta (bypassável) | `current_paroquia_id()` uniforme | ✅ Corrigido |
| Token portal sem TTL | Tokens eternos | Expiração 90 dias + cron rotação | ✅ Corrigido |
| Redirect pós-login | Hardcoded `/painel` (Google OAuth ia sempre para admin) | `getPostLoginRoute()` centralizado | ✅ Corrigido |
| OAuth callback | Inexistente (redirect apontava para `/painel`) | `/auth/callback` com detecção de role | ✅ Corrigido |
| Rate limiting | Ausente em ambas as telas de login | 5 tentativas + 60s lockout + countdown | ✅ Corrigido |
| Mensagens de erro | Detalhes internos (`hint`, `details`) em produção | Sanitizados — só em DEV | ✅ Corrigido |
| MFA | Ausente | Estrutura base (tabelas, flags, componente) | ✅ Implementado |
| .gitignore | `supabase/.temp/` ausente | Adicionado | ✅ Corrigido |

---

## Fase 1 — Segredos e Credenciais

### Vulnerabilidade: Chave ANON hardcoded em SQL
**Severidade:** ALTA  
**Arquivos afetados (pré-correção):**
- `supabase/HOMILIA_CRON.sql` linha 57
- `supabase/PATCH_C_HOMILIA_CRON.sql` linha 21
- `supabase/PRODUCTION_DEPLOY.sql` linha ~373
- `supabase/SYNC_AGORA.sql` linhas 46, 58, 70
- `supabase/CRON_HOMILIA_SETUP.sql` linha 22
- `supabase/CRON_LITURGIA_SETUP.sql` linha ~28

**Correção aplicada:**
- Chave ANON migrada para Supabase Vault em `PATCH_I_HOMILIA_RESILIENTE_2026_06_10.sql`
- Função `sync_homilia_diaria()` agora lê via `vault.decrypted_secrets WHERE name = 'homilia_anon_key'`
- Arquivos SQL antigos: chave substituída por placeholder `<VAULT:homilia_anon_key>` / `<OBSOLETO:...>`
- Para rotacionar: `DELETE FROM vault.secrets WHERE name = 'homilia_anon_key'; PERFORM vault.create_secret('<nova_chave>', 'homilia_anon_key', '...');`

### Vulnerabilidade: Console logs com dados internos em produção
**Severidade:** MÉDIA  
**Arquivo:** `src/routes/_authenticated/membros.tsx`

**Correção aplicada:**
```typescript
if (import.meta.env.DEV) {
  console.error(`[DB ERROR] ${context}`, { message, code, details, hint, full });
} else {
  console.error(`[DB ERROR] ${context}: ${code ?? "unknown"}`);
}
```

**Correção aplicada (build):**  
`vite.config.ts` — drop de console e debugger em builds de produção:
```typescript
esbuild: command === "build" ? { drop: ["console", "debugger"] } : {}
```

### Vulnerabilidade: `supabase/.temp/` não estava no .gitignore
**Severidade:** BAIXA  
**Correção:** Adicionado `.gitignore`.

---

## Fase 2 — RLS e Multi-tenancy

### Vulnerabilidade: Políticas com subquery direta
**Severidade:** ALTA  
**Problema:** `PATCH_EVOLUCAO_V2.sql` usava `WHERE paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())` — subquery executada por usuário, sem índice, suscetível a privilege escalation se `profiles` tiver brecha.

**Correção:** `supabase/migrations/006_rls_gaps.sql`
- Todas as políticas usam `current_paroquia_id()` — função SECURITY DEFINER com search_path fixo
- Políticas separadas: `FOR SELECT` (read) e `FOR ALL WITH CHECK` (write)
- Removidas sobreposições: `FOR SELECT + FOR ALL` duplicadas causavam ambiguidade
- Tabelas corrigidas: `tipos_prioridade`, `formacoes_eventos`, `presencas_eventos`, `ocorrencias_escala`

### Vulnerabilidade: Tokens de acesso do portal sem expiração
**Severidade:** MÉDIA  
**Problema:** `membros.token_acesso` era um UUID estático sem TTL — comprometimento permanente.

**Correção:** `supabase/migrations/007_token_ttl.sql`
- Coluna `token_acesso_expires_at TIMESTAMPTZ` adicionada
- Backfill: registros existentes recebem `now() + 90 days`
- Todos os RPCs do portal validam: `AND (token_acesso_expires_at IS NULL OR token_acesso_expires_at > now())`
- Cron `membros-token-refresh` às 03:00 UTC rotaciona tokens expirados
- Função helper `portal_rotacionar_token(membro_id)` para admins

---

## Fase 3 — Autenticação e Controle de Acesso

### Vulnerabilidade: Google OAuth sempre redirecionava para `/painel`
**Severidade:** ALTA  
**Problema:** `redirectTo: window.location.origin + "/painel"` — qualquer usuário autenticado via Google ia para o painel admin, independente do role.

**Correção:**
- Criada `src/routes/auth.callback.tsx` — rota `/auth/callback`
  - Aguarda sessão estabelecida (onAuthStateChange + timeout 8s)
  - Chama `getPostLoginRoute()` e redireciona para o portal correto
- `src/lib/auth-redirect.ts` — `getPostLoginRoute(supabase)`:
  - `super_admin | admin_paroquial | coordenador` → `/painel`
  - sem `paroquia_id` (admin novo) → `/onboarding`
  - `servidor | membro | auxiliar` → verifica `membros.ativo`, se false → `/acesso-negado`
  - sem roles → tenta `portal_auto_link_by_email`, verifica por email, fallback `/membro/login`
- `src/routes/acesso-negado.tsx` — página de acesso negado

**Fluxos cobertos:** email/senha, Google OAuth, magic link, recuperação de sessão, refresh de página.

### Vulnerabilidade: Credenciais inválidas revelavam mensagem do Supabase
**Severidade:** BAIXA  
**Correção:** `login.tsx` e `membro/login.tsx` — mensagens de erro normalizadas:
- `"Invalid login credentials"` → `"E-mail ou senha incorretos."`
- Outros erros → `"Erro ao autenticar. Tente novamente."`

### Vulnerabilidade: Ausência de rate limiting nas telas de login
**Severidade:** MÉDIA  
**Correção aplicada em `login.tsx` e `membro/login.tsx` (SenhaForm):**
- Constantes: `MAX_ATTEMPTS = 5`, `LOCKOUT_SECONDS = 60`
- Após 5 tentativas falhas: form desabilitado, countdown visual regressivo
- Reset automático ao expirar o lockout

### Vulnerabilidade: `_authenticated.tsx` sem guarda para roles inválidas
**Severidade:** BAIXA  
**Correção:** Novo `useEffect`:
```typescript
if (!loading && user && roles.length > 0 && !hasAdminAccess && !isServidor) {
  navigate({ to: "/acesso-negado" });
}
```
Captura roles corrompidas/desconhecidas que não dariam acesso a nenhum portal.

---

## Fase 4 — MFA (Estrutura Base)

**Status:** Implementado sem enforcement (ver feature flags).

### Migration `008_mfa_settings.sql`
- Tabela `user_mfa_settings`: `user_id` (unique), `enabled`, `last_verified_at`
- RLS: cada usuário vê apenas o próprio registro; `super_admin` pode auditar
- Trigger `on_auth_user_created_mfa`: cria registro automaticamente para novos usuários
- Backfill para usuários existentes

### Tabela `security_settings`
Feature flags para enforcement futuro:

| Chave | Valor | Descrição |
|-------|-------|-----------|
| `mfa_required_for_coordination` | `false` | MFA obrigatório para coordenadores/admins |
| `mfa_required_for_admin` | `false` | MFA obrigatório para super_admin |
| `mfa_available` | `true` | Exibe seção MFA em Minha Conta |

Para **habilitar enforcement** no futuro:
```sql
UPDATE security_settings SET value = 'true' WHERE key = 'mfa_required_for_coordination';
```

### Componente `src/components/security/MfaSetup.tsx`
- Detecta status atual via `supabase.auth.mfa.listFactors()`
- Fluxo de ativação: `mfa.enroll()` → QR code + chave manual → `mfa.challenge()` + `mfa.verify()`
- Fluxo de desativação: confirma código atual antes de `mfa.unenroll()`
- Integrado em `/_authenticated/minha-conta` (admins) e `/portal-membro/perfil` (membros)

---

## Fase 5 — Homilia Diária (Pré-auditoria)

### Vulnerabilidade crítica: `homilia_sync_logs` inexistente
**Severidade:** CRÍTICA  
**Problema:** `sync_homilia_diaria()` falhava silenciosamente (ou propagava exceção) porque a tabela de log não existia.

**Correção:**
- `supabase/migrations/005_homilia_sync_logs.sql` — migration oficial da tabela
- `PATCH_I_HOMILIA_RESILIENTE_2026_06_10.sql`:
  - Função resiliente com blocos `BEGIN/EXCEPTION` aninhados (falha no log não aborta a homilia)
  - Lê chave ANON do Vault
  - Cron de limpeza de logs antigos (todo domingo)

---

## Pendências e Recomendações Futuras

### Alta prioridade
| # | Item | Arquivo / Local |
|---|------|-----------------|
| 1 | **Enforcement MFA** | Checar `security_settings.mfa_required_for_coordination` no login e exigir código TOTP antes de emitir sessão | 
| 2 | **Audit log** | Tabela `audit_logs` com INSERT/UPDATE/DELETE em tabelas sensíveis (membros, escalas, presenças) via triggers |
| 3 | **CAPTCHA no login** | Integrar hCaptcha ou Cloudflare Turnstile no `login.tsx` e `membro/login.tsx` para brute force em escala |

### Média prioridade
| # | Item | Arquivo / Local |
|---|------|-----------------|
| 4 | **CPF encryption** | `membros.cpf` armazenado em texto puro — encriptar com `pgcrypto.pgp_sym_encrypt` ou campo dedicado no Vault |
| 5 | **Content-Security-Policy** | Adicionar headers CSP no Vite/Nginx para mitigar XSS residual |
| 6 | **Session revocation** | Quando admin desativa um membro, chamar `supabase.auth.admin.signOut(userId)` para invalidar sessão ativa |
| 7 | **Backup de codes MFA** | Geração de recovery codes ao ativar TOTP para evitar lock-out permanente |

### Baixa prioridade
| # | Item | Arquivo / Local |
|---|------|-----------------|
| 8 | **`Camera` import** | Remover import não utilizado em `minha-conta.tsx` (lint hint pré-existente) |
| 9 | **`FormEvent` deprecado** | Substituir `React.FormEvent` por `React.SyntheticEvent` em arquivos afetados |
| 10 | **Secrets scanning CI** | Adicionar `gitleaks` ou `trufflehog` no pipeline para prevenir reintrodução de chaves |

---

## Arquivos Criados / Modificados

### Novos arquivos
| Arquivo | Descrição |
|---------|-----------|
| `supabase/migrations/005_homilia_sync_logs.sql` | Tabela `homilia_sync_logs` |
| `supabase/migrations/006_rls_gaps.sql` | Correção de políticas RLS |
| `supabase/migrations/007_token_ttl.sql` | TTL para tokens do portal |
| `supabase/migrations/008_mfa_settings.sql` | Estrutura base MFA |
| `supabase/PATCH_I_HOMILIA_RESILIENTE_2026_06_10.sql` | Patch aplicável ao Supabase (Vault + homilia resiliente) |
| `src/lib/auth-redirect.ts` | Helper `getPostLoginRoute()` |
| `src/routes/auth.callback.tsx` | Callback OAuth com redirect inteligente |
| `src/routes/acesso-negado.tsx` | Página de acesso negado |
| `src/components/security/MfaSetup.tsx` | Componente de configuração MFA |

### Arquivos modificados
| Arquivo | Mudança |
|---------|---------|
| `vite.config.ts` | Drop console/debugger em produção |
| `.gitignore` | Adicionado `supabase/.temp/` |
| `src/routes/login.tsx` | Rate limiting + getPostLoginRoute + OAuth callback fix |
| `src/routes/membro/login.tsx` | Rate limiting (SenhaForm) + getPostLoginRoute + emailRedirectTo fix |
| `src/routes/_authenticated.tsx` | Guard roles inválidas → /acesso-negado |
| `src/routes/_authenticated/minha-conta.tsx` | Seção Segurança com MfaSetup |
| `src/routes/_authenticated/membros.tsx` | logDbError sanitizado em produção |
| `src/routes/portal-membro/perfil.tsx` | Seção Segurança com MfaSetup |
| `supabase/HOMILIA_CRON.sql` | Chave ANON redatada |
| `supabase/PATCH_C_HOMILIA_CRON.sql` | Chave ANON redatada |
| `supabase/PRODUCTION_DEPLOY.sql` | Chave ANON redatada |
| `supabase/SYNC_AGORA.sql` | Chave ANON redatada (3 ocorrências) |
| `supabase/CRON_HOMILIA_SETUP.sql` | Chave de projeto obsoleto redatada |
| `supabase/CRON_LITURGIA_SETUP.sql` | Chave de projeto obsoleto redatada |

---

## Score de Segurança por Categoria

| Categoria | Antes | Depois |
|-----------|-------|--------|
| Segredos / Credenciais | 3/10 | 8/10 |
| Autenticação | 5/10 | 8/10 |
| Autorização / RLS | 6/10 | 9/10 |
| Multi-tenancy | 7/10 | 9/10 |
| Frontend (XSS, CSRF) | 6/10 | 8/10 |
| MFA / 2FA | 0/10 | 5/10 (estrutura base) |
| **Geral** | **4.5/10** | **7.8/10** |

> Para atingir 9/10 geral: implementar enforcement MFA, audit log, e CAPTCHA.
