// ─── Design Tokens — Lumen Pastoral ──────────────────────────────────────────
// Fonte única de verdade para cores de status, radius e escala tipográfica.
// Importe aqui ao invés de definir classes inline.

// ── Status de escala ──────────────────────────────────────────────────────────
export const ESCALA_STATUS = {
  rascunho:  { label: "Rascunho",   bg: "bg-slate-100  dark:bg-slate-800/40",  text: "text-slate-600  dark:text-slate-400",  border: "border-slate-300  dark:border-slate-700",  dot: "bg-slate-400"  },
  publicada: { label: "Publicada",  bg: "bg-green-50   dark:bg-green-900/20",  text: "text-green-700  dark:text-green-400",  border: "border-green-300  dark:border-green-800",  dot: "bg-green-500"  },
  arquivada: { label: "Arquivada",  bg: "bg-zinc-100   dark:bg-zinc-800/40",   text: "text-zinc-500   dark:text-zinc-500",   border: "border-zinc-300   dark:border-zinc-700",   dot: "bg-zinc-400"   },
  cancelada: { label: "Cancelada",  bg: "bg-red-50     dark:bg-red-900/20",    text: "text-red-600    dark:text-red-400",    border: "border-red-200    dark:border-red-800",    dot: "bg-red-500"    },
} as const;

export type EscalaStatus = keyof typeof ESCALA_STATUS;

// ── Status de presença ────────────────────────────────────────────────────────
export const PRESENCA_STATUS = {
  pendente:   { label: "Pendente",    bg: "bg-slate-100  dark:bg-slate-800/40", text: "text-slate-500  dark:text-slate-400", border: "border-slate-200  dark:border-slate-700", dot: "bg-slate-400"   },
  confirmado: { label: "Confirmado",  bg: "bg-blue-50    dark:bg-blue-900/20",  text: "text-blue-700   dark:text-blue-400",  border: "border-blue-200   dark:border-blue-800",  dot: "bg-blue-500"    },
  presente:   { label: "Presente",    bg: "bg-green-50   dark:bg-green-900/20", text: "text-green-700  dark:text-green-400", border: "border-green-200  dark:border-green-800", dot: "bg-green-500"   },
  faltou:     { label: "Faltou",      bg: "bg-red-50     dark:bg-red-900/20",   text: "text-red-600    dark:text-red-400",   border: "border-red-200    dark:border-red-800",   dot: "bg-red-500"     },
  atrasado:   { label: "Atrasou",     bg: "bg-orange-50  dark:bg-orange-900/20",text: "text-orange-700 dark:text-orange-400",border: "border-orange-200 dark:border-orange-800",dot: "bg-orange-500"  },
  justificou: { label: "Justificou",  bg: "bg-amber-50   dark:bg-amber-900/20", text: "text-amber-700  dark:text-amber-400", border: "border-amber-200  dark:border-amber-800", dot: "bg-amber-500"   },
  ausente:    { label: "Ausente",     bg: "bg-red-50     dark:bg-red-900/20",   text: "text-red-600    dark:text-red-400",   border: "border-red-200    dark:border-red-800",   dot: "bg-red-400"     },
  recusado:   { label: "Recusou",     bg: "bg-rose-50    dark:bg-rose-900/20",  text: "text-rose-600   dark:text-rose-400",  border: "border-rose-200   dark:border-rose-800",  dot: "bg-rose-500"    },
} as const;

export type PresencaStatus = keyof typeof PRESENCA_STATUS;

// ── Status de substituição ────────────────────────────────────────────────────
export const SUBSTITUICAO_STATUS = {
  solicitada:     { label: "Aguardando voluntário", bg: "bg-amber-50   dark:bg-amber-900/20",  text: "text-amber-700  dark:text-amber-400",  border: "border-amber-200  dark:border-amber-800",  dot: "bg-amber-500"  },
  com_voluntario: { label: "Com voluntário",        bg: "bg-blue-50    dark:bg-blue-900/20",   text: "text-blue-700   dark:text-blue-400",   border: "border-blue-200   dark:border-blue-800",   dot: "bg-blue-500"   },
  aprovada:       { label: "Aprovada",              bg: "bg-green-50   dark:bg-green-900/20",  text: "text-green-700  dark:text-green-400",  border: "border-green-200  dark:border-green-800",  dot: "bg-green-500"  },
  rejeitada:      { label: "Não aprovada",          bg: "bg-red-50     dark:bg-red-900/20",    text: "text-red-600    dark:text-red-400",    border: "border-red-200    dark:border-red-800",    dot: "bg-red-500"    },
  cancelada:      { label: "Cancelada",             bg: "bg-zinc-100   dark:bg-zinc-800/40",   text: "text-zinc-500   dark:text-zinc-400",   border: "border-zinc-200   dark:border-zinc-700",   dot: "bg-zinc-400"   },
} as const;

export type SubstituicaoStatus = keyof typeof SUBSTITUICAO_STATUS;

// ── Membro — nível de acesso ──────────────────────────────────────────────────
export const NIVEL_ACESSO = {
  membro:      { label: "Membro",          bg: "bg-slate-100  dark:bg-slate-800/40", text: "text-slate-600  dark:text-slate-400", border: "border-slate-200 dark:border-slate-700" },
  auxiliar:    { label: "Administrador",   bg: "bg-blue-50    dark:bg-blue-900/20",  text: "text-blue-700   dark:text-blue-400",  border: "border-blue-200  dark:border-blue-800"  },
  coordenador: { label: "Coordenador",     bg: "bg-amber-50   dark:bg-amber-900/20", text: "text-amber-700  dark:text-amber-400", border: "border-amber-200 dark:border-amber-800" },
} as const;

// ── Radius ─────────────────────────────────────────────────────────────────────
export const RADIUS = {
  card:    "rounded-2xl",
  inner:   "rounded-xl",
  badge:   "rounded-full",
  input:   "rounded-xl",
  button:  "rounded-xl",
  section: "rounded-3xl",
} as const;

// ── Cores dos módulos (sidebar) ───────────────────────────────────────────────
export const MODULE_COLORS = {
  painel:        { bg: "bg-slate-600",   light: "bg-slate-50  text-slate-700" },
  escalas:       { bg: "bg-blue-600",    light: "bg-blue-50   text-blue-700"  },
  membros:       { bg: "bg-emerald-600", light: "bg-emerald-50 text-emerald-700" },
  liturgia:      { bg: "bg-violet-600",  light: "bg-violet-50 text-violet-700" },
  pastoral:      { bg: "bg-teal-600",    light: "bg-teal-50   text-teal-700"  },
  ranking:       { bg: "bg-amber-600",   light: "bg-amber-50  text-amber-700" },
  configuracoes: { bg: "bg-indigo-600",  light: "bg-indigo-50 text-indigo-700" },
} as const;
