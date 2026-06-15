# Checklist de Lançamento em Produção — Lumen Pastoral
**Data:** 2026-06-14  
**Sprint:** 037  
**Classificação:** ✅ OK · ⚠️ ATENÇÃO · ❌ BLOQUEADOR

---

## ÁREA 1 — BANCO DE DADOS (Supabase)

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 1.1 | Migrations 001–035 aplicadas | ✅ OK | — |
| 1.2 | Aplicar `PATCH_REMOVE_TRIGGER_LEGADO.sql` | ❌ BLOQUEADOR | Remover `tg_escala_membro_pontuacao` antes de qualquer escala solene |
| 1.3 | Aplicar `036_sprint_estabilizacao.sql` | ❌ BLOQUEADOR | Remove trigger P0 de scores; cria 9 índices críticos; corrige RLS ministérios |
| 1.4 | Aplicar `037_missing_columns.sql` | ❌ BLOQUEADOR | 23 colunas + 6 tabelas não rastreadas nas migrations anteriores |
| 1.5 | Executar `VERIFICAR_RECONSTRUCAO.sql` | ❌ BLOQUEADOR | Rodar após 036+037 e confirmar 0 linhas com ❌ |
| 1.6 | RLS habilitado em `profiles` | ❌ BLOQUEADOR | Incluído em 037; verificar via `pg_tables` antes de produção |
| 1.7 | `membro_self_link` com paroquia_id | ❌ BLOQUEADOR | Incluído em 037; sem isso qualquer usuário pode sequestrar conta cross-paróquia por e-mail |
| 1.8 | `historico_score_trigger` removido | ❌ BLOQUEADOR | Scores de membros corrompidos enquanto trigger ativo |
| 1.9 | Índice `idx_membros_auth_user_id` | ❌ BLOQUEADOR | Todo request autenticado faz seq scan em membros sem este índice |
| 1.10 | RLS em todas as tabelas de dados | ✅ OK | Coberto pelas migrations 001–037 |
| 1.11 | Função `current_paroquia_id()` criada | ✅ OK | Migration 010 |
| 1.12 | Extension `pgcrypto` habilitada | ⚠️ ATENÇÃO | Verificar via `SELECT * FROM pg_extension WHERE extname='pgcrypto'`; necessária para `gen_random_uuid()` |
| 1.13 | Extension `pg_net` habilitada | ⚠️ ATENÇÃO | Necessária para Edge Functions chamarem o banco; verificar no Dashboard → Extensions |
| 1.14 | Backup automático configurado | ⚠️ ATENÇÃO | Plano Pro habilita PITR (Point in Time Recovery); verificar se ativo |
| 1.15 | Connection pooling (PgBouncer) | ⚠️ ATENÇÃO | Supabase oferece pooler na porta 6543; app deve usar connection string com pooler para prod |

---

## ÁREA 2 — STORAGE

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 2.1 | Bucket `avatares` criado | ⚠️ ATENÇÃO | Criar via Dashboard → Storage se ainda não existir |
| 2.2 | Bucket `fotos-membros` criado | ⚠️ ATENÇÃO | Criar para `membros.foto_url` |
| 2.3 | Bucket `documentos` criado | ⚠️ ATENÇÃO | Criar para CPF/RG scan se implementado |
| 2.4 | Storage policies configuradas | ⚠️ ATENÇÃO | Cada bucket deve ter policy: `owner = auth.uid()` para upload; leitura por paróquia |
| 2.5 | Tamanho máximo de arquivo configurado | ⚠️ ATENÇÃO | Sugestão: 5MB para fotos, 10MB para documentos |
| 2.6 | CDN/Transform ativo | ✅ OK | Supabase Image Transformation incluso no plano Pro |

---

