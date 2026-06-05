# 🔧 GUIA PRÁTICO: Debugar "Por que não há sugestões?"

## Caso 1: Sugestões Zeradas Apesar de Dados Carregados

### Sintomas:
- ✅ Membros aparecem na lista
- ✅ Ministérios aparecem
- ✅ Funções criadas na escala
- ❌ Ao gerar, aparece: "Não foi possível gerar sugestões"

### Script de Debug Completo

Adicione isso no início de `handleGenerateSuggestions()` (antes da chamada ao motor):

```tsx
function handleGenerateSuggestions() {
  console.clear();
  console.group("🔍 DEBUG COMPLETO - handleGenerateSuggestions");
  
  // ────────────────────────────────────────────────────────────
  // 1. ESTRUTURA BASE
  // ────────────────────────────────────────────────────────────
  console.group("📋 Estrutura Base");
  console.log("data escala:", escala.data);
  console.log("tipo escala:", escala.tipo);
  console.log("solene:", escala.solene);
  console.log("tem_adoracao:", escala.tem_adoracao);
  console.log("tem_bispo:", escala.tem_bispo);
  
  const dayOfWeek = new Date(escala.data + "T12:00:00").getDay();
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  console.log("Dia da semana:", dayNames[dayOfWeek], `(${dayOfWeek})`);
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 2. MEMBROS
  // ────────────────────────────────────────────────────────────
  console.group("👥 Membros");
  console.log("Total carregado:", membros.length);
  
  const membrosInativos = membros.filter(m => m.ativo === false);
  console.log("Inativos:", membrosInativos.length);
  
  const membrosComRestricaoDia = membros.filter(
    m => m.restricoes_dia_semana?.includes(dayOfWeek)
  );
  console.log("Com restrição para", dayNames[dayOfWeek] + ":", membrosComRestricaoDia.length);
  
  if (membrosComRestricaoDia.length > 0) {
    console.warn("⚠️ Estes membros NÃO podem escalar hoje:");
    membrosComRestricaoDia.slice(0, 5).forEach(m => console.log("  -", m.nome));
    if (membrosComRestricaoDia.length > 5) {
      console.log(`  ... e mais ${membrosComRestricaoDia.length - 5}`);
    }
  }
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 3. MINISTÉRIOS
  // ────────────────────────────────────────────────────────────
  console.group("⛪ Ministérios");
  console.log("Total carregado:", ministerios.length);
  console.log("Nomes:", ministerios.map(m => m.nome).join(", "));
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 4. FUNÇÕES DA ESCALA
  // ────────────────────────────────────────────────────────────
  console.group("📍 Funções Necessárias");
  console.log("Total:", funcoes.length);
  funcoes.forEach(f => {
    console.log(`  ${f.ministerio.nome} (${f.ministerio_id}): qty=${f.quantidade}`);
  });
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 5. MAPA CRÍTICO: membroMinisterios
  // ────────────────────────────────────────────────────────────
  console.group("🔴 membroMinisterios (CRÍTICO)");
  console.log("Ministérios com membros:", Object.keys(membroMinisterios).length);
  
  funcoes.forEach(f => {
    const membrosParaFuncao = membroMinisterios[f.ministerio_id] ?? [];
    console.log(
      `  ${f.ministerio.nome}: ${membrosParaFuncao.length} membros`,
      membrosParaFuncao.slice(0, 2).map(id => {
        const m = membros.find(m => m.id === id);
        return m?.nome ?? id;
      }).join(", ")
    );
  });
  
  // Verificação crítica
  const minSemMembros = funcoes.filter(f => 
    !membroMinisterios[f.ministerio_id] || membroMinisterios[f.ministerio_id].length === 0
  );
  
  if (minSemMembros.length > 0) {
    console.error("🔴 CRÍTICO: Funções SEM membros cadastrados:");
    minSemMembros.forEach(f => {
      console.error(`  - ${f.ministerio.nome}`);
    });
  }
  
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 6. RESTRIÇÕES
  // ────────────────────────────────────────────────────────────
  console.group("🚫 Restrições");
  
  const blocklists = funcaoRestricoes.filter(r => r.tipo === "nao_pode");
  const allowlists = funcaoRestricoes.filter(r => r.tipo === "pode");
  
  console.log("Blocklists (nao_pode):", blocklists.length);
  if (blocklists.length > 0) {
    funcoes.forEach(f => {
      const bloqueados = blocklists.filter(r => r.ministerio_id === f.ministerio_id);
      if (bloqueados.length > 0) {
        console.warn(`  ${f.ministerio.nome}: ${bloqueados.length} membros bloqueados`);
      }
    });
  }
  
  console.log("Allowlists (pode):", allowlists.length);
  console.log("Indisponibilidades nesta data:", 
    indisponibilidades.filter(i => i.data === escala.data).length
  );
  
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 7. ANÁLISE DE CANDIDATOS
  // ────────────────────────────────────────────────────────────
  console.group("👤 Análise de Candidatos");
  
  funcoes.forEach(f => {
    const potenciais = membroMinisterios[f.ministerio_id] ?? [];
    console.group(`Ministério: ${f.ministerio.nome}`);
    console.log(`Total com cadastro: ${potenciais.length}`);
    
    // Simula o filtro isApto()
    const candidatos = potenciais
      .map(mid => membros.find(m => m.id === mid)!)
      .filter(m => {
        if (!m.ativo) return false;
        if (indisponibilidades.some(i => i.membro_id === m.id && i.data === escala.data)) {
          return false;
        }
        if (m.restricoes_dia_semana?.includes(dayOfWeek)) return false;
        
        const blocklist = funcaoRestricoes.filter(
          r => r.membro_id === m.id && r.ministerio_id === f.ministerio_id && r.tipo === "nao_pode"
        );
        if (blocklist.length > 0) return false;
        
        return true;
      });
    
    console.log(`Candidatos aptos: ${candidatos.length}`);
    if (candidatos.length === 0) {
      console.error("⚠️ NENHUM CANDIDATO!");
      potenciais.forEach(mid => {
        const m = membros.find(m => m.id === mid);
        if (!m) {
          console.error(`  ❌ ${mid}: NÃO ENCONTRADO em membros[]`);
          return;
        }
        if (!m.ativo) console.log(`  ❌ ${m.nome}: inativo`);
        if (indisponibilidades.some(i => i.membro_id === m.id && i.data === escala.data)) {
          console.log(`  ❌ ${m.nome}: indisponível nesta data`);
        }
        if (m.restricoes_dia_semana?.includes(dayOfWeek)) {
          console.log(`  ❌ ${m.nome}: restrito para ${dayNames[dayOfWeek]}`);
        }
        const blocklist = funcaoRestricoes.filter(
          r => r.membro_id === m.id && r.ministerio_id === f.ministerio_id && r.tipo === "nao_pode"
        );
        if (blocklist.length > 0) {
          console.log(`  ❌ ${m.nome}: blocklist para este ministério`);
        }
      });
    } else {
      candidatos.slice(0, 3).forEach(m => {
        console.log(`  ✅ ${m.nome} (score: ${m.score})`);
      });
      if (candidatos.length > 3) {
        console.log(`  ... e mais ${candidatos.length - 3}`);
      }
    }
    
    console.groupEnd();
  });
  
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 8. HISTÓRICO
  // ────────────────────────────────────────────────────────────
  console.group("📊 Histórico (últimos 6 meses)");
  console.log("Total de escalações:", assignmentHistory.length);
  
  const statsPorMembro: Record<string, number> = {};
  assignmentHistory.forEach(h => {
    statsPorMembro[h.memberId] = (statsPorMembro[h.memberId] ?? 0) + 1;
  });
  
  Object.entries(statsPorMembro)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([id, count]) => {
      const m = membros.find(m => m.id === id);
      console.log(`  ${m?.nome ?? id}: ${count} escalações`);
    });
  
  console.groupEnd();
  
  // ────────────────────────────────────────────────────────────
  // 9. CHAMADA AO MOTOR
  // ────────────────────────────────────────────────────────────
  console.group("⚙️ Chamada ao Motor");
  
  const engineParams = {
    evento: { titulo: escala.titulo, data: escala.data, tipo: escala.tipo, observacoes: escala.observacoes },
    funcoes,
    membros,
    membroMinisterios,
    options: {
      history: assignmentHistory,
      existingAssignments: atribuicoes.map(entry => ({ 
        membro_id: entry.membro_id, 
        ministerio_id: entry.ministerio_id 
      })),
      indisponibilidades: [...indisponibilidades, ...missaRestricaoIndisp],
      restricoes: funcaoRestricoes,
      config,
      solene: escala.solene,
      tem_adoracao: escala.tem_adoracao,
      tem_bispo: escala.tem_bispo,
    }
  };
  
  console.log("generateEscalaAssignments() será chamado com:");
  console.log(engineParams);
  
  console.groupEnd();
  
  // CHAMADA REAL
  const suggestions = generateEscalaAssignments(
    engineParams.evento,
    engineParams.funcoes,
    engineParams.membros,
    engineParams.membroMinisterios,
    engineParams.options
  );
  
  console.log("RESULTADO:", suggestions);
  console.log("Quantidade de sugestões:", suggestions.length);
  
  console.groupEnd();  // FIM do group principal
  
  // Resto do código original...
  setSuggestedAssignments(suggestions);
  const totalSlots = funcoes.reduce((sum, funcao) => sum + funcao.quantidade, 0);
  // ... etc
}
```

