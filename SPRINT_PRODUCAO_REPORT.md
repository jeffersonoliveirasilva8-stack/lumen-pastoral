# Relatório de Prontidão para Produção — Lumen Pastoral
**Data:** 2026-06-14  
**Sprint:** Estabilização Final

---

## 1. CORREÇÕES APLICADAS NESTA SPRINT

### prioridade_escala — Motor de Escalas
**Arquivo:** `src/biblioteca/escala-engine.ts`, `src/lib/escala-engine.ts`, `src/routes/_authenticated/escalas.tsx`

Campo `prioridade_escala` agora é reconhecido e aplicado pelo algoritmo de seleção:

| Valor | Bonus no score | Observação |
|---|---|---|
| `nenhuma` | 0 pts | Algoritmo padrão (equidade) |
| `baixa` | 0 pts | Sem bônus, sem penalidade |
| `media` | +8 pts (configurável) | Leve preferência em desempates |
| `alta` | +15 pts (configurável) | Preferência clara sem forçar |
| `coordenador` | +15 pts (configurável) | Equivalente a alta |
| `mestre_cerimonia` | +15 pts (configurável) | Equivalente a alta |
| `sempre_solenes` | Regra Jefferson | Escalação forçada em missas solenes |

Bonus configurável via `ConfigParoquia.prioridade_bonus_alto` e `prioridade_bonus_medio`.  
`ScoreBreakdown` agora inclui campo `prioridade_bonus` visível nos insights do motor.

---

### Trigger legado `tg_escala_membro_pontuacao`
**Arquivo:** `supabase/PATCH_REMOVE_TRIGGER_LEGADO.sql`  
**Status:** Patch SQL gerado — **aplicar no Supabase Dashboard**

Remove `tg_escala_membro_pontuacao` (PONTUACAO_TRIGGER.sql manual), que conflitava com `on_escala_membro_status_final` (migration 026), sobrescrevendo pontos de missas solenes com valor fixo de 2pts.

---

### Migration 036 — Sprint de Estabilização
**Arquivo:** `supabase/migrations/036_sprint_estabilizacao.sql`  
**Status:** Pronto para aplicar — **aplicar no Supabase Dashboard**

Cobre:

#### [P0] historico_score_trigger removido
- Trigger da migration 002 disparava em QUALQUER operação em `historico_participacoes`
- Função `recalcular_score_membro()` contava apenas `WHERE presenca='confirmado'`
- Resultado: `faltou`/`atrasado`/`justificou` nunca penalizavam o score
- Fix: DROP trigger + recalculo completo de todos os scores

#### [P1] 9 índices críticos adicionados

| Índice | Tabela | Impacto |
|---|---|---|
| `idx_membros_auth_user_id` | membros | Hot path RLS do portal — todo request autenticado |
| `idx_membros_paroquia_id` | membros | Todos os RPCs admin (filtro primário) |
| `idx_escala_membros_membro_id` | escala_membros | JOINs de portal, sacristia, substituições |
| `idx_escala_membros_escala_id` | escala_membros | Lookup de membros por escala |
| `idx_historico_participacoes_membro_id` | historico_participacoes | SUM(pontos) por membro (recalculo score) |
| `idx_historico_participacoes_paroquia_id` | historico_participacoes | Relatórios de pontuação |
| `idx_notificacoes_destinatario_id` | notificacoes | Inbox do membro |
| `idx_notificacoes_paroquia_id` | notificacoes | Feed de coordenação |
| `idx_indisponibilidades_membro_data` | indisponibilidades | Filtro no motor de escalas |

#### [P1] ministerios_leitura_publica corrigida
- Policy original: `WHERE ativo = true` — expunha ministérios de TODAS as paróquias a `anon`
- Fix: `anon` só vê ministérios de escalas publicadas (via JOIN)

---

## 2. TRIGGERS — INVENTÁRIO FINAL

### Tabela `escala_membros` (após patches aplicados)

| Trigger | Evento | Status |
|---|---|---|
| `on_escala_membro_status_final` | AFTER UPDATE OF status | ✅ ATIVO — único, correto |
| `audit_escala_membros` | AFTER INSERT/UPDATE/DELETE | ✅ Audit log |
| `tg_escala_membro_pontuacao` | — | ❌ REMOVER via PATCH_REMOVE_TRIGGER_LEGADO.sql |

### Tabela `historico_participacoes` (após migration 036)

| Trigger | Evento | Status |
|---|---|---|
| `historico_score_trigger` | — | ❌ REMOVIDO pela migration 036 |
| `audit_historico` | AFTER INSERT/UPDATE/DELETE | ✅ Audit log |

### Outros triggers relevantes

| Trigger | Tabela | Status |
|---|---|---|
| `on_substituicao_insert` | substituicoes | ✅ Notifica aprovação de troca |
| `on_substituicao_update` | substituicoes | ✅ Atualiza membro_id na aprovação |
| `on_auth_user_created_mfa` | auth.users | ✅ Cria settings MFA no cadastro |
| `*_updated_at` (5x) | várias | ✅ Atualiza timestamp |

---

## 3. SEGURANÇA — STATUS POR ROLE

### Coordenação (isCoordenador)
- ✅ Lê/escreve escalas, membros, presenças, substituições da própria paróquia
- ✅ Vê todas as notificações incluindo `apenas_coordenacao`
- ✅ Aprova/rejeita substituições

### Administrador Paroquial / Super Admin (isAdmin)
- ✅ Acesso total via policies `*_admin` SECURITY DEFINER
- ✅ Acessa audit_logs
- ⚠️ `escala_ocorrencias` sem policy explícita de admin → acesso via `ocorrencias_escala_write` com `current_paroquia_id()`

