# 🗺️ MAPA DE CHAMADAS - Geração de Escalas

## 📍 LOCALIZAÇÃO DAS FUNÇÕES

### 📄 Arquivo 1: `src/routes/_authenticated/escalas.tsx`

#### Linhas Críticas:
| Linha | Função/Query | Tipo | Descrição |
|-------|-----------|------|-----------|
| 187-193 | `useQuery` | QUERY | ✅ Carrega ministérios ATIVOS |
| 195-208 | `useQuery` | QUERY | ✅ Carrega membros ATIVOS |
| 211-225 | `useQuery` | QUERY | ✅ Carrega funções da escala específica |
| 227-242 | `useQuery` | QUERY | ✅ Carrega atribuições da escala |
| 244-259 | `useQuery` | QUERY | 🔴 **membroMinisterios - CRÍTICO** |
| 267-299 | `useQuery` | QUERY | ✅ Histórico 6 meses |
| 332-343 | `useQuery` | QUERY | ✅ Indisponibilidades |
| 347-357 | `useQuery` | QUERY | ✅ Restrições de função |
| 364-382 | `useQuery` | QUERY | ✅ Restrições por missa |
| 389-403 | `useQuery` | QUERY | ✅ Config da paróquia |
| **408-480** | `saveMutation.mutationFn` | **MUTATION** | **Criar escala + auto-gerar** |
| 426-438 | Construção de `funcoesPedido` | CODE | Monta funcões para passar ao engine |
| 449-479 | Chamada `generateEscalaAssignments()` | **ENGINE CALL** | Chama motor para gerar sugestões |
| **629-730** | `reorganizarMutation.mutationFn` | **MUTATION** | **Reorganizar escala** |
| 652-664 | Construção de `funcoesPedido` | CODE | Monta funcões |
| 685-710 | Chamada `generateEscalaAssignments()` | **ENGINE CALL** | Chama motor |
| **759-930** | `gerarPeriodoMutation.mutationFn` | **MUTATION** | **Gerar período em lote** |
| 858-869 | Construção de `funcoesPedido` | CODE | Monta funcões por missa |
| 875-893 | Chamada `generateEscalaAssignments()` | **ENGINE CALL** | Chama motor |
| **2378-2425** | `handleGenerateSuggestions()` | **FUNCTION** | **Gerar sugestões manualmente (UI)** |
| 2397-2422 | Chamada `generateEscalaAssignments()` | **ENGINE CALL** | Chama motor |

---

### 📄 Arquivo 2: `src/lib/escala-engine.ts`

#### Linhas Críticas:
| Linha | Função | Assinatura | Descrição |
|-------|--------|-----------|-----------|
| 1-60 | Tipos | Re-exportação | Importa tudo de `biblioteca/escala-engine.ts` |
| 73-230 | `_buildAndAllocate()` | `(evento, funcoes, membros, membroMinisterios, options) → ResultadoAlocacao` | ⭐ Função interna que constrói e aloca |
| 195-209 | `generateEscalaAssignments()` | `(evento, funcoes, membros, membroMinisterios, options) → EscalaAssignmentSuggestion[]` | ✅ Função pública - RETORNA SUGESTÕES |
| 212-230 | `generateEscalaWithAlertas()` | `(evento, funcoes, membros, membroMinisterios, options) → {sugestoes, alertas}` | ✅ Função pública - COM ALERTAS |

---

### 📄 Arquivo 3: `src/biblioteca/escala-engine.ts`

#### Linhas Críticas:
| Linha | Função | Assinatura | Descrição |
|-------|--------|-----------|-----------|
| 1-100+ | Tipos públicos | Types | `MembroEngine`, `FuncaoNecessaria`, etc |
| 150-200+ | Funções utilitárias | Functions | `isApto()`, `estaIndisponivel()`, etc |
| 250-400+ | `alocarMembros()` | `(funcoes, membros, indisponibilidades, contexto, historico?, config?) → ResultadoAlocacao` | 🔴 **MOTOR REAL** - aplica Regra Jefferson, score, etc |
| 300-350 | Regra Jefferson | CODE | Busca `forcar_escalacao_solene` se solene |
| 350-400+ | Loop de alocação | CODE | Para cada função, aloca melhor candidato |

