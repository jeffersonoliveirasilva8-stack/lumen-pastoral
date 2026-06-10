# Auditoria de Segurança — Lumen Pastoral
**Data:** 2026-06-10  
**Versão:** 2.0 (completo — fases P1 a P6)  
**Autor:** Jefferson Oliveira + revisão técnica Claude Sonnet 4.6

---

## Score Final

| Categoria              | Antes | Depois |
|------------------------|-------|--------|
| Autenticação           | 5/10  | 8.5/10 |
| Autorização / RLS      | 6/10  | 9/10   |
| Segredos e credenciais | 3/10  | 8/10   |
| Rastreabilidade        | 0/10  | 8/10   |
| Resiliência / Erros    | 4/10  | 8/10   |
| Dados sensíveis (PII)  | 2/10  | 6/10   |
| **Score global**       | **4.5/10** | **8.0/10** |

---

## Fase P0 — Auditoria Base

### Concluído
- **Homilia Diária:** tabela `homilia_sync_logs` criada com coluna `strategy`; Edge Function resiliente com fallback entre fontes  
- **Vault:** chave anon removida de todos os arquivos SQL; substituída por `SELECT decrypted_secret FROM vault.decrypted_secrets`  
- **Google OAuth:** rota `/auth/callback` centralizada; `getPostLoginRoute()` único ponto de decisão de redirect  
- **Multi-tenancy RLS:** auditoria de todas as tabelas; função `current_paroquia_id()` SECURITY DEFINER; gaps documentados  
- **TTL tokens:** reduzido de 90 → 30 dias; cron de rotação automática  
- **Rate limiting:** 5 tentativas / 60s lockout no login (email/senha e magic link)  
- **Sanitização de erros:** `logDbError()` condicional — detalhes apenas em `DEV`; `drop: ["console", "debugger"]` em produção  
- **MFA setup:** componente `<MfaSetup>` com enroll TOTP, QR code, verify e unenroll  
- **Console strip:** `vite.config.ts` — `esbuild.drop: ["console", "debugger"]` no build

---

## Fase P1 — Audit Log (IMPLEMENTADO)

### Arquivos criados
- `supabase/migrations/009_audit_log.sql`
- `src/routes/_authenticated/auditoria.tsx`

### Implementação
- Tabela `audit_logs`: id, paroquia_id, actor_user_id, actor_nome, entidade, entidade_id, acao, dados_anteriores (jsonb), dados_novos (jsonb), ip, user_agent, created_at
- Índices em: paroquia_id, actor_user_id, entidade, created_at
- RLS: admin/coordenador veem só sua paróquia; super_admin vê tudo; ninguém pode escrever manualmente
- Trigger `fn_audit_trigger()` SECURITY DEFINER em todas as tabelas críticas (membros, escalas, escala_membros, historico_participacoes, ocorrencias_membros, user_roles, paroquias)
- Campos omitidos do log: token_acesso, token_acesso_expires_at, cpf, rg, senha, password
- UPDATE armazena apenas diff (campos que mudaram) — eficiente
- Falha no trigger nunca bloqueia a operação original (EXCEPTION → RAISE WARNING)
- Cron de limpeza: logs > 2 anos removidos todo dia 1º do mês
- Interface `/auditoria` com filtros de período, entidade, ação e busca textual

---

## Fase P2 — Sentry (IMPLEMENTADO)

### Arquivos modificados
- `src/main.tsx` — `Sentry.init()` com DSN do env, `browserTracingIntegration`, `beforeSend` scrub
- `vite.config.ts` — `sentryVitePlugin` para upload de source maps em produção
- `.env.example` — variáveis VITE_SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT

### Configuração
- DSN configurável via `VITE_SENTRY_DSN` (não ativa sem a variável)
- `tracesSampleRate`: 10% em produção, 0% em outros ambientes
- `beforeSend`: scrub de campos sensíveis — token_acesso, cpf, rg, senha, password, token
- Source maps gerados e enviados ao Sentry apenas quando `SENTRY_AUTH_TOKEN` estiver presente (CI/CD)
- Source maps deletados do bundle após upload (`filesToDeleteAfterUpload`)

