import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/Organization/page')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/Organization/page"!</div>
}
