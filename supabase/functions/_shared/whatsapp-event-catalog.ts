// T6 — Catálogo de eventos WhatsApp para membros
//
// Define QUAIS eventos do sistema disparam notificações WhatsApp para membros,
// distinguindo do sistema de coordenação existente (notificar-whatsapp/CallMeBot).
//
// Sistema existente (NÃO alterado aqui):
//   supabase/functions/notificar-whatsapp — notifica COORDENADORES via CallMeBot
//   Eventos: novo_voluntario, nova_substituicao, membro_pendente, etc.
//
// Este catálogo cobre MEMBROS — notificações individuais pelo sistema M3 (futuro).

import type { EventoTipo, TemplateContext } from "./whatsapp-contracts.ts";
import type {
  EscalaPublicadaContext,
  LembreteEscalaContext,
  SubstituicaoAprovadaContext,
  SubstituicaoRecusadaContext,
  SubstituicaoSolicitadaContext,
} from "./whatsapp-contracts.ts";

// ── Tipo do catálogo ──────────────────────────────────────────────────────────

export type CatalogoEntrada = {
  /** Tipo canônico — chave de roteamento */
  evento_tipo: EventoTipo;
  /** Descrição legível do evento */
  descricao: string;
  /** Tabela que origina o evento */
  fonte_tabela: string;
  /** Operação que dispara o evento */
  fonte_operacao: "INSERT" | "UPDATE" | "cron";
  /** Coluna/condição que identifica quando acionar (para UPDATE) */
  condicao_disparo?: string;
  /** Descrição de quem recebe a notificação */
  destinatarios: string;
  /** Tabela que evento_ref_id referencia */
  evento_ref_tabela: string;
  /** Campos necessários do banco para montar TemplateContext */
  contexto_campos: string[];
  /** Comportamento do dedup para este evento */
  dedup_nota: string;
  /** Prioridade relativa de implementação */
  prioridade: 1 | 2 | 3;
};

// ── Catálogo ──────────────────────────────────────────────────────────────────

export const CATALOGO: readonly CatalogoEntrada[] = [
  {
    evento_tipo:       "escala_publicada",
    descricao:         "Escala publicada — notifica todos os membros da escala",
    fonte_tabela:      "escalas",
    fonte_operacao:    "UPDATE",
    condicao_disparo:  "status: 'rascunho' → 'publicada'",
    destinatarios:     "Todos os membros com função na escala (via escala_membros)",
    evento_ref_tabela: "escalas",
    contexto_campos:   ["membros.nome", "escalas.data", "ministerios.nome", "paroquias.nome"],
    dedup_nota:        "Um envio por (membro_id, 'escala_publicada', escala_id) — republicação não renotifica",
    prioridade:        1,
  },
  {
    evento_tipo:       "substituicao_solicitada",
    descricao:         "Solicitação de substituição — notifica candidatos elegíveis",
    fonte_tabela:      "substituicoes",
    fonte_operacao:    "INSERT",
    destinatarios:     "Membros do mesmo ministério com opt-in e sem indisponibilidade na data",
    evento_ref_tabela: "substituicoes",
    contexto_campos:   ["membros.nome AS nome_solicitante", "escalas.data", "ministerios.nome", "paroquias.nome"],
    dedup_nota:        "Um envio por (candidato_id, 'substituicao_solicitada', substituicao_id)",
    prioridade:        2,
  },
  {
    evento_tipo:       "substituicao_aprovada",
    descricao:         "Substituição aprovada — notifica o membro que assumiu a vaga",
    fonte_tabela:      "substituicoes",
    fonte_operacao:    "UPDATE",
    condicao_disparo:  "status: 'com_voluntario' → 'aprovada' (via coord_aprovar_substituicao)",
    destinatarios:     "Membro substituto (substituicoes.substituto_id)",
    evento_ref_tabela: "substituicoes",
    contexto_campos:   ["membros.nome", "escalas.data", "ministerios.nome", "paroquias.nome"],
    dedup_nota:        "Um envio por (substituto_id, 'substituicao_aprovada', substituicao_id)",
    prioridade:        2,
  },
  {
    evento_tipo:       "substituicao_recusada",
    descricao:         "Substituição recusada — notifica o membro que solicitou",
    fonte_tabela:      "substituicoes",
    fonte_operacao:    "UPDATE",
    condicao_disparo:  "status: 'solicitada'/'com_voluntario' → 'rejeitada' (via coord_rejeitar_substituicao)",
    destinatarios:     "Membro solicitante (substituicoes.solicitante_id)",
    evento_ref_tabela: "substituicoes",
    contexto_campos:   ["membros.nome", "escalas.data", "ministerios.nome", "substituicoes.motivo_rejeicao"],
    dedup_nota:        "Um envio por (solicitante_id, 'substituicao_recusada', substituicao_id)",
    prioridade:        2,
  },
  {
    evento_tipo:       "lembrete_escala",
    descricao:         "Lembrete 24h antes — notifica membros com escala no dia seguinte",
    fonte_tabela:      "escalas",
    fonte_operacao:    "cron",
    condicao_disparo:  "cron diário ~08h: escalas.data = today + 1 AND status = 'publicada'",
    destinatarios:     "Todos os membros com função na escala do dia seguinte",
    evento_ref_tabela: "escalas",
    contexto_campos:   ["membros.nome", "escalas.data", "escalas.hora_inicio", "ministerios.nome", "paroquias.nome"],
    dedup_nota:        "Um envio por (membro_id, 'lembrete_escala', escala_id) — se escala alterar data, novo lembrete não é enviado automaticamente",
    prioridade:        3,
  },
] as const;

