# Plano de Execução — Lançamento em Produção
**Lumen Pastoral** · Project ref: `cusuoggmlhtvrclrzvfr`  
Tempo estimado: 2–3 horas · Execute em ordem, valide cada etapa antes de avançar.

---

## FASE 1 — BANCO DE DADOS (Supabase SQL Editor)

> **Onde:** [supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new](https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new)  
> Execute cada bloco separadamente. Leia o resultado antes de avançar.

---

### 1.1 · Remover trigger legado de pontuação

Cole e execute o arquivo inteiro:

```
supabase/PATCH_REMOVE_TRIGGER_LEGADO.sql
```

**Validação após execução:**
```sql
-- Deve retornar 0 linhas
SELECT tgname FROM pg_trigger
JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
WHERE tgname = 'tg_escala_membro_pontuacao';
```
✅ Esperado: `0 rows`

---

### 1.2 · Aplicar Sprint 036 (trigger P0 + índices + RLS ministérios)

Cole e execute o arquivo inteiro:

```
supabase/migrations/036_sprint_estabilizacao.sql
```

**Validação após execução:**
```sql
-- Trigger P0 removido
SELECT tgname FROM pg_trigger
JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
WHERE tgname = 'historico_score_trigger';
-- Esperado: 0 rows

-- Índices criados (deve retornar 9 linhas)
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_membros_auth_user_id',
    'idx_membros_paroquia_id',
    'idx_escala_membros_membro_id',
    'idx_escala_membros_escala_id',
    'idx_historico_participacoes_membro_id',
    'idx_historico_participacoes_paroquia_id',
    'idx_notificacoes_destinatario_id',
    'idx_notificacoes_paroquia_id',
    'idx_indisponibilidades_membro_data'
  );
-- Esperado: 9 rows
```

---

### 1.3 · Aplicar Sprint 037 (colunas faltantes + segurança)

Cole e execute o arquivo inteiro:

```
supabase/migrations/037_missing_columns.sql
```

**Validação após execução** — o próprio script imprime blocos H1–H5 no resultado.  
Verifique manualmente:

```sql
-- Colunas críticas em membros
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'membros'
  AND column_name IN ('auth_user_id','sexo','tipo_acesso','foto_url',
                      'restricoes_dia_semana','conta_ativada','prioridade_escala')
ORDER BY column_name;
-- Esperado: 7 rows

-- profiles com RLS
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'profiles';
-- Esperado: rowsecurity = true

-- membro_self_link com paroquia_id
SELECT qual FROM pg_policies
WHERE tablename = 'membros' AND policyname = 'membro_self_link';
-- Esperado: texto contém 'paroquia_id'
```

---

### 1.4 · Verificação de reconstrução completa

Cole e execute o arquivo inteiro:

```
supabase/VERIFICAR_RECONSTRUCAO.sql
```

**Critério de aprovação:** todas as linhas com `✅ OK`. Nenhuma linha com `❌`.  
Se aparecer `❌`, não avance — resolva antes.

---

### 1.5 · Verificar integridade de scores dos membros

```sql
-- Deve retornar 0 membros com score divergente
SELECT m.nome, m.score AS score_atual,
       COALESCE(SUM(hp.pontos), 0) AS score_correto
FROM public.membros m
LEFT JOIN public.historico_participacoes hp ON hp.membro_id = m.id
WHERE m.ativo = true
GROUP BY m.id, m.nome, m.score
HAVING m.score != COALESCE(SUM(hp.pontos), 0)
LIMIT 20;
```

Se houver divergências (scores corrompidos pelo trigger P0 que ainda estava ativo):

```sql
-- Recalcular todos os scores
UPDATE public.membros m
SET score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM public.historico_participacoes hp
  WHERE hp.membro_id = m.id
)
WHERE m.ativo = true;
```

---

## FASE 2 — SUPABASE AUTH

> **Onde:** Dashboard → Authentication

---

### 2.1 · Configurar URL do site

**Dashboard → Authentication → URL Configuration**

| Campo | Valor |
|-------|-------|
| **Site URL** | `https://seudominio.com.br` |
| **Redirect URLs** | `https://seudominio.com.br/**` |

> Sem isso o Supabase recusa redirecionamentos após login/ativação.

