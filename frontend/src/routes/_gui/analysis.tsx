import { createFileRoute } from "@tanstack/react-router"
import { AnalysisPage } from "../Analysis.page"

export const Route = createFileRoute("/_gui/analysis")({
  component: AnalysisPage,
})
