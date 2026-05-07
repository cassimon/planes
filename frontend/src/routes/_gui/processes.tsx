import { createFileRoute } from "@tanstack/react-router"
import { ProcessesPage } from "../Processes.page"

export const Route = createFileRoute("/_gui/processes")({
  component: ProcessesPage,
})
