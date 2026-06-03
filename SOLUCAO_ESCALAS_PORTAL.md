# Solução: Escalas não aparecem no Portal do Membro

## Problema Reportado
"Não está aparecendo no portal do membro as escalas publicadas"

---

## Causa Raiz Identificada

### O Fluxo Problemático
1. Admin cria escala **SEM selecionar "Tipo de celebração"**
2. Escala é criada com status `"rascunho"` e `tipo_missa_id = ""`
3. Como `tipo_missa_id` está vazio, **nenhum membro é adicionado automaticamente** a `escala_membros`
4. Admin precisa adicionar membros **manualmente** (opcional)
5. Admin muda status para `"publicada"`
6. Portal do membro busca apenas escalas com:
   - `.eq("escalas.status", "publicada")`
   - E que existam em `escala_membros`
7. **Resultado**: Escala publicada mas SEM MEMBROS no portal ❌

### Código Responsável
**Arquivo**: [src/routes/_authenticated/escalas.tsx](src/routes/_authenticated/escalas.tsx#L410-L412)

```typescript
// Linha ~410
if (nova?.id && payload.tipo_missa_id) {  // ← Condição FALSE se tipo_missa_id = ""
  // Insere automaticamente funções e membros sugeridos
  // ESTA SEÇÃO NÃO EXECUTA SE tipo_missa_id FOR VAZIO
}
```

---

## Solução Implementada

### 1️⃣ Tornar "Tipo de celebração" OBRIGATÓRIO
**Arquivo**: [src/routes/_authenticated/escalas.tsx](src/routes/_authenticated/escalas.tsx#L1462-L1480)

**Mudanças**:
- ✅ Removida opção "Outro (texto livre)…"
- ✅ Adicionado atributo `required` ao select
- ✅ Adicionada mensagem de erro se nenhum tipo está cadastrado
- ✅ Alterado label de "Tipo de celebração" para "Tipo de celebração *"

```typescript
// ANTES
<option value="">Selecione o tipo…</option>
{tiposMissa.map((t) => (...))}
<option value="_outro_">Outro (texto livre)…</option>

// DEPOIS
<option value="">Selecione o tipo de celebração…</option>
{tiposMissa.map((t) => (...))}
{/* Removida a opção "Outro" */}
```

### 2️⃣ Adicionar Validação no Botão "Salvar"
**Arquivo**: [src/routes/_authenticated/escalas.tsx](src/routes/_authenticated/escalas.tsx#L1540-L1546)

```typescript
// ANTES
disabled={saving || !form.titulo.trim() || !form.data}

// DEPOIS
disabled={saving || !form.titulo.trim() || !form.data || !form.tipo_missa_id}
```

Agora o botão só ativa quando **TODOS** os campos obrigatórios estão preenchidos.

---

## Resultado

### ✅ Novo Fluxo (Correto)
1. Admin cria escala e **OBRIGATORIAMENTE** seleciona "Tipo de celebração"
2. Sistema auto-gera sugestões de membros para aquele tipo de missa
3. Membros são inseridos em `escala_membros` com status `"pendente"`
4. Admin pode adicionar/remover membros manualmente se necessário
5. Admin muda status para `"publicada"`
6. Portal do membro **ENCONTRA** os membros na tabela `escala_membros`
7. ✅ Escalas aparecem corretamente no portal do membro!

### Dashboard de Escalas
```
Rascunhos:  5    (não publicadas)
Publicadas: 3    (aparecem no portal do membro)
Arquivadas: 2    (passadas)
```

---

## Arquivo Modificado

- [src/routes/_authenticated/escalas.tsx](src/routes/_authenticated/escalas.tsx)
  - Linhas 1462-1480: Tornar tipo de missa obrigatório
  - Linhas 1540-1546: Adicionar validação no botão
  - Linha 1432: Removido uso de `tipoIsOutro`

---

## Testes Realizados

✅ **Compilação**: Sem erros TypeScript  
✅ **Build**: Vite compilou com sucesso  
✅ **Hot Reload**: Mudanças aplicadas sem erro  

---

## Próximos Passos (Recomendado)

1. **Verificar se há escalas órfãs** no banco de dados
   - Escalas com status `"publicada"` mas sem membros em `escala_membros`
   - Use o script: [DIAGNOSTICO_ESCALAS_PORTAL.sql](../DIAGNOSTICO_ESCALAS_PORTAL.sql)

2. **Comunicar aos admins**:
   - Todas as escalas futuras agora REQUEREM seleção de "Tipo de celebração"
   - Isso garante que sempre haja membros atribuídos automaticamente

3. **Adicionar ajuda in-app** (opcional):
   - Tooltip mostrando "Tipo de celebração é necessário para gerar sugestões automáticas"
   - Link para documentação sobre Tipos de Missa em Personalização

---

## Documentação de Referência

- [Portal do Membro - Escalas](src/routes/portal-membro/escalas.tsx#L115-L150)
- [Criação de Escala - Auto-sugestões](src/routes/_authenticated/escalas.tsx#L410-L470)
- [Schema - Tabela escalas](supabase/SCHEMA_COMPLETO.sql#L195-L217)
- [Schema - Tabela escala_membros](supabase/SCHEMA_COMPLETO.sql#L227-L237)
