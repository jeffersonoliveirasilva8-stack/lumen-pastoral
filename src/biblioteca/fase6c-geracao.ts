/**
 * FASE 6C — Resolução de elegibilidade antes da geração de escalas
 *
 * Função de produção utilizada por AssistenteGeracaoEscalas (gerarMutation)
 * para garantir que membros suspensos sejam removidos antes de qualquer
 * alocação ou persistência.
 *
 * Testável de forma independente do componente React.
 */

import { filtrarElegiveis, type DecisaoPresenca } from "./elegibilidade-presenca";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type SupabaseRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type ResolverElegibilidadeResult<T extends { id: string }> = {
  elegiveis: T[];
  suspensos: T[];
};

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Executa a sequência FASE 6C antes de alocar membros:
 *   1. Calcula suspensões frescas via `coord_calcular_suspensoes_fase6c`
 *   2. Consulta elegibilidade atualizada via `coord_get_elegibilidade_presenca`
 *   3. Aplica `filtrarElegiveis` sobre a lista de membros fornecida
 *
 * Lança erro e interrompe o fluxo se qualquer RPC falhar.
 *
 * @param client     - Cliente Supabase com método `.rpc()`
 * @param paroquiaId - UUID da paróquia
 * @param membros    - Lista de membros recebida por prop (pode incluir suspensos)
 * @returns Partição { elegiveis, suspensos } com membros classificados
 */
export async function resolverElegibilidadeFase6c<T extends { id: string }>(
  client: SupabaseRpcClient,
  paroquiaId: string,
  membros: T[],
): Promise<ResolverElegibilidadeResult<T>> {
  // Passo 1: recalcula suspensões no banco
  const { data: calcResult, error: calcError } = await client.rpc(
    "coord_calcular_suspensoes_fase6c",
    { p_paroquia_id: paroquiaId },
  );
  if (calcError) {
    throw new Error(`Falha ao calcular suspensões (FASE 6C): ${calcError.message}`);
  }
  if ((calcResult as Record<string, unknown> | null)?.error) {
    throw new Error(
      `Falha ao calcular suspensões (FASE 6C): ${(calcResult as Record<string, unknown>).error}`,
    );
  }

  // Passo 2: busca decisões de elegibilidade atualizadas
  const { data: decisoesFrescas, error: decError } = await client.rpc(
    "coord_get_elegibilidade_presenca",
    { p_paroquia_id: paroquiaId },
  );
  if (decError) {
    throw new Error(`Falha ao obter elegibilidade (FASE 6C): ${decError.message}`);
  }

  // Passo 3: filtra suspensos da lista de membros
  const { elegiveis, suspensos } = filtrarElegiveis(
    membros,
    (decisoesFrescas ?? []) as DecisaoPresenca[],
  );

  return { elegiveis, suspensos };
}
