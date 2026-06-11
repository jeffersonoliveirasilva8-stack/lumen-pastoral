# Templates de E-mail — Lumen Pastoral

## Como aplicar no Supabase Dashboard

1. Acesse: **Supabase Dashboard → Authentication → Email Templates**
2. Para cada template abaixo, clique no tipo correspondente, substitua o conteúdo pelo HTML do arquivo e salve.

| Arquivo | Template no Dashboard |
|---|---|
| `magic-link.html` | **Magic Link** |
| `reset-password.html` | **Reset Password** |
| `confirm-signup.html` | **Confirm Signup** |

## Assuntos sugeridos (campo "Subject")

| Template | Assunto sugerido |
|---|---|
| Magic Link | `Portal Pastoral — Seu link de acesso` |
| Reset Password | `Portal Pastoral — Redefinição de senha` |
| Confirm Signup | `Portal Pastoral — Confirme seu e-mail` |

> Os templates do Dashboard não suportam variáveis customizadas (nome do membro, paróquia).
> Para e-mails com personalização completa (aprovação, boas-vindas), use a Edge Function `send-email`.

## Variáveis disponíveis nos templates do Dashboard

| Variável | Descrição |
|---|---|
| `{{ .ConfirmationURL }}` | URL de ação (link principal) |
| `{{ .Email }}` | E-mail do destinatário |
| `{{ .Token }}` | Código OTP de 6 dígitos |
| `{{ .SiteURL }}` | URL base do projeto |
| `{{ .RedirectTo }}` | URL de redirecionamento configurado |

---

## Configuração do Resend (Edge Function send-email)

### 1. Criar conta e domínio

1. Crie conta em [resend.com](https://resend.com)
2. Vá em **Domains → Add Domain**
3. Adicione seu domínio (ex: `paroquia.com.br`)

### 2. Registros DNS obrigatórios

No painel DNS do seu domínio, adicione os registros que o Resend mostrar. Em geral:

| Tipo | Nome | Valor |
|---|---|---|
| **TXT** (SPF) | `@` | `v=spf1 include:amazonses.com ~all` |
| **CNAME** (DKIM) | `resend._domainkey` | valor fornecido pelo Resend |
| **TXT** (DMARC) | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:admin@paroquia.com.br` |

> O Resend mostra os valores exatos no Dashboard. Copie diretamente de lá.

### 3. Configurar secrets no Supabase

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxx
supabase secrets set SITE_URL=https://seuprojeto.com.br
supabase secrets set EMAIL_FROM="Nome da Paróquia <noreply@paroquia.com.br>"
```

Ou via Dashboard: **Supabase → Functions → Secrets**

### 4. Verificar SPF/DKIM/DMARC

Após adicionar os registros DNS, aguarde propagação (até 48h) e verifique:
- No Resend Dashboard: **Domains** → aguardar status "Verified"
- Ferramenta gratuita: [MXToolbox](https://mxtoolbox.com/SuperTool.aspx)

---

## Configuração de SMTP customizado (para e-mails do Dashboard)

Para que os templates `magic-link.html`, `reset-password.html` e `confirm-signup.html` saiam
do seu domínio em vez de `@supabase.io`:

Acesse: **Supabase Dashboard → Project Settings → Authentication → SMTP Settings**

Configure com as credenciais SMTP do Resend:
- **Host:** `smtp.resend.com`
- **Port:** `587`
- **User:** `resend`
- **Password:** sua chave de API do Resend (`re_xxxxxx`)
- **Sender email:** `noreply@paroquia.com.br`

---

## Diagrama de fluxo dos e-mails

```
Admin aprova membro
   └→ Edge Function send-email
        └→ template "ativacao_conta"
             └→ link para /membro/ativar-conta

Admin reenvia ativação
   └→ Edge Function send-email
        └→ template "reenvio_ativacao"
             └→ link para /membro/ativar-conta

Membro cadastro completo
   └→ Edge Function send-email
        └→ template "boas_vindas"
             └→ link para /portal-membro/home

Membro esqueceu senha (/esqueci-senha)
   └→ supabase.auth.resetPasswordForEmail (nativo)
        └→ Dashboard template "Reset Password"
             └→ link para /reset-senha?from=membro

Membro login com OTP
   └→ supabase.auth.signInWithOtp (nativo)
        └→ Dashboard template "Magic Link"
             └→ link configurado em redirectTo
```