---

## 🔗 GRAFO DE CHAMADAS

```
escalas.tsx
├─ SETUP QUERIES (executam automaticamente)
│  ├─ membros → Membro[]
│  ├─ ministerios → Ministerio[]
│  ├─ membroMinisterios → Record<ministerio_id, membro_id[]>
│  ├─ assignmentHistory → {memberId, ministerioId, date}[]
│  ├─ indisponibilidades → {membro_id, data}[]
│  ├─ funcaoRestricoes → {membro_id, ministerio_id, tipo}[]
│  ├─ membroMissaRestricoes → Record<missa_id, membro_id[]>
│  └─ paroquiaConfig → ConfigParoquia
│
├─ MUTATION 1: saveMutation (Criar escala)
│  └─ generateEscalaAssignments(
│       evento: {titulo, data, tipo, observacoes},
│       funcoesPedido[],  ← construído a partir de tipoFuncoes
│       membros[],
│       membroMinisterios,
│       {history, indisponibilidades, restricoes, config, solene, ...}
│     )
│     └─ lib/escala-engine.ts → generateEscalaAssignments()
│        └─ _buildAndAllocate()
│           ├─ Inverte mapa: membroMinisterios → membroParaMinisterios
│           ├─ Filtra e constrói MembroEngine[]
│           ├─ Normaliza indisponibilidades
│           └─ alocarMembros()  ← biblioteca/escala-engine.ts
│              ├─ Regra Jefferson (se solene)
│              ├─ Para cada função:
│              │  ├─ isApto() para cada candidato
│              │  ├─ Filtra aptos
│              │  ├─ Embaralha (Fisher-Yates)
│              │  ├─ Ordena por scoreEfetivo
│              │  └─ Aloca primeiro
│              └─ RETORNA: {alocacoes[], alertas[]}
│        └─ RETORNA: sugestões[]
│     └─ INSERT escalas_membros
│
├─ MUTATION 2: reorganizarMutation (Reorganizar escala)
│  └─ [Mesmo fluxo que MUTATION 1]
│     └─ Diferença: existingAssignments = atribuições confirmadas
│
├─ MUTATION 3: gerarPeriodoMutation (Gerar lote)
│  └─ Para CADA data/missa no período:
│     ├─ Busca tipoFuncoes ou missaPadraoFuncoes
│     ├─ generateEscalaAssignments()
│     │  └─ [Mesmo fluxo acima]
│     ├─ INSERT escalas_membros
│     └─ UPDATE batchHistory (para próxima missa no loop)
│
└─ HANDLER: handleGenerateSuggestions() (Gerar manualmente na UI)
   ├─ Encontra missas_padrao que combinam (dia/hora)
   ├─ Busca restrições por missa específica
   └─ generateEscalaAssignments()
      └─ [Mesmo fluxo acima]
      └─ setSuggestedAssignments(suggestions)
         └─ Mostra na UI
```

---

## 🔴 PONTOS DE FILTRO (onde dados são descartados)

### Filtro 1: Membros
```tsx
Supabase:  membros WHERE ativo = true
JavaScript: membros.filter(m => m.ativo)
```
**Se membro está inativo**: ❌ Não aparece

### Filtro 2: Ministérios
```tsx
Supabase: ministerios WHERE ativo = true
JavaScript: ministerios.filter(m => m.ativo)
```
**Se ministério está inativo**: ❌ Não aparece em funcoesPedido

### Filtro 3: membroMinisterios
```tsx
Supabase: membro_ministerios WHERE membro_id IN (membros.map(m => m.id))
Result: Record<ministerio_id, membro_id[]>
```
**Se tabela vazia**: ❌ Nenhum membro pode ser alocado

### Filtro 4: isApto() (biblioteca/escala-engine.ts)
```
Para cada candidato:
  if (!membro.ativo) return false;
  if (!membro.ministerio_ids.includes(ministerio_id)) return false;
  if (ja_alocados.has(membro.id)) return false;
  if (estaIndisponivel(membro, data, indisponibilidades)) return false;
  if (restricoes_dia_semana.includes(dayOfWeek)) return false;
  if (funcoes_nao_pode_ids.includes(ministerio_id)) return false;
  return true;
```
**Qualquer condição falhar**: ❌ Membro rejeitado

