import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/configuracoes") {
      throw redirect({ to: "/configuracoes/paroquia" });
    }
  },
  component: () => <Outlet />,
});