## ÁREA 3 — EDGE FUNCTIONS

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 3.1 | `reset-senha` deployada | ❌ BLOQUEADOR | Sem ela o fluxo de reset de senha falha silenciosamente |
| 3.2 | `enviar-email` (ou equivalente) deployada | ❌ BLOQUEADOR | E-mails transacionais (ativação, escalas) dependem desta função |
| 3.3 | `sync-auth-users` deployada (se existir) | ⚠️ ATENÇÃO | Verificar se usada em algum fluxo |
| 3.4 | Variáveis de ambiente das Edge Functions | ❌ BLOQUEADOR | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_*`, `RESEND_API_KEY` etc. devem estar no Dashboard → Edge Functions → Secrets |
| 3.5 | CORS configurado nas Edge Functions | ⚠️ ATENÇÃO | Headers `Access-Control-Allow-Origin` devem incluir o domínio de produção |
| 3.6 | Timeout configurado | ⚠️ ATENÇÃO | Default 150s; batch de emails pode precisar de ajuste |

---

## ÁREA 4 — SMTP / E-MAIL

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 4.1 | SMTP configurado no Supabase Dashboard | ❌ BLOQUEADOR | Settings → Auth → SMTP: host, port, user, password |
| 4.2 | Domínio remetente verificado (SPF/DKIM) | ❌ BLOQUEADOR | Sem SPF/DKIM e-mails vão para spam ou são rejeitados |
| 4.3 | Template "Confirmação de E-mail" customizado | ⚠️ ATENÇÃO | Supabase usa template genérico; customizar via Dashboard → Auth → Email Templates |
| 4.4 | Template "Reset de Senha" customizado | ⚠️ ATENÇÃO | Deve apontar para `/ativar-conta` (primeiro acesso) ou `/reset-senha` |
| 4.5 | Template "Convite" desativado (se não usado) | ⚠️ ATENÇÃO | Fluxo usa ativação manual; desativar convite automático do Supabase |
| 4.6 | `email_logs` coletando dados | ✅ OK | Migration cria tabela; Edge Function deve gravar após cada envio |
| 4.7 | Rate limit de SMTP | ⚠️ ATENÇÃO | Bulk sends de ativação devem respeitar limite do provedor SMTP (ex: Resend: 100/s) |

---

## ÁREA 5 — AUTENTICAÇÃO

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 5.1 | Site URL configurada | ❌ BLOQUEADOR | Dashboard → Auth → URL Configuration → Site URL = domínio de produção |
| 5.2 | Redirect URLs permitidas | ❌ BLOQUEADOR | Adicionar `https://seudominio.com/**` em "Redirect URLs" |
| 5.3 | Magic Link habilitado | ✅ OK | Migration 017 |
| 5.4 | Duração de sessão configurada | ⚠️ ATENÇÃO | Default 1 semana; definir conforme política de segurança |
| 5.5 | MFA (TOTP) habilitado | ⚠️ ATENÇÃO | Dashboard → Auth → Multi Factor → habilitar TOTP se ainda não feito |
| 5.6 | Rate limit de login | ✅ OK | Supabase aplica rate limit nativo por IP |
| 5.7 | OTP expiry em 1 hora | ✅ OK | Configurado na migration; verificar no Dashboard → Auth → OTP Expiry |
| 5.8 | Conta ativada antes de acesso | ✅ OK | Migrations 012–013 + RLS |

---

## ÁREA 6 — DOMÍNIO E DNS

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 6.1 | Domínio de produção apontado | ⚠️ ATENÇÃO | Configurar CNAME/A Record no provedor DNS apontando para CDN/hosting |
| 6.2 | HTTPS habilitado (SSL) | ⚠️ ATENÇÃO | Verificar certificado TLS válido; Let's Encrypt ou CDN |
| 6.3 | Domínio customizado no Supabase | ⚠️ ATENÇÃO | Dashboard → Settings → Custom Domain: configurar se quiser URL amigável para Auth |
| 6.4 | WWW redirect configurado | ⚠️ ATENÇÃO | `www.seudominio.com` deve redirecionar para `seudominio.com` (ou vice-versa) |
| 6.5 | SPF Record | ❌ BLOQUEADOR | `TXT @ "v=spf1 include:seusmtp.com ~all"` — necessário para entrega de e-mails |
| 6.6 | DKIM Record | ❌ BLOQUEADOR | Chave fornecida pelo provedor SMTP |
| 6.7 | DMARC Record | ⚠️ ATENÇÃO | `TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:dmarc@seudominio.com"` |

---

## ÁREA 7 — VARIÁVEIS DE AMBIENTE DO FRONTEND

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 7.1 | `VITE_SUPABASE_URL` = URL de produção | ❌ BLOQUEADOR | Não pode apontar para projeto de dev |
| 7.2 | `VITE_SUPABASE_ANON_KEY` = chave de produção | ❌ BLOQUEADOR | Chave anon do projeto de produção (Dashboard → API) |
| 7.3 | `VITE_SUPABASE_URL` não expõe `service_role` | ✅ OK | `anon key` é pública; `service_role` NUNCA deve estar no frontend |
| 7.4 | Build de produção sem `console.log` sensíveis | ⚠️ ATENÇÃO | `vite.config.ts` já tem `drop: ['console', 'debugger']` em prod |
| 7.5 | Source maps desabilitados em prod | ⚠️ ATENÇÃO | Verificar `build.sourcemap = false` no `vite.config.ts` |

---

