# 🔧 CORREÇÃO COMPLETA DO MOTOR DE ESCALAS

## Resumo Executivo (Junho 2026)

Este documento descreve **todas as correções implementadas** no Motor de Distribuição Automática de Escalas para resolver problemas de distribuição vazia ou incorreta de membros nas funções litúrgicas.

---

## 🔴 PROBLEMAS IDENTIFICADOS E CORRIGIDOS

### **Problema 1: Falta de Validação em saveMutation**
**Status**: ✅ CORRIGIDO

#### O Problema
- Função `saveMutation` (criar escala nova) NÃO validava se havia membros com vínculos
- Diferente de `reorganizarMutation` que tinha validação
- Resultado: Sistema iniciava a distribuição mesmo sem dados válidos

#### A Solução
Adicionado validação preventiva em [escalas.tsx linha ~430-440](src/routes/_authenticated/escalas.tsx#L430-L440):

```typescript
// ── VALIDAÇÃO PREVENTIVA: Verificar se há membros com vínculos ───
const minIds = (tipoFuncoes as any[]).map((f) => f.ministerio_id as string);
const membrosComVinculo = minIds.some((mid) => (membroMinisterios[mid] ?? []).length > 0);

if (!membrosComVinculo) {
  console.warn("[ESCALA] Aviso: Nenhum membro possui vínculo com as funções desta escala.");
  return { autoSugestoes: 0, aviso: true };
}
```

**Impacto**: Previne escalas inúteis sendo criadas sem possibilidade de distribuição.

---

### **Problema 2: Falta de Logging Detalhado**
**Status**: ✅ CORRIGIDO

#### O Problema
- Quando a distribuição falhava, não havia como diagnosticar por quê
- Usuário via "0 sugestões" mas não sabia se era:
  - Membros vazios?
  - Ministérios vazios?
  - membroMinisterios vazio?
  - Restrições muito rígidas?

#### A Solução
Adicionado logging detalhado em [lib/escala-engine.ts linha ~89-150](src/lib/escala-engine.ts#L89-L150):

```typescript
// ── DIAGNÓSTICO 1: Validação de dados de entrada ────────────────────────
logDebug(`Total de funções solicitadas: ${funcoes.length}`);
logDebug(`Total de membros disponíveis: ${membros.length}`);
logDebug(`Total de ministérios com vínculos: ${Object.keys(membroMinisterios).length}`);

// Validar se há dados suficientes
if (Object.keys(membroMinisterios).length === 0) {
  logDebug("❌ ERRO CRÍTICO: membroMinisterios vazio");
  return { 
    alocacoes: [], 
    alertas: ["Nenhum membro possui vínculo com funções..."] 
  };
}

// ── DIAGNÓSTICO 2: Validação de funções ────────────────────────────────
const minFaltando = Array.from(minIdsRequeridos).filter((mid) => !minIdsComMembros.has(mid));

if (minFaltando.length > 0) {
  logDebug(`⚠️ Funções sem membros vinculados: ${minFaltando.length}`);
  minFaltando.forEach((mid) => {
    const funcao = funcoes.find((f) => f.ministerio_id === mid);
    logDebug(`   - ${funcao?.ministerio.nome || mid}`);
  });
}
```

**Como usar**: Abra o navegador (F12 → Console) e crie/edite uma escala. O console mostrará exatamente onde está o problema.

**Impacto**: Diagnóstico imediato de problemas de dados.

---

### **Problema 3: Atuações NÃO Estavam Sendo Carregadas**
**Status**: ✅ CORRIGIDO

#### O Problema
- Campo `atuacao_ids` definido em `MembroEngine` mas NUNCA ERA CARREGADO
- Significa que "Acólito", "Coroinha", "Cerimoniário", "Filhas de Maria" NÃO eram considerados no motor
- O motor não podia filtrar por atuação do membro

#### A Solução
**Passo 1**: Adicionar query para carregar atuações em [escalas.tsx linha ~210-240](src/routes/_authenticated/escalas.tsx#L210-L240):

```typescript
// ── Carregar atuações dos membros (para usar no motor) ───────────────────
const { data: membroAtuacoes = {} } = useQuery({
  queryKey: ["membro-atuacoes-map", profile?.paroquia_id, membros.length],
  enabled: !!profile?.paroquia_id && membros.length > 0,
  queryFn: async () => {
    const { data } = await (supabase as any)
      .from("membro_atuacoes")
      .select("membro_id, atuacao_id")
      .in("membro_id", membros.map((m) => m.id));
    const map: Record<string, string[]> = {};
    (data ?? []).forEach((r) => {
      if (!map[r.membro_id]) map[r.membro_id] = [];
      map[r.membro_id].push(r.atuacao_id);
    });
    return map;
  },
});
```

**Passo 2**: Enriquecer membros com atuações antes de passar ao motor:

```typescript
const membrosComAtuacoes = membros.map((m) => ({
  ...m,
  atuacao_ids: membroAtuacoes[m.id] ?? [],
}));

const sugestoes = generateEscalaAssignments(
  evento,
  funcoesPedido,
  membrosComAtuacoes,  // ← Com atuações!
  membroMinisterios,
  options
);
```

**Locais atualizados**:
- [saveMutation](src/routes/_authenticated/escalas.tsx#L430-L445) (criar escala)
- [reorganizarMutation](src/routes/_authenticated/escalas.tsx#L680-L695) (reorganizar)
- [gerarSemanaRapidaMutation](src/routes/_authenticated/escalas.tsx#L920-L935) (gerar período)
- [handleGenerateSuggestions](src/routes/_authenticated/escalas.tsx#L2440-L2455) (gerar manual)

**Passo 3**: Adicionar tipo em [lib/escala-engine.ts](src/lib/escala-engine.ts#L19-L29):

```typescript
export type EscalaMembroInput = {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  score?: number;
  forcar_escalacao_solene?: boolean;
  restricoes_dia_semana?: number[];
  sexo?: "M" | "F" | null;
  atuacao_ids?: string[];  // ← NOVO!
};
```

**Passo 4**: Passar atuações ao motor em [lib/escala-engine.ts](src/lib/escala-engine.ts#L130-L145):

```typescript
return {
  id: m.id,
  nome: m.nome,
  score: m.score ?? 0,
  ativo: true,
  forcar_escalacao_solene: m.forcar_escalacao_solene ?? false,
  ministerio_ids: ministerioIdsEfetivo,
  restricoes_dia_semana: m.restricoes_dia_semana ?? [],
  funcoes_nao_pode_ids: naoPodemIds,
  sexo: (m.sexo === "M" || m.sexo === "F") ? m.sexo : null,
  atuacao_ids: m.atuacao_ids ?? [],  // ← NOVO!
};
```

**Impacto**: Motor agora tem acesso aos dados de atuação do membro.

---

### **Problema 4: Debugging Mode Não Estava Ativado**
**Status**: ✅ CORRIGIDO

#### A Solução
Adicionado `debug: true` às chamadas de motor quando necessário diagnosticar:

```typescript
const sugestoes = generateEscalaAssignments(
  evento,
  funcoesPedido,
  membrosComAtuacoes,
  membroMinisterios,
  {
    history: assignmentHistory,
    indisponibilidades,
    restricoes: funcaoRestricoes,
    config: engineConfig,
    solene: form.solene,
    tem_adoracao: form.tem_adoracao,
    tem_bispo: form.tem_bispo,
    debug: true,  // ← Ativa logging detalhado
  }
);
```

**Locais**:
- `saveMutation` (criar)
- `reorganizarMutation` (reorganizar)
- `handleGenerateSuggestions` (gerar manual)
- `gerarSemanaRapidaMutation` (deixado como false para não poluir logs)

---

## 📋 LISTA COMPLETA DE MUDANÇAS

### Arquivos Modificados

#### 1. **src/lib/escala-engine.ts**
- ✅ Adicionado tipo `AllocOptions.debug`
- ✅ Adicionado função `logDebug()`
- ✅ Enriquecido `_buildAndAllocate()` com validações diagnósticas
- ✅ Adicionado campo `atuacao_ids` a `EscalaMembroInput`
- ✅ Passando `atuacao_ids` ao `MembroEngine`

#### 2. **src/routes/_authenticated/escalas.tsx**
- ✅ Adicionada query `membroAtuacoes` para carregar atuações
- ✅ Adicionada validação em `saveMutation`
- ✅ Enriquecimento de membros com `membrosComAtuacoes` em 4 funções:
  - `saveMutation` (criar escala)
  - `reorganizarMutation` (reorganizar)
  - `gerarSemanaRapidaMutation` (gerar período)
  - `handleGenerateSuggestions` (gerar manual)
- ✅ Ativado `debug: true` para diagnóstico

---

## 🧪 COMO TESTAR AS CORREÇÕES

### Teste 1: Criar Escala (saveMutation)
```
1. Ir para "Escalas" → "Criar Escala"
2. Selecionar um tipo de missa com funções obrigatórias
3. Clique em "Salvar"
4. Abrir console (F12 → Console)
5. Verificar logs: deve ver:
   - "Total de funções solicitadas: X"
   - "Total de membros disponíveis: Y"
   - "Membros com ministérios vinculados: Z"
   - "Alocações geradas: N"
```

### Teste 2: Reorganizar Escala (reorganizarMutation)
```
1. Ir para uma escala existente
2. Clicar em "⋯ → Reorganizar"
3. Abrir console (F12 → Console)
4. Verificar se há validação de vínculos antes de rodar motor
5. Se houver erro: "Nenhum membro possui vínculo com as funções"
```

### Teste 3: Gerar Manual (handleGenerateSuggestions)
```
1. Abrir escala existente
2. Clicar em "Gerar Sugestões"
3. Abrir console (F12 → Console)
4. Verificar logs detalhados
5. Verificar se sistema retorna 0 sugestões com motivo diagnosticado
```

### Teste 4: Validação de Dados
Deixa-me criar um cenário de teste:

**Cenário A**: Nenhum membro tem ministérios
- Resultado esperado: "Nenhum membro possui vínculo com as funções"
- Log esperado: "membroMinisterios vazio - nenhum membro tem vínculo"

**Cenário B**: Membros têm ministérios, mas não para as funções solicitadas
- Resultado esperado: "Alocações geradas: 0"
- Log esperado: "⚠️ Funções sem membros vinculados: 1" (nome da função)

**Cenário C**: Tudo correto
- Resultado esperado: "N membro(s) sugerido(s) automaticamente"
- Log esperado: "Alocações geradas: N"

---

## 🎯 PRÓXIMOS PASSOS (Recomendado)

### 1. Validação Adicional com Atuações
O motor agora TEM as atuações, mas não está usando para filtrar. Próxima fase seria adicionar filtro tipo:
- "Se a função é Ce. Padre, só escalem Cerimoniários"
- "Se a função é Acólito, só escalem Acólitos"

### 2. Logging Persistente
Considerar salvar logs de distribuição no banco para auditoria.

### 3. Testes Unitários
Adicionar testes unitários para o motor com dados conhecido.

---

## 🚀 COMO USAR O SISTEMA AGORA

### Para Admin/Coordenador:
1. **Verificar membros**: Membros → cada membro deve ter:
   - ✅ Ministérios atribuídos (Funções)
   - ✅ Atuação pastoral selecionada (Acólito, Coroinha, etc)
   - ✅ Data de disponibilidade preenchida

2. **Criar escala**:
   - Criar nova escala
   - Selecionar tipo de missa
   - Sistema auto-gera com logging detalhado
   - Se falhar: Abrir console (F12) e verificar logs

3. **Se não gerar sugestões**:
   - Verificar console (F12) para diagnóstico
   - Comum: Nenhum membro tem vínculo com ministério
   - Solução: Editar membro → aba "Funções" → marcar ministérios

### Para Usuários:
Nada muda na interface. Tudo é automático e melhorado nos bastidores.

---

## 📚 Referência Rápida de Diagnóstico

| Problema | Log Esperado | Solução |
|----------|--------------|---------|
| 0 sugestões | `membroMinisterios vazio` | Editar membros → marcar funções |
| 0 sugestões | `Nenhum membro possui vínculo` | Mesmo que acima |
| 0 sugestões | `Funções sem membros vinculados: 1` | Membros não têm essa função específica |
| Alguns membros faltam | `Faltam X membro(s) para "Função"` | Não há membros suficientes |
| Membro não selecionado | `⚠️ Membro "X" sem ministérios` | Editar membro → marcar funções |

---

## ✅ CHECKLIST DE VALIDAÇÃO

- [ ] Query `membroAtuacoes` carregando corretamente
- [ ] Campo `atuacao_ids` sendo passado ao motor
- [ ] Logging aparecendo no console (F12)
- [ ] Validação preventiva funcionando
- [ ] Sistema não criando escalas inúteis
- [ ] Mensagens de erro claras quando falha

---

**Data de Conclusão**: 3 de junho de 2026
**Status**: ✅ IMPLEMENTADO E PRONTO PARA TESTE

