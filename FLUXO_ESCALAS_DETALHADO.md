# 📊 FLUXO COMPLETO DE GERAÇÃO DE ESCALAS

## 🔄 DIAGRAMA DE FLUXO DE DADOS

```
┌────────────────────────────────────────────────────────────────┐
│                    INTERFACE DO USUÁRIO                        │
│  (Criar escala / Gerar período / Reorganizar / Gerar sugestões) │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│              ESCALAS.TSX - QUERIES INICIAIS                    │
│                                                                │
│  1️⃣ membros (linha 195)                                        │
│     ├─ FROM: membros                                          │
│     ├─ WHERE: paroquia_id = X, ativo = TRUE                  │
│     └─ RETURN: Membro[]                                       │
│                                                                │
│  2️⃣ ministerios (linha 187)                                    │
│     ├─ FROM: ministerios                                      │
│     ├─ WHERE: paroquia_id = X, ativo = TRUE                  │
│     └─ RETURN: Ministerio[]                                   │
│                                                                │
│  3️⃣ ⭐ membroMinisterios (linha 244) [CRÍTICO]               │
│     ├─ FROM: membro_ministerios                              │
│     ├─ WHERE: membro_id IN (membros.map(m => m.id))         │
│     ├─ ENABLED: membros.length > 0                           │
│     └─ RETURN: Record<ministerio_id, membro_id[]>           │
│                                                                │
│  4️⃣ assignmentHistory (linha 267)                             │
│     ├─ FROM: escalas.escala_membros                          │
│     ├─ WHERE: data >= sixMonthsAgo                           │
│     └─ RETURN: {memberId, ministerioId, date}[]             │
│                                                                │
│  5️⃣ indisponibilidades (linha 332)                            │
│     ├─ FROM: indisponibilidades                              │
│     ├─ WHERE: paroquia_id = X                                │
│     └─ RETURN: {membro_id, data}[]                          │
│                                                                │
│  6️⃣ funcaoRestricoes (linha 347)                              │
│     ├─ FROM: membro_funcao_restricoes                        │
│     ├─ WHERE: membro_id IN (membros)                         │
│     └─ RETURN: {membro_id, ministerio_id, tipo}[]          │
│                                                                │
│  7️⃣ membroMissaRestricoes (linha 364)                         │
│     ├─ FROM: membro_missa_restricoes                         │
│     ├─ WHERE: membro_id IN (membros)                         │
│     └─ RETURN: Record<missa_padrao_id, membro_id[]>        │
│                                                                │
│  8️⃣ paroquiaConfig (linha 389)                                │
│     ├─ FROM: paroquias                                       │
│     ├─ SELECT: regras_escala, usa_tochas, ...               │
│     └─ RETURN: ConfigParoquia                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│              PONTO DE CHAMADA: generateEscalaAssignments()     │
│                                                                │
│  Entrada (4 rotas):                                            │
│  ├─ 1. Criar escala manualmente (linha 408-480)              │
│  ├─ 2. Gerar período (linha 759-930)                         │
│  ├─ 3. Reorganizar escala (linha 629-730)                    │
│  └─ 4. Gerar sugestões manualmente (linha 2378-2425)         │
│                                                                │
│  Parâmetros passados:                                          │
│  ├─ evento: {titulo, data, tipo, observacoes}                │
│  ├─ funcoes: EscalaFuncaoPedido[]  ← CRÍTICO                 │
│  ├─ membros: Membro[]               ← CRÍTICO                │
│  ├─ membroMinisterios: Record<...>  ← 🔴 CRÍTICO             │
│  └─ options:                                                   │
│     ├─ history: assignmentHistory                            │
│     ├─ indisponibilidades: [...]                             │
│     ├─ restricoes: funcaoRestricoes                          │
│     ├─ config: engineConfig                                  │
│     ├─ solene, tem_adoracao, tem_bispo                       │
│     └─ existingAssignments (apenas em reorganizar)           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│         lib/escala-engine.ts → _buildAndAllocate()             │
│                                                                │
│  Etapa 1: INVERSÃO DO MAPA                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ membroMinisterios:                                      │ │
│  │   {                                                     │ │
│  │     "ministerio-1": ["membro-A", "membro-B", ...],    │ │
│  │     "ministerio-2": ["membro-C", ...],                │ │
│  │     ...                                                │ │
│  │   }                                                     │ │
│  │                                                        │ │
│  │ VIRA:                                                  │ │
│  │                                                        │ │
│  │ membroParaMinisterios:                                │ │
│  │   {                                                     │ │
│  │     "membro-A": ["ministerio-1", ...],               │ │
│  │     "membro-B": ["ministerio-1", ...],               │ │
│  │     "membro-C": ["ministerio-2", ...],               │ │
│  │     ...                                                │ │
│  │   }                                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                │
│  Etapa 2: FILTRAGEM E CONSTRUÇÃO DO MODELO                   │
│  ├─ Filtra membros já atribuídos (existingAssignments)       │
│  ├─ Para cada membro:                                         │
│  │  ├─ Busca blocklist (nao_pode):                          │
│  │  │  └─ restricoes.filter(r => tipo === "nao_pode")     │
│  │  ├─ Busca allowlist (pode):                             │
│  │  │  └─ restricoes.filter(r => tipo === "pode")         │
│  │  ├─ Combina: [ministérioBase + allowlist]              │
│  │  ├─ Remove: blocklist (nao_pode)                        │
│  │  └─ Monta MembroEngine com campos completos            │
│  │                                                         │
│  │  Result: MembroEngine[] com:                           │
│  │    ├─ ministerio_ids (final)                           │
│  │    ├─ funcoes_nao_pode_ids                             │
│  │    ├─ restricoes_dia_semana                            │
│  │    ├─ forcar_escalacao_solene                          │
│  │    └─ score                                             │
│  │                                                         │
│  └─ Remove duplicatas por dia (sameDayBlocks)             │
│                                                                │
│  Etapa 3: PREPARAÇÃO DE DADOS                                │
│  ├─ funcoesEngine: FuncaoNecessaria[]                        │
│  ├─ contexto: ContextoEscala                                 │
│  ├─ historicoRecente: normalizado para YYYY-MM-DD           │
│  ├─ indisponibilidades: normalizado + sameDayBlocks         │
│  └─ config: regras da paróquia                              │
│                                                                │
│  Etapa 4: CHAMADA AO MOTOR                                   │
│  └─ return alocarMembros(                                     │
│       funcoesEngine,                                          │
│       membrosEngine,                                          │
│       indisponibilidades,                                     │
│       contexto,                                               │
│       historicoRecente,                                       │
│       config                                                  │
│     )                                                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│       biblioteca/escala-engine.ts → alocarMembros()           │
│                                                                │
│  REGRAS APLICADAS (ordem):                                    │
│                                                                │
│  1️⃣  REGRA JEFFERSON (Missa Solene)                          │
│      ├─ Se contexto.solene || contexto.tem_bispo             │
│      ├─ Busca membro com forcar_escalacao_solene === true    │
│      ├─ Força alocação em Ce. Padre ou Ce. Mor              │
│      ├─ IGNORA indisponibilidades (mas avisa)               │
│      └─ Marca como "forcado: true"                           │
│                                                                │
│  2️⃣  FILTRAGEM POR MINISTÉRIO                               │
│      ├─ Para cada função necessária:                         │
│      │  ├─ Busca membros com ministerio_id em ministerio_ids│
│      │  ├─ Filtra:                                           │
│      │  │  ├─ membro.ativo === true                        │
│      │  │  ├─ !ja_alocados.has(membro.id)                  │
│      │  │  ├─ !estaIndisponivel(membro, data)              │
│      │  │  ├─ Não há restricao_dia_semana                  │
│      │  │  └─ Não está em funcoes_nao_pode_ids             │
│      │  │                                                   │
│      │  └─ Se limite_semanal ou limite_mensal:             │
│      │     └─ Filtra membros que AINDA NÃO atingiram limite │
│      │        (Regra Jefferson ignora isso)                 │
│      │                                                       │
│      └─ Result: candidatos[]                                 │
│                                                                │
│  3️⃣  ORDENAÇÃO E EMBARALHAMENTO                              │
│      ├─ Embaralha candidatos (Fisher-Yates)                 │
│      ├─ Ordena por scoreEfetivo (menor = maior prioridade)  │
│      ├─ scoreEfetivo = base_score + total_serviços          │
│      │  + penalidade_últimos_7_dias (×10000)                │
│      │  + penalidade_mesmo_ministerio (×50000)              │
│      └─ Primeiro candidato é escalado                        │
│                                                                │
│  4️⃣  ALOCAÇÃO                                                │
│      ├─ Alocado[i] = candidatos[0]                          │
│      ├─ ADD membro.id a ja_alocados                          │
│      └─ Registra razão: "Distribuição equilibrada", etc.     │
│                                                                │
│  5️⃣  ALERTAS GERADOS                                         │
│      ├─ Se nenhum candidato para função → ALERTA CRÍTICO     │
│      ├─ Se Regra Jefferson mas membro indisponível → AVISO   │
│      ├─ Se Regra Jefferson mas sem ministério → AVISO        │
│      └─ Outros alertas contextuais                           │
│                                                                │
│  RETORNA:                                                      │
│  {                                                             │
│    alocacoes: MembroAlocado[],                               │
│    alertas: string[]                                          │
│  }                                                             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│        Retorno: EscalaAssignmentSuggestion[]                  │
│        {                                                       │
│          ministerio_id: string,                              │
│          membro_id: string,                                  │
│          motivo?: string  (se generateEscalaWithAlertas)     │
│        }                                                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│            INSERÇÃO NO SUPABASE (escalas.tsx)                │
│                                                                │
│  INSERT INTO escala_membros VALUES:                           │
│  {                                                             │
│    escala_id: string,                                        │
│    membro_id: string,   ← from sugestões[i].membro_id       │
│    ministerio_id: string, ← from sugestões[i].ministerio_id  │
│    status: "pendente"                                        │
│  }                                                             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 🎯 PONTOS CRÍTICOS PARA INVESTIGAÇÃO

### 🔴 CRÍTICO 1: membroMinisterios VAZIO

**Sintoma**: `generateEscalaAssignments()` retorna `[]`

**Linha de carregamento**: [escalas.tsx linha 244-259](escalas.tsx#L244-L259)

**Query**:
```tsx
from("membro_ministerios")
  .select("membro_id, ministerio_id")
  .in("membro_id", membros.map(m => m.id))
