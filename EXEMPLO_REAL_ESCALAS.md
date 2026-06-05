# 📖 EXEMPLO REAL: Fluxo Completo de Geração

## Cenário: Admin cria escala para "Acólito" e gera sugestões

### Setup Inicial:

**Paróquia**: "Igreja São João" (paroquia_id: `par-123`)

**Membros cadastrados** (ativo=true):
- João (mem-1): Acólito, Ministro
- Maria (mem-2): Acólito
- Paulo (mem-3): Acólito
- Ana (mem-4): Ministro (SEM Acólito)

**Ministérios** (ativo=true):
- Acólito (min-1): cores="#6366f1"
- Ministro (min-2): cor="#8b5cf6"

**membro_ministerios** (em Supabase):
```sql
membro_id  | ministerio_id
-----------|---------------
mem-1      | min-1  (João → Acólito)
mem-1      | min-2  (João → Ministro)
mem-2      | min-1  (Maria → Acólito)
mem-3      | min-1  (Paulo → Acólito)
mem-4      | min-2  (Ana → Ministro)
```

---

## ⏱️ T=0s: Admin clica "Nova escala"

### Query Execution (Automático)

**1️⃣ Query: membros**
```typescript
// src/routes/_authenticated/escalas.tsx:195-208
const membros = supabase
  .from("membros")
  .select("id, nome, ...")
  .eq("paroquia_id", "par-123")
  .eq("ativo", true)
```

**Resultado**:
```typescript
[
  { id: "mem-1", nome: "João", score: 0, restricoes_dia_semana: [] },
  { id: "mem-2", nome: "Maria", score: 0, restricoes_dia_semana: [] },
  { id: "mem-3", nome: "Paulo", score: 0, restricoes_dia_semana: [] },
  { id: "mem-4", nome: "Ana", score: 0, restricoes_dia_semana: [] }
]
```

**2️⃣ Query: ministerios**
```typescript
// src/routes/_authenticated/escalas.tsx:187-193
const ministerios = supabase
  .from("ministerios")
  .select("id, nome, cor, ...")
  .eq("paroquia_id", "par-123")
  .eq("ativo", true)
```

**Resultado**:
```typescript
[
  { id: "min-1", nome: "Acólito", cor: "#6366f1" },
  { id: "min-2", nome: "Ministro", cor: "#8b5cf6" }
]
```

**3️⃣ Query: membroMinisterios** 🔴 CRÍTICO
```typescript
// src/routes/_authenticated/escalas.tsx:244-259
const membroMinisterios = supabase
  .from("membro_ministerios")
  .select("membro_id, ministerio_id")
  .in("membro_id", ["mem-1", "mem-2", "mem-3", "mem-4"])
```

**Supabase retorna**:
```typescript
[
  { membro_id: "mem-1", ministerio_id: "min-1" },
  { membro_id: "mem-1", ministerio_id: "min-2" },
  { membro_id: "mem-2", ministerio_id: "min-1" },
  { membro_id: "mem-3", ministerio_id: "min-1" },
  { membro_id: "mem-4", ministerio_id: "min-2" }
]
```

**Transformação** (linhas 251-258):
```typescript
// Inverte: membro → ministérios vira ministério → membros
const map = {};
data.forEach(r => {
  if (!map[r.ministerio_id]) map[r.ministerio_id] = [];
  map[r.ministerio_id].push(r.membro_id);
});

// Result:
map = {
  "min-1": ["mem-1", "mem-2", "mem-3"],  // Acólito
  "min-2": ["mem-1", "mem-4"]             // Ministro
}
```

**4️⃣ Outras queries** (indisponibilidades, histórico, etc)
- Suponha tudo vazio por simplicidade

---

## ⏱️ T=10s: Admin preenche form e clica "Salvar"

```typescript
form = {
  titulo: "Missa Dominical",
  data: "2026-06-07",
  hora_inicio: "09:00",
  tipo_missa_id: "tipo-1",  // Missa com funções obrigatórias
  status: "rascunho",
  solene: false,
  tem_adoracao: false,
  tem_bispo: false
}
```

---

## ⏱️ T=11s: saveMutation executada (linha 408)

### Step 1: Insert escala
```typescript
const { data: nova } = await supabase
  .from("escalas")
  .insert({
    paroquia_id: "par-123",
    titulo: "Missa Dominical",
    data: "2026-06-07",
    hora_inicio: "09:00",
    tipo: "tipo_missa",
    tipo_missa_id: "tipo-1",
    // ...
  })
  .select("id")
  .single();

// Supabase retorna:
nova = { id: "esc-100" }
```

