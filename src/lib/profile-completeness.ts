export type ProfileCheck = {
  complete: boolean;
  percentage: number;
  missingFields: string[];
};

type ProfileFields = {
  nome?: string | null;
  telefone?: string | null;
  data_nascimento?: string | null;
  sexo?: string | null;
  comunidade_id?: string | null;
  has_atuacao?: boolean;
};

const REQUIRED_CHECKS: { label: string; check: (f: ProfileFields) => boolean }[] = [
  { label: "Nome completo",       check: (f) => !!f.nome?.trim() },
  { label: "Telefone",            check: (f) => !!f.telefone?.trim() },
  { label: "Data de nascimento",  check: (f) => !!f.data_nascimento },
  { label: "Sexo",                check: (f) => !!f.sexo },
  { label: "Comunidade",          check: (f) => !!f.comunidade_id },
  { label: "Atuação pastoral",    check: (f) => !!f.has_atuacao },
];

export function checkProfileCompleteness(fields: ProfileFields): ProfileCheck {
  const missing = REQUIRED_CHECKS.filter((c) => !c.check(fields)).map((c) => c.label);
  const percentage = Math.round(
    ((REQUIRED_CHECKS.length - missing.length) / REQUIRED_CHECKS.length) * 100,
  );
  return { complete: missing.length === 0, percentage, missingFields: missing };
}