// ── Helpers de catálogo ───────────────────────────────────────────────────────

/** Retorna a entrada do catálogo para o tipo dado, ou undefined. */
export function entradaDoCatalogo(tipo: EventoTipo): CatalogoEntrada | undefined {
  return CATALOGO.find((e) => e.evento_tipo === tipo);
}

/** Todos os tipos de evento com prioridade P1. */
export function eventosPorPrioridade(p: 1 | 2 | 3): EventoTipo[] {
  return CATALOGO.filter((e) => e.prioridade === p).map((e) => e.evento_tipo);
}

// ── Resolvedores de contexto ──────────────────────────────────────────────────
// Cada resolvedor recebe uma linha do banco (tipada) e devolve o TemplateContext.
// A Edge Function real chamará o resolvedor adequado após buscar os dados.

export type EscalaRow = {
  escala_id:     string;
  membro_nome:   string;
  data_escala:   string;   // ISO "YYYY-MM-DD" — formatar antes de exibir
  ministerio:    string;
  paroquia_nome: string;
  hora_inicio?:  string;   // "HH:MM:SS" ou null
};

export type SubstituicaoRow = {
  substituicao_id:   string;
  solicitante_nome:  string;
  substituto_nome?:  string;
  data_escala:       string;
  ministerio:        string;
  paroquia_nome:     string;
  /** Campo real no banco: substituicoes.motivo_rejeicao (não motivo_recusa) */
  motivo_rejeicao?:  string;
};

/** Formata "YYYY-MM-DD" → "DD/MM/YYYY" para exibição no WhatsApp. */
export function formatarData(iso: string): string {
  if (!iso || typeof iso !== "string") throw new TypeError(`data_escala inválida: ${iso}`);
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) throw new TypeError(`data_escala fora do formato ISO YYYY-MM-DD: ${iso}`);
  return `${d}/${m}/${y}`;
}

/** Formata "HH:MM:SS" → "HH:MM" (descarta segundos). */
export function formatarHora(iso: string): string {
  return iso.slice(0, 5);
}