**Validação:** tente gerar um magic link manualmente:
```sql
-- No SQL Editor (não retorna o link, mas confirma que não dá erro)
SELECT auth.uid();
```

---

### 2.2 · Configurar expiração de OTP

**Dashboard → Authentication → Auth Policies**

| Campo | Valor recomendado |
|-------|-------------------|
| OTP expiry | `3600` (1 hora) |
| JWT expiry | `604800` (7 dias) |

---

### 2.3 · Desabilitar confirmação de e-mail automática do Supabase

O app usa a Edge Function `send-email` para enviar e-mails com link de ativação personalizado. O fluxo nativo do Supabase deve ficar **desligado** para não gerar um segundo e-mail genérico.

**Dashboard → Authentication → Auth Policies**

- `Enable email confirmations` → **OFF** (o app controla o envio manualmente)
- `Enable phone confirmations` → OFF (não usado)

> ⚠️ Se deixar ON, o membro receberá 2 e-mails ao ser aprovado: um do Supabase (genérico) e um do Lumen (personalizado).

---

### 2.4 · Verificar extensions do banco

**Dashboard → Database → Extensions**

Confirme que estão **habilitadas**:
- ✅ `pgcrypto` — para `gen_random_uuid()`
- ✅ `pg_net` — para calls HTTP nas Edge Functions (se usada)
- ✅ `pg_stat_statements` — monitoramento de queries lentas

---

## FASE 3 — STORAGE

> **Onde:** Dashboard → Storage

---

### 3.1 · Criar buckets

Crie os seguintes buckets se ainda não existirem:

| Bucket | Acesso público | Uso |
|--------|---------------|-----|
| `avatares` | **Público** | Foto de perfil do membro (`membros.foto_url`) |
| `documentos` | **Privado** | Upload de documentos futuros (CPF scan, etc.) |

**Como criar:**  
Storage → New bucket → preencha o nome → marque "Public bucket" apenas para `avatares`.

---

### 3.2 · Configurar policies de Storage via SQL

```sql
-- Policy: qualquer autenticado pode fazer upload no próprio avatar
CREATE POLICY "avatares_upload_proprio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatares'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: leitura pública dos avatares
CREATE POLICY "avatares_leitura_publica" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatares');

-- Policy: dono pode atualizar/deletar o próprio avatar
CREATE POLICY "avatares_delete_proprio" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatares'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

---

## FASE 4 — EDGE FUNCTIONS

> **Pré-requisito:** Supabase CLI instalado  
> `npm install -g supabase` ou `winget install Supabase.CLI`

---

### 4.1 · Login no CLI

```powershell
supabase login
# Abrirá o navegador — faça login com a conta do Supabase
```

---

### 4.2 · Configurar secrets das Edge Functions

```powershell
supabase secrets set `
  RESEND_API_KEY="re_XXXXXXXXXXXXXXXXXXXXXXXXXX" `
  SITE_URL="https://seudominio.com.br" `
  EMAIL_FROM="Portal Lumen <noreply@seudominio.com.br>" `
  TURNSTILE_SECRET_KEY="0x4AAAAAAAAAAAAAAAAAAAAAA" `
  --project-ref cusuoggmlhtvrclrzvfr
```

> ⚠️ `EMAIL_FROM`: o domínio após `@` **deve estar verificado no Resend** (ver Fase 6.2).  
> Enquanto o domínio não estiver verificado, use `onboarding@resend.dev`.

**Confirmar que os secrets foram salvos:**

```powershell
supabase secrets list --project-ref cusuoggmlhtvrclrzvfr
```
Deve listar: `RESEND_API_KEY`, `SITE_URL`, `EMAIL_FROM`, `TURNSTILE_SECRET_KEY`.

---

### 4.3 · Deploy das Edge Functions

```powershell
# Função principal de e-mails
supabase functions deploy send-email --project-ref cusuoggmlhtvrclrzvfr

# Funções de conteúdo litúrgico
supabase functions deploy liturgia-diaria --project-ref cusuoggmlhtvrclrzvfr
supabase functions deploy homilia-diaria  --project-ref cusuoggmlhtvrclrzvfr
```

**Validação de deploy:**

```powershell
supabase functions list --project-ref cusuoggmlhtvrclrzvfr
```

Esperado: `send-email`, `liturgia-diaria`, `homilia-diaria` com status `ACTIVE`.