## ÁREA 8 — MONITORAMENTO E LOGS

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 8.1 | Supabase Dashboard Logs ativo | ✅ OK | Incluso em todos os planos |
| 8.2 | Alertas de erro de Edge Function | ⚠️ ATENÇÃO | Configurar webhook ou integração Slack para erros 5xx |
| 8.3 | `audit_log` cobrindo ações críticas | ✅ OK | Migrations 009, 031 |
| 8.4 | `email_logs` monitorado | ✅ OK | Tabela criada; painel de auditoria de falhas (migration 033) |
| 8.5 | Query performance via `pg_stat_statements` | ⚠️ ATENÇÃO | Ativar no Supabase Dashboard → Database → Extensions → pg_stat_statements |
| 8.6 | Alertas de banco (CPU/conexões) | ⚠️ ATENÇÃO | Dashboard → Settings → Alerts: configurar limites de CPU e conexões |
| 8.7 | Uptime monitoring externo | ⚠️ ATENÇÃO | Usar UptimeRobot / BetterUptime na URL de produção |

---

## ÁREA 9 — BACKUPS

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 9.1 | PITR habilitado (Plano Pro) | ❌ BLOQUEADOR | Point-in-Time Recovery: mínimo necessário para produção real |
| 9.2 | Backup diário automático | ✅ OK | Incluso no Plano Pro |
| 9.3 | Teste de restore documentado | ⚠️ ATENÇÃO | Testar restore manual pelo menos uma vez antes do lançamento |
| 9.4 | Exportação periódica de `membros` | ⚠️ ATENÇÃO | Script de backup extra para dados sensíveis (CPF/RG), fora do Supabase |

---

## ÁREA 10 — SEGURANÇA FINAL

| # | Item | Status | Ação necessária |
|---|------|--------|-----------------|
| 10.1 | `service_role` key não exposta | ✅ OK | Só Edge Functions e backend usam |
| 10.2 | CPF armazenado criptografado (`cpf_enc`) | ⚠️ ATENÇÃO | `cpf_enc` em BYTEA; verificar se chave AES está em secret (não no código) |
| 10.3 | CPF em texto plano removido (após migração) | ⚠️ ATENÇÃO | Após migrar dados para `cpf_enc`, zerar coluna `cpf` |
| 10.4 | Rate limiting nas Edge Functions | ⚠️ ATENÇÃO | Implementar no próprio código ou via Cloudflare Workers |
| 10.5 | Headers de segurança HTTP | ⚠️ ATENÇÃO | CSP, X-Frame-Options, HSTS via CDN (Cloudflare/Vercel) |
| 10.6 | Secrets rotacionados regularmente | ⚠️ ATENÇÃO | `SUPABASE_SERVICE_ROLE_KEY` e chaves SMTP a cada 90 dias |
| 10.7 | Vulnerabilidade `membro_self_link` corrigida | ❌ BLOQUEADOR | Aplicar migration 037 |
| 10.8 | RLS em `profiles` habilitado | ❌ BLOQUEADOR | Aplicar migration 037 |

---

## RESUMO EXECUTIVO

| Status | Qtd | Área principal |
|--------|-----|----------------|
| ❌ BLOQUEADOR | **18** | Banco (patches pendentes), Auth URLs, SMTP, DNS, Env vars, RLS |
| ⚠️ ATENÇÃO | **22** | Storage, Monitoramento, Backups, Segurança operacional |
| ✅ OK | **13** | Core do sistema, RLS de dados, audit log, motor de escalas |

---

## ORDEM DE EXECUÇÃO RECOMENDADA

```
Passo 1 ── Supabase Dashboard
  1. Aplicar PATCH_REMOVE_TRIGGER_LEGADO.sql      [BLOQUEADOR]
  2. Aplicar 036_sprint_estabilizacao.sql         [BLOQUEADOR]
  3. Aplicar 037_missing_columns.sql              [BLOQUEADOR]
  4. Executar VERIFICAR_RECONSTRUCAO.sql          [verificação]
  5. Configurar SMTP                              [BLOQUEADOR]
  6. Configurar Site URL + Redirect URLs          [BLOQUEADOR]

Passo 2 ── DNS / Domínio
  7. Apontar domínio para hosting                 [BLOQUEADOR]
  8. Configurar SPF + DKIM no DNS                 [BLOQUEADOR]
  9. Habilitar HTTPS                              [BLOQUEADOR]

Passo 3 ── Infraestrutura
  10. Deploy Edge Functions (reset-senha, enviar-email)  [BLOQUEADOR]
  11. Configurar secrets nas Edge Functions        [BLOQUEADOR]
  12. Criar buckets Storage + policies             [ATENÇÃO]

Passo 4 ── Frontend
  13. Atualizar .env.production com URL/key de produção  [BLOQUEADOR]
  14. Build e deploy (`npm run build`)             [—]

Passo 5 ── Verificação final
  15. Testar fluxo completo: cadastro → ativação → login → escala
  16. Testar reset de senha
  17. Verificar e-mail nos logs (email_logs)
  18. Confirmar scores de membros corretos
```

---

*Gerado automaticamente pelo Sprint 037 — Preparação para Produção*  
*Lumen Pastoral — 2026-06-14*