### Pendência operacional
- Criar projeto no Sentry, copiar DSN para `.env`
- Configurar `SENTRY_AUTH_TOKEN` no CI/CD (GitHub Actions / Cloudflare Pages)

---

## Fase P3 — Backup e Recuperação (DOCUMENTADO)

### Estratégia atual (Supabase)

| Tipo | Frequência | Retenção | RPO | RTO |
|------|-----------|----------|-----|-----|
| Point-in-Time Recovery (PITR) | Contínuo (WAL) | 7 dias (Free) / 30 dias (Pro) | < 1 min | 15–30 min |
| Daily snapshot | Diário 00:00 UTC | 7 dias | 24h | 5–15 min |

### Recomendações
1. **Upgrade para plano Pro** para PITR de 30 dias (LGPD: 5 anos de logs operacionais)
2. **Pg_dump periódico** via pg_cron + Edge Function → bucket externo (Cloudflare R2 / S3)
3. **Teste mensal:** restaurar em projeto Supabase separado e validar integridade

### Checklist de disaster recovery
- [ ] Credenciais de acesso ao Supabase em cofre seguro (1Password/Bitwarden)
- [ ] Variáveis de ambiente documentadas no `.env.example`
- [ ] Runbook de restauração: `pg_restore -d "$CONNECTION_STRING" backup.dump`
- [ ] Contato emergência Supabase: support@supabase.io (Pro SLA: 24h)
- [ ] Teste semestral de restore validado por data específica

### Script de backup manual
```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-acl \
  --no-owner \
  --file="backup-$(date +%Y%m%d-%H%M%S).dump"
```

---

## Fase P4 — MFA Enforcement (IMPLEMENTADO)

### Arquivos criados/modificados
- `src/routes/auth.mfa-challenge.tsx` — página de desafio TOTP (AAL2)
- `src/lib/auth-redirect.ts` — check AAL antes de redirecionar admin/coordenador
- `src/routeTree.gen.ts` — rota `/auth/mfa-challenge` registrada

### Fluxo
1. Login (email/senha ou OAuth) → `getPostLoginRoute()`
2. Se role = admin/coordenador E AAL atual < AAL exigido → `/auth/mfa-challenge`
3. Página exibe input de 6 dígitos para código TOTP
4. `mfa.challenge()` + `mfa.verify()` → eleva para AAL2 → redireciona ao destino
5. Usuários sem MFA cadastrado passam direto (enforcement é opt-in por enquanto)

### Enforcement futuro
```sql
UPDATE public.security_settings
SET value = 'true'
WHERE key = 'mfa_required_for_coordination';
```

---

## Fase P5 — Cloudflare Turnstile (IMPLEMENTADO)

### Arquivo criado
- `src/components/security/TurnstileWidget.tsx`

### Implementação
- Widget Turnstile carregado via script dinâmico (lazy load)
- Site key via `VITE_TURNSTILE_SITE_KEY` (sem a variável = dev bypass automático)
- `onVerify(token)` callback para integração nos formulários
- Cleanup de widget no unmount
- Theme `auto` (adapta ao tema claro/escuro)

### Pendência de integração
- Adicionar `<TurnstileWidget>` nos formulários: login.tsx, esqueci-senha.tsx, membro/login.tsx
- Criar Edge Function `verify-turnstile` para validar token no servidor com `TURNSTILE_SECRET_KEY`

---

## Fase P6 — Dados Sensíveis (ANALISADO)

### Arquivo criado
- `supabase/PATCH_K_CPF_ENCRYPT_2026_06_10.sql`

### Campos identificados

