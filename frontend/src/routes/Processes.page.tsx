import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Menu,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core"
import {
  IconAtom,
  IconChevronDown,
  IconCopy,
  IconDroplet,
  IconInfoCircle,
  IconLayersIntersect,
  IconPlayerPlay,
  IconPlus,
  IconSparkles,
  IconSquare,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  type ProcessParam,
  PROCESS_PARAMETER_DEFINITIONS,
  type Process,
  type ProcessParameterKey,
  type ProcessStep,
  type ProcessStepCategory,
  newExperiment,
  newProcess,
  newProcessStep,
} from "@/store/AppContext"
import { useAppContext, useEntityCollection } from "@/store/AppContext"

const STEP_CATEGORIES: Array<{ value: ProcessStepCategory; label: string; icon: React.ReactNode }> = [
  { value: "wet_deposition", label: "Wet Deposition", icon: <IconDroplet size={14} /> },
  { value: "dry_deposition", label: "Dry Deposition", icon: <IconLayersIntersect size={14} /> },
  { value: "surface_treatment", label: "Surface Treatment", icon: <IconSparkles size={14} /> },
  { value: "doping_aging", label: "Doping/Aging", icon: <IconAtom size={14} /> },
  { value: "substrate_preparation", label: "Substrate Preparation", icon: <IconSquare size={14} /> },
]

const STEP_CATEGORY_ICON_MAP: Record<ProcessStepCategory, React.ReactNode> = {
  wet_deposition: <IconDroplet size={14} />,
  dry_deposition: <IconLayersIntersect size={14} />,
  surface_treatment: <IconSparkles size={14} />,
  doping_aging: <IconAtom size={14} />,
  substrate_preparation: <IconSquare size={14} />,
}

const STEP_COLOR_PALETTE = [
  "#d96c4f",
  "#5b8c85",
  "#6f7cc3",
  "#b5895a",
  "#7a9e4b",
  "#b06c8d",
  "#4d8fb3",
  "#9a6bb0",
]

const PROCESS_DETAIL_DEFINITIONS = new Map(
  PROCESS_PARAMETER_DEFINITIONS.map((definition) => [definition.key, definition]),
)

const DEFAULT_DEPOSITION_KEYS: ProcessParameterKey[] = [
  "depositionMethod",
  "substrateTemp",
  "depositionAtmosphere",
  "depositionParameters",
  "solutionVolume",
  "dryingMethod",
]

const DEFAULT_ANNEALING_KEYS: ProcessParameterKey[] = [
  "annealingTime",
  "annealingTemp",
  "annealingAtmosphere",
]

function getParameterSections(stepCategory: ProcessStepCategory): {
  deposition: ProcessParameterKey[]
  annealing: ProcessParameterKey[]
  labelOverrides: Partial<Record<ProcessParameterKey, string>>
  placeholderOverrides: Partial<Record<ProcessParameterKey, string>>
} {
  if (stepCategory === "substrate_preparation") {
    return {
      deposition: ["depositionMethod", "annealingTime", "depositionParameters"],
      annealing: [],
      labelOverrides: {
        depositionMethod: "Cleaning Method",
        annealingTime: "Cleaning Time",
        depositionParameters: "Cleaning Parameters",
      },
      placeholderOverrides: {},
    }
  }

  if (stepCategory === "dry_deposition") {
    return {
      deposition: [
        "depositionMethod",
        "substrateTemp",
        "depositionAtmosphere",
        "depositionParameters",
      ],
      annealing: DEFAULT_ANNEALING_KEYS,
      labelOverrides: {},
      placeholderOverrides: {
        depositionParameters: "Rate / Temperature",
      },
    }
  }

  if (stepCategory === "doping_aging") {
    return {
      deposition: ["annealingAtmosphere", "annealingTemp", "annealingTime"],
      annealing: [],
      labelOverrides: {
        annealingAtmosphere: "Doping Atmosphere",
        annealingTemp: "Atmosphere Temperature",
        annealingTime: "Doping Time",
      },
      placeholderOverrides: {},
    }
  }

  return {
    deposition: DEFAULT_DEPOSITION_KEYS,
    annealing: DEFAULT_ANNEALING_KEYS,
    labelOverrides: {},
    placeholderOverrides: {},
  }
}

function randomStepColor() {
  return STEP_COLOR_PALETTE[Math.floor(Math.random() * STEP_COLOR_PALETTE.length)]
}