### Filtro 5: Limites semanal/mensal
```
if (config.limite_semanal) {
  if (escalacoes_nos_ultimos_7_dias >= limite) {
    membros_acima_do_limite.add(membro.id)  // BLOQUEADO
  }
}
```
**Se atingiu limite**: ❌ Não é candidato (exceto Regra Jefferson)

### Filtro 6: Penalidade scoreEfetivo
```
scoreEfetivo = base_score
            + total_servicos_historicos
            + (recentes_7_dias × 10000)
            + (mesmo_ministerio × 50000)
```
**Membros com altos scores**: ❌ Colocados no final

---

## 📊 TABELA: DADOS ESPERADOS vs VAZIOS

| Dado | Esperado | Se Vazio | Consequência |
|------|----------|----------|--------------|
| membros | >0 | 0 | Sem candidatos |
| ministerios | >0 | 0 | Sem funcoes disponiveis |
| membroMinisterios | >0 | {} | 🔴 **SEM ALOCAÇÃO** |
| funcoes (escala) | >0 | 0 | Interface mostra "sem funções" |
| assignmentHistory | ≥0 | [] | Sem balanceamento (menos prejudicial) |
| indisponibilidades | ≥0 | [] | Sem filtro de data (menos prejudicial) |
| funcaoRestricoes | ≥0 | [] | Sem blocklists (menos prejudicial) |
| paroquiaConfig | 1 row | null | Usa defaults |

---

## 🔍 TRANSFORMAÇÕES DE DADOS

### Transformação 1: tipoFuncoes → funcoesPedido

**Entrada** (Supabase):
```json
[
  {"ministerio_id": "abc123", "quantidade_min": 1},
  {"ministerio_id": "def456", "quantidade_min": 2}
]
```

**Código** (linha 426-438):
```tsx
.map((tf) => {
  const min = ministerios.find((m) => m.id === tf.ministerio_id);
  return {
    ministerio_id: tf.ministerio_id,
    quantidade: tf.quantidade_min,
    ministerio: { id: tf.ministerio_id, nome: min?.nome ?? "", cor: min?.cor },
  };
})
```

**Saída**:
```json
[
  {
    "ministerio_id": "abc123",
    "quantidade": 1,
    "ministerio": {"id": "abc123", "nome": "Acólito", "cor": "#6366f1"}
  }
]
```

**❌ Problema**: Se `min?.nome === undefined`, a função fica sem nome.

---

### Transformação 2: membroMinisterios → membroParaMinisterios

**Entrada** (Supabase):
```json
{
  "ministerio-1": ["membro-A", "membro-B"],
  "ministerio-2": ["membro-C"]
}
```

**Código** (escala-engine.ts linha 96-103):
```tsx
for (const [minId, mids] of Object.entries(membroMinisterios)) {
  for (const mid of mids) {
    if (!membroParaMinisterios[mid]) membroParaMinisterios[mid] = [];
    membroParaMinisterios[mid].push(minId);
  }
}
```

**Saída**:
```json
{
  "membro-A": ["ministerio-1"],
  "membro-B": ["ministerio-1"],
  "membro-C": ["ministerio-2"]
}
```

---

### Transformação 3: HistoricoRecente

**Entrada** (Supabase):
```
escalas{
  id: "esc-1",
  data: "2026-03-01",
  escala_membros: [
    {membro_id: "m1", ministerio_id: "min1"},
    {membro_id: "m2", ministerio_id: "min2"}
  ]
}
```

**Código** (linha 276-298):
```tsx
.flatMap((escala) =>
  (escala.escala_membros ?? []).map((entry: any) => ({
    memberId: entry.membro_id,
    ministerioId: entry.ministerio_id,
    date: escala.data,
  }))
)
```

**Saída**:
```json
[
  {"memberId": "m1", "ministerioId": "min1", "date": "2026-03-01"},
  {"memberId": "m2", "ministerioId": "min2", "date": "2026-03-01"}
]
```

---