```

**Estrutura resultante**:
```tsx
{
  "ministerio-uuid-1": ["membro-uuid-a", "membro-uuid-b"],
  "ministerio-uuid-2": ["membro-uuid-c"],
  ...
}
```

**Condições para ativar query**:
- `profile?.paroquia_id` ≠ null/undefined
- `membros.length > 0`

**Se vazio = PROBLEMA**:
- Nenhum membro está cadastrado em ministérios
- Ministérios foram deletados da tabela membro_ministerios
- Query falhou silenciosamente

**Debug Script**:
```tsx
useEffect(() => {
  console.log("=== DEBUG membroMinisterios ===");
  console.log("membros.length:", membros.length);
  console.log("membroMinisterios keys:", Object.keys(membroMinisterios));
  console.log("membroMinisterios:", membroMinisterios);
  
  for (const [minId, membroIds] of Object.entries(membroMinisterios)) {
    console.log(`  Ministério ${minId}: ${membroIds.length} membros`);
  }
  
  // Para cada membro, mostrar quais ministérios tem
  membros.forEach(m => {
    const minIds = Object.entries(membroMinisterios)
      .filter(([_, mIds]) => mIds.includes(m.id))
      .map(([minId, _]) => minId);
    console.log(`  ${m.nome}: ${minIds.length} ministérios`, minIds);
  });
}, [membros, membroMinisterios]);
```

---

### 🔴 CRÍTICO 2: funcoesPedido NÃO SENDO CONSTRUÍDO CORRETAMENTE

**Sintoma**: `funcoes.length > 0` mas `suggestions.length === 0`

**Linhas de construção**:
- Criar escala (linha 426-438)
- Gerar período (linha 858-869)
- Reorganizar (linha 652-664)

**Exemplo correto** (linha 426-438):
```tsx
const funcoesPedido = (tipoFuncoes as { ministerio_id: string; quantidade_min: number }[])
  .map((tf) => {
    const min = ministerios.find((m) => m.id === tf.ministerio_id);
    return {
      ministerio_id: tf.ministerio_id,
      quantidade: tf.quantidade_min,
      ministerio: { 
        id: tf.ministerio_id, 
        nome: min?.nome ?? "", 
        cor: min?.cor 
      },
    };
  });