---

## Caso 2: membroMinisterios Vazio

### Debug Específico:

```tsx
// No useEffect que monitora membroMinisterios
useEffect(() => {
  const summary = {
    membros_count: membros.length,
    ministerios_count: ministerios.length,
    mapa_keys: Object.keys(membroMinisterios).length,
    mapa_size: Object.values(membroMinisterios).reduce((a, b) => a + b.length, 0),
  };
  
  console.log("membroMinisterios status:", summary);
  
  if (summary.membros_count > 0 && summary.ministerios_count > 0 && summary.mapa_keys === 0) {
    console.error("🔴 CRÍTICO: NENHUMA RELAÇÃO MEMBRO↔MINISTERIO!");
    
    // Query manual para verificar
    (async () => {
      const { data, error } = await supabase
        .from("membro_ministerios")
        .select("membro_id, ministerio_id")
        .limit(10);
      
      if (error) {
        console.error("Erro na query:", error);
      } else {
        console.log("Primeiras 10 linhas de membro_ministerios:", data);
      }
    })();
  }
}, [membroMinisterios, membros.length, ministerios.length]);
```

---

## Caso 3: Ministérios Inativos Causando Problema

### Query de Diagnóstico:

```tsx
// Executar no console do navegador
const paroquiaId = "sua-paroquia-id";

(async () => {
  const { data: ativos } = await supabase
    .from("ministerios")
    .select("id, nome, ativo")
    .eq("paroquia_id", paroquiaId)
    .eq("ativo", true);
  
  const { data: inativos } = await supabase
    .from("ministerios")
    .select("id, nome, ativo")
    .eq("paroquia_id", paroquiaId)
    .eq("ativo", false);
  
  console.log("Ministérios ATIVOS:", ativos?.length ?? 0);
  console.log("Ministérios INATIVOS:", inativos?.length ?? 0);
  
  if (inativos && inativos.length > 0) {
    console.warn("⚠️ Ministérios inativos encontrados:");
    inativos.slice(0, 5).forEach(m => console.warn(`  - ${m.nome}`));
  }
})();
```