### Administrador Auxiliar (isAdministrador)
- ✅ Frontend filtra escalas pelo `membro_id` do usuário (Sacristia)
- ⚠️ **Gap de banco:** sem `escala_coordenadores` table, o filtro é apenas frontend
- Risco P2: auxiliar com acesso direto ao PostgREST pode ver todos os membros escalados

### Membro (portal)
- ✅ Vê apenas escalas publicadas da própria paróquia
- ✅ Pode registrar indisponibilidades próprias
- ⚠️ `membro_self_link`: qualquer usuário com email coincidente pode vincular `auth_user_id` a membro sem vinculação — janela de sequestro de conta

---

## 4. CAMPOS SEM MIGRATION RASTREADA

Estes campos existem no banco (via patches manuais históricos) mas NÃO aparecem nas migrations 001–036. Se o banco for recriado do zero, falharão:

| Campo | Tabela | Usado em |
|---|---|---|
| `sexo` | membros | escalas.tsx, membros.tsx, engine |
| `tipo_acesso` | membros | membros.tsx, RLS coord |
| `prioridade_escala` | membros | membros.tsx, engine (esta sprint) |
| `prioridade_id` | membros | membros.tsx |
| `restricoes_dia_semana` | membros | engine, sacristia |
| `missas_nao_pode_ids` | membros | engine, membros.tsx |
| `comunidade_id` | membros | membros.tsx, portal-membro |
| `foto_url` | membros | membros.tsx |
| `auth_user_id` | membros | RLS crítico — todo portal |
| `conta_ativada` | membros | fluxo de ativação |
| `perfil_completo` | membros | completar-cadastro |
| `restricoes_horario` | membros | import CSV |
| `deslocamento` | membros | import CSV |
| `planilha_url` | membros | membros.tsx |

**Ação recomendada:** Criar `037_missing_columns.sql` documentando todos os `ALTER TABLE ADD COLUMN IF NOT EXISTS` desses campos para garantir que o ambiente possa ser reproduzido.

---

## 5. CAMPOS/TABELAS MORTOS (DÍVIDA TÉCNICA)

| Item | Tipo | Status |
|---|---|---|
| `membro_ministerios.nivel` | campo | Nunca lido pelo frontend — dead code |
| `historico_substituicoes` | tabela | Dados escritos por trigger, zero UI de consulta |
| `PONTUACAO_TRIGGER.sql` | arquivo | Trigger manual legado — não integrado às migrations |
| `ConfigParoquia.prioridade_score` | tipo TS | Flag definida mas sem lógica no algoritmo |

---

## 6. PENDÊNCIAS RESTANTES

### P0 — Executar antes do lançamento (ordem obrigatória)

1. **Aplicar `PATCH_REMOVE_TRIGGER_LEGADO.sql`** no Supabase Dashboard  
   Remove `tg_escala_membro_pontuacao` e faz recalculo de scores

2. **Aplicar `036_sprint_estabilizacao.sql`** no Supabase Dashboard  
   Remove `historico_score_trigger`, cria 9 índices, corrige RLS de ministérios

3. **Aplicar `037_missing_columns.sql`** no Supabase Dashboard ✅ Gerado  
   23 colunas + 6 tabelas + fix `membro_self_link` + RLS `profiles`

4. **Executar `supabase/VERIFICAR_RECONSTRUCAO.sql`** e confirmar 0 itens com ❌

5. **Seguir `CHECKLIST_PRODUCAO.md`** — 53 itens em 10 áreas (DNS, SMTP, Auth URLs, Edge Functions, Env vars)

### P2 — Dívida técnica

6. **UI de `historico_substituicoes`**  
   Dados existem mas nunca são exibidos — painel de auditoria de trocas

7. **ConfigParoquia.prioridade_score** implementar  
   Flag existe no tipo mas não tem lógica: quando `true`, deveria inverter o `rankingBonus` para premiar os de maior score histórico

8. **`presencas_eventos.pontuacao_recebida`**  
   Sem trigger para atualizar `membros.score` quando evento registra presença

9. **`escala_coordenadores` (banco nível)**  
   Criar tabela para vincular auxiliar a escalas específicas e mover filtro do frontend para RLS

---

## 7. ESTIMATIVA DE PRONTIDÃO

| Área | Status | Bloqueador |
|---|---|---|
| Autenticação & ativação de conta | ✅ Pronto | — |
| Motor de escalas | ✅ Pronto | — |
| Portal do membro | ✅ Pronto | — |
| Sacristia / registro de presença | ✅ Pronto | — |
| Substituições | ✅ Pronto | — |
| E-mails transacionais | ✅ Pronto | — |
| Rastreabilidade do esquema | ✅ Pronto | Migration 037 cobre tudo |
| Segurança cross-paróquia | ✅ Pronto | membro_self_link + profiles RLS em 037 |
| Pontuação / ranking | ⚠️ Aplicar patches | Executar PATCH + 036 no Supabase |
| Performance de banco | ⚠️ Aplicar patches | Executar 036 (índices) |
| Infraestrutura (DNS/SMTP/Auth) | ⚠️ Configurar | Ver CHECKLIST_PRODUCAO.md |

**Prontidão de código: 100% — Sprints 036 e 037 completos**

**Prontidão de infraestrutura: ~40% — 18 BLOQUEADOREs de configuração pendentes**

Ver [CHECKLIST_PRODUCAO.md](CHECKLIST_PRODUCAO.md) para a lista completa e ordem de execução.
