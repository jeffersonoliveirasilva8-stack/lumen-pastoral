# ⚡ QUICK REFERENCE: Geração de Escalas

## 🎯 O QUE VOCÊ PRECISA SABER EM 5 MINUTOS

### Onde os dados começam?
**`src/routes/_authenticated/escalas.tsx`** linhas **187-403**

```tsx
// 8 queries carregam tudo automaticamente
├─ membros (ativo=true)
├─ ministerios (ativo=true)
├─ membroMinisterios  ← 🔴 CRÍTICO!
├─ funcoes da escala
├─ atribuições
├─ histórico (6 meses)
├─ indisponibilidades
├─ restricoes de função
├─ restricoes por missa
└─ config da paróquia
```

### Onde o motor é chamado?
**Sempre em `generateEscalaAssignments()`** - 4 cenários:

1. **Criar escala** (linha 449-479)
   - Insere funções obrigatórias do tipo_missa
   - Gera sugestões automáticas
   - Insere com status="pendente"

2. **Gerar período** (linha 875-893)
   - Loop por cada missa_padrao
   - Mantém batchHistory para balancear
   - Múltiplas escalas geradas

3. **Reorganizar** (linha 685-710)
   - Delete de pendentes
   - Regera com existingAssignments fixas
   - Mantém confirmadas

4. **Gerar manualmente** (linha 2397-2422)
   - Encontra missas_padrao correspondentes
   - Carrega restrições por missa
   - Mostra sugestões na UI

### O que entra no motor?
```tsx
generateEscalaAssignments(
  { titulo, data, tipo, observacoes },           // evento
  funcoes[],                                     // o que precisa preencher
  membros[],                                     // quem pode servir
  Record<ministerio_id, membro_id[]>,           // quem serve ONDE
  {
    history: [6 meses],                         // para balancear
    indisponibilidades: [datas],                // quem NÃO pode
    restricoes: [{membro, ministerio, tipo}],   // blocklist/allowlist
    config: { regras },                         // limites
    solene, tem_adoracao, tem_bispo             // contexto
  }
)
```

### O que sai?
```tsx
[
  { ministerio_id: "abc", membro_id: "xyz" },
  { ministerio_id: "def", membro_id: "uvw" },
  ...
]
```
✅ Inserido com `status="pendente"` em `escala_membros`

---

## 🔴 TOP 5 PROBLEMAS

### 1. Sugestões Zeradas
**Causa**: `membroMinisterios` vazio
```tsx
// Debug:
console.log(Object.keys(membroMinisterios).length)  // Deve ser > 0
```
**Solução**: Verificar se membros estão cadastrados em ministérios

### 2. Funções Desaparecem
**Causa**: Ministério inativo (`ativo = false`)
```tsx
// Membros da query:
.eq("ativo", true)  ← Filtra inativos!
```
**Solução**: Ativar ministério ou remover da escala

### 3. Membro Específico Nunca É Selecionado
**Causa**: Restrição de dia da semana
```tsx
if (m.restricoes_dia_semana?.includes(dayOfWeek))  // Bloqueado!
```
**Solução**: Limpar `restricoes_dia_semana`

### 4. Muitos Bloqueados
**Causa**: Restrições de função (`nao_pode`)
```tsx
if (r.tipo === "nao_pode")  // Blocklist!
```
**Solução**: Revisar `membro_funcao_restricoes`

### 5. Limite Atingido
**Causa**: Limite semanal/mensal
```tsx
if (countSemana >= config.limite_semanal)  // Bloqueado!
```
**Solução**: Reduzir limite ou aguardar

---

## 📊 TABELA DE TRANSFORMAÇÕES

| Input | Output | Função |
|-------|--------|--------|
| `membro_ministerios` | `membroMinisterios` | Query (linha 244-259) |
| `membroMinisterios` | `membroParaMinisterios` | Motor (escala-engine.ts:96) |
| `tipo_missa_funcoes` | `tipoFuncoes` | Query (linha 426) |
| `tipoFuncoes` | `funcoesPedido` | Map (linha 426-438) |
| `escala_membros` | `assignmentHistory` | FlatMap (linha 276-298) |

---

## ⚙️ MOTOR INTERNO (biblioteca/escala-engine.ts)

### Ordem de Execução:
1. **Inverte mapa** (membro→ministerios)
2. **Filtra membros** (ativo, indisponível, restrição dia, blocklist)
3. **Aplica Regra Jefferson** (se solene)
4. **Para cada função**:
   - Busca candidatos aptos
   - Embaralha (Fisher-Yates)
   - Ordena por scoreEfetivo
   - Aloca primeiro

### scoreEfetivo:
```
base_score
+ total_servicos_historicos
+ (últimos_7_dias × 10000)
+ (mesmo_ministerio × 50000)
```
**Menor score = maior prioridade**

---

## 🎯 VALIDAÇÃO RÁPIDA

```tsx
const isReady = 
  membros.length > 0 &&
  ministerios.length > 0 &&
  Object.keys(membroMinisterios).length > 0 &&
  funcoes.length > 0;

if (!isReady) console.error("❌ Dados incompletos");
```

---

## 📍 LINHAS MAIS IMPORTANTES

