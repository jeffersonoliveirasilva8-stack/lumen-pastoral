import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/formacoes')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authenticated/formacoes"!</div>
}
