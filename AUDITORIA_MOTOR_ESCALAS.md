# AUDITORIA COMPLETA — MOTOR DE ESCALAS LUMEN PASTORAL
**Versão:** Motor V3  
**Data:** 2026-09-02  
**Arquivo principal:** `src/biblioteca/escala-engine.ts` (1000 linhas)  
**Wrapper:** `src/lib/escala-engine.ts`  
**Status:** FASE 1 (Auditoria) + FASE 2 (Diagnóstico) + FASE 3 (Proposta)  
**Nenhuma linha de código foi alterada.**

---

## SUMÁRIO

1. [FASE 1 — Auditoria do Motor Atual](#fase-1--auditoria-do-motor-atual)
   - 1.1 Fluxo completo passo a passo
   - 1.2 Elegibilidade — como funciona hoje
   - 1.3 Cálculo de prioridade — modo COMUM
   - 1.4 Cálculo de prioridade — modo SOLENE_PRINCIPAL
   - 1.5 Sistema de pools
   - 1.6 Disponibilidade e indisponibilidade
   - 1.7 Solenidades
   - 1.8 Presença e formações
   - 1.9 Score e ranking
   - 1.10 O que está correto no motor atual
2. [FASE 2 — Diagnóstico de Problemas](#fase-2--diagnóstico-de-problemas)
   - 2.1 Causa raiz da concentração
   - 2.2 Bugs críticos (P0)
   - 2.3 Problemas graves (P1)
   - 2.4 Conflitos de regras
   - 2.5 Por que os mesmos membros são repetidos
   - 2.6 Por que membros ficam esquecidos
3. [FASE 3 — Proposta do Novo Algoritmo](#fase-3--proposta-do-novo-algoritmo)
   - 3.1 Princípio central
   - 3.2 Estágio 1 — Elegibilidade
   - 3.3 Estágio 2 — Equidade de Oportunidade (fórmula)
   - 3.4 Estágio 3 — Comprometimento (desempate)
   - 3.5 Estágio 4 — Adequação à Função
   - 3.6 Tratamento de solenidades
   - 3.7 Tratamento de presença
   - 3.8 Desempate determinístico
   - 3.9 Transparência — o que o motor deve explicar
   - 3.10 Avaliação de Participação (substitui Ranking)
   - 3.11 Métricas de validação
   - 3.12 Plano de implementação e riscos

---

# FASE 1 — AUDITORIA DO MOTOR ATUAL

## 1.1 Fluxo Completo Passo a Passo

O motor recebe, como entrada:
- Lista de funções necessárias (`FuncaoNecessaria[]`) com quantidade e relevância
- Lista de membros ativos (`MembroEngine[]`) com score, restrições, vínculos
- Histórico recente (`HistoricoRecente[]`) de participações passadas
- Indisponibilidades (`IndisponibilidadeEngine[]`)
- Configurações da paróquia (`ConfigParoquia`)
- Contexto da escala (data, tipo, solene, tem_bispo)

O fluxo interno é:

```
ENTRADA
  ↓
computeGrupoStats()         — calcula maxTotal, maxRecente, maxDbScore, maxPorFuncao
  ↓
computeLimitePools()        — identifica quem está acima do limite semanal/mensal
  ↓
Para cada função (ordenada por ordem_prioridade):
  ↓
  Para cada membro:
    ├── sem_vinculo?         → eliminado
    ├── funcao_nao_pode?     → eliminado
    ├── incompatível?        → eliminado
    ├── atuação insuficiente? → eliminado
    ├── [SOLENIDADE] restrição dia semana? → ignorado silenciosamente
    ├── [COMUM] restrição dia semana?      → eliminado
    ├── indisponível na data? → eliminado (ou ignorado se flag ativo)
    ├── serviu ontem?        → eliminado (se impedir_repeticao_seguida)
    ├── dentro do intervalo_minimo_dias? → Pool 5 (fallback com alerta)
    ├── já alocado?          → Pool 4 (se duplicidade_permitida) ou eliminado
    ├── acima limite mensal? → Pool 3
    ├── acima limite semanal? → Pool 2
    ├── [SOLENIDADE] serviu na última solenidade? → Pool 1b
    └── elegível normal      → Pool 1
  ↓
  calcularScore() — calcula breakdown por membro
    ├── modoSolenePrincipal = ehSolene   ← BUG (ver 2.2.B1)
    └── Modo COMUM ou SOLENE_PRINCIPAL
  ↓
  scorePool() — pontua cada pool separadamente
  ↓
  ordenarPorGenero() — reordena por cota M/F (se configurado)
  ↓
  Seleção: Pool1 → Pool1b → Pool2 → Pool3 → Pool4 → Pool5
  ↓
  buildMotivo() — gera texto explicativo por membro
  ↓
  buildInsightCandidato() — diagnóstico top 8 candidatos
  ↓
SAÍDA: alocacoes, alertas, detalhesPorFuncao, insights
```

**Observação crítica sobre o fluxo:**  
A ordem acima expõe o problema fundamental: a elegibilidade e a pontuação estão conceitualmente misturadas no mesmo loop. O Pool1 é uma pré-seleção, mas dentro dele a pontuação pode ainda favorecer sistematicamente os mesmos membros por razões não relacionadas à justiça distributiva.

---

## 1.2 Elegibilidade — Como Funciona Hoje

Os critérios de eliminação (antes da pontuação) estão na função `alocarMembros()`, entre as linhas 688–735:

| Critério | Linha | Resultado | Exceção documentada |
|---|---|---|---|
| Sem vínculo com a função | 688 | Eliminado | — |
| Função proibida (`funcoes_nao_pode_ids`) | 689 | Eliminado | — |
| Incompatibilidade com membro já alocado | 690 | Eliminado | — |
| Atuação insuficiente | 691 | Eliminado | — |
| Restrição de dia da semana | 695 | Eliminado em escalas COMUNS | **Ignorado em solenidades** |
| Indisponibilidade de data específica | 697 | Eliminado | Flag `ignorar_indisponibilidades` |
| Serviu no dia anterior | 698–703 | Eliminado | Flag `impedir_repeticao_seguida` desativado |
| Dentro do intervalo mínimo | 704–710 | Pool 5 (fallback, alerta) | — |
| Já alocado em outra função | 713–717 | Pool 4 se duplicidade_permitida | — |
| Acima limite mensal | 722–724 | Pool 3 | — |
| Acima limite semanal | 725–727 | Pool 2 | — |
| Serviu na última solenidade | 728–734 | Pool 1b (rodízio) | — |

**Critérios ausentes que deveriam existir:**
- Nenhum filtro de presença mínima em escalas comuns
- Nenhuma verificação de sequências excessivas (membros com 4+ semanas consecutivas)
- Nenhum sinal de desequilíbrio sistêmico detectado proativamente

---

## 1.3 Cálculo de Prioridade — Modo COMUM (Equidade)

Ativado em: escalas sem solenidade (ou quando `modoSolenePrincipal = false`).

Código: `calcularScore()`, linhas 454–488.

**Fórmula atual:**

```
Score_COMUM = 0,35 × participacaoRecente
            + 0,30 × tempoSemServir
            + 0,10 × rankingBonus
            + 0,10 × frequenciaHistorica
            + 0,15 × aleatoriedade
            − penalidade
```

Onde cada componente vale 0–100 pontos:

**1. participacaoRecente (35%)** — Linha 457  
`max(0, (1 - count30d / CAP_PARTICIPACOES_30D) * 100)`  
- `count30d` = número de escalas do membro nos últimos 30 dias  
- `CAP_PARTICIPACOES_30D = 5`  
- Quem tem 0 escalas nos últimos 30d recebe 100 pontos. Quem tem ≥5 recebe 0.  
- **Problema:** não considera disponibilidade. Quem está disponível 6 dias/semana e teve 5 escalas recentes e quem só podia servir uma vez e já serviu recebem penalidade igual (0 pts).

**2. tempoSemServir (30%)** — Linha 460  
`min(diasSemServir, CAP_DIAS_SEM_SERVIR) / CAP_DIAS_SEM_SERVIR * 100`  
- `CAP_DIAS_SEM_SERVIR = 60`  
- Quem está há ≥60 dias sem servir recebe 100 pontos (máximo)  
- **Problema crítico:** o cap de 60 dias cria um "paredão". Quem está há 60 dias e quem está há 180 dias recebem exatamente o mesmo bônus (100 pts). Para um sistema semanal, 60 dias representa apenas 8 semanas — muito pouco para diferenciar membros que ficam 3 meses sem servir de quem ficou 2 meses.

**3. rankingBonus (10%)** — Linha 463  
`(1 - membro.score / maxDbScore) * 100`  
- Favorece quem tem menor score absoluto.  
- **Problema:** o score acumula indefinidamente. Um membro que entrou há 3 anos tem score muito maior que um que entrou há 3 meses, independente do comprometimento atual.

**4. frequenciaHistorica (10%)** — Linha 467  
`(1 - totalHist / maxTotal) * 100`  
- Favorece quem tem menos escalas no histórico total (sem janela temporal).  
- **Problema grave:** a janela é ilimitada. Um membro ativo há 5 anos terá mais histórico que um que entrou há 6 meses, mas isso não diz nada sobre o comprometimento atual.

**5. aleatoriedade (15%)** — Linha 472  
`Math.random() * 100`  
- **Bug crítico:** puro `Math.random()`, sem seed. O motor é não-determinístico. Duas gerações com exatamente os mesmos dados produzem resultados diferentes.  
- 15% é suficiente para superar o bônus de quem ficou até 3 semanas a mais sem servir: `tempoSemServir = 0,30 × (21d/60d) × 100 ≈ 10,5 pts`, enquanto aleatoriedade pode variar até 15 pts.

**Penalidades de recência** — Linhas 354–377  
- Mesmo dia: −50  
- Dia anterior: −30  
- Anteontem: −15  
- Mesma semana (3–8 dias): −25  
- Entre 9–30 dias: penalidade progressiva decrescente (25 pts → 0 pts)  
- Após 30 dias: sem penalidade

As penalidades são corretas conceitualmente, mas interagem mal com a aleatoriedade de 15%.

---

## 1.4 Cálculo de Prioridade — Modo SOLENE_PRINCIPAL (Mérito)

Ativado quando: `modoSolenePrincipal = true`. Atualmente ativado para TODAS as funções de qualquer solenidade (Bug B1).

Código: linhas 409–452.

**Fórmula atual:**

```
Score_SOLENE = 0,25 × rotacaoFuncao
             + 0,20 × experienciaFuncao
             + 0,25 × scoreMerito
             + 0,15 × taxaPresencaScore
             + 0,15 × formacaoScore
             + bonusPreferencial (fixo)
             + prioridadeBonus (fixo)
```

**1. rotacaoFuncao (25%):**  
`min(diasSemFuncao, 180) / 180 * 100`  
Dias desde a última vez que o membro exerceu ESTA FUNÇÃO ESPECÍFICA. Correto conceitualmente.

**2. experienciaFuncao (20%):**  
`(totalNaFuncao / maxNaFuncao) * 100`  
Normaliza pela quantidade máxima do grupo. Favorece quem tem mais experiência.

**3. scoreMerito (25%):**  
`(membro.score / maxDbScore) * 100`  
Score absoluto do banco. **Atenção:** em modo SOLENE, score alto é VANTAGEM (ao contrário do modo COMUM).

**4. taxaPresencaScore (15%):**  
`membro.taxa_presenca * 100`  
Taxa de presença nas convocações. Correto.

**5. formacaoScore (15%):**  
`min(formacoes, 10) / 10 * 100`  
Participação em formações nos últimos 6 meses. Correto.

**Sem penalidades e sem aleatoriedade** no modo SOLENE_PRINCIPAL.

---

## 1.5 Sistema de Pools

O sistema de pools é a parte mais correta do motor conceitualmente. Membros são separados antes da pontuação por critérios objetivos:

- **Pool 1:** elegível, dentro dos limites, não serviu na última solenidade → prioridade máxima
- **Pool 1b:** elegível, mas serviu na última solenidade → rodízio (de-priorizado)
- **Pool 2:** elegível, acima do limite semanal mas abaixo do mensal → segundo fallback
- **Pool 3:** elegível, acima do limite mensal → terceiro fallback (marcado como `forcado=true`)
- **Pool 4:** já alocado em outra função + `duplicidade_permitida=true` → multi-função
- **Pool 5:** violou o `intervalo_minimo_dias` → último recurso (alerta emitido)

A seleção percorre Pool1 → Pool1b → Pool2 → Pool3 → Pool4 → Pool5 até preencher as vagas.

**O que funciona:** a separação hierárquica impede que membros acima dos limites concorram com membros normais.  
**O que não funciona:** dentro do Pool 1, a pontuação ainda tem vieses sistêmicos que concentram escalas nos mesmos membros.

---

## 1.6 Disponibilidade e Indisponibilidade

**Restrições de dia da semana (`restricoes_dia_semana`):**  
- Armazenadas no campo `membros.restricoes_dia_semana` como array de inteiros (0=Dom…6=Sáb)
- Verificadas na linha 695: `m.restricoes_dia_semana?.includes(getDiaSemana(contexto.data))`
- **Bug B7:** a verificação é completamente ignorada para solenidades (guarda `if (!ehSolene && ...)`)
- A justificativa no código: "solenidades são eventos extraordinários" — mas a restrição é do membro, não da escala

**Indisponibilidade de data específica (`indisponibilidades`):**  
- Verificada via `estaIndisponivel()` (linhas 227–239)
- Suporta: data pontual e intervalo (`tipo='intervalo'` com `data_fim`)
- Funcionamento correto em escalas comuns
- Pode ser ignorada com o flag `ignorar_indisponibilidades` (ação deliberada da coordenação)

**Bloqueio de dupla escalação no mesmo dia:**  
- Construído no wrapper `_buildAndAllocate()` (linhas 234–248 do `escala-engine.ts` lib)
- Histórico do mesmo dia é convertido em indisponibilidade sintética
- Correto e funciona bem

---

## 1.7 Solenidades

O comportamento especial para solenidades é ativado por `ehMissaSolene()`:

```typescript
export function ehMissaSolene(tipo: string, solene: boolean, tem_bispo: boolean): boolean {
  return solene || tem_bispo || TIPOS_SOLENES.has((tipo ?? "").toLowerCase().trim());
}
// TIPOS_SOLENES = {"festa", "novena", "solenidade"}
```

Quando `ehSolene = true`:

**1. Restrições de dia da semana são ignoradas** (linha 695) — Bug B7  
**2. `modoSolenePrincipal = ehSolene`** (linha 634) — Bug B1: ativa modo mérito para TODAS as funções, não apenas as com `relevancia="principal"`  
**3. Pool 1b ativado** — membros que serviram na última solenidade são de-priorizados. Esse é o mecanismo de rodízio. Funciona conceitualmente, mas:
   - Dentro do Pool 1b, o scoring ainda usa modo SOLENE_PRINCIPAL (mérito), o que faz membros experientes no Pool 1b competirem e frequentemente vencerem membros novatos no Pool 1
   - O rodízio é de-priorização, não bloqueio real
**4. Sem penalidades de recência** no modo SOLENE_PRINCIPAL

**Sistema `PreferencialSolene`:**  
- Bônus fixo (padrão 20 pts) para membros vinculados a funções principais
- Substitui o campo deprecated `forcar_escalacao_solene`
- Razoável, mas o bônus fixo pode ser insuficiente em grupos com scores muito dispersos

---

## 1.8 Presença e Formações

**Taxa de presença (`taxa_presenca`):**  
- Campo do tipo `number` (0–1) passado via `MembroEngine`
- **Usado APENAS no modo SOLENE_PRINCIPAL** com peso 15%
- **Completamente ignorado no modo COMUM:** membros com 35% de presença concorrem em igualdade com membros com 100% em escalas normais
- Nenhum filtro mínimo de presença existe em qualquer modo

**Formações (`formacao_participacoes`):**  
- Campo com contagem de formações com presença confirmada nos últimos 6 meses
- **Usado APENAS no modo SOLENE_PRINCIPAL** com peso 15%
- Também ignorado no modo COMUM

**Gap de integração:**  
A RPC `get_ranking_completo` calcula `taxa_presenca` corretamente no banco, mas esses dados precisam ser carregados e passados ao motor no momento da geração. Se não forem passados, `taxa_presenca = undefined` → o motor trata como 0 no scoring de solenidades.

---

## 1.9 Score e Ranking

**`membros.score` (coluna no banco):**  
- Acumulado por triggers no banco ao longo do tempo
- Pontos positivos: presença confirmada, formações, solenidades
- Pontos negativos: falta, atraso (dependendo das regras configuradas)
- Não tem janela temporal — acumula desde o cadastro do membro
- Não é normalizado por oportunidades recebidas

**RPC `get_ranking_completo` (migration 148):**  
- Retorna: score, total_convocacoes, total_presencas, total_faltas, taxa_presenca, ministerios
- Ordenado por `score DESC` — é um leaderboard puro
- **Não calcula:** dias desde última escala, taxa de aproveitamento de oportunidades, distribuição por janela temporal, posição no rodízio
- **Não tem:** equidade, concentração, análise de disponibilidade

**Uso do score pelo motor:**  
- Modo COMUM: `rankingBonus = 1 - score/maxScore` → score alto = **desvantagem** (para equidade)
- Modo SOLENE: `scoreMerito = score/maxScore` → score alto = **vantagem** (para mérito)

O score portanto é usado com sinal invertido conforme o modo — um mesmo membro é avaliado de formas opostas em escalas comuns vs. solenidades.

---

## 1.10 O Que Está Correto no Motor Atual

Para ser justo, estas partes funcionam bem e não devem ser removidas:

- **Sistema de pools hierárquicos** (Pool 1 → Pool 5): a ideia é boa e deve ser preservada
- **Bloquear dupla escalação no mesmo dia:** correto e funciona
- **Penalidades de recência imediata** (mesmo dia, dia anterior, anteontem, semana): correto como proteção contra repetição imediata
- **Pool 1b para rodízio de solenidades:** o conceito é correto, a implementação tem bux mas a ideia está certa
- **`estaIndisponivel()` para datas específicas:** correto e funciona bem em escalas comuns
- **Distribuição de gênero** com contadores globais: a lógica é mais sofisticada e está correta
- **`PreferencialSolene`** substituindo `forcar_escalacao_solene`: melhora em relação ao sistema antigo
- **`InsightCandidato` / `InsightFuncao`:** a estrutura de dados para transparência já existe e é boa
- **`buildMotivo()`:** o texto explicável por membro existe — precisa ser expandido

---

# FASE 2 — DIAGNÓSTICO DE PROBLEMAS

## 2.1 Causa Raiz da Concentração

**A causa raiz não é um único bug. É uma estrutura matemática que cria um ciclo de reforço positivo:**

```
Membro com ampla disponibilidade
  → Aparece em mais escalas como elegível
  → É selecionado com mais frequência (mais oportunidades absolutas)
  → Acumula mais participações nos últimos 30 dias
  → participacaoRecente diminui (penalidade), MAS...
  → Acumula score absoluto mais alto
  → rankingBonus cai (em modo COMUM) — penalidade pequena (apenas 10%)
  → Continua aparecendo nos próximos ciclos
  → E quando a janela de 30d "esfria", volta a ter prioridade total
```

O ciclo se fecha porque **a disponibilidade ampla garante mais oportunidades absolutas, e as métricas absolutas (score, totalHist) nunca normalizam por oportunidades**. 

Um membro disponível 6 dias/semana tem potencialmente 6× mais oportunidades que um disponível apenas domingo. Mesmo que ambos tenham a mesma taxa de aproveitamento (digamos, 40%), o primeiro vai aparecer 6× mais vezes nas escalas — e o motor não distingue isso.

---

## 2.2 Bugs Críticos (P0)

### B1 — `modoSolenePrincipal = ehSolene` (linha 634)

**Arquivo:** `src/biblioteca/escala-engine.ts:634`

```typescript
// CÓDIGO ATUAL (incorreto):
const modoSolenePrincipal = ehSolene;

// DEVERIA SER:
const modoSolenePrincipal = ehSolene && funcao.relevancia === "principal";
```

**Impacto:** Ativa modo mérito (experiência + score + presença + formação) para TODAS as funções de qualquer solenidade, incluindo funções secundárias como Credência, Turíbulo, Tocha, etc. Essas funções deveriam usar equidade, não mérito. Resultado: membros com score alto e experiência maior dominam TODAS as funções da solenidade, não apenas as principais.

**Risco da correção:** Baixo. Apenas altera qual modo é usado em funções com `relevancia="normal"` em solenidades.

---

### B2 — `CAP_DIAS_SEM_SERVIR = 60` (linha 187)

**Arquivo:** `src/biblioteca/escala-engine.ts:187`

```typescript
const CAP_DIAS_SEM_SERVIR = 60;  // muito baixo
```

**Impacto:** Após 60 dias sem servir, qualquer membro adicional de ausência não adiciona bônus. Quem está há 60 dias e quem está há 5 meses recebem exatamente 100 pontos (máximo) neste componente. O componente perde capacidade de discriminar membros que ficaram muito tempo sem servir. Em um sistema com ciclos semanais, 60 dias = apenas 8 semanas — pouquíssimo.

**Correção proposta:** 120 dias (17 semanas). Isso permite que o bônus continue crescendo por 4 meses, dando verdadeiro peso a quem ficou muito tempo sem ser chamado.

**Risco da correção:** Baixo. Apenas expande o intervalo de discriminação.

---

### B3 — `Math.random() * 100` como 15% do score (linha 472)

**Arquivo:** `src/biblioteca/escala-engine.ts:472`

```typescript
const aleatoriedade = Math.random() * 100;  // não-determinístico
```

**Impacto:**
1. O motor não é determinístico. Duas gerações com os mesmos dados produzem resultados diferentes.
2. O coordenador não consegue entender por que alguém foi escolhido: "por que hoje o João e não a Maria?" — pode ser apenas sorte.
3. 15% é suficiente para superar o bônus de até 3 semanas sem servir: `tempoSemServir = 30% × (21d/60d) × 100 = 10,5 pts` vs. aleatoriedade que pode variar até 15 pts. O rodízio pode ser anulado por sorte.
4. O preview de escala pode mostrar um resultado diferente do que será salvo se o motor for chamado novamente.

**Risco da correção:** Médio. Remover a aleatoriedade exige que o sistema de desempate determinístico seja bem projetado, caso contrário o mesmo membro sempre vence empates.

---

### B4 — Restrição de dia da semana ignorada em solenidades (linha 695)

**Arquivo:** `src/biblioteca/escala-engine.ts:695`

```typescript
// CÓDIGO ATUAL: a guarda "!ehSolene" suprime a verificação
if (!ehSolene && m.restricoes_dia_semana?.includes(getDiaSemana(contexto.data))) {
  excluidos.dia_semana++;
  continue;
}
```

**Impacto:** Se uma solenidade cai no domingo e um membro declarou "não posso aos domingos", o motor o escala normalmente, sem nenhum aviso ao coordenador. A restrição do membro é completamente ignorada.

**A justificativa no código ("solenidades são eventos extraordinários") está errada:** a restrição semanal é uma declaração do membro sobre sua disponibilidade estrutural. Se ele não pode aos domingos, é porque trabalha, cuida de filhos, ou tem outro compromisso fixo. Uma solenidade não muda isso.

**Correção:** Respeitar `restricoes_dia_semana` em solenidades da mesma forma que em escalas comuns. Se a coordenação quiser fazer exceção, deve usar o mecanismo de `ignorar_indisponibilidades` com confirmação explícita.

**Risco da correção:** Baixo. Pode reduzir ligeiramente o pool disponível para solenidades em domingos, mas o Pool 1b e os pools de fallback compensam.

---

## 2.3 Problemas Graves (P1)

### P1.1 — Disponibilidade ampla como vantagem sistêmica implícita

**Onde ocorre:** Em todos os componentes de modo COMUM.

O motor não tem nenhuma normalização por oportunidades reais. Um membro disponível 6 dias/semana:
- Aparece em mais escalas como elegível
- Acumula mais participações em `count30d` → seu bônus de `participacaoRecente` satura mais rápido, mas também volta mais rápido
- Acumula mais em `totalHist` → penalizado em `frequenciaHistorica`, mas o máximo do grupo também é seu, reduzindo a penalidade relativa
- Acumula mais score absoluto → penalizado em `rankingBonus`, mas de forma proporcional

A disponibilidade contamina todos os componentes de forma implícita, sem que exista um único lugar para corrigir isso.

---

### P1.2 — Sem filtro de presença mínima em escalas comuns

O modo COMUM não considera `taxa_presenca` em nenhum momento. Membros com 33% ou 35% de presença (dados reais encontrados na auditoria anterior) concorrem em plena igualdade com membros com 100% em escalas normais. Isso:
- Priva membros comprometidos de oportunidades
- Recompensa comportamento de falta sistemática com escalas continuadas

---

### P1.3 — Score absoluto acumula indefinidamente sem normalização temporal

`membros.score` cresce desde o cadastro. Um membro com 3 anos na pastoral tem score muito maior que um com 6 meses, independente do comprometimento atual de cada um. Isso afeta diretamente `rankingBonus` (modo COMUM) e `scoreMerito` (modo SOLENE). Membros novos são artificialmente favorecidos em equidade e prejudicados em mérito — não porque merecem, mas pelo tempo de cadastro.

---

### P1.4 — `frequenciaHistorica` usa janela ilimitada

O componente `frequenciaHistorica` (10%) compara o total histórico do membro com o máximo do grupo, sem qualquer janela temporal. Um membro que serviu muito no ano 1 mas está inativo nos últimos 6 meses ainda aparece com histórico alto — sendo penalizado mesmo que atualmente seja um dos que mais precisam de oportunidade.

---

### P1.5 — Cap de `participacaoRecente` satura com facilidade

`CAP_PARTICIPACOES_30D = 5`. Membros com 5 ou mais escalas nos últimos 30 dias recebem 0 pontos neste componente, igualando quem teve 5 com quem teve 15. Membros com disponibilidade ampla chegam a esse cap rapidamente e "resetam" — voltando a competir normalmente após o período de 30 dias.

---

### P1.6 — Solenidades: modo mérito ativado para funções secundárias (consequência do Bug B1)

Mesmo após corrigir B1 para `ehSolene && relevancia === "principal"`, ainda haverá funções que deveriam usar equidade em solenidades. O motor precisa de lógica explícita para tratar cada tipo de função adequadamente em solenidades.

---

## 2.4 Conflitos de Regras

| # | Regra A | Regra B | Conflito |
|---|---|---|---|
| C1 | `aleatoriedade` (15%) garante rotação entre gerações | `tempoSemServir` (30%) garante equidade de rodízio | A aleatoriedade supera até 3 semanas de vantagem no rodízio. Um membro que ficou 21 dias a mais sem servir pode perder para outro com sorte: 30% × 21/60 × 100 = 10,5 pts vs. até 15 pts de aleatoriedade. |
| C2 | Pool 1b de-prioriza quem serviu na última solenidade | Modo SOLENE_PRINCIPAL usa mérito puro | Dentro do Pool 1b, o scoring por mérito permite que membros experientes do 1b venham antes de membros novatos do Pool 1 se o Pool 1 estiver vazio. O rodízio é contornado pelo mérito. |
| C3 | `restricoes_dia_semana` bloqueia o membro em dias que não pode | Solenidades ignoram essa restrição | O membro declara que não pode domingo. A solenidade é domingo. O motor o escala sem avisar. |
| C4 | CAP de 60 dias cria teto para bônus de tempo | Aleatoriedade de 15% sempre presente | Quem está há 60+ dias sem servir tem bônus máximo de tempo (30 pts). Com aleatoriedade, um membro que foi escalado 3 semanas atrás pode receber até 15 pts de sorte, mais do que os 10 pts de diferença de tempo que ele teria. |
| C5 | `frequenciaHistorica` usa todo o histórico (janela ilimitada) | `participacaoRecente` usa apenas 30 dias | Os dois componentes medem conceitos semelhantes em janelas incompatíveis. Um membro que serviu muito no ano 1 e pouco nos últimos 3 meses pode ter `frequenciaHistorica` alto (penalidade) mas `participacaoRecente` baixo (bônus) — os sinais se contradizem. |
| C6 | Modo COMUM usa `1 - score/maxScore` (score alto = desvantagem) | Modo SOLENE usa `score/maxScore` (score alto = vantagem) | O mesmo membro tem avaliações opostas dependendo do tipo de missa. Um membro com score 200 é de-priorizado nas missas comuns e priorizado nas solenidades — criando incentivo perverso. |

---

## 2.5 Por Que os Mesmos Membros São Repetidos

O ciclo de concentração funciona assim para um membro com disponibilidade ampla e score alto (ex.: Eduardo Ferreira, 22 escalações em 11 semanas):

1. Está disponível muitos dias → aparece em muitos pools como elegível
2. Seu `participacaoRecente` satura (`count30d = 5`) → recebe 0 pts neste componente
3. Mas após 30 dias sem nova escala, o cap reseta e ele volta a ter pontuação máxima
4. Seu `tempoSemServir` chega a 60 dias rapidamente → bônus máximo (30 pts)
5. Seu `rankingBonus` é baixo por score alto — mas apenas 10% do total
6. `frequenciaHistorica` é baixo por alto histórico — mas apenas 10%
7. `aleatoriedade` varia aleatoriamente, frequentemente em seu favor
8. **Resultado:** a cada ciclo de 30–60 dias ele volta a ter score competitivo e é selecionado novamente

A janela de 30 dias para participacaoRecente é curta demais para manter a penalidade efetiva por tempo suficiente.

---

## 2.6 Por Que Membros Ficam Esquecidos

Para um membro com disponibilidade restrita (ex.: disponível apenas domingo):

1. Só aparece como elegível em 1 escala por semana (domingo)
2. Mesmo com bônus máximo de `tempoSemServir` e `rankingBonus`, compete contra todos os outros naquele domingo
3. Quem tem disponibilidade mais ampla serve em outros dias → quando o domingo chega, eles ainda têm bônus razoável de tempo + aleatoriedade
4. Após ser escalado uma vez, o membro com disponibilidade restrita entra em penalidade de 30 dias
5. Na escala seguinte do domingo (7 dias depois), ainda está em penalidade total
6. Na escala de 14 dias depois, penalidade progressiva (ainda pesada)
7. Só volta a competir normalmente após 30+ dias — o que, para um ciclo de domingos, significa 4+ semanas de espera
8. Durante essas semanas, membros com disponibilidade ampla ocuparam as vagas

---

# FASE 3 — PROPOSTA DO NOVO ALGORITMO

## 3.1 Princípio Central

O motor deve responder a uma única pergunta:

> **"Entre os membros que PODEM servir nesta escala, quem está tendo menos oportunidade relativa de servir — comparado à sua própria disponibilidade — e demonstra comprometimento suficiente?"**

Três mudanças fundamentais em relação ao motor atual:

1. **Disponibilidade = elegibilidade, não vantagem.** Disponibilidade ampla não deve gerar score maior.
2. **Equidade normalizada por oportunidades reais**, não por participações absolutas.
3. **Motor determinístico.** Mesmos dados → mesmo resultado.

---

## 3.2 Estágio 1 — Elegibilidade (Porta de Entrada)

A elegibilidade é binária: o membro PODE ou NÃO PODE servir. Nenhum score é calculado aqui.

**Critérios de eliminação total (igual ao atual, mais correções):**

| Critério | Mudança vs. atual |
|---|---|
| Sem vínculo com a função | Igual |
| Função proibida | Igual |
| Incompatibilidade | Igual |
| Atuação insuficiente | Igual |
| **Restrição de dia da semana** | **Corrigido: respeitada TAMBÉM em solenidades** |
| Indisponibilidade de data específica | Igual (flag ignorar mantido com confirmação) |
| Conflito com escala no mesmo dia | Igual |

**Critério de pool reduzido (novo — não elimina, reduz prioridade):**

- Membro com presença < 70% nas últimas 8 semanas E com amostra ≥ 6 convocações → vai para Pool 2 (abaixo dos membros sem essa penalidade), não para o Pool 1
- Com amostra < 6 convocações: sem penalidade de presença (amostra insuficiente)

**Pools de fallback (estrutura preservada):**

```
Pool 1:  elegível + dentro dos limites + sem penalidade de presença
Pool 1b: elegível + serviu na última solenidade (rodízio) [apenas em solenidades]
Pool 2:  elegível + presença < 70% com amostra ≥ 6 OU acima do limite semanal
Pool 3:  elegível + acima do limite mensal (forcado=true)
Pool 4:  já alocado + duplicidade_permitida (forcado=true)
Pool 5:  violou intervalo_minimo_dias (forcado=true, alerta)
```

**Regra de solenidade:**
- Membro que serviu na última solenidade → Pool 1b para TODA solenidade seguinte
- Pool 1b é descartado apenas se Pool 1 tiver candidatos suficientes
- Se Pool 1 esgota, Pool 1b é usado com alerta para o coordenador: "Rodízio esgotado — [Nome] está sendo repetido da última solenidade"

---

## 3.3 Estágio 2 — Equidade de Oportunidade

Este é o componente principal. Responde: quem, dentre os elegíveis, está recebendo menos oportunidades proporcionalmente?

### Conceito de "oportunidade"

Uma **oportunidade** é uma escala passada em que o membro estava elegível (ativo, com vínculo, sem indisponibilidade registrada, sem restrição de dia naquela data, dentro dos limites).

Isso requer calcular, para cada membro, quantas escalas passadas ele poderia ter servido — **mas não serviu**. Na prática, usamos uma aproximação com janela de 12 semanas.

### Fórmula do Score de Equidade (S2)

```
oportunidades(m, 12sem) = número de escalas passadas nas últimas 12 semanas
                          em que m estava elegível para a função atual

escalas_recebidas(m, 12sem) = número de escalas que m efetivamente recebeu
                               nas últimas 12 semanas

aproveitamento(m) = escalas_recebidas / max(oportunidades, 1)
                    [resultado: 0.0 a 1.0]

equidade(m) = 1 - aproveitamento(m)
              [quem aproveitou menos tem score maior = mais prioridade]

rodizio(m) = min(dias_sem_servir, 120) / 120
             [quanto mais tempo sem servir qualquer função, maior]

S2(m) = 0,60 × equidade(m) + 0,40 × rodizio(m)
        [resultado: 0.0 a 1.0, normalizado]
```

### Por que esta fórmula resolve o problema central

**Exemplo concreto:**

João: disponível 6 dias/semana
- Nas últimas 12 semanas: 36 oportunidades de escala (simplificando: 3/semana)
- Foi escalado 12 vezes
- aproveitamento = 12/36 = 33%
- equidade = 1 - 0,33 = 0,67
- Não serviu há 7 dias → rodizio = 7/120 = 0,058
- S2 = 0,60 × 0,67 + 0,40 × 0,058 = **0,426**

Maria: disponível apenas domingo
- Nas últimas 12 semanas: 12 oportunidades (1/semana)
- Foi escalada 2 vezes
- aproveitamento = 2/12 = 17%
- equidade = 1 - 0,17 = 0,83
- Não serviu há 21 dias → rodizio = 21/120 = 0,175
- S2 = 0,60 × 0,83 + 0,40 × 0,175 = **0,568**

**Resultado: Maria tem prioridade maior (0,568 > 0,426)**, mesmo tendo menos escalas absolutas, porque proporcionalmente aproveitou menos suas oportunidades. João não é penalizado por ter servido mais — ele serviu mais porque tinha mais oportunidades. Mas Maria, por ter tido menos oportunidades e aproveitado proporcionalmente menos, tem prioridade.

### Implementação prática do "oportunidades"

Para calcular oportunidades sem alterar o banco agora, usamos uma aproximação:

- Para cada escala publicada nas últimas 12 semanas, verificar se o membro estava elegível (ativo, com vínculo, sem indisponibilidade, sem restrição de dia)
- Isso pode ser feito no frontend ao carregar o histórico, ou via RPC no banco

Uma RPC `get_oportunidades_por_membro(paroquia_id, funcao_id, janela_semanas)` que retorna `{ membro_id, oportunidades, escalas_recebidas }` é a implementação ideal.

### O peso de cada componente

**Por que 60% para equidade e 40% para rodízio?**

- `equidade` normaliza por oportunidades: é o componente principal da justiça distributiva
- `rodizio` (dias sem servir) é o mecanismo de rotação de curto prazo: garante que, entre dois membros com aproveitamento similar, quem ficou mais tempo sem servir vem primeiro
- O rodízio está capped em 120 dias (não 60) para que a vantagem continue crescendo por 4 meses inteiros

---

## 3.4 Estágio 3 — Comprometimento (Desempate)

O Estágio 3 é o desempate: entre membros com S2 muito próximo (diferença < 0,10), o comprometimento decide.

**Este é um desempate, não um critério principal.** Não queremos que comprometimento monopolize escalas — queremos que ele resolva empates.

### Fórmula do Score de Comprometimento (S3)

```
presenca_recente(m) = taxa de presença nas últimas 8 semanas (convocações/presentes)
                      [0.0 a 1.0, amostra mínima = 4 para usar; senão = 0,75 neutro]

formacao(m) = min(formacao_participacoes, 10) / 10
              [igual ao motor atual]

tendencia_presenca(m) = taxa_ultimas_4sem - taxa_anteriores_4sem
                        clampado em [-0,20, +0,20] → normalizado para [0,0, 1,0]
                        [melhora de presença recebe bônus; piora recebe penalidade]

score_normalizado(m) = membro.score / maxScore
                       [score do banco, normalizado — indicador geral, não principal]

S3(m) = 0,40 × presenca_recente(m)
      + 0,25 × formacao(m)
      + 0,20 × (0,5 + tendencia_presenca(m))  [tendência como modificador]
      + 0,15 × score_normalizado(m)
      [resultado: 0.0 a 1.0]
```

**Por que estas ponderações?**

- **Presença recente (40%):** o mais importante do comprometimento — estar presente quando convocado é o comportamento mais básico
- **Formação (25%):** comprometimento pastoral. Quem participa de formações demonstra engajamento além da escala
- **Tendência de presença (20%):** recompensa melhora recente. Um membro que tinha presença ruim mas melhorou deve ser recompensado, não punido pelo histórico antigo
- **Score normalizado (15%):** como indicador complementar geral, não como motor principal

**Regra de amostra mínima para presença:**

| Convocações recentes (8 sem) | Tratamento |
|---|---|
| 0 ou 1 | presenca_recente = 0,75 (neutro) — amostra insuficiente |
| 2 a 3 | presenca_recente = taxa real, mas sem penalidade de pool |
| 4 a 5 | presenca_recente = taxa real; se < 70%, vai para Pool 2 |
| ≥ 6 | presenca_recente = taxa real; se < 70%, Pool 2; se < 50%, Pool 3 |

---

## 3.5 Estágio 4 — Adequação à Função

Aplicado apenas a funções com `relevancia = "principal"` em solenidades. Para funções normais, S2 e S3 são suficientes.

### Fórmula do Score de Função (S4) — Solenidades, funções principais

```
experiencia_na_funcao(m) = escalas_recebidas_nesta_funcao / max_do_grupo_nesta_funcao
                           [0.0 a 1.0]

rodizio_na_funcao(m) = min(dias_sem_esta_funcao, 180) / 180
                       [0.0 a 1.0, igual ao motor atual]

S4_principal(m) = 0,50 × experiencia_na_funcao(m)
               + 0,30 × rodizio_na_funcao(m)
               + 0,20 × S3(m)
               [resultado: 0.0 a 1.0]
```

**Para funções normais em solenidades:**  
Usar S2 + S3 (sem S4). A experiência em funções secundárias não deve ser critério prioritário.

### Unificação dos estágios

**Score final de ordenação (F) para cada pool:**

```
Para funções normais (qualquer escala):
  F(m) = S2(m)                     [equidade como critério principal]
         desempate: S3(m)          [comprometimento]
         desempate final: membro_id lexicográfico [determinístico]

Para funções principais em solenidades:
  F(m) = S4_principal(m)           [adequação à função como critério]
         desempate: S2(m)          [equidade]
         desempate final: membro_id lexicográfico [determinístico]
```

**Não existe aleatoriedade em nenhum ponto.**

---

## 3.6 Tratamento de Solenidades

As solenidades usam o mesmo motor, com regras adicionais:

**Regras adicionais mantidas:**
1. Pool 1b: quem serviu na última solenidade é de-priorizado (não eliminado)
2. Funções com `relevancia = "principal"` usam S4 como critério principal
3. Funções com `relevancia = "normal"` usam S2 (equidade) como critério principal
4. Penalidades de recência imediata continuam ativas para funções normais
5. `PreferencialSolene` mantido: bônus fixo, mas somado ao S4, não ao S2

**Regras corrigidas:**
1. `restricoes_dia_semana` passa a ser respeitado (Bug B4 corrigido)
2. `modoSolenePrincipal` ativado apenas para `relevancia = "principal"` (Bug B1 corrigido)

**Regra de repetição de solenidade:**

```
Se membro está no Pool 1b (serviu na última solenidade):
  → É elegível para Pool 1b apenas
  → Pool 1b só é usado se Pool 1 for insuficiente
  → Se usado, alerta: "[Nome] serviu na última solenidade [Data] — rodízio esgotado"
  → Motivo registrado na escala
```

---

## 3.7 Tratamento de Presença

### Lógica de pool por presença

```
Calcular taxa de presença nas últimas 8 semanas (convocações_recentes / presentes_recentes):

amostra_recente = convocações nas últimas 8 semanas

Se amostra_recente < 4:
  → sem penalidade de pool (amostra insuficiente)
  → presenca_recente = 0,75 (neutro no S3)

Se amostra_recente >= 4 e taxa >= 70%:
  → Pool 1 (normal)
  → presenca_recente = taxa real no S3

Se amostra_recente >= 4 e taxa entre 50% e 70%:
  → Pool 2 (reduzido)
  → presenca_recente = taxa real no S3
  → alerta ao coordenador: "[Nome] — presença {taxa}% nas últimas 8 semanas"

Se amostra_recente >= 6 e taxa < 50%:
  → Pool 3 (baixo — usado apenas como fallback)
  → alerta ao coordenador: "[Nome] — presença muito baixa: {taxa}% em {n} convocações"
```

**Faltas justificadas vs. injustificadas:**  
O campo `status` em `escala_membros` já distingue 'presente', 'faltou', 'justificou', 'atrasado'. A taxa de presença para fins de pool deve considerar:
- 'presente' + 'atrasado': conta como presença (parcial, mas foi)
- 'justificou': não conta como falta para o pool (não penaliza o pool, mas também não conta como presença)
- 'faltou': conta como falta para o pool

Ou seja: `taxa_para_pool = (presentes + atrasados) / (convocacoes - justificados)` com amostra mínima ajustada.

---

## 3.8 Desempate Determinístico

Quando dois membros têm S2 idêntico (diferença < 0,001) e S3 idêntico:

**Ordem de desempate:**

1. Maior `dias_sem_servir` (mais tempo parado = prioridade)
2. Menor `escalas_recebidas_total_12sem` (menos escalas absolutas na janela)
3. Maior `presenca_recente` (mais confiável quando convocado)
4. Maior `experiencia_na_funcao` (para funções com histórico)
5. `membro_id` lexicográfico crescente (determinístico e imutável)

**A aleatoriedade `Math.random()` é completamente eliminada.**

O resultado é 100% reproduzível: os mesmos dados de entrada produzem sempre a mesma saída.

---

## 3.9 Transparência — O Que o Motor Deve Explicar

O `InsightCandidato` deve ser expandido para conter:

```typescript
type InsightCandidatoV4 = {
  membro_id: string;
  nome: string;
  
  // Estágio 1 — Elegibilidade
  pool: 1 | "1b" | 2 | 3 | 4 | 5 | "eliminado";
  motivo_pool: string;           // "Serviu na última solenidade" | "Presença 45%" | etc.
  indisponivel: boolean;
  restricao_dia: boolean;
  
  // Estágio 2 — Equidade
  oportunidades_12sem: number;
  escalas_recebidas_12sem: number;
  aproveitamento_pct: number;    // 0-100
  equidade_score: number;        // 0-100
  dias_sem_servir: number;
  rodizio_score: number;         // 0-100
  S2: number;                    // 0-100
  
  // Estágio 3 — Comprometimento
  presenca_recente_pct: number;  // 0-100, últimas 8sem
  convocacoes_recentes: number;  // amostra para presença
  formacao_score: number;        // 0-100
  tendencia_presenca: string;    // "melhorando" | "estável" | "piorando"
  S3: number;                    // 0-100
  
  // Estágio 4 — Função (solenidade/principal)
  experiencia_na_funcao: number;
  rodizio_na_funcao_dias: number;
  S4?: number;                   // apenas funções principais em solenidades
  
  // Resultado
  score_final: number;
  posicao_ranking_pool: number;
  escolhido: boolean;
  motivo_escolha?: string;       // "Maior equidade de oportunidade no pool"
  motivo_nao_escolha?: string;   // "Score inferior a Ana Lima (S2: 0,45 vs 0,62)"
};
```

**Exemplo de texto gerado pelo novo `buildMotivo()`:**

Para membro escolhido:
```
Selecionado — equidade de oportunidade:
• Teve 8 oportunidades nas últimas 12 semanas, recebeu 1 escala (12,5% aproveitamento)
• Está há 42 dias sem servir
• Presença de 100% nas últimas 8 semanas
• Formações: 3 nos últimos 6 meses
```

Para membro não escolhido (mas elegível):
```
Não selecionado — outro candidato tem maior equidade:
• Aproveitamento 33% (10 de 30 oportunidades) vs. Maria: 12,5% (1 de 8)
• Serviu há apenas 7 dias (Maria: 42 dias)
• S2: 42,6 vs. Maria: 56,8
```

Para membro não elegível:
```
Não candidato — indisponível nesta data.
```
ou:
```
Não candidato — restrição de dia (declarou: não pode aos domingos).
```
ou:
```
Não candidato — serviu na última solenidade (18/08/2026). Retorna ao pool normal na próxima solenidade.
```

---

## 3.10 Avaliação de Participação (Substitui Ranking)

A página de Ranking deve ser completamente redesenhada como "Avaliação de Participação". Não é mais um leaderboard — é um painel de análise.

**Para a coordenação (visão completa):**

Por membro, exibir:

```
OPORTUNIDADE
  oportunidades totais (12 semanas)
  escalas recebidas (12 semanas)
  aproveitamento (%)
  tendência: ↑ melhorando / → estável / ↓ piorando
  situação no rodízio: Normal | De-priorizado (serviu na última solenidade)
  dias desde a última escala

PRESENÇA (8 semanas)
  convocações
  presentes
  atrasados
  justificou
  faltou
  taxa de presença (para pool)
  amostra: suficiente / insuficiente

FORMAÇÃO (6 meses)
  formações disponíveis
  participações confirmadas
  percentual

HISTÓRICO POR JANELA
  últimas 4 semanas: N escalas
  últimas 8 semanas: N escalas
  últimas 12 semanas: N escalas
  total histórico: N escalas

FUNÇÕES
  lista das funções que exerce
  quantidade por função (12 semanas)
  última vez em cada função

SOLENIDADES
  solenidades nas últimas 20 semanas: N
  última solenidade: [data]
  situação: pode servir / em rodízio (esperando)

AVALIAÇÃO COMPOSTA
  equidade: [score S2 em %] — "Abaixo da média do grupo"
  comprometimento: [score S3 em %] — "Acima da média do grupo"
  situação geral: [Normal | Precisa de oportunidade | Em rodízio | Presença reduzida]
```

**Para o membro (visão pessoal, sem comparação):**

```
MINHA PARTICIPAÇÃO
  Últimas 4 semanas: N escalas
  Últimas 12 semanas: N escalas
  Minha última escala: [data] ([dias] dias atrás)

MINHA PRESENÇA
  Quando fui convocado, estive presente em X% das vezes

MINHAS FORMAÇÕES
  Participei de N formações nos últimos 6 meses

MINHAS FUNÇÕES
  Funções que exerci: [lista]

PRÓXIMAS ESCALAS
  Minha disponibilidade cadastrada
  [Sem indicação de posição no ranking ou comparação com outros]
```

**A RPC necessária:**

Criar `get_avaliacao_participacao(p_paroquia_id UUID, p_janela_semanas INTEGER)` retornando todos os dados acima calculados no banco (oportunidades, aproveitamento, presença por janela, formações, solenidades, funções).

---

## 3.11 Métricas de Validação

Antes de ir para produção, a simulação retrospectiva deve medir:

| Métrica | Motor Atual (benchmark) | Meta Motor Novo |
|---|---|---|
| Gini de distribuição | 0,47 (medido em 11 semanas) | ≤ 0,20 |
| Membros com 0 escalas em 12 semanas | 17 de 85 (20%) | ≤ 5 |
| Membros com 1–2 escalas | — | ≥ 30% do total |
| Máximo de escalas por membro (12 sem) | 22 (Eduardo Ferreira) | ≤ 14 |
| Semanas consecutivas máx. por membro | — | ≤ 3 consecutivas |
| Tempo máx. sem servir (disponível) | — | ≤ 8 semanas |
| % de escalas nos 5 maiores | — | ≤ 25% |
| Membros com presença < 35% ainda escalados | — | 0 no Pool 1 |
| Respeito a indisponibilidades (semanal + avulsa) | 95% | 100% |
| Determinístico (mesmos dados = mesmo resultado) | Não | Sim |
| Resultado explicável por membro | Parcial | Completo |

**Atenção:** Se o novo motor não atingir todas as metas, não forçar artificialmente. Apresentar os números reais e identificar por quê algumas metas podem ser estruturalmente impossíveis (ex.: se há apenas 3 membros elegíveis para uma função, é matematicamente impossível ter Gini < 0,20 para aquela função).

---

## 3.12 Plano de Implementação e Riscos

### Ordem de execução proposta

**FASE 4 — Simulação retrospectiva (ANTES de qualquer código)**
- Implementar a fórmula proposta como script separado
- Rodar sobre os dados reais das últimas 12 semanas
- Comparar motor atual vs. novo em todas as métricas
- Apresentar resultados à coordenação para aprovação

**FASE 5 — Aprovação**
- Apresentar comparativo e receber aprovação formal
- Nenhuma alteração em produção antes desta etapa

**FASE 6A — Correções P0 (baixo risco, alto impacto)**
- Corrigir Bug B1 (linha 634): `modoSolenePrincipal = ehSolene && relevancia === "principal"`
- Corrigir Bug B3 (linha 472): remover `Math.random()`, adicionar desempate determinístico
- Corrigir Bug B4 (linha 695): respeitar `restricoes_dia_semana` em solenidades
- Aumentar `CAP_DIAS_SEM_SERVIR` de 60 para 120 (linha 187)
- **Risco:** Baixo. São mudanças pontuais sem refatoração estrutural.

**FASE 6B — Novo cálculo de equidade (médio risco)**
- Substituir `calcularScore()` pela nova fórmula S2 + S3 + S4
- Criar RPC `get_oportunidades_por_membro` no Supabase
- Expandir `InsightCandidato` com os novos campos
- Atualizar `buildMotivo()` com explicações detalhadas
- **Risco:** Médio. É uma reescrita da função central. Testar extensivamente antes de publicar.

**FASE 6C — Filtro de presença (baixo risco)**
- Adicionar lógica de pool por presença em `alocarMembros()`
- Adicionar alertas para membros com presença baixa
- **Risco:** Baixo. É uma adição ao sistema de pools existente.

**FASE 7 — Avaliação de Participação**
- Criar RPC `get_avaliacao_participacao`
- Redesenhar a página `ranking.tsx`
- Expandir a visão do portal do membro
- **Risco:** Médio. Envolve nova RPC e redesign de página, mas não afeta o motor de geração.

**FASE 8 — Homologação**

Testar explicitamente cada cenário:

| Cenário | Como testar | Verificar |
|---|---|---|
| Membro disponível apenas domingo | Criar membro com restricoes_dia_semana=[1,2,3,4,5] | Aparece apenas em escalas de domingo |
| Membro disponível 6 dias/semana | Sem restrições | Score de equidade proporcional às oportunidades |
| Indisponibilidade semanal em solenidade | Solenidade num domingo, membro com restricoes=[0] | Membro NÃO aparece como candidato |
| Indisponibilidade avulsa | Cadastrar indisponibilidade específica | Membro eliminado sem fallback silencioso |
| Solenidade — rodízio | Membro que serviu na última solenidade | Vai para Pool 1b, não Pool 1 |
| Solenidade — função principal | Função com relevancia="principal" | S4 usado como critério |
| Solenidade — função normal | Função com relevancia="normal" em solenidade | S2 (equidade) usado, não S4 |
| Presença baixa com amostra pequena | Membro com 2 convocações e 1 falta | Sem penalidade de pool |
| Presença baixa com amostra suficiente | Membro com 8 convocações e 45% presença | Pool 2 ou 3 |
| Empate exato em S2 e S3 | Dois membros com aproveitamento idêntico | Desempate por dias_sem_servir, depois membro_id |
| Determinismo | Gerar mesma escala duas vezes | Resultado idêntico |
| Membro recém-cadastrado | 0 convocações anteriores | Tratado como 100% de equidade (0 oportunidades aproveitadas) |
| Limites semanal/mensal | Membro acima do limite | Pool 2 ou 3, com alerta |

---

## RESUMO EXECUTIVO

### Problemas confirmados e sua prioridade

| Prioridade | Problema | Linha | Impacto |
|---|---|---|---|
| P0 (crítico) | `modoSolenePrincipal = ehSolene` — solenidades em modo mérito total | 634 | Solenidades injustas para funções secundárias |
| P0 (crítico) | `Math.random() * 100` — motor não-determinístico | 472 | Resultados irreproduváveis, aleatoriedade supera rodízio |
| P0 (crítico) | `CAP_DIAS_SEM_SERVIR = 60` — muito baixo | 187 | "Paredão" nivelando quem ficou 2 meses com quem ficou 5 |
| P0 (crítico) | Restrições de dia ignoradas em solenidades | 695 | Membro escalado em dia que declarou não poder |
| P1 (grave) | Sem normalização por oportunidades reais | Estrutural | Disponibilidade ampla vira vantagem sistêmica |
| P1 (grave) | Sem filtro de presença em modo COMUM | Estrutural | Membros com 35% de presença concorrem igualmente |
| P1 (grave) | Score absoluto sem janela temporal | Estrutural | Tempo de serviço confundido com comprometimento atual |
| P1 (grave) | `frequenciaHistorica` sem janela | 467 | Histórico de anos atrás penaliza atualidade |
| P2 (médio) | Ranking apenas por score | migration 148 | Coordenação não consegue entender distribuição real |
| P2 (médio) | `InsightCandidato` sem oportunidades normalizadas | 132–146 | Transparência parcial |

### O que não deve ser feito

- Não inverter simplesmente o score
- Não escolher sempre quem tem menos pontos absolutos
- Não aumentar a aleatoriedade para "variar" (faz o oposto do pretendido)
- Não criar motor separado para solenidades
- Não bloquear automaticamente membros por presença sem amostra mínima
- Não ignorar o histórico — usá-lo de forma normalizada e com janela temporal
- Não alterar banco de produção antes da simulação (FASE 4) aprovada

### Resultado esperado após implementação completa

- Gini de distribuição: de 0,47 para ≤ 0,20
- Membros com 0 escalas em 12 semanas: de 17 para ≤ 5
- Motor determinístico: toda geração com os mesmos dados produz o mesmo resultado
- Qualquer escala justificável: "por que João e não Maria?" tem resposta objetiva
- Membros com disponibilidade restrita recebem oportunidades proporcionais à sua disponibilidade real
- Solenidades com rodízio real (não apenas desconto): quem serviu na última não serve na próxima se houver alternativas
- Presença influencia prioridade de forma gradual e com amostra mínima

---

*Documento produzido na FASE 1–3 da auditoria. Nenhuma linha de código foi alterada.*  
*A FASE 4 (Simulação) aguarda aprovação deste diagnóstico.*