---

### 4.4 · Testar Edge Function send-email

```powershell
# Substitua pelo seu token de acesso (anon key) e um e-mail real
curl -X POST https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/send-email `
  -H "Authorization: Bearer ANON_KEY_AQUI" `
  -H "Content-Type: application/json" `
  -d '{
    "template": "boas_vindas",
    "to": "seuemail@teste.com",
    "nome": "Teste Produção",
    "paroquia": "Nossa Senhora Teste"
  }'
```

✅ Resposta esperada: `{"ok":true,"id":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}`  
❌ `{"ok":false,"error":"RESEND_API_KEY not configured"}` → secrets não foram salvos (refaça 4.2)  
❌ `{"ok":false,"error":"Resend 403: ..."}` → domínio não verificado (ver 6.2)

---

### 4.5 · Verificar log de e-mail no banco

```sql
SELECT tipo, destinatario, status, provider_id, erro, created_at
FROM public.email_logs
ORDER BY created_at DESC
LIMIT 5;
```

O teste do passo 4.4 deve aparecer aqui com `status = 'enviado'`.

---

## FASE 5 — RESEND (provedor de e-mail)

> **Onde:** [resend.com](https://resend.com) → login

---

### 5.1 · Criar API Key de produção

**Resend → API Keys → Create API Key**

- Name: `lumen-pastoral-producao`
- Permission: `Sending access`

Copie a chave e use no passo 4.2 (`RESEND_API_KEY`).

---

### 5.2 · Verificar domínio remetente

**Resend → Domains → Add Domain**

1. Adicione o domínio da paróquia (ex: `suaparoquia.com.br`)
2. O Resend fornecerá registros DNS para adicionar:

| Tipo | Host | Valor |
|------|------|-------|
| `TXT` | `resend._domainkey` | `p=MIGfMA0GCSq...` (DKIM) |
| `MX` | `@` ou subdomínio | Registros fornecidos pelo Resend |

3. Adicione estes registros no seu provedor DNS (ver Fase 6)
4. Aguarde verificação (15 min a 48h dependendo do TTL)
5. Status no Resend mudará de `Pending` para `Verified`

> ⚠️ Sem domínio verificado, e-mails ficam limitados a `onboarding@resend.dev` (só para o e-mail dono da conta Resend).

---

## FASE 6 — DNS E DOMÍNIO

> Configure no painel do seu registrador de domínio (GoDaddy, Registro.br, Cloudflare, etc.)

---

### 6.1 · Apontar domínio para Vercel

No painel DNS do seu domínio, adicione:

```
# Para domínio raiz (seudominio.com.br):
Tipo: A
Host: @
Valor: 76.76.21.21     ← IP do Vercel

# OU usando CNAME (para www):
Tipo: CNAME
Host: www
Valor: cname.vercel-dns.com
```

> Se usar Cloudflare: adicione o domínio no Cloudflare e aponte os nameservers. O Vercel detecta automaticamente.

---

### 6.2 · Registros SPF e DKIM (obrigatórios para e-mail)

```
# SPF — autoriza o Resend a enviar e-mails pelo seu domínio
Tipo: TXT
Host: @
Valor: "v=spf1 include:amazonses.com ~all"
# (o Resend usa SES internamente — confirme no dashboard do Resend qual valor usar)

# DKIM — fornecido pelo Resend no passo 5.2
Tipo: TXT
Host: resend._domainkey
Valor: p=MIGfMA0GCSq... (copie do Resend)

# DMARC — opcional mas recomendado
Tipo: TXT
Host: _dmarc
Valor: "v=DMARC1; p=quarantine; rua=mailto:dmarc@seudominio.com.br"
```

**Verificar propagação DNS (após 15–30 min):**

```powershell
# SPF
Resolve-DnsName -Name "seudominio.com.br" -Type TXT