---

## Caso 4: Funções da Escala Sem Membros

### Debug:

```tsx
// Depois de carregar funcoes e membroMinisterios
useEffect(() => {
  console.group("🔍 Funções × Membros");
  
  funcoes.forEach(f => {
    const membrosDisponiveis = membroMinisterios[f.ministerio_id] ?? [];
    
    if (membrosDisponiveis.length === 0) {
      console.error(
        `🔴 Função "${f.ministerio.nome}" (${f.ministerio_id}) SEM MEMBROS!`
      );
      
      // Verificar se ministério existe em BD
      (async () => {
        const { data: minBD } = await supabase
          .from("ministerios")
          .select("*")
          .eq("id", f.ministerio_id)
          .single();
        
        if (minBD?.ativo === false) {
          console.error(`  → Motivo: Ministério está INATIVO`);
        } else if (!minBD) {
          console.error(`  → Motivo: Ministério NÃO ENCONTRADO!`);
        } else {
          console.error(`  → Motivo: Nenhum membro cadastrado neste ministério`);
          
          // Buscar membros em membro_ministerios
          const { data: rel } = await supabase
            .from("membro_ministerios")
            .select("membro_id")
            .eq("ministerio_id", f.ministerio_id);
          
          console.log(`  → Membros em BD: ${rel?.length ?? 0}`);
          console.log(`  → Membros no mapa: ${membrosDisponiveis.length}`);
        }
      })();
    } else {
      console.log(
        `✅ "${f.ministerio.nome}": ${membrosDisponiveis.length} membros disponíveis`
      );
    }
  });
  
  console.groupEnd();
}, [funcoes, membroMinisterios]);
```

