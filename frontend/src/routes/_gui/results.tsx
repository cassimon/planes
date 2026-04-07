import { createFileRoute } from "@tanstack/react-router"
import { ResultsPage } from "../Results.page"

export const Route = createFileRoute("/_gui/results")({
  component: ResultsPage,
})