# DKIM
Resolve-DnsName -Name "resend._domainkey.seudominio.com.br" -Type TXT
```

Ou via web: [toolbox.googleapps.com/apps/checkmx](https://toolbox.googleapps.com/apps/checkmx)

---

### 6.3 · Domínio customizado no Supabase (opcional mas recomendado)

**Dashboard → Settings → Custom Domains**

Configure `auth.seudominio.com.br` para que os links de autenticação usem seu domínio em vez de `cusuoggmlhtvrclrzvfr.supabase.co`.

---

## FASE 7 — VERCEL (FRONTEND)

---

### 7.1 · Variáveis de ambiente de produção

**Vercel Dashboard → Project → Settings → Environment Variables**

Adicione as variáveis abaixo com escopo **Production**:

| Variável | Valor | Nota |
|----------|-------|------|
| `VITE_SUPABASE_URL` | `https://cusuoggmlhtvrclrzvfr.supabase.co` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Anon/Publishable key do Supabase |
| `VITE_SUPABASE_PROJECT_ID` | `cusuoggmlhtvrclrzvfr` | ID do projeto |
| `VITE_SENTRY_DSN` | `https://xxx@o0.ingest.sentry.io/0` | Se Sentry estiver configurado |
| `VITE_TURNSTILE_SITE_KEY` | `0x4AAAAAAAAAAAAAAAAAAA` | Chave pública do Cloudflare Turnstile |
| `SENTRY_AUTH_TOKEN` | `sntrys_...` | Apenas para upload de source maps no CI |
| `SENTRY_ORG` | `sua-org` | Org do Sentry |
| `SENTRY_PROJECT` | `lumen-pastoral` | Projeto do Sentry |

> As chaves `VITE_*` ficam visíveis no bundle do frontend — **nunca coloque `service_role` aqui**.

---

### 7.2 · Adicionar domínio customizado no Vercel

**Vercel → Project → Settings → Domains → Add**

1. Digite `seudominio.com.br`
2. O Vercel mostrará os registros DNS necessários (geralmente um A record ou CNAME)
3. Configure no seu DNS (ver 6.1)
4. Aguarde verificação (ícone verde aparece em até 5 min após DNS propagar)

---

### 7.3 · Deploy em produção

```powershell
# No terminal, na raiz do projeto:
git push origin main
# O Vercel faz deploy automático a partir do push para main.

# OU force um redeploy manual:
# Vercel Dashboard → Deployments → (último deploy) → "Redeploy"
```

**Verificar se o build passou:**

- Vercel → Deployments → ver logs de build
- Build deve terminar com `Build Completed`
- Sem erros TypeScript que bloqueiem o build (os 3 erros pre-existentes são warnings, não bloqueiam)

---

### 7.4 · Verificar deploy

Abra `https://seudominio.com.br` no navegador:

- [ ] Página inicial carrega sem erro de console
- [ ] Nenhum `Failed to fetch` no console (indica URL Supabase errada)
- [ ] Aba Network → verificar que requests vão para `cusuoggmlhtvrclrzvfr.supabase.co`

---

## FASE 8 — VALIDAÇÃO FINAL (SMOKE TESTS)

Execute estes testes em ordem no ambiente de produção:

---

### 8.1 · Fluxo de cadastro e ativação

1. Acesse `/solicitar-acesso` (ou o cadastro público)
2. Preencha os dados de um membro fictício de teste
3. Faça login como **admin/coordenador** no painel
4. Vá em **Membros → Pendentes** — o membro deve aparecer
5. Aprove o cadastro e envie o e-mail de ativação
6. Verifique a caixa de entrada do e-mail de teste

**Validação no banco:**
```sql
-- O membro deve ter conta_ativada = false, token_acesso preenchido
SELECT nome, email, conta_ativada, ativo, token_acesso
FROM public.membros
WHERE email = 'email-de-teste@exemplo.com';
```

7. Clique no link do e-mail → deve redirecionar para `/membro/primeiro-acesso`
8. Crie uma senha → deve redirecionar para `/completar-cadastro`
9. Preencha o cadastro → deve redirecionar para o portal do membro

**Validação após ativação:**
```sql
SELECT nome, conta_ativada, perfil_completo, auth_user_id
FROM public.membros
WHERE email = 'email-de-teste@exemplo.com';
-- Esperado: conta_ativada = true, perfil_completo = true, auth_user_id NOT NULL
```

---

### 8.2 · Fluxo de reset de senha

1. Acesse `/login` → clique em "Esqueci minha senha"
2. Digite o e-mail do membro de teste
3. Verifique a caixa de entrada — deve chegar e-mail de reset