```

**Possíveis problemas**:
- `ministerios` é vazio
- `tipoFuncoes` é vazio
- `min?.nome` é undefined (ministério não encontrado)
- `quantidade_min` é 0 ou undefined

**Debug Script**:
```tsx
console.log("tipoFuncoes:", tipoFuncoes);
console.log("ministerios.length:", ministerios.length);

tipoFuncoes?.forEach(tf => {
  const minEncontrado = ministerios.find(m => m.id === tf.ministerio_id);
  console.log(`  Função ${tf.ministerio_id}: ${minEncontrado?.nome ?? "❌ NOT FOUND"} (qty: ${tf.quantidade_min})`);
});

console.log("funcoesPedido:", funcoesPedido);
```

---

### 🔴 CRÍTICO 3: Ministérios INATIVOS sendo ignorados

**Sintoma**: Funções desaparecem silenciosamente

**Linha de carregamento**: [escalas.tsx linha 187-193](escalas.tsx#L187-L193)

**Query**:
```tsx
from("ministerios")
  .select("id, nome, cor, categoria")
  .eq("paroquia_id", profile.paroquia_id)
  .eq("ativo", true)  ← 🔴 ISSO FILTRA!
  .order("ordem")
```

**Se um ministério tem `ativo = false`**:
- Não aparece em `ministerios`
- Se estiver em `escala_funcoes`, `funcoesPedido` terá `min?.nome = undefined`
- Membro não será alocado para essa função

**Debug Script**:
```tsx
// Verificar ministérios inativos
const { data: allMinisterios } = await supabase
  .from("ministerios")
  .select("id, nome, ativo")
  .eq("paroquia_id", paroquiaId);

