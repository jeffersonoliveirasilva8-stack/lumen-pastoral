import { ESCALA_STATUS, PRESENCA_STATUS, SUBSTITUICAO_STATUS } from "@/lib/design-tokens";

type StatusBadgeProps = {
  status: string;
  type?: "escala" | "presenca" | "substituicao";
  size?: "sm" | "md";
  showDot?: boolean;
};

const STATUS_MAP = {
  escala:       ESCALA_STATUS       as Record<string, { label: string; bg: string; text: string; border: string; dot: string }>,
  presenca:     PRESENCA_STATUS     as Record<string, { label: string; bg: string; text: string; border: string; dot: string }>,
  substituicao: SUBSTITUICAO_STATUS as Record<string, { label: string; bg: string; text: string; border: string; dot: string }>,
};

const ALL_STATUS = {
  ...ESCALA_STATUS,
  ...PRESENCA_STATUS,
  ...SUBSTITUICAO_STATUS,
} as Record<string, { label: string; bg: string; text: string; border: string; dot: string }>;

export function StatusBadge({ status, type, size = "sm", showDot = false }: StatusBadgeProps) {
  const cfg = (type ? STATUS_MAP[type]?.[status] : undefined) ?? ALL_STATUS[status];

  if (!cfg) return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border whitespace-nowrap">
      —
    </span>
  );

  const textSize = size === "md" ? "text-xs" : "text-[11px]";
  const px = size === "md" ? "px-2.5 py-1" : "px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border whitespace-nowrap ${textSize} ${px} ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {showDot && (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      )}
      {cfg.label}
    </span>
  );
}