**Validação no banco:**
```sql
SELECT tipo, destinatario, status, erro
FROM public.email_logs
WHERE tipo = 'reset_senha'
ORDER BY created_at DESC LIMIT 3;
-- Esperado: status = 'enviado', erro NULL
```

---

### 8.3 · Fluxo de escala (coordenador)

1. Login como coordenador
2. Crie uma nova escala em **Escalas → Nova**
3. Gere a escala automática → membros devem aparecer distribuídos
4. Publique a escala
5. Login como membro de teste no portal
6. Membro deve ver a escala em **Minhas escalas**
7. Membro confirma presença → status muda para `confirmado`

---

### 8.4 · Verificar scores após confirmação

```sql
-- Após confirmar presença e auto-pontuação rodar:
SELECT m.nome, m.score,
       COUNT(hp.id) AS num_registros,
       SUM(hp.pontos) AS soma_pontos
FROM public.membros m
LEFT JOIN public.historico_participacoes hp ON hp.membro_id = m.id
WHERE m.ativo = true
GROUP BY m.id, m.nome, m.score
HAVING m.score != COALESCE(SUM(hp.pontos), 0)
LIMIT 5;
-- Esperado: 0 rows (scores todos corretos)
```

---

### 8.5 · Verificar isolamento entre paróquias

```sql
-- Se houver mais de uma paróquia no banco:
-- Confirmar que nenhum membro de A aparece para coordenador de B
SELECT p.nome AS paroquia, COUNT(m.id) AS membros
FROM public.paroquias p
LEFT JOIN public.membros m ON m.paroquia_id = p.id AND m.ativo = true
GROUP BY p.id, p.nome
ORDER BY p.nome;
-- Anote os counts esperados por paróquia
```

---

## FASE 9 — PÓS-LANÇAMENTO (primeiras 24h)

---

### 9.1 · Monitorar logs de e-mail

```sql
-- Verificar entregas e falhas das primeiras horas
SELECT
  tipo,
  COUNT(*) FILTER (WHERE status = 'enviado') AS enviados,
  COUNT(*) FILTER (WHERE status = 'erro')    AS erros
FROM public.email_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY tipo
ORDER BY tipo;
```

---

### 9.2 · Monitorar performance de queries

**Dashboard → Database → Query Performance**

Queries mais lentas devem envolver as tabelas cobertas pelos índices da migration 036. Se alguma query em `membros`, `escala_membros` ou `notificacoes` aparece no top-10, verifique se os índices foram criados:

```sql
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
```

---

### 9.3 · Verificar Supabase Dashboard Logs

**Dashboard → Logs → Edge Functions**  
Filtre por `send-email` — todos os envios devem ter status `200`.  
Erros `503` = secrets não configurados. Erros `502` = Resend rejeitou (domínio, chave).

---

## REFERÊNCIA RÁPIDA

| Recurso | URL |
|---------|-----|
| Supabase Dashboard | [supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr](https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr) |
| SQL Editor | [.../sql/new](https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new) |
| Auth Config | [.../auth/url-configuration](https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/auth/url-configuration) |
| Edge Functions Logs | [.../functions](https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/functions) |
| Storage | [.../storage/buckets](https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/storage/buckets) |
| Resend | [resend.com/domains](https://resend.com/domains) |
| Verificar DNS | [toolbox.googleapps.com/apps/checkmx](https://toolbox.googleapps.com/apps/checkmx) |

---

## ORDEM MÍNIMA PARA GO-LIVE

Se precisar lançar hoje com o mínimo de risco:

```
1. [30 min] Fases 1.1 → 1.4  (patches SQL + verificação)
2. [10 min] Fase 2.1          (Site URL no Supabase Auth)
3. [10 min] Fase 4.2          (secrets das Edge Functions)
4. [10 min] Fase 4.3          (deploy send-email)
5. [10 min] Fase 4.4          (teste de e-mail)
6. [20 min] Fase 7.1 → 7.3   (Vercel env vars + deploy)
7. [20 min] Fase 8.1          (smoke test fluxo completo)
─────────────────────────────
Total: ~110 min

Fase 5 (Resend + domínio verificado) pode ser feita em paralelo
Fases 6 e 9 podem ser completadas nas 24h seguintes sem bloquear o lançamento
```

---

*Lumen Pastoral · Plano gerado em 2026-06-15 · Sprints 036 e 037 completos*