export function resolverEscalaPublicada(row: EscalaRow): EscalaPublicadaContext {
  return {
    nome_membro:   row.membro_nome,
    data_escala:   formatarData(row.data_escala),
    ministerio:    row.ministerio,
    paroquia_nome: row.paroquia_nome,
  };
}

export function resolverSubstituicaoSolicitada(row: SubstituicaoRow): SubstituicaoSolicitadaContext {
  return {
    nome_solicitante: row.solicitante_nome,
    data_escala:      formatarData(row.data_escala),
    ministerio:       row.ministerio,
    paroquia_nome:    row.paroquia_nome,
  };
}

export function resolverSubstituicaoAprovada(row: SubstituicaoRow): SubstituicaoAprovadaContext {
  return {
    nome_membro:   row.substituto_nome ?? row.solicitante_nome,
    data_escala:   formatarData(row.data_escala),
    ministerio:    row.ministerio,
    paroquia_nome: row.paroquia_nome,
  };
}

export function resolverSubstituicaoRecusada(row: SubstituicaoRow): SubstituicaoRecusadaContext {
  return {
    nome_membro: row.solicitante_nome,
    data_escala: formatarData(row.data_escala),
    ministerio:  row.ministerio,
    motivo:      row.motivo_rejeicao,
  };
}

export function resolverLembreteEscala(row: EscalaRow): LembreteEscalaContext {
  return {
    nome_membro:   row.membro_nome,
    data_escala:   formatarData(row.data_escala),
    hora_escala:   row.hora_inicio ? formatarHora(row.hora_inicio) : undefined,
    ministerio:    row.ministerio,
    paroquia_nome: row.paroquia_nome,
  };
}

/** Lança TypeError se algum campo obrigatório de EscalaRow estiver ausente. */
function assertEscalaRow(row: EscalaRow): void {
  if (!row.membro_nome) throw new TypeError("EscalaRow: membro_nome obrigatório");
  if (!row.data_escala) throw new TypeError("EscalaRow: data_escala obrigatória");
  if (!row.ministerio)  throw new TypeError("EscalaRow: ministerio obrigatório");
  if (!row.paroquia_nome) throw new TypeError("EscalaRow: paroquia_nome obrigatório");
}

/** Lança TypeError se algum campo obrigatório de SubstituicaoRow estiver ausente. */
function assertSubstituicaoRow(row: SubstituicaoRow): void {
  if (!row.solicitante_nome) throw new TypeError("SubstituicaoRow: solicitante_nome obrigatório");
  if (!row.data_escala)      throw new TypeError("SubstituicaoRow: data_escala obrigatória");
  if (!row.ministerio)       throw new TypeError("SubstituicaoRow: ministerio obrigatório");
  if (!row.paroquia_nome)    throw new TypeError("SubstituicaoRow: paroquia_nome obrigatório");
}

// Dispatcher: dado evento_tipo e row, devolve o TemplateContext correto.
export function resolverContexto(
  tipo: EventoTipo,
  row: EscalaRow | SubstituicaoRow,
): TemplateContext {
  switch (tipo) {
    case "escala_publicada": {
      const r = row as EscalaRow; assertEscalaRow(r);
      return resolverEscalaPublicada(r);
    }
    case "substituicao_solicitada": {
      const r = row as SubstituicaoRow; assertSubstituicaoRow(r);
      return resolverSubstituicaoSolicitada(r);
    }
    case "substituicao_aprovada": {
      const r = row as SubstituicaoRow; assertSubstituicaoRow(r);
      return resolverSubstituicaoAprovada(r);
    }
    case "substituicao_recusada": {
      const r = row as SubstituicaoRow; assertSubstituicaoRow(r);
      return resolverSubstituicaoRecusada(r);
    }
    case "lembrete_escala": {
      const r = row as EscalaRow; assertEscalaRow(r);
      return resolverLembreteEscala(r);
    }
    default: {
      const _never: never = tipo;
      throw new RangeError(`evento_tipo sem resolvedor: ${_never}`);
    }
  }
}
