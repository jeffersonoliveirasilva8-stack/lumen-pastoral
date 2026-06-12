import { createFileRoute, redirect } from "@tanstack/react-router";

// Esta rota foi substituída por /membro/primeiro-acesso (usa recovery link).
// Mantida para compatibilidade com links antigos que podem estar em e-mails já enviados.
export const Route = createFileRoute("/membro/ativar-conta")({
  beforeLoad: () => {
    throw redirect({ to: "/membro/primeiro-acesso", replace: true, search: { token: "" } });
  },
  component: () => null,
  head: () => ({ meta: [{ title: "Redirecionando… — Lumen Pastoral" }] }),
});