### Step 2: Buscar funções obrigatórias
```typescript
// linha 416
const { data: tipoFuncoes } = await supabase
  .from("tipo_missa_funcoes")
  .select("ministerio_id, quantidade_min")
  .eq("tipo_missa_id", "tipo-1")
  .eq("tipo_vinculo", "obrigatoria");

// Supabase retorna:
tipoFuncoes = [
  { ministerio_id: "min-1", quantidade_min: 2 }  // 2 Acólitos obrigatórios
]
```

### Step 3: Injetar funções em escala_funcoes
```typescript
// linha 430
await supabase
  .from("escala_funcoes")
  .insert([
    {
      escala_id: "esc-100",
      ministerio_id: "min-1",
      quantidade: 2
    }
  ]);

// Inserido ✅
```

### Step 4: Construir funcoesPedido (linha 426-438)
```typescript
tipoFuncoes.map(tf => {
  const min = ministerios.find(m => m.id === tf.ministerio_id);
  return {
    ministerio_id: "min-1",
    quantidade: 2,
    ministerio: {
      id: "min-1",
      nome: "Acólito",
      cor: "#6366f1"
    }
  };
});

// Result:
funcoesPedido = [
  {
    ministerio_id: "min-1",
    quantidade: 2,
    ministerio: { id: "min-1", nome: "Acólito", cor: "#6366f1" }
  }
]
```

### Step 5: Chamar generateEscalaAssignments() (linha 449-479)

```typescript
const sugestoes = generateEscalaAssignments(
  // evento:
  {
    titulo: "Missa Dominical",
    data: "2026-06-07",
    tipo: "tipo_missa",
    observacoes: null
  },
  
  // funcoes:
  funcoesPedido,
  
  // membros:
  [
    { id: "mem-1", nome: "João", score: 0, restricoes_dia_semana: [] },
    { id: "mem-2", nome: "Maria", score: 0, restricoes_dia_semana: [] },
    { id: "mem-3", nome: "Paulo", score: 0, restricoes_dia_semana: [] },
    { id: "mem-4", nome: "Ana", score: 0, restricoes_dia_semana: [] }
  ],
  
  // membroMinisterios:
  {
    "min-1": ["mem-1", "mem-2", "mem-3"],
    "min-2": ["mem-1", "mem-4"]
  },
  
  // options:
  {
    history: [],  // Vazio por simplicidade
    indisponibilidades: [],
    restricoes: [],
    config: { usa_tochas: false },
    solene: false,
    tem_adoracao: false,
    tem_bispo: false
  }
);
```

---

## ⏱️ T=11.5s: Motor executa (_buildAndAllocate)

### Passo 1: Inverter mapa
```typescript
membroParaMinisterios = {
  "mem-1": ["min-1", "min-2"],
  "mem-2": ["min-1"],
  "mem-3": ["min-1"],
  "mem-4": ["min-2"]
}
```

### Passo 2: Construir MembroEngine[]
```typescript
membrosEngine = [
  {
    id: "mem-1",
    nome: "João",
    score: 0,
    ativo: true,
    ministerio_ids: ["min-1", "min-2"],
    funcoes_nao_pode_ids: [],
    restricoes_dia_semana: []
  },
  {
    id: "mem-2",
    nome: "Maria",
    score: 0,
    ativo: true,
    ministerio_ids: ["min-1"],
    funcoes_nao_pode_ids: [],
    restricoes_dia_semana: []
  },
  {
    id: "mem-3",
    nome: "Paulo",
    score: 0,
    ativo: true,
    ministerio_ids: ["min-1"],
    funcoes_nao_pode_ids: [],
    restricoes_dia_semana: []
  },
  {
    id: "mem-4",
    nome: "Ana",
    score: 0,
    ativo: true,
    ministerio_ids: ["min-2"],
    funcoes_nao_pode_ids: [],
    restricoes_dia_semana: []
  }
]
```

### Passo 3: Chamar alocarMembros()

#### Para FUNÇÃO 1: Acólito (min-1), quantidade=2

**Filtrar aptos** (isApto):
- João: ✅ ativo, tem min-1, não indisponível
- Maria: ✅ ativo, tem min-1, não indisponível
- Paulo: ✅ ativo, tem min-1, não indisponível
- Ana: ❌ não tem min-1

**Candidatos aptos**: [João, Maria, Paulo]

**Embaralhar** (Fisher-Yates): Suponha resultado = [Maria, João, Paulo]

**Ordenar por scoreEfetivo**: Todos têm score=0, histórico vazio, então ordem mantém:
- [Maria: 0, João: 0, Paulo: 0]

**Alocar primeiro (Maria)**:
```typescript
alocacoes.push({
  membro_id: "mem-2",
  membro_nome: "Maria",
  ministerio_id: "min-1",
  forcado: false,
  motivo: "Distribuição equilibrada"
})
ja_alocados.add("mem-2")
```

**Alocar segundo (João)**:
```typescript
alocacoes.push({
  membro_id: "mem-1",
  membro_nome: "João",
  ministerio_id: "min-1",
  forcado: false,
  motivo: "Distribuição equilibrada"
})
ja_alocados.add("mem-1")
```

