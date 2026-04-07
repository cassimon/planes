import { createFileRoute } from "@tanstack/react-router"
import { ExperimentsPage } from "../Experiments.page"

export const Route = createFileRoute("/_gui/experiments")({
  component: ExperimentsPage,
})