| Linha | Arquivo | O Quê | Por Quê |
|-------|---------|-------|--------|
| 244-259 | escalas.tsx | membroMinisterios | 🔴 CRÍTICO - sem isso, nada funciona |
| 426-438 | escalas.tsx | funcoesPedido | IMPORTANTE - monta dados para motor |
| 449-479 | escalas.tsx | Chamada ao motor | IMPORTANTE - onde motor é invocado |
| 2378-2425 | escalas.tsx | handleGenerateSuggestions() | IMPORTANTE - UI manual |
| 73-230 | lib/escala-engine.ts | _buildAndAllocate() | IMPORTANTE - prepara dados |
| 195-209 | lib/escala-engine.ts | generateEscalaAssignments() | API pública |
| 300+ | biblioteca/escala-engine.ts | alocarMembros() | CRÍTICO - motor real |

---

## 🔍 COMANDOS DE DEBUG ESSENCIAIS

### 1. Ver membroMinisterios
```tsx
console.table(Object.entries(membroMinisterios).map(([minId, mids]) => ({
  ministerio: minId,
  membros: mids.length
})))
```

### 2. Ver candidatos para cada função
```tsx
funcoes.forEach(f => {
  const aptos = (membroMinisterios[f.ministerio_id] ?? [])
    .map(id => membros.find(m => m.id === id))
    .filter(Boolean);
  console.log(`${f.ministerio.nome}: ${aptos.length} aptos`)
})
```

### 3. Ver bloqueios
```tsx
const blocklist = funcaoRestricoes.filter(r => r.tipo === "nao_pode");
console.table(blocklist)
```

### 4. Ver histórico de um membro
```tsx
const memberId = "...";
const history = assignmentHistory.filter(h => h.memberId === memberId);
console.table(history)
```

### 5. Simular isApto() para um membro
```tsx
const m = membros[0];
const minId = funcoes[0].ministerio_id;
const eligible = 
  m.ativo &&
  membroMinisterios[minId]?.includes(m.id) &&
  !indisponibilidades.some(i => i.membro_id === m.id && i.data === escala.data) &&
  !m.restricoes_dia_semana?.includes(new Date(escala.data).getDay()) &&
  !funcaoRestricoes.some(r => r.membro_id === m.id && r.ministerio_id === minId && r.tipo === "nao_pode");

console.log(eligible ? "✅ Apto" : "❌ Bloqueado")
```

---

## 📋 CHECKLIST PRÉ-DEBUG

Antes de debugar, responda SIM para todos:

- [ ] `membros.length > 0`?
- [ ] `ministerios.length > 0`?
- [ ] `Object.keys(membroMinisterios).length > 0`?
- [ ] `funcoes.length > 0`?
- [ ] Para CADA função, há membros em `membroMinisterios[funcao.ministerio_id]`?
- [ ] Membros da função não estão indisponíveis nesta data?
- [ ] Ministérios das funções estão ATIVOS?
- [ ] Membros candidatos não têm restrição de dia da semana?
- [ ] Membros não estão todos em blocklist para a função?

Se algum NÃO → Encontrou o problema!

---

## 🚀 TESTE RÁPIDO NO CONSOLE

```tsx
// Cole no console do navegador quando estiver na página de escalas

// 1. Ver estrutura
console.log("membros:", window.DEBUG_membros?.length ?? "❌");
console.log("ministerios:", window.DEBUG_ministerios?.length ?? "❌");
console.log("membroMinisterios keys:", Object.keys(window.DEBUG_membroMinisterios ?? {}).length);

// 2. Simular handleGenerateSuggestions
const funcoesTeste = window.DEBUG_funcoes?.slice(0, 2) ?? [];
console.log("Funções teste:", funcoesTeste.length);

funcoesTeste.forEach(f => {
  const membros = window.DEBUG_membroMinisterios[f.ministerio_id] ?? [];
  console.log(`  ${f.ministerio.nome}: ${membros.length} membros`);
});
```

**Nota**: Você precisa adicionar `window.DEBUG_*` nos componentes para usar isso.

---

## 🎓 RESUMO FINAL

### Para CRIAR ESCALA com auto-geração:
1. Preencha form
2. Se tipo_missa_id, funções são injetadas automaticamente
3. generateEscalaAssignments() é chamado
4. Sugestões inseridas como "pendente"

### Para REORGANIZAR:
1. Abre escala existente
2. Delete pendentes
3. Chama generateEscalaAssignments() com existingAssignments fixas
4. Insere sugestões novas

### Para GERAR MANUALMENTE:
1. Escala já existe com funções
2. Clica "Atualizar sugestões"
3. handleGenerateSuggestions() encontra missas_padrao
4. Carrega restrições por missa
5. Mostra sugestões na UI

### Se nada é gerado:
→ membroMinisterios está vazio ou não tem dados para os ministérios das funções

---

## 📞 PALAVRAS-CHAVE PARA BUSCAR

- **membroMinisterios** - O mapa crítico
- **generateEscalaAssignments()** - Função motor
- **isApto()** - Validação de candidato
- **scoreEfetivo** - Ordenação
- **alocarMembros()** - Motor real
- **funcoesPedido** - Dados formatados para motor
- **indisponibilidades** - Bloqueio por data
- **funcaoRestricoes** - Blocklist/allowlist
- **assignmentHistory** - Histórico para balanço