const inativos = allMinisterios?.filter(m => !m.ativo) ?? [];
console.log("Ministérios inativos:", inativos);
```

---

### 🔴 CRÍTICO 4: Filtros de restrição zerando resultados

**Indisponibilidades** (linha 332-343):
```tsx
from("indisponibilidades")
  .select("membro_id, data")
  .eq("paroquia_id", paroquiaId)
```

**Se membro está marcado como indisponível na data da escala**:
- `isApto()` retorna `false`
- Membro não será candidato

**Debug Script**:
```tsx
const escalasData = "2026-06-03";  // sua data
const membroTesteId = "membro-uuid";

const indisponiveisDiaEscala = indisponibilidades.filter(
  i => i.data === escalasData
);

console.log(`Indisponíveis em ${escalasData}:`, indisponiveisDiaEscala);

if (indisponiveisDiaEscala.some(i => i.membro_id === membroTesteId)) {
  console.log(`⚠️ Membro ${membroTesteId} está indisponível!`);
}
```

---

### 🔴 CRÍTICO 5: Restrições de função bloqueando tudo

**Blocklist (nao_pode)** (linha 347-357):
```tsx
from("membro_funcao_restricoes")
  .select("membro_id, ministerio_id, tipo")
  .in("membro_id", membroIds)
```

**Se `tipo = "nao_pode"`**:
- Membro entra na `funcoes_nao_pode_ids` (linha 130 do escala-engine.ts)
- Bloqueado para aquele ministério

**Debug Script**:
```tsx
const nãoPodeRestricoes = funcaoRestricoes.filter(r => r.tipo === "nao_pode");
console.log("Bloklists (nao_pode):", nãoPodeRestricoes);

funcoes.forEach(f => {
  const bloqueados = nãoPodeRestricoes.filter(r => r.ministerio_id === f.ministerio_id);
  console.log(`  Ministério ${f.ministerio}: ${bloqueados.length} bloqueados`);
});
```

---

### 🟡 IMPORTANTE: Restrições por dia da semana

**Linha de carregamento**: [escalas.tsx linha 195-208](escalas.tsx#L195-L208)

**Campo no banco**:
```sql
membros.restricoes_dia_semana: number[]  (0=Dom, 1=Seg, ..., 6=Sáb)
```

**Se membro tem `restricoes_dia_semana = [0]`**:
- Não pode escalar em domingos
- `isApto()` filtra automaticamente (linha 107 do biblioteca/escala-engine.ts)

**Debug Script**:
```tsx
const dayOfWeek = new Date(escalaData + "T12:00:00").getDay();
const diaTexto = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][dayOfWeek];

membros.forEach(m => {
  if (m.restricoes_dia_semana?.includes(dayOfWeek)) {
    console.log(`⚠️ ${m.nome} restrito para ${diaTexto}`);
  }
});
```

---

### 🟡 IMPORTANTE: Histórico de escalações (6 meses)

**Linha de carregamento**: [escalas.tsx linha 267-299](escalas.tsx#L267-L299)

**Período**: últimos 6 meses atrás

**Impacto**:
1. Balanceamento de carga (scoreEfetivo)
2. Penalidade de repetição consecutiva
3. Limites semanal/mensal

**Debug Script**:
```tsx
const sixMonthsAgo = subMonths(new Date(), 6);
console.log(`Histórico desde: ${format(sixMonthsAgo, "yyyy-MM-dd")}`);
console.log(`Total de escalações históricas: ${assignmentHistory.length}`);