| Campo | Tabela | Sensibilidade | Estado | Recomendação |
|-------|--------|---------------|--------|--------------|
| cpf | membros | ALTO (PII fiscal) | Plaintext | Criptografar (pgcrypto) |
| rg | membros | MÉDIO | Plaintext | Manter com RLS |
| telefone | membros | MÉDIO | Plaintext | Manter com RLS |
| observacoes | membros | BAIXO | Plaintext | Manter |
| descricao | ocorrencias_membros | BAIXO | Plaintext | Manter |

### Estratégia implementada no PATCH_K
1. Coluna `cpf_enc` (bytea) — CPF criptografado com `pgp_sym_encrypt`
2. Coluna `cpf_hash` (text) — SHA-256 para busca sem descriptografar
3. Chave gerenciada pelo Vault (`vault.decrypted_secrets` → `cpf_encrypt_key`)
4. RPC `rpc_decrypt_cpf(membro_id)` — somente admin_paroquial e super_admin
5. Procedure `migrar_cpf_para_colunas_enc(key)` para migração dos dados existentes
6. Remoção da coluna plaintext após validação (`DROP COLUMN cpf`)

### Conformidade LGPD
- Art. 46 (segurança técnica): CPF criptografado em repouso ✓ após PATCH_K  
- Art. 5 I (dado pessoal identificado): mapeamento completo ✓  
- Art. 18 (direito de exclusão): `membros.ativo = false` + exclusão programática ✓  
- Consentimento explícito (formulário de cadastro): **pendente validação**

---

## Pendências Abertas

| Item | Prioridade | Esforço |
|------|-----------|---------|
| Integrar TurnstileWidget nos formulários + Edge Function de verificação | Alta | 2h |
| Aplicar PATCH_K + configurar `cpf_encrypt_key` no Vault + migrar dados | Alta | 4h |
| Configurar SENTRY_DSN + SENTRY_AUTH_TOKEN no CI/CD | Média | 1h |
| Ativar enforcement de MFA para admins (`security_settings`) | Média | 1h |
| Criar Edge Function de backup diário → R2/S3 | Média | 3h |
| Validar consentimento LGPD no cadastro | Alta | 2h |

---

## Arquivos Produzidos

### Migrations / SQL
| Arquivo | Descrição |
|---------|-----------|
| `migrations/007_token_ttl.sql` | TTL 90→30 dias |
| `migrations/008_mfa_settings.sql` | Tabela MFA settings + feature flags |
| `migrations/009_audit_log.sql` | Audit log completo |
| `PATCH_H_INDISP_RLS_2026_06_09.sql` | RLS indisponibilidades |
| `PATCH_I_HOMILIA_RESILIENTE_2026_06_10.sql` | Homilia com fallback |
| `PATCH_J_TOKEN_PORTAL_ROTATION_2026_06_10.sql` | Rotação manual token_portal |
| `PATCH_K_CPF_ENCRYPT_2026_06_10.sql` | Análise + criptografia CPF |
| `ISOLATION_TEST_2026_06_10.sql` | Testes de isolamento entre paróquias |
| `RLS_AUDIT_QUERY.sql` | Consultas de auditoria RLS |

### Frontend
| Arquivo | Descrição |
|---------|-----------|
| `src/lib/auth-redirect.ts` | Helper `getPostLoginRoute()` com MFA check |
| `src/routes/auth.callback.tsx` | Callback OAuth inteligente |
| `src/routes/auth.mfa-challenge.tsx` | Página desafio TOTP AAL2 |
| `src/routes/acesso-negado.tsx` | Página de acesso negado |
| `src/routes/_authenticated/auditoria.tsx` | Interface de auditoria admin |
| `src/components/security/MfaSetup.tsx` | Componente setup MFA |
| `src/components/security/TurnstileWidget.tsx` | CAPTCHA Turnstile |
| `src/main.tsx` | Sentry init + scrub PII |
| `vite.config.ts` | Sentry plugin + console drop |
| `.env.example` | Variáveis de segurança documentadas |