---

## Caso 5: Validação Completa em Uma Linha

Para adicionar em qualquer ponto crítico:

```tsx
// Verificação rápida
const isReadyToGenerate = 
  membros.length > 0 &&
  ministerios.length > 0 &&
  Object.keys(membroMinisterios).length > 0 &&
  funcoes.length > 0 &&
  funcoes.every(f => membroMinisterios[f.ministerio_id]?.length > 0);

if (!isReadyToGenerate) {
  console.error("❌ NÃO ESTÁ PRONTO PARA GERAR", {
    membros: membros.length,
    ministerios: ministerios.length,
    relaçoes: Object.keys(membroMinisterios).length,
    funcoes: funcoes.length,
    funcoesSemMembros: funcoes.filter(f => !membroMinisterios[f.ministerio_id]?.length > 0).length
  });
}
```

---

## RESUMO: Checklist de Debug

Ao encontrar "Não foi possível gerar sugestões":

```
1. ✅ membroMinisterios tem dados?
   console.log(Object.keys(membroMinisterios).length)

2. ✅ membros.length > 0?
   console.log(membros.length)

3. ✅ ministerios.length > 0?
   console.log(ministerios.length)

4. ✅ funcoes.length > 0?
   console.log(funcoes.length)

5. ✅ Para cada função, há membros em membroMinisterios?
   funcoes.forEach(f => {
     const count = membroMinisterios[f.ministerio_id]?.length ?? 0;
     console.log(`${f.ministerio.nome}: ${count} membros`);
   })

6. ✅ Nenhum membro está indisponível NESTA DATA?
   console.log(indisponibilidades.filter(i => i.data === escala.data))

7. ✅ Ministérios das funções estão ATIVOS?
   funcoes.forEach(f => {
     const isActive = ministerios.find(m => m.id === f.ministerio_id)?.ativo;
     console.log(`${f.ministerio.nome}: ${isActive}`);
   })

8. ✅ Nenhuma blocklist (nao_pode) bloqueando todos?
   funcoes.forEach(f => {
     const blocked = funcaoRestricoes.filter(
       r => r.ministerio_id === f.ministerio_id && r.tipo === "nao_pode"
     );
     console.log(`${f.ministerio.nome}: ${blocked.length} bloqueados`);
   })

9. ✅ Membros têm restrição de dia da semana?
   const day = new Date(escala.data).getDay();
   membros.forEach(m => {
     if (m.restricoes_dia_semana?.includes(day)) {
       console.log(`${m.nome} restrito para hoje`);
     }
   })

10. ✅ handleGenerateSuggestions() está siendo chamado?
    Adicionar console.log("🔍 handleGenerateSuggestions called") no início
```