const memberStats: Record<string, number> = {};
assignmentHistory.forEach(h => {
  memberStats[h.memberId] = (memberStats[h.memberId] ?? 0) + 1;
});

Object.entries(memberStats)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([id, count]) => {
    const m = membros.find(m => m.id === id);
    console.log(`  ${m?.nome}: ${count} escalações`);
  });
```

---

## 📋 CHECKLIST COMPLETO DE CARREGAMENTO

Use este checklist para validar se cada query está funcionando:

```tsx
useEffect(() => {
  const checks = {
    "❓ Membros carregados": membros.length,
    "❓ Ministérios carregados": ministerios.length,
    "❓ membroMinisterios tem dados": Object.keys(membroMinisterios).length,
    "❓ Histórico carregado": assignmentHistory.length,
    "❓ Indisponibilidades carregadas": indisponibilidades.length,
    "❓ Restrições de função carregadas": funcaoRestricoes.length,
    "❓ Restrições por missa carregadas": Object.keys(membroMissaRestricoes).length,
    "❓ Config paróquia carregada": !!paroquiaConfig,
  };
  
  Object.entries(checks).forEach(([key, value]) => {
    console.log(`${key}: ${value ? "✅" : "❌"}`);
  });
  
  // Validação cruzada
  const numMinisteriosNoMapa = Object.keys(membroMinisterios).length;
  if (numMinisteriosNoMapa === 0 && membros.length > 0 && ministerios.length > 0) {
    console.warn("⚠️ CRÍTICO: membros existem, ministérios existem, mas NENHUMA relação!");
  }
  
}, [membros, ministerios, membroMinisterios, assignmentHistory, indisponibilidades, funcaoRestricoes, membroMissaRestricoes, paroquiaConfig]);
```

---

## 🔧 TRACE MANUAL DO FLUXO

Para debugar um caso específico de escala que não gera sugestões:

1. **Abra o console do navegador**
2. **No `handleGenerateSuggestions()`**, adicione antes do `generateEscalaAssignments()`:

```tsx
console.group("🔍 DEBUG generateEscalaAssignments()");

console.log("=== ENTRADA ===");
console.log("evento:", { titulo: escala.titulo, data: escala.data, tipo: escala.tipo });
console.log("funcoes:", funcoes);
console.log("membros.length:", membros.length);
console.log("membroMinisterios:", membroMinisterios);
console.log("assignmentHistory.length:", assignmentHistory.length);
console.log("atribuicoes:", atribuicoes);
console.log("indisponibilidades:", indisponibilidades);
console.log("funcaoRestricoes:", funcaoRestricoes);

console.log("\n=== VALIDAÇÕES ===");
console.log("Membros PARA os ministérios das funções:");
funcoes.forEach(f => {
  const ids = membroMinisterios[f.ministerio_id] ?? [];
  console.log(`  ${f.ministerio.nome} (${f.ministerio_id}): ${ids.length} membros`);
  ids.slice(0, 3).forEach(id => {
    const m = membros.find(m => m.id === id);
    console.log(`    - ${m?.nome}`);
  });
});

console.groupEnd();

// DEPOIS, checar a saída:
// setSuggestedAssignments(suggestions);
console.log("Resultado:", suggestions);
```

3. **Compare**:
   - `funcoes.length` deve ser > 0
   - `membros.length` deve ser > 0
   - `membroMinisterios[funcao.ministerio_id]` deve ter elementos
   - Nenhum membro deve estar em TODAS as restrições

---

## 📝 SUMÁRIO

### Queries Críticas (ordem de importância):
1. **membroMinisterios** → Se vazio = sem alocação
2. **membros** (ativo=true) → Deve ter dados
3. **ministerios** (ativo=true) → Deve ter dados
4. **funcaoRestricoes** → Blocklists/allowlists
5. **indisponibilidades** → Filtra por data

### Fluxo de Alocação:
1. Valida funcoes
2. Busca membros aptos para cada ministério
3. Aplica Regra Jefferson (se solene)
4. Ordena por score + penalidades
5. Embaralha para aleatoriedade
6. Insere no BD como "pendente"

### Se nada é gerado:
- ✅ membroMinisterios tem dados?
- ✅ funcoes tem dados?
- ✅ membros candidatos para esses ministérios?
- ✅ Nenhum membro está indisponível NESSA DATA?
- ✅ Membros têm os ministérios necessários?
