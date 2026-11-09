# Bootstrap do Ambiente Local — Lumen Pastoral

## Por que `supabase start` / `db reset` falham

`001_liturgia_schema.sql` referencia `paroquias(id)` na linha 9:

```sql
paroquia_id UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
```

A tabela `paroquias` só existe em `SCHEMA_COMPLETO.sql`, aplicado diretamente ao Supabase remoto fora das migrations numeradas. As migrations numeradas portanto não são autossuficientes — `supabase start` aborta na migration 001 com erro de FK para tabela inexistente.

**Nunca executar `supabase db reset` ou `supabase db push` sem confirmar o destino.**  
O projeto remoto é `cusuoggmlhtvrclrzvfr` (produção). Qualquer push ou reset apaga dados reais.

---

## Imagem Docker requerida

`profiles.id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`

A tabela `auth.users` e a função `auth.uid()` são extensões Supabase e **não existem** em `postgres:15-alpine` ou imagens vanilla. É obrigatório usar:

```
public.ecr.aws/supabase/postgres:17.6.1.121
```

Esta imagem foi confirmada disponível localmente (usada nos testes T3/T7/T8 da FASE 6C).

---

## Sequência segura para ambiente local ephemeral

### Passo 1 — Iniciar container

```powershell
docker run --rm -d `
  --name pg_local_dev `
  -e POSTGRES_PASSWORD=postgres `
  -p 5433:5432 `
  public.ecr.aws/supabase/postgres:17.6.1.121
```

Aguardar ~15s para o banco inicializar.

### Passo 2 — Aplicar SCHEMA_COMPLETO.sql

```powershell
docker cp "C:\Projetos\lumen-pastoral\supabase\SCHEMA_COMPLETO.sql" pg_local_dev:/tmp/schema.sql
docker exec pg_local_dev psql -U postgres -d postgres -f /tmp/schema.sql
```

Isso cria: `paroquias`, `profiles`, `ministerios`, `membros`, `escalas`, `historico_participacoes` e os demais 45 objetos DDL base.

### Passo 3 — Aplicar migrations da FASE 6C em ordem

```powershell
# Função auxiliar
function Apply-Migration($file) {
  $name = Split-Path $file -Leaf
  docker cp $file pg_local_dev:/tmp/mig.sql
  docker exec pg_local_dev psql -U postgres -d postgres -f /tmp/mig.sql
  Write-Host "Aplicado: $name"
}

Apply-Migration "C:\Projetos\lumen-pastoral\supabase\migrations\189_fase6c_presenca.sql"
Apply-Migration "C:\Projetos\lumen-pastoral\supabase\migrations\190_salvar_presencas_status_guard.sql"
Apply-Migration "C:\Projetos\lumen-pastoral\supabase\migrations\191_fase6c_historico_restrict.sql"
```

### Passo 4 — Verificar estado final

```sql
-- Confirmar FK RESTRICT em vigor
SELECT conname, confdeltype
FROM pg_constraint
WHERE conname = 'historico_participacoes_escala_id_fkey';
-- confdeltype deve ser 'r' (RESTRICT)

-- Confirmar tabelas presentes
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

### Passo 5 — Teardown

```powershell
docker stop pg_local_dev  # --rm garante remoção automática
```

---

## Compatibilidade das migrations 189–191 com SCHEMA_COMPLETO.sql

| Migration | O que faz | Conflito? |
|-----------|-----------|-----------|
| `189_fase6c_presenca.sql` | ADD COLUMN `anulada` em `historico_participacoes` | Nenhum — coluna nova |
| `190_salvar_presencas_status_guard.sql` | Recria `salvar_presencas_escala` com validação de status | Nenhum — apenas recria função |
| `191_fase6c_historico_restrict.sql` | Altera FK `escala_id` para ON DELETE RESTRICT; recria `admin_deletar_paroquia` | Nenhum — altera constraint existente |

As três migrations são **idempotentes em relação ao SCHEMA_COMPLETO.sql** e podem ser aplicadas em sequência sem conflito.

---

## Restrições permanentes

- **Não executar `supabase db push` sem flag `--local`** — sem a flag, o CLI usa o projeto remoto de produção.
- **Não executar `supabase db reset`** — destrói o banco alvo (remoto = produção).
- O ambiente local acima é ephemeral: dados de teste não persistem entre sessões de container.
- Para testes com `auth.uid()` real, usar a imagem Supabase (passo 1) e simular via `set_config('request.jwt.claim.sub', '<uuid>', true)`.