function ProcessParamInput({
  label,
  param,
  onChange,
  placeholder,
  unit,
  initialParam,
  sourceSuggestions = [],
  type = "text",
}: {
  label: string
  param?: ProcessParam
  onChange: (param: ProcessParam | undefined) => void
  placeholder?: string
  unit?: string
  initialParam?: ProcessParam
  sourceSuggestions?: Array<{ label: string; param: ProcessParam }>
  type?: "text" | "number" | "datetime-local"
}) {
  const [expanded, setExpanded] = useState(Boolean(param))

  useEffect(() => {
    setExpanded(Boolean(param))
  }, [param])

  if (!expanded) {
    return (
      <Group gap={4} align="flex-start" wrap="wrap">
        <Button
          variant="subtle"
          size="xs"
          color="green"
          leftSection={<IconPlus size={12} />}
          onClick={() => {
            setExpanded(true)
            onChange(initialParam ?? { value: "", mode: "constant" })
          }}
          style={{ justifyContent: "flex-start" }}
        >
          Add {label}
        </Button>

        {sourceSuggestions.map((source) => (
          <Button
            key={`${source.label}:${source.param.mode}:${source.param.value}`}
            variant="subtle"
            size="xs"
            color="teal"
            leftSection={<IconPlus size={12} />}
            onClick={() => {
              setExpanded(true)
              onChange({ ...source.param })
            }}
            style={{ justifyContent: "flex-start" }}
          >
            as {source.label}
          </Button>
        ))}
      </Group>
    )
  }

  return (
    <Box>
      <Group gap="xs" mb={4}>
        <Text size="xs" fw={500}>
          {label}
        </Text>
        {unit && (
          <Text size="xs" c="dimmed">
            ({unit})
          </Text>
        )}
        <ActionIcon
          size="xs"
          variant="subtle"
          color="red"
          onClick={() => {
            setExpanded(false)
            onChange(undefined)
          }}
        >
          <IconX size={10} />
        </ActionIcon>
      </Group>

      <Group gap="xs" align="flex-end" wrap="nowrap">
        {type === "number" ? (
          <NumberInput
            size="xs"
            value={param?.value ? Number(param.value) : ""}
            onChange={(val) =>
              onChange({
                ...(param ?? { mode: "constant", value: "" }),
                value:
                  typeof val === "number"
                    ? String(val)
                    : String(val ?? ""),
              })
            }
            placeholder={placeholder}
            style={{ flex: 1 }}
          />
        ) : (
          <TextInput
            size="xs"
            type={type}
            value={param?.value ?? ""}
            onChange={(e) =>
              onChange({
                ...(param ?? { mode: "constant", value: "" }),
                value: e.currentTarget.value,
              })
            }
            placeholder={placeholder}
            style={{ flex: 1 }}
          />
        )}
      </Group>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function ProcessesPage() {
  const navigate = useNavigate()

  const {
    materials,
    processes,
    setProcesses,
    setExperiments,
    planes,
    updateElement,
    removeCollectionRefs,
    solutions,
    pendingCollectionLink,
    setPendingCollectionLink,
    activeCollectionId,
    activePlaneId,
    activeEntity,
    setActiveEntity,
  } = useAppContext()
  const { isEntityVisible, getEntityColor, getEntityPlane, getEntityCollection } =
    useEntityCollection()

  const [searchQuery, setSearchQuery] = useState("")
  const [draggedStep, setDraggedStep] = useState<{
    stepId: string
    fromStagePos: number
  } | null>(null)
  const [pendingFocusStepId, setPendingFocusStepId] = useState<string | null>(
    null,
  )
  const [noteEditorStepId, setNoteEditorStepId] = useState<string | null>(null)
  const [dropStagePos, setDropStagePos] = useState<number | null>(null)
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null)
  const processedPendingRequestIdsRef = useRef<Set<string>>(new Set())

  const selectProcess = useCallback(
    (id: string | null) => {
      setActiveEntity(id ? { kind: "process", id } : null)
    },
    [setActiveEntity],
  )

  // Auto-create process + link to collection when navigated from action bubble
  useEffect(() => {
    if (!pendingCollectionLink || pendingCollectionLink.kind !== "process") {
      return
    }
    if (
      processedPendingRequestIdsRef.current.has(pendingCollectionLink.requestId)
    ) {
      return
    }
    processedPendingRequestIdsRef.current.add(pendingCollectionLink.requestId)

    const { collectionId, planeId } = pendingCollectionLink
    setPendingCollectionLink(null)

    const proc = newProcess()
    setProcesses((prev) => [...prev, proc])
    selectProcess(proc.id)
    setSelectedStepId(null)

    // Link back to collection
    const plane = planes.find((p) => p.id === planeId)
    if (plane) {
      const col = plane.elements.find((e) => e.id === collectionId)
      if (col && col.type === "collection") {
        const updated = {
          ...col,
          refs: [...col.refs, { kind: "process" as const, id: proc.id }],
        }
        updateElement(planeId, updated)
      }
    }
  }, [
    pendingCollectionLink,
    setPendingCollectionLink,
    setProcesses,
    planes,
    updateElement,
    selectProcess,
  ])

  // Filtered list of visible processes
  const visibleProcesses = useMemo(
    () =>
      processes.filter(
        (p) =>
          isEntityVisible("process", p.id) &&
          (p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.description?.toLowerCase().includes(searchQuery.toLowerCase())),
      ),
    [processes, isEntityVisible, searchQuery],
  )

  const selectedProcess = useMemo(
    () =>
      activeEntity?.kind === "process"
        ? processes.find((p) => p.id === activeEntity.id) ?? null
        : null,
    [activeEntity, processes],
  )

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  const selectedStep: ProcessStep | null = useMemo(() => {
    if (!selectedProcess || !selectedStepId) return null
    for (const stage of selectedProcess.stages) {
      for (const alt of stage.alternatives) {
        if (alt.id === selectedStepId) return alt
      }
    }
    return null
  }, [selectedProcess, selectedStepId])

  const handleCreateProcess = () => {
    const newProc = newProcess()
    setProcesses((prev) => [...prev, newProc])
    selectProcess(newProc.id)
    setSelectedStepId(null)
    // Link to active collection if one is selected
    if (activeCollectionId && activePlaneId) {
      const plane = planes.find((p) => p.id === activePlaneId)
      if (plane) {
        const col = plane.elements.find((e) => e.id === activeCollectionId)
        if (col && col.type === "collection") {
          updateElement(activePlaneId, {
            ...col,
            refs: [...col.refs, { kind: "process" as const, id: newProc.id }],
          })
        }
      }
    }
  }

  const handleSpawnExperiment = (process: Process) => {
    const exp = newExperiment(process.id)
    setExperiments((prev) => [...prev, exp])
    void navigate({ to: "/experiments" })
  }

  const handleDeleteProcess = (id: string) => {
    setProcesses((prev) => prev.filter((p) => p.id !== id))
    removeCollectionRefs("process", [id])
    if (selectedProcess?.id === id) {
      selectProcess(null)
      setSelectedStepId(null)
    }
  }

  const handleCopyProcess = (process: Process) => {
    const copy: Process = {
      ...process,
      id: crypto.randomUUID(),
      name: `${process.name} (copy)`,
      stages: process.stages.map((stage) => ({
        ...stage,
        alternatives: stage.alternatives.map((step) => ({
          ...step,
          id: crypto.randomUUID(),
        })),
      })),
    }
    setProcesses((prev) => [...prev, copy])
    const owner = getEntityCollection("process", process.id)
    if (owner) {
      updateElement(owner.plane.id, {
        ...owner.collection,
        refs: [...owner.collection.refs, { kind: "process" as const, id: copy.id }],
      })
    }
    selectProcess(copy.id)
    setSelectedStepId(null)
  }

  const handleAddProcessStep = (category: ProcessStepCategory) => {
    if (!selectedProcess) return
    const nextIndex = selectedProcess.stages.length
    const step = { ...newProcessStep(nextIndex, category), color: randomStepColor() }
    const newStage = { index: nextIndex, alternatives: [step] }
    const updated: Process = {
      ...selectedProcess,
      stages: [...selectedProcess.stages, newStage],
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
    setActiveEntity({ kind: "process", id: updated.id })
    setSelectedStepId(step.id)
    setPendingFocusStepId(step.id)
  }

  const handleAddAlternativeStep = (
    stageIndex: number,
    category: ProcessStepCategory,
  ) => {
    if (!selectedProcess) return
    const step = { ...newProcessStep(stageIndex, category), color: randomStepColor() }
    const updated: Process = {
      ...selectedProcess,
      stages: selectedProcess.stages.map((stage) =>
        stage.index === stageIndex
          ? { ...stage, alternatives: [...stage.alternatives, step] }
          : stage,
      ),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
    selectProcess(updated.id)
    setSelectedStepId(step.id)
    setPendingFocusStepId(step.id)
  }

  const handleUpdateProcessName = (name: string) => {
    if (!selectedProcess) return
    const updated: Process = { ...selectedProcess, name }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
  }

  const handleUpdateStepParam = (
    stepId: string,
    key: ProcessParameterKey,
    param: ProcessParam | undefined,
  ) => {
    if (!selectedProcess) return
    const updated: Process = {
      ...selectedProcess,
      stages: selectedProcess.stages.map((stage) => ({
        ...stage,
        alternatives: stage.alternatives.map((step) =>
          step.id === stepId
            ? {
                ...step,
                [key]: param ? { ...param, mode: "constant" } : undefined,
                ...(key === "depositionMethod"
                  ? { name: param?.value?.trim() || step.name }
                  : {}),
              }
            : step,
        ),
      })),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
  }

  const handleUpdateStepNotes = (stepId: string, notes: string) => {
    if (!selectedProcess) return
    const updated: Process = {
      ...selectedProcess,
      stages: selectedProcess.stages.map((stage) => ({
        ...stage,
        alternatives: stage.alternatives.map((step) =>
          step.id === stepId ? { ...step, notes } : step,
        ),
      })),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
  }

  const handleUpdateStepColor = (stepId: string, color: string) => {
    if (!selectedProcess) return
    const updated: Process = {
      ...selectedProcess,
      stages: selectedProcess.stages.map((stage) => ({
        ...stage,
        alternatives: stage.alternatives.map((step) =>
          step.id === stepId ? { ...step, color } : step,
        ),
      })),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
  }

  const handleRemoveStep = (stepId: string) => {
    if (!selectedProcess) return
    const updated: Process = {
      ...selectedProcess,
      stages: selectedProcess.stages
        .map((stage) => ({
          ...stage,
          alternatives: stage.alternatives.filter((s) => s.id !== stepId),
        }))
        .filter((stage) => stage.alternatives.length > 0)
        .map((stage, idx) => ({ ...stage, index: idx })),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
    if (selectedStepId === stepId) {
      setSelectedStepId(null)
    }
  }

  const moveStepToAlternativeStage = (
    stepId: string,
    fromStagePos: number,
    targetStagePos: number,
  ) => {
    if (!selectedProcess || fromStagePos === targetStagePos) {
      return
    }

    const stages = selectedProcess.stages.map((stage) => ({
      ...stage,
      alternatives: [...stage.alternatives],
    }))

    const source = stages[fromStagePos]
    if (!source) {
      return
    }

    const movingIdx = source.alternatives.findIndex((step) => step.id === stepId)
    if (movingIdx < 0) {
      return
    }

    const [movingStep] = source.alternatives.splice(movingIdx, 1)
    const sourceEmptied = source.alternatives.length === 0
    if (sourceEmptied) {
      stages.splice(fromStagePos, 1)
    }

    let adjustedTarget = targetStagePos
    if (sourceEmptied && fromStagePos < targetStagePos) {
      adjustedTarget -= 1
    }
    if (adjustedTarget < 0 || adjustedTarget >= stages.length) {
      return
    }

    stages[adjustedTarget].alternatives.push(movingStep)

    const updated: Process = {
      ...selectedProcess,
      stages: stages.map((stage, index) => ({ ...stage, index })),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
    setSelectedStepId(stepId)
  }

  const moveStepToNewStageAt = (
    stepId: string,
    fromStagePos: number,
    insertIndex: number,
  ) => {
    if (!selectedProcess) {
      return
    }

    const stages = selectedProcess.stages.map((stage) => ({
      ...stage,
      alternatives: [...stage.alternatives],
    }))
    const source = stages[fromStagePos]
    if (!source) {
      return
    }
    const movingIdx = source.alternatives.findIndex((step) => step.id === stepId)
    if (movingIdx < 0) {
      return
    }
    const [movingStep] = source.alternatives.splice(movingIdx, 1)
    const sourceEmptied = source.alternatives.length === 0
    if (sourceEmptied) {
      stages.splice(fromStagePos, 1)
    }

    let adjustedInsert = insertIndex
    if (sourceEmptied && fromStagePos < insertIndex) {
      adjustedInsert -= 1
    }
    adjustedInsert = Math.max(0, Math.min(stages.length, adjustedInsert))

    stages.splice(adjustedInsert, 0, {
      index: adjustedInsert,
      alternatives: [movingStep],
    })

    const updated: Process = {
      ...selectedProcess,
      stages: stages.map((stage, index) => ({ ...stage, index })),
    }
    setProcesses((prev) =>
      prev.map((p) => (p.id === selectedProcess.id ? updated : p)),
    )
    setSelectedStepId(stepId)
  }

  useEffect(() => {
    if (
      selectedProcess &&
      !isEntityVisible("process", selectedProcess.id)
    ) {
      selectProcess(null)
      setSelectedStepId(null)
    }
  }, [selectedProcess, isEntityVisible, selectProcess])

  const selectedStageIndex = useMemo(() => {
    if (!selectedProcess || !selectedStep) {
      return -1
    }
    return selectedProcess.stages.findIndex((stage) =>
      stage.alternatives.some((step) => step.id === selectedStep.id),
    )
  }, [selectedProcess, selectedStep])

  const getSourceSuggestions = useCallback(
    (key: ProcessParameterKey): Array<{ label: string; param: ProcessParam }> => {
      if (!selectedProcess || !selectedStep || selectedStageIndex < 0) {
        return []
      }
      const seen = new Set<string>()
      const suggestions: Array<{ label: string; param: ProcessParam }> = []

      for (let i = selectedStageIndex - 1; i >= 0; i--) {
        const stage = selectedProcess.stages[i]
        for (const step of stage.alternatives) {
          const stepParam = step[key]
          if (!stepParam || !stepParam.value) {
            continue
          }
          const signature = `${stepParam.mode}::${stepParam.value}`
          if (seen.has(signature)) {
            continue
          }
          seen.add(signature)
          suggestions.push({
            label: step.name || `Step ${i + 1}`,
            param: { ...stepParam },
          })
          if (suggestions.length >= 4) {
            return suggestions
          }
        }
      }

      return suggestions
    },
    [selectedProcess, selectedStageIndex, selectedStep],
  )

  const displayedStages = useMemo(() => {
    if (!selectedProcess) {
      return [] as Array<{ stage: Process["stages"][number]; stagePos: number }>
    }
    return selectedProcess.stages.map((stage, stagePos) => ({ stage, stagePos }))
  }, [selectedProcess])

  const visibleMaterialOptions = useMemo(
    () =>
      materials
        .filter((material) => isEntityVisible("material", material.id))
        .map((material) => ({
          value: `material:${material.id}`,
          label: material.name || "Unnamed material",
        })),
    [isEntityVisible, materials],
  )

  const visibleSolutionOptions = useMemo(
    () =>
      solutions
        .filter((solution) => isEntityVisible("solution", solution.id))
        .map((solution) => ({
          value: `solution:${solution.id}`,
          label: solution.name || "Unnamed solution",
        })),
    [isEntityVisible, solutions],
  )

  const sourceOptions = useMemo(
    () => [
      ...visibleMaterialOptions.map((option) => ({
        ...option,
        label: `Material: ${option.label}`,
      })),
      ...visibleSolutionOptions.map((option) => ({
        ...option,
        label: `Solution: ${option.label}`,
      })),
    ],
    [visibleMaterialOptions, visibleSolutionOptions],
  )

  const getStepSourceValue = useCallback((step: ProcessStep) => {
    if (step.materialId) {
      return `material:${step.materialId}`
    }
    if (step.solutionId) {
      return `solution:${step.solutionId}`
    }
    return null
  }, [])

  const getStepSourceLabel = useCallback(
    (step: ProcessStep) => {
      if (step.materialId) {
        return (
          materials.find((material) => material.id === step.materialId)?.name ||
          "Unnamed material"
        )
      }
      if (step.solutionId) {
        return (
          solutions.find((solution) => solution.id === step.solutionId)?.name ||
          "Unnamed solution"
        )
      }
      return "No material"
    },
    [materials, solutions],
  )

  const handleUpdateStepSource = (stepId: string, sourceValue: string | null) => {
    if (!selectedProcess) return
    const [kind, id] = sourceValue?.split(":") ?? []
    const updated: Process = {
      ...selectedProcess,
      stages: selectedProcess.stages.map((stage) => ({
        ...stage,
        alternatives: stage.alternatives.map((step) =>
          step.id === stepId
            ? {
                ...step,
                materialId: kind === "material" ? id : undefined,
                solutionId: kind === "solution" ? id : undefined,
              }
            : step,
        ),
      })),
    }
    setProcesses((prev) =>
      prev.map((process) => (process.id === selectedProcess.id ? updated : process)),
    )
  }

  const countSpecifiedParams = useCallback((step: ProcessStep) => {
    return PROCESS_PARAMETER_DEFINITIONS.filter(
      ({ key }) =>
        key !== "depositionMethod" &&
        key !== "depositionStartTime" &&
        key !== "annealingStartTime" &&
        Boolean(step[key]?.value),
    ).length
  }, [])

  const selectedStepParameterSections = useMemo(() => {
    if (!selectedStep) {
      return null
    }
    return getParameterSections(selectedStep.stepCategory)
  }, [selectedStep])

  return (
    <Box style={{ display: "grid", gridTemplateColumns: "250px 1fr", height: "100%" }}>
      {/* Left Sidebar: Process List */}
      <Paper p="md" radius={0} style={{ borderRight: "1px solid var(--mantine-color-gray-3)" }}>
        <Stack gap="md" style={{ height: "100%" }}>
          <TextInput
            placeholder="Search processes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            styles={{ input: { fontSize: "0.875rem" } }}
          />
          <Button
            onClick={handleCreateProcess}
            fullWidth
            leftSection={<IconPlus size={16} />}
            disabled={!activeCollectionId}
          >
            New Process
          </Button>

          {!activeCollectionId && (
            <Alert
              icon={<IconInfoCircle size={16} />}
              color="blue"
              radius="sm"
            >
              Select a collection in the Organization tab to add processes.
            </Alert>
          )}

          <Divider />
          <ScrollArea style={{ flex: 1 }}>
            <Stack gap="xs">
              {visibleProcesses.length === 0 ? (
                <Paper
                  p="lg"
                  ta="center"
                  style={{ background: "var(--mantine-color-gray-0)" }}
                >
                  <Text size="sm" c="dimmed">
                    No processes yet
                  </Text>
                </Paper>
              ) : !activePlaneId ? (
                (() => {
                  const groups = new Map<
                    string,
                    { planeName: string; items: typeof visibleProcesses }
                  >()
                  const orphans: typeof visibleProcesses = []
                  for (const process of visibleProcesses) {
                    const plane = getEntityPlane("process", process.id)
                    if (plane) {
                      const group = groups.get(plane.id)
                      if (group) {
                        group.items.push(process)
                      } else {
                        groups.set(plane.id, {
                          planeName: plane.name,
                          items: [process],
                        })
                      }
                    } else {
                      orphans.push(process)
                    }
                  }
                  const sections: React.ReactNode[] = []
                  for (const [planeId, { planeName, items }] of groups) {
                    sections.push(
                      <Text
                        key={`plane-header-${planeId}`}
                        size="xs"
                        fw={700}
                        c="dimmed"
                        tt="uppercase"
                        mt="xs"
                      >
                        {planeName}
                      </Text>,
                    )
                    sections.push(
                      ...items.map((process) => {
                        const isSelected = selectedProcess?.id === process.id
                        const collectionColor = getEntityColor("process", process.id)
                        return (
                          <Paper
                            key={process.id}
                            p="xs"
                            radius="sm"
                            style={{
                              cursor: "pointer",
                              backgroundColor: isSelected
                                ? "var(--mantine-color-blue-0)"
                                : "transparent",
                              borderLeft: collectionColor
                                ? `3px solid ${collectionColor}`
                                : undefined,
                            }}
                            onClick={() => {
                              selectProcess(process.id)
                              setSelectedStepId(null)
                            }}
                          >
                            <Group justify="space-between">
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text size="sm" fw={isSelected ? 600 : 400} truncate>
                                  {process.name || "Untitled"}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {process.stages.length} step{process.stages.length !== 1 ? "s" : ""}
                                </Text>
                              </div>
                              <Menu shadow="md" width={160}>
                                <Menu.Target>
                                  <ActionIcon size="sm" variant="subtle" color="gray">
                                    <IconChevronDown size={14} />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    leftSection={<IconCopy size={14} />}
                                    onClick={() => handleCopyProcess(process)}
                                  >
                                    Copy
                                  </Menu.Item>
                                  <Menu.Item
                                    leftSection={<IconTrash size={14} />}
                                    color="red"
                                    onClick={() => handleDeleteProcess(process.id)}
                                  >
                                    Delete
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            </Group>
                          </Paper>
                        )
                      }),
                    )
                  }
                  if (orphans.length > 0) {
                    sections.push(
                      <Text
                        key="plane-header-orphan"
                        size="xs"
                        fw={700}
                        c="dimmed"
                        tt="uppercase"
                        mt="xs"
                      >
                        Unassigned
                      </Text>,
                    )
                    sections.push(
                      ...orphans.map((process) => {
                        const isSelected = selectedProcess?.id === process.id
                        const collectionColor = getEntityColor("process", process.id)
                        return (
                          <Paper
                            key={process.id}
                            p="xs"
                            radius="sm"
                            style={{
                              cursor: "pointer",
                              backgroundColor: isSelected
                                ? "var(--mantine-color-blue-0)"
                                : "transparent",
                              borderLeft: collectionColor
                                ? `3px solid ${collectionColor}`
                                : undefined,
                            }}
                            onClick={() => {
                              selectProcess(process.id)
                              setSelectedStepId(null)
                            }}
                          >
                            <Group justify="space-between">
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text size="sm" fw={isSelected ? 600 : 400} truncate>
                                  {process.name || "Untitled"}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {process.stages.length} step{process.stages.length !== 1 ? "s" : ""}
                                </Text>
                              </div>
                              <Menu shadow="md" width={160}>
                                <Menu.Target>
                                  <ActionIcon size="sm" variant="subtle" color="gray">
                                    <IconChevronDown size={14} />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    leftSection={<IconCopy size={14} />}
                                    onClick={() => handleCopyProcess(process)}
                                  >
                                    Copy
                                  </Menu.Item>
                                  <Menu.Item
                                    leftSection={<IconTrash size={14} />}
                                    color="red"
                                    onClick={() => handleDeleteProcess(process.id)}
                                  >
                                    Delete
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            </Group>
                          </Paper>
                        )
                      }),
                    )
                  }
                  return sections
                })()
              ) : (
                visibleProcesses.map((process) => {
                  const isSelected = selectedProcess?.id === process.id
                  const collectionColor = getEntityColor("process", process.id)
                  return (
                    <Paper
                      key={process.id}
                      withBorder
                      p="sm"
                      radius="md"
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "var(--mantine-color-blue-0)" : undefined,
                        borderColor: isSelected ? "var(--mantine-color-blue-4)" : undefined,
                        borderLeft: collectionColor
                          ? `4px solid ${collectionColor}`
                          : undefined,
                      }}
                      onClick={() => {
                        selectProcess(process.id)
                        setSelectedStepId(null)
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={600} truncate mb={2}>
                            {process.name || "Untitled"}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {process.stages.length} step{process.stages.length !== 1 ? "s" : ""}
                          </Text>
                        </Box>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="New experiment" withArrow>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="green"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSpawnExperiment(process)
                              }}
                            >
                              <IconPlayerPlay size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="teal"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyProcess(process)
                            }}
                          >
                            <IconCopy size={14} />
                          </ActionIcon>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteProcess(process.id)
                            }}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      </Group>
                    </Paper>
                  )
                })
              )}
            </Stack>
          </ScrollArea>
        </Stack>
      </Paper>

      {/* Center: Process Editor */}
      <Box style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {selectedProcess ? (
          <>
            {/* Header */}
            <Group justify="space-between" p="md" pb={0}>
              <TextInput
                placeholder="Process name"
                value={selectedProcess.name}
                onChange={(e) => handleUpdateProcessName(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
            </Group>

            <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <Stack p="md" gap="sm">
                {/* Process Board */}
                <Box>
                  <Stack gap="sm">
                    <Box
                      style={{
                        padding: "6px 8px",
                        borderRadius: 8,
                        background: "transparent",
                      }}
                      onMouseDown={(e) => {
                        const target = e.target as HTMLElement
                        if (
                          target.closest('[data-step-box="true"]') ||
                          target.closest('[role="listbox"]') ||
                          target.closest('[role="option"]') ||
                          target.closest('.mantine-Select-dropdown')
                        ) {
                          return
                        }
                        if (!target.closest('[data-step-box="true"]')) {
                          setSelectedStepId(null)
                        }
                      }}
                    >
                      {selectedProcess.stages.length === 0 ? (
                        <Box style={{ minHeight: 120, display: "grid", placeItems: "center" }}>
                          <Text size="sm" c="dimmed">
                            Empty process board
                          </Text>
                        </Box>
                      ) : (
                        <Stack gap="xs">
                          <Box
                            style={{
                              height: 10,
                              borderRadius: 5,
                              background:
                                dropInsertIndex === 0
                                  ? "var(--mantine-color-blue-1)"
                                  : "transparent",
                            }}
                            onDragOver={(e) => {
                              e.preventDefault()
                              setDropInsertIndex(0)
                              setDropStagePos(null)
                            }}
                            onDragLeave={() => setDropInsertIndex(null)}
                            onDrop={(e) => {
                              e.preventDefault()
                              if (draggedStep) {
                                moveStepToNewStageAt(
                                  draggedStep.stepId,
                                  draggedStep.fromStagePos,
                                  0,
                                )
                              }
                              setDraggedStep(null)
                              setDropInsertIndex(null)
                              setDropStagePos(null)
                            }}
                          />

                          {displayedStages.map(({ stage, stagePos }, displayIndex) => (
                            <Box key={stage.index}>
                              <Box
                                style={{
                                  minHeight: 96,
                                  borderRadius: 10,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 8,
                                  padding: "8px 12px",
                                  background:
                                    dropStagePos === stagePos
                                      ? "var(--mantine-color-blue-0)"
                                      : "transparent",
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault()
                                  setDropStagePos(stagePos)
                                  setDropInsertIndex(null)
                                }}
                                onDragLeave={() => setDropStagePos(null)}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  if (draggedStep) {
                                    moveStepToAlternativeStage(
                                      draggedStep.stepId,
                                      draggedStep.fromStagePos,
                                      stagePos,
                                    )
                                  }
                                  setDraggedStep(null)
                                  setDropStagePos(null)
                                  setDropInsertIndex(null)
                                }}
                              >
                                <Text
                                  size="xl"
                                  fw={700}
                                  w={84}
                                  ta="left"
                                  style={{ color: "var(--mantine-color-gray-5)" }}
                                >
                                  #{displayIndex + 1}
                                </Text>

                                <Group
                                  justify="center"
                                  gap="sm"
                                  wrap="nowrap"
                                  style={{ flex: 1 }}
                                >
                                  {stage.alternatives.map((step, altIdx) => (
                                    <Box
                                      key={step.id}
                                      data-step-box="true"
                                      draggable
                                      onDragStart={() => {
                                        setDraggedStep({
                                          stepId: step.id,
                                          fromStagePos: stagePos,
                                        })
                                      }}
                                      onDragEnd={() => {
                                        setDraggedStep(null)
                                        setDropInsertIndex(null)
                                        setDropStagePos(null)
                                      }}
                                      onClick={() => setSelectedStepId(step.id)}
                                      style={{
                                        width: 260,
                                        minHeight: 92,
                                        borderRadius: 8,
                                        padding: "10px 12px",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "space-between",
                                        cursor: "grab",
                                        userSelect: "none",
                                        background: `linear-gradient(90deg, ${step.color}2E 0%, transparent 100%)`,
                                        border:
                                          selectedStepId === step.id
                                            ? `2px solid ${step.color}`
                                            : "1px solid var(--mantine-color-gray-3)",
                                      }}
                                    >
                                      {selectedStepId === step.id ? (
                                        <Stack gap={6}>
                                          <Group
                                            justify="space-between"
                                            align="flex-start"
                                            wrap="nowrap"
                                            gap="xs"
                                          >
                                            <TextInput
                                              size="xs"
                                              placeholder="Deposition method"
                                              autoFocus={pendingFocusStepId === step.id}
                                              value={step.depositionMethod?.value ?? ""}
                                              onClick={(e) => e.stopPropagation()}
                                              onFocus={(e) => {
                                                e.currentTarget.select()
                                                if (pendingFocusStepId === step.id) {
                                                  setPendingFocusStepId(null)
                                                }
                                              }}
                                              onChange={(e) =>
                                                handleUpdateStepParam(
                                                  step.id,
                                                  "depositionMethod",
                                                  {
                                                    value: e.currentTarget.value,
                                                    mode: "constant",
                                                  },
                                                )
                                              }
                                              styles={{ input: { fontWeight: 600 } }}
                                              style={{ flex: 1 }}
                                            />
                                            <Group gap={6} wrap="nowrap">
                                              <input
                                                type="color"
                                                value={step.color}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) =>
                                                  handleUpdateStepColor(
                                                    step.id,
                                                    e.currentTarget.value,
                                                  )
                                                }
                                                style={{
                                                  width: 28,
                                                  height: 28,
                                                  border: `1px solid ${step.color}`,
                                                  borderRadius: 6,
                                                  background: "transparent",
                                                  padding: 1,
                                                }}
                                              />
                                              <ActionIcon
                                                size="xs"
                                                variant="subtle"
                                                color="red"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  handleRemoveStep(step.id)
                                                }}
                                              >
                                                <IconX size={12} />
                                              </ActionIcon>
                                            </Group>
                                          </Group>

                                          <Select
                                            size="xs"
                                            placeholder="Select material or solution"
                                            value={getStepSourceValue(step)}
                                            data={sourceOptions}
                                            searchable
                                            clearable
                                            comboboxProps={{ withinPortal: false }}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(value) =>
                                              handleUpdateStepSource(step.id, value)
                                            }
                                          />
                                        </Stack>
                                      ) : (
                                        <>
                                          <Group justify="space-between" wrap="nowrap" gap="xs">
                                            {stage.alternatives.length > 1 && (
                                              <Text size="xs" c="dimmed" style={{ fontWeight: 700, minWidth: 16 }}>
                                                {String.fromCharCode(97 + altIdx)}
                                              </Text>
                                            )}
                                            <Text size="sm" fw={600} truncate>
                                              {step.depositionMethod?.value?.trim() ||
                                                step.name ||
                                                "Unnamed"}
                                              {`: ${getStepSourceLabel(step)}`}
                                            </Text>
                                            <ActionIcon
                                              size="xs"
                                              variant="subtle"
                                              color="red"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleRemoveStep(step.id)
                                              }}
                                            >
                                              <IconX size={12} />
                                            </ActionIcon>
                                          </Group>
                                          <Group justify="space-between" gap="xs" wrap="nowrap">
                                            <Group gap={4} wrap="nowrap">
                                              {STEP_CATEGORY_ICON_MAP[step.stepCategory]}
                                              <Text size="xs" c="dimmed" truncate>
                                                {STEP_CATEGORIES.find(c => c.value === step.stepCategory)?.label ?? step.stepCategory.replace(/_/g, " ")}
                                              </Text>
                                            </Group>
                                            {countSpecifiedParams(step) > 0 && (
                                              <Badge size="xs" variant="light" color="teal">
                                                {countSpecifiedParams(step)} params
                                              </Badge>
                                            )}
                                          </Group>
                                        </>
                                      )}
                                    </Box>
                                  ))}

                                  <Menu shadow="md" width={240}>
                                    <Menu.Target>
                                      <Button
                                        size="xs"
                                        variant="subtle"
                                        leftSection={<IconPlus size={14} />}
                                      >
                                        Add Alternative Step
                                      </Button>
                                    </Menu.Target>
                                    <Menu.Dropdown>
                                      {STEP_CATEGORIES.map((category) => (
                                        <Menu.Item
                                          key={`alt-${stage.index}-${category.value}`}
                                          leftSection={category.icon}
                                          onClick={() =>
                                            handleAddAlternativeStep(
                                              stage.index,
                                              category.value,
                                            )
                                          }
                                        >
                                          {category.label}
                                        </Menu.Item>
                                      ))}
                                    </Menu.Dropdown>
                                  </Menu>
                                </Group>
                              </Box>

                              <Box
                                style={{
                                  height: 10,
                                  borderRadius: 5,
                                  background:
                                    dropInsertIndex === stagePos + 1
                                      ? "var(--mantine-color-blue-1)"
                                      : "transparent",
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault()
                                  setDropInsertIndex(stagePos + 1)
                                  setDropStagePos(null)
                                }}
                                onDragLeave={() => setDropInsertIndex(null)}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  if (draggedStep) {
                                    moveStepToNewStageAt(
                                      draggedStep.stepId,
                                      draggedStep.fromStagePos,
                                      stagePos + 1,
                                    )
                                  }
                                  setDraggedStep(null)
                                  setDropInsertIndex(null)
                                  setDropStagePos(null)
                                }}
                              />
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Box>

                    <Group justify="center" gap="sm">
                      <Menu shadow="md" width={240}>
                        <Menu.Target>
                          <Button
                            size="xs"
                            variant="subtle"
                            leftSection={<IconPlus size={14} />}
                          >
                            Add Next Step
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {STEP_CATEGORIES.map((category) => (
                            <Menu.Item
                              key={`next-${category.value}`}
                              leftSection={category.icon}
                              onClick={() => handleAddProcessStep(category.value)}
                            >
                              {category.label}
                            </Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Stack>
                </Box>
              </Stack>
            </Box>

            {/* Bottom: Step Details (always visible) */}
            <Paper
              p="md"
              radius={0}
              style={{
                backgroundColor: "transparent",
              }}
            >
              <Stack gap="md">
                {selectedStep ? (
                  <>
                    {selectedStepParameterSections && (
                      <>
                        {selectedStepParameterSections.deposition.length > 0 && (
                          <Stack gap="xs">
                            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                              Deposition Parameters
                            </Text>
                            <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
                              {selectedStepParameterSections.deposition.map((key) => {
                                const definition = PROCESS_DETAIL_DEFINITIONS.get(key)
                                if (!definition) return null
                                return (
                                  <Box
                                    key={key}
                                    p="xs"
                                    style={{
                                      borderRadius: 8,
                                      border: `1px solid ${selectedStep.color}66`,
                                      background: `linear-gradient(90deg, ${selectedStep.color}18 0%, transparent 100%)`,
                                    }}
                                  >
                                    <ProcessParamInput
                                      label={
                                        selectedStepParameterSections.labelOverrides[key] ??
                                        definition.label
                                      }
                                      param={selectedStep[key]}
                                      onChange={(param) =>
                                        handleUpdateStepParam(selectedStep.id, key, param)
                                      }
                                      placeholder={
                                        selectedStepParameterSections.placeholderOverrides[key] ??
                                        definition.placeholder
                                      }
                                      unit={definition.unit}
                                      sourceSuggestions={getSourceSuggestions(key)}
                                      type={definition.type ?? "text"}
                                    />
                                  </Box>
                                )
                              })}
                            </SimpleGrid>
                          </Stack>
                        )}

                        {selectedStepParameterSections.annealing.length > 0 && (
                          <Stack gap="xs">
                            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                              Annealing Parameters
                            </Text>
                            <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
                              {selectedStepParameterSections.annealing.map((key) => {
                                const definition = PROCESS_DETAIL_DEFINITIONS.get(key)
                                if (!definition) return null
                                return (
                                  <Box
                                    key={key}
                                    p="xs"
                                    style={{
                                      borderRadius: 8,
                                      border: `1px solid ${selectedStep.color}66`,
                                      background: `linear-gradient(90deg, ${selectedStep.color}18 0%, transparent 100%)`,
                                    }}
                                  >
                                    <ProcessParamInput
                                      label={
                                        selectedStepParameterSections.labelOverrides[key] ??
                                        definition.label
                                      }
                                      param={selectedStep[key]}
                                      onChange={(param) =>
                                        handleUpdateStepParam(selectedStep.id, key, param)
                                      }
                                      placeholder={
                                        selectedStepParameterSections.placeholderOverrides[key] ??
                                        definition.placeholder
                                      }
                                      unit={definition.unit}
                                      sourceSuggestions={getSourceSuggestions(key)}
                                      type={definition.type ?? "text"}
                                    />
                                  </Box>
                                )
                              })}
                            </SimpleGrid>
                          </Stack>
                        )}
                      </>
                    )}

                    {(noteEditorStepId === selectedStep.id ||
                      Boolean(selectedStep.notes?.trim())) ? (
                      <Textarea
                        label="Notes"
                        minRows={2}
                        maxRows={4}
                        value={selectedStep.notes ?? ""}
                        onChange={(e) =>
                          handleUpdateStepNotes(selectedStep.id, e.currentTarget.value)
                        }
                      />
                    ) : (
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconPlus size={12} />}
                        onClick={() => setNoteEditorStepId(selectedStep.id)}
                        style={{ justifyContent: "flex-start", width: "fit-content" }}
                      >
                        Add Note
                      </Button>
                    )}
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    Select a step to edit names, parameters, and notes.
                  </Text>
                )}
              </Stack>
            </Paper>
          </>
        ) : (
          <Box style={{ display: "grid", placeItems: "center", height: "100%" }}>
            <Stack align="center" gap="md">
              <Text c="dimmed">Select or create a process to begin</Text>
              <Button
                onClick={handleCreateProcess}
                leftSection={<IconPlus size={16} />}
                disabled={!activeCollectionId}
              >
                New Process
              </Button>
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
  )
}