## 🎯 SEQUÊNCIA DE EXECUÇÃO - handleGenerateSuggestions()

```tsx
user clicks "Atualizar sugestões"
↓
handleGenerateSuggestions() called (linha 2378)
├─ 1. Validation: if (funcoes.length === 0) return error
├─ 2. Get config: paroquiaConfig.regras_escala
├─ 3. Match missas_padrao:
│  ├─ escalaDia = dayOfWeek(escala.data)
│  ├─ escalaHora = escala.hora_inicio?.slice(0, 5)
│  └─ missasMatch = missasPadrao.filter(mp => same dia + hora)
├─ 4. Get restrictions:
│  └─ missaRestricaoIndisp = [all membros restricted in matched missas]
├─ 5. Call: generateEscalaAssignments(
│     evento, funcoes, membros, membroMinisterios,
│     {
│       history: assignmentHistory,
│       existingAssignments: atribuicoes.map(...),
│       indisponibilidades: [...indisponibilidades, ...missaRestricaoIndisp],
│       restricoes: funcaoRestricoes,
│       config,
│       solene: escala.solene,
│       tem_adoracao: escala.tem_adoracao,
│       tem_bispo: escala.tem_bispo
│     }
│  )
│  └─ [ENGINE PROCESSES]
│  └─ RETURNS: suggestions[]
├─ 6. setSuggestedAssignments(suggestions)
├─ 7. Compute message:
│  ├─ if (suggestions.length === 0) → "Não foi possível..."
│  ├─ else if (suggestions.length < totalSlots) → "Gerado X de Y..."
│  └─ else → "Sugestões completas..."
├─ 8. setGenerateNotice(message)
└─ UI updates to show suggestions
```

---

## 📋 LISTA DE VERIFICAÇÃO - SEGUIR DADOS

### Criar escala manualmente:

```
1. Admin clica "Nova escala"
   ↓
2. Preenche form (title, data, hora_inicio, tipo_missa_id, etc)
   ↓
3. Clica "Salvar"
   ↓
4. saveMutation.mutationFn() executada (linha 408)
   ├─ Insere em escalas
   ├─ Se tipo_missa_id:
   │  ├─ Busca FROM tipo_missa_funcoes
   │  ├─ Injeta em escala_funcoes
   │  └─ Constrói funcoesPedido
   ├─ Chama generateEscalaAssignments()
   │  └─ Retorna sugestões[]
   ├─ Insere em escala_membros (status="pendente")
   └─ toast.success("X membros sugeridos")
```

### Gerar sugestões na escala existente:

```
1. Admin abre escala existente
   ↓
2. Clica "Atualizar sugestões" (linha 2722)
   ↓
3. handleGenerateSuggestions() (linha 2378)
   ├─ Encontra missas_padrao correspondentes
   ├─ Carrega restrições delas
   ├─ Chama generateEscalaAssignments()
   ├─ setSuggestedAssignments()
   └─ UI mostra sugestões
   ↓
4. Admin clica "Aplicar sugestões"
   ↓
5. applySuggestionsMutation() executada (linha 2444)
   ├─ Filtra duplicatas
   ├─ INSERT em escala_membros
   └─ toast.success()
```

---

## 🚨 POSSÍVEIS PROBLEMAS SILENCIOSOS

| Problema | Onde | Sintoma | Debug |
|----------|------|---------|-------|
| membroMinisterios vazio | Supabase | Nenhuma sugestão | console.log(Object.keys(membroMinisterios)) |
| Ministério inativo | ministerios query | Função desaparece | Checar `ativo=false` |
| Membro inativo | membros query | Não aparece | Checar `ativo=false` |
| funcoesPedido com nome="" | Construção (426) | Não funciona | console.log(funcoesPedido) |
| existingAssignments mal formado | reorganizar (669) | Alocação quebrada | Verificar mapeamento |
| indisponibilidade data malformada | Supabase | Membro não é bloqueado | Slice(0, 10) normaliza |
| scoreEfetivo com penalidade alta | Motor | Membros recentes preteridos | Checar últimos 7 dias |
| Regra Jefferson sem ministério | Validação | Aviso silencioso | Logs do motor |