**Quantidade atingida**: 2 ✅

---

## ⏱️ T=11.7s: Resultado do Motor

```typescript
sugestoes = [
  {
    ministerio_id: "min-1",
    membro_id: "mem-2"  // Maria
  },
  {
    ministerio_id: "min-1",
    membro_id: "mem-1"  // João
  }
]
```

---

## ⏱️ T=12s: Inserção no Supabase

```typescript
// linha 470-478
await supabase
  .from("escala_membros")
  .insert([
    {
      escala_id: "esc-100",
      membro_id: "mem-2",
      ministerio_id: "min-1",
      status: "pendente"
    },
    {
      escala_id: "esc-100",
      membro_id: "mem-1",
      ministerio_id: "min-1",
      status: "pendente"
    }
  ]);

// Inserido ✅
```

---

## ⏱️ T=13s: UI Atualiza

```typescript
onSuccess: ({ autoSugestoes }) => {
  toast.success("Escala criada com 2 membro(s) sugerido(s) automaticamente.");
  // Cache invalidado
  qc.invalidateQueries({ queryKey: ["escalas"] });
}
```

**Admin vê**: "Escala criada com 2 membro(s) sugerido(s)"

---

## 📊 Estado Final

### No Supabase:

**escalas**:
```sql
id: esc-100
titulo: Missa Dominical
data: 2026-06-07
tipo: tipo_missa
status: rascunho
```

**escala_funcoes**:
```sql
id: ef-1
escala_id: esc-100
ministerio_id: min-1
quantidade: 2
```

**escala_membros**:
```sql
id: em-1 | escala_id: esc-100 | membro_id: mem-2 | ministerio_id: min-1 | status: pendente
id: em-2 | escala_id: esc-100 | membro_id: mem-1 | ministerio_id: min-1 | status: pendente
```

---

## 🔄 Se Admin Clica "Atualizar Sugestões" Manualmente

### Mesmo processo:
1. handleGenerateSuggestions() é chamado
2. Encontra missas_padrao correspondentes
3. Carrega restrições por missa
4. Chama generateEscalaAssignments()
5. setSuggestedAssignments() mostra na UI
6. Admin clica "Aplicar sugestões"
7. Insere em escala_membros

### Diferenças:
- Não insere automaticamente
- Mostra sugestões na UI antes de aplicar
- Admin pode revisar antes

---

## ❌ Se Nada Fosse Gerado (Exemplo de Erro)

### Cenário: membroMinisterios vazio

```typescript
// Se nenhuma relação em membro_ministerios
membroMinisterios = {
  // Vazio!
}
```

### No motor:
```typescript
// Para Acólito (min-1):
const candidatos = membroMinisterios["min-1"] ?? [];  // undefined → []
// Resultado: []

// Nenhum candidato! Alerta:
alertas.push("Nenhum membro disponível para Acólito")

// Retorno:
alocacoes = []  // Vazio!
```

### No Supabase:
```typescript
// Nada inserido em escala_membros
// (ou com status="pendente" mas vazio)
```

### UI:
```
"Não foi possível gerar sugestões automaticamente. 
Verifique disponibilidade, funções e ministérios definidos."
```

---

## 📋 Resumo do Fluxo

```
1. Admin preenche form
   ↓
2. saveMutation cria escala em BD
   ↓
3. Busca tipo_missa_funcoes
   ↓
4. Injeta em escala_funcoes
   ↓
5. Constrói funcoesPedido
   ↓
6. Chama generateEscalaAssignments()
   ├─ Inverte membroMinisterios
   ├─ Constrói MembroEngine[]
   ├─ Para cada função:
   │  ├─ Filtra aptos (isApto)
   │  ├─ Embaralha
   │  ├─ Ordena por scoreEfetivo
   │  └─ Aloca melhores
   └─ Retorna sugestões[]
   ↓
7. Insere sugestões em escala_membros (status=pendente)
   ↓
8. Toast: "Criada com X membros sugeridos"
   ↓
9. Cache invalidado, UI refaz query
   ↓
10. Admin vê escala nova com sugestões aplicadas
```

---

## 🎯 Pontos Críticos Neste Exemplo

1. **membroMinisterios** = mapa de quem pode servir ONDE
   - Se vazio = NADA funciona
   - Se missing para "min-1" = Acólito fica sem candidatos

2. **funcoesPedido** = dados formatados para motor
   - Deve ter ministerio_id, quantidade, ministerio.nome

3. **Motor** = aplica lógica inteligente
   - Embaralha para sorteio justo
   - Ordena por score para balancear
   - Respeita restrições

4. **Inserção** = com status="pendente"
   - Admin pode aceitar ou rejeitar
   - Ou pedir para regerar

