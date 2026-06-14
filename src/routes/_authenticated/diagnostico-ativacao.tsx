import { createFileRoute } from "@tanstack/react-router";
import DiagnosticoAtivacao from "@/components/membros/DiagnosticoAtivacao";

export const Route = createFileRoute("/_authenticated/diagnostico-ativacao")({
  component: DiagnosticoAtivacaoPage,
  head: () => ({ meta: [{ title: "Diagnóstico de Ativação — Lumen Pastoral" }] }),
});

function DiagnosticoAtivacaoPage() {
  return <DiagnosticoAtivacao />;
}
