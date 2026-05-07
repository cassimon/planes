import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core"
import { modals } from "@mantine/modals"
import {
  IconCopy,
  IconInfoCircle,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import * as React from "react"
import { useState } from "react"
import {
  type Experiment,
  getExperimentStatus,
  newExperiment,
  PROCESS_PARAMETER_DEFINITIONS,
  type Process,
  type ProcessParameterKey,
  type ProcessStep,
  useAppContext,
} from "../store/AppContext"

type SubstrateGeneratorConfig = {
  namePrefix: string
  includeDate: boolean
  includeExperimentName: boolean
  addCount: number
}

function buildGeneratedSubstrateName(
  index: number,
  experiment: Experiment,
  generatorConfig: SubstrateGeneratorConfig,
) {
  const parts: string[] = [generatorConfig.namePrefix || "substrate"]
  if (generatorConfig.includeDate && experiment.date) {
    parts.push(experiment.date)
  }
  if (generatorConfig.includeExperimentName && experiment.name) {
    parts.push(experiment.name.replace(/\s+/g, "_"))
  }
  return `${parts.join("_")}_${index}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit SubstrateName Generator (simplified display above table)
// ─────────────────────────────────────────────────────────────────────────────

function SubstrateNameGenerator({
  experiment,
  process,
  generatorConfig,
  onChangeGeneratorConfig,
  nextStepDefaults,
  onChangeNextStepDefault,
  onUpdate,
}: {
  experiment: Experiment
  process: Process
  generatorConfig: SubstrateGeneratorConfig
  onChangeGeneratorConfig: (patch: Partial<SubstrateGeneratorConfig>) => void
  nextStepDefaults: Record<number, string>
  onChangeNextStepDefault: (stageIndex: number, value: string) => void
  onUpdate: (exp: Experiment) => void
}) {
  const buildDefaultStageValues = () => {
    const values: Record<string, string> = {}
    process.stages.forEach((stage, idx) => {
      const selected =
        nextStepDefaults[idx] ?? stage.alternatives[0]?.id ?? "SKIP"
      values[`stageSelection:${idx}`] = selected
    })
    return values
  }

  const buildSubstrateName = (index: number) => {
    return buildGeneratedSubstrateName(index, experiment, generatorConfig)
  }

  const handleAddSubstrates = () => {
    const count = Math.max(1, generatorConfig.addCount)
    const newSubstrates = [
      ...experiment.substrates,
      ...Array.from({ length: count }, (_, i) => ({
        id: crypto.randomUUID(),
        name: buildSubstrateName(experiment.substrates.length + i + 1),
        parameterValues: buildDefaultStageValues(),
      })),
    ]
    onUpdate({
      ...experiment,
      numSubstrates: newSubstrates.length,
      substrates: newSubstrates,
    })
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      mb="md"
      style={{ background: "var(--mantine-color-blue-0)" }}
    >
      <Text size="sm" fw={600} mb="xs">
        Substrate Name Generator
      </Text>
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <TextInput
          label="Name Prefix"
          placeholder="e.g. substrate"
          size="sm"
          value={generatorConfig.namePrefix}
          onChange={(e) => onChangeGeneratorConfig({ namePrefix: e.currentTarget.value })}
          style={{ flex: 1, minWidth: 180 }}
        />
        <Checkbox
          label="Include Date"
          checked={generatorConfig.includeDate}
          onChange={(e) => onChangeGeneratorConfig({ includeDate: e.currentTarget.checked })}
        />
        <Checkbox
          label="Include Experiment Name"
          checked={generatorConfig.includeExperimentName}
          onChange={(e) =>
            onChangeGeneratorConfig({ includeExperimentName: e.currentTarget.checked })
          }
        />
        <NumberInput
          label="How Many"
          size="sm"
          min={1}
          max={200}
          value={generatorConfig.addCount}
          onChange={(v) => onChangeGeneratorConfig({ addCount: Number(v) || 1 })}
          style={{ width: 120 }}
        />
      </Group>

      <Divider my="sm" />

      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
        Default Values For Next Added Substrates
      </Text>
      <Group gap="sm" align="flex-end" wrap="wrap">
        {process.stages.map((stage, idx) => (
          <Select
            key={`default-stage-${idx}`}
            size="xs"
            label={`Step ${idx + 1}`}
            w={210}
            value={nextStepDefaults[idx] ?? stage.alternatives[0]?.id ?? "SKIP"}
            onChange={(value) =>
              onChangeNextStepDefault(
                idx,
                value ?? stage.alternatives[0]?.id ?? "SKIP",
              )
            }
            data={[
              ...stage.alternatives.map((step) => ({
                value: step.id,
                label: step.name,
              })),
              { value: "SKIP", label: "Skip step" },
            ]}
          />
        ))}
      </Group>

      <Group justify="flex-end" mt="sm">
        <Button
          size="md"
          variant="filled"
          leftSection={<IconPlus size={16} />}
          onClick={handleAddSubstrates}
          style={{ minWidth: 140 }}
        >
          Add
        </Button>
      </Group>
    </Paper>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe Selection Modal
// ─────────────────────────────────────────────────────────────────────────────

function RecipeSelectionModal({
  isOpen,
  processes,
  onSelect,
  onClose,
}: {
  isOpen: boolean
  processes: Process[]
  onSelect: (processId: string) => void
  onClose: () => void
}) {
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null)

  const handleConfirm = () => {
    if (selectedProcessId) {
      onSelect(selectedProcessId)
      onClose()
      setSelectedProcessId(null)
    }
  }

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Select Recipe (Process) for Experiment"
      size="md"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Choose which recipe/process this experiment will follow. You can change
          this later.
        </Text>

        <>
          {processes.length === 0 ? (
            <Alert
              icon={<IconInfoCircle size={16} />}
              title="No Recipes Available"
              color="yellow"
            >
              Please create a recipe first before creating an experiment.
            </Alert>
          ) : (
            <Select
              label="Recipe"
              placeholder="Select a recipe..."
              searchable
              data={processes.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              value={selectedProcessId}
              onChange={setSelectedProcessId}
              size="sm"
            />
          )}
        </>

        <Group justify="flex-end" gap="sm">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedProcessId || processes.length === 0}
          >
            Confirm
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Process Step Selection Dropdown (for each cell in grid)
// ─────────────────────────────────────────────────────────────────────────────

function ProcessStepSelector({
  alternatives,
  selectedStepId,
  defaultStepId,
  onSelect,
}: {
  alternatives: ProcessStep[]
  selectedStepId: string | undefined | null
  defaultStepId: string | null
  onSelect: (stepId: string | null) => void
}) {
  const data = [
    ...alternatives.map((step) => ({
      value: step.id,
      label: step.name,
    })),
    { value: "SKIP", label: "Skip this step" },
  ]

  const handleChange = (value: string | null) => {
    if (value === "SKIP") {
      onSelect(null)
    } else {
      onSelect(value)
    }
  }

  return (
    <Select
      placeholder="Select step..."
      data={data}
      value={selectedStepId || defaultStepId || "SKIP"}
      onChange={handleChange}
      size="xs"
      maxDropdownHeight={200}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Experiment Grid View
// ─────────────────────────────────────────────────────────────────────────────

function ExperimentGrid({
  experiment,
  process,
  generatorConfig,
  nextStepDefaults,
  onUpdate,
  onUpdateProcess,
}: {
  experiment: Experiment
  process: Process
  generatorConfig: SubstrateGeneratorConfig
  nextStepDefaults: Record<number, string>
  onUpdate: (exp: Experiment) => void
  onUpdateProcess: (process: Process) => void
}) {
  const [variationTarget, setVariationTarget] = useState<string | null>(null)
  const [variationParam, setVariationParam] = useState<string | null>(null)
  const nameInputRefs = React.useRef<Array<HTMLInputElement | null>>([])

  const getStageSelection = (substrateId: string, stageIndex: number): string | null => {
    const substrate = experiment.substrates.find((s) => s.id === substrateId)
    const stored = substrate?.parameterValues?.[`stageSelection:${stageIndex}`]
    if (stored) {
      return stored === "SKIP" ? null : stored
    }
    return process.stages[stageIndex]?.alternatives[0]?.id ?? null
  }

  const handleStepSelect = (
    substrateId: string,
    stageIndex: number,
    stepId: string | null,
  ) => {
    const newSubstrates = experiment.substrates.map((substrate) => {
      if (substrate.id !== substrateId) return substrate
      return {
        ...substrate,
        parameterValues: {
          ...(substrate.parameterValues ?? {}),
          [`stageSelection:${stageIndex}`]: stepId ?? "SKIP",
        },
      }
    })
    onUpdate({ ...experiment, substrates: newSubstrates })
  }

  const handleRemoveSubstrate = (substrateId: string) => {
    const newSubstrates = experiment.substrates.filter(
      (s) => s.id !== substrateId,
    )
    onUpdate({ ...experiment, substrates: newSubstrates })
  }

  const handleProcessingTimeChange = (stageKey: string, value: string) => {
    onUpdate({
      ...experiment,
      processingTimes: {
        ...(experiment.processingTimes ?? {}),
        [stageKey]: value,
      },
    })
  }

  const buildDefaultStageValues = () => {
    const values: Record<string, string> = {}
    process.stages.forEach((stage, idx) => {
      values[`stageSelection:${idx}`] = nextStepDefaults[idx] ?? stage.alternatives[0]?.id ?? "SKIP"
    })
    return values
  }

  const focusNameInput = (index: number) => {
    const nextInput = nameInputRefs.current[index]
    if (!nextInput) return
    nextInput.focus()
    nextInput.select()
  }

  const handleSubstrateNameChange = (substrateId: string, name: string) => {
    onUpdate({
      ...experiment,
      substrates: experiment.substrates.map((substrate) =>
        substrate.id === substrateId ? { ...substrate, name } : substrate,
      ),
    })
  }

  const handleDuplicateSubstrate = (substrateId: string) => {
    const source = experiment.substrates.find((substrate) => substrate.id === substrateId)
    if (!source) return
    const duplicateIndex = experiment.substrates.length + 1
    const duplicate = {
      ...source,
      id: crypto.randomUUID(),
      name: buildGeneratedSubstrateName(duplicateIndex, experiment, generatorConfig),
      parameterValues: {
        ...buildDefaultStageValues(),
        ...(source.parameterValues ?? {}),
      },
    }
    const newSubstrates = [...experiment.substrates, duplicate]
    onUpdate({ ...experiment, numSubstrates: newSubstrates.length, substrates: newSubstrates })
  }

  const handleAddVariation = () => {
    if (!variationTarget || !variationParam) return
    const [stageIndexRaw, stepId] = variationTarget.split(":")
    const stageIndex = Number(stageIndexRaw)
    const paramKey = variationParam as ProcessParameterKey
    const targetStep = process.stages[stageIndex]?.alternatives.find((step) => step.id === stepId)
    if (!targetStep) return

    const baseValue = targetStep[paramKey]?.value ?? ""

    const updatedProcess: Process = {
      ...process,
      stages: process.stages.map((stage, idx) =>
        idx !== stageIndex
          ? stage
          : {
              ...stage,
              alternatives: stage.alternatives.map((step) =>
                step.id !== stepId
                  ? step
                  : {
                      ...step,
                      [paramKey]: {
                        ...(step[paramKey] ?? { value: baseValue, mode: "variation" }),
                        value: step[paramKey]?.value ?? baseValue,
                        mode: "variation",
                      },
                    },
              ),
            },
      ),
    }

    const updatedExperiment: Experiment = {
      ...experiment,
      substrates: experiment.substrates.map((substrate) => ({
        ...substrate,
        parameterValues: {
          ...(substrate.parameterValues ?? {}),
          [`${stepId}:${paramKey}`]: substrate.parameterValues?.[`${stepId}:${paramKey}`] ?? baseValue,
        },
      })),
    }

    onUpdateProcess(updatedProcess)
    onUpdate(updatedExperiment)
    setVariationTarget(null)
    setVariationParam(null)
  }

  return (
    <>
      <Group align="flex-start" wrap="nowrap" gap="md" mb="lg">
        <Box style={{ overflowX: "auto", flex: 1 }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: "14px",
          }}
        >
          <thead>
            <tr style={{ background: "var(--mantine-color-gray-1)" }}>
              <th
                style={{
                  padding: "12px 8px",
                  textAlign: "left",
                  fontWeight: 600,
                  borderBottom: "2px solid var(--mantine-color-gray-3)",
                  minWidth: "150px",
                }}
              >
                Substrate
              </th>
              {process.stages.map((stage, idx) => {
                const step = stage.alternatives[0]
                return (
                  <th
                    key={`stage-${idx}`}
                    style={{
                      padding: "12px 8px",
                      textAlign: "left",
                      fontWeight: 600,
                      borderBottom: "2px solid var(--mantine-color-gray-3)",
                      minWidth: "180px",
                    }}
                  >
                    <Group justify="space-between" gap="xs">
                      <Text size="sm">{step.name}</Text>
                      {stage.alternatives.length > 1 && (
                        <Badge size="xs" variant="light" color="orange">
                          {stage.alternatives.length} options
                        </Badge>
                      )}
                    </Group>
                  </th>
                )
              })}
              <th
                style={{
                  padding: "12px 8px",
                  textAlign: "center",
                  fontWeight: 600,
                  borderBottom: "2px solid var(--mantine-color-gray-3)",
                  minWidth: "80px",
                }}
              >
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {experiment.substrates.map((substrate) => (
              <tr
                key={substrate.id}
                style={{
                  borderBottom: "1px solid var(--mantine-color-gray-2)",
                }}
              >
                <td
                  style={{
                    padding: "12px 8px",
                    fontWeight: 500,
                    background: "var(--mantine-color-gray-0)",
                  }}
                >
                  <TextInput
                    ref={(node) => {
                      nameInputRefs.current[experiment.substrates.findIndex((s) => s.id === substrate.id)] = node
                    }}
                    size="xs"
                    variant="unstyled"
                    value={substrate.name}
                    onChange={(e) => handleSubstrateNameChange(substrate.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      const currentIndex = experiment.substrates.findIndex((s) => s.id === substrate.id)
                      if (e.key === "Enter") {
                        e.preventDefault()
                        focusNameInput(currentIndex + 1)
                      }
                      if (e.key === "Tab") {
                        e.preventDefault()
                        focusNameInput(e.shiftKey ? currentIndex - 1 : currentIndex + 1)
                      }
                    }}
                    styles={{ input: { fontWeight: 500 } }}
                  />
                </td>

                {process.stages.map((stage, stageIdx) => (
                  <td
                    key={`${substrate.id}-stage-${stageIdx}`}
                    style={{
                      padding: "8px 4px",
                    }}
                  >
                    <ProcessStepSelector
                      alternatives={stage.alternatives}
                      defaultStepId={stage.alternatives[0]?.id ?? null}
                      selectedStepId={getStageSelection(substrate.id, stageIdx)}
                      onSelect={(stepId) =>
                        handleStepSelect(substrate.id, stageIdx, stepId)
                      }
                    />
                  </td>
                ))}

                <td
                  style={{
                    padding: "8px 4px",
                    textAlign: "center",
                  }}
                >
                  <Group justify="center" gap={2} wrap="nowrap">
                    <Tooltip label="Duplicate substrate">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="teal"
                        onClick={() => handleDuplicateSubstrate(substrate.id)}
                      >
                        <IconCopy size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Remove substrate">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={() => handleRemoveSubstrate(substrate.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </td>
              </tr>
            ))}

            <tr style={{ background: "var(--mantine-color-gray-0)" }}>
              <td
                style={{
                  padding: "10px 8px",
                  fontWeight: 600,
                  borderTop: "2px solid var(--mantine-color-gray-2)",
                }}
              >
                Processing Times
              </td>
              {process.stages.map((stage, idx) => {
                const processingKey = `stage:${idx}`
                return (
                <td
                  key={`processing-time-${stage.index}-${idx}`}
                  style={{
                    padding: "8px 4px",
                    borderTop: "2px solid var(--mantine-color-gray-2)",
                  }}
                >
                  <TextInput
                    size="xs"
                    type="datetime-local"
                    value={experiment.processingTimes?.[processingKey] ?? ""}
                    onChange={(e) =>
                      handleProcessingTimeChange(processingKey, e.currentTarget.value)
                    }
                  />
                </td>
                )
              })}
              <td
                style={{
                  borderTop: "2px solid var(--mantine-color-gray-2)",
                }}
              />
            </tr>
          </tbody>
          </table>
        </Box>

        <Paper
          withBorder
          p="md"
          radius="md"
          style={{ width: 320, background: "var(--mantine-color-blue-0)" }}
        >
          <Text size="sm" fw={600} mb="xs">
            Add Parameter Variation
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Create variation columns for selected process steps.
          </Text>
          <Stack gap="sm">
            <Select
              placeholder="Select step..."
              searchable
              value={variationTarget}
              onChange={setVariationTarget}
              data={process.stages.flatMap((stage, idx) =>
                stage.alternatives.map((step) => ({
                  value: `${idx}:${step.id}`,
                  label: `${idx + 1}. ${step.name}`,
                })),
              )}
              size="sm"
            />
            <Select
              placeholder="Select parameter..."
              value={variationParam}
              onChange={setVariationParam}
              data={PROCESS_PARAMETER_DEFINITIONS.filter(
                ({ key }) => key !== "depositionStartTime" && key !== "annealingStartTime",
              ).map(({ key, label }) => ({ value: key, label }))}
              size="sm"
            />
            <Button
              size="sm"
              disabled={!variationTarget || !variationParam}
              onClick={handleAddVariation}
            >
              Add Variation
            </Button>
          </Stack>
        </Paper>
      </Group>

      {experiment.substrates.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          No substrates added. Use the generator above to add substrates.
        </Text>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Experiments Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ExperimentsPage() {
  const {
    experiments,
    setExperiments,
    processes,
    setProcesses,
    activeEntity,
    setActiveEntity,
  } = useAppContext()

  const [selectedExpId, setSelectedExpId] = useState<string | null>(null)
  const [recipeModalOpen, setRecipeModalOpen] = useState(false)
  const [newExperimentProcessId, setNewExperimentProcessId] = useState<string | null>(
    null,
  )
  const [generatorConfig, setGeneratorConfig] = useState<SubstrateGeneratorConfig>({
    namePrefix: "substrate",
    includeDate: false,
    includeExperimentName: false,
    addCount: 5,
  })
  const [nextStepDefaults, setNextStepDefaults] = useState<Record<number, string>>(
    {},
  )

  const selectedExperiment = experiments.find((e) => e.id === selectedExpId)
  const selectedProcess =
    selectedExperiment && processes.find((p) => p.id === selectedExperiment.processId)

  React.useEffect(() => {
    if (activeEntity?.kind !== "experiment") {
      return
    }
    if (!experiments.some((e) => e.id === activeEntity.id)) {
      return
    }
    setSelectedExpId(activeEntity.id)
  }, [activeEntity, experiments])

  React.useEffect(() => {
    if (!selectedExpId) {
      return
    }
    setActiveEntity({ kind: "experiment", id: selectedExpId })
  }, [selectedExpId, setActiveEntity])

  React.useEffect(() => {
    if (processes.length === 0) {
      setNewExperimentProcessId(null)
      return
    }
    if (
      !newExperimentProcessId ||
      !processes.some((process) => process.id === newExperimentProcessId)
    ) {
      setNewExperimentProcessId(processes[0].id)
    }
  }, [newExperimentProcessId, processes])

  // Create new experiment
  const handleNewExperiment = () => {
    if (!newExperimentProcessId) return
    const newExp = newExperiment(newExperimentProcessId)
    setExperiments((prev) => [...prev, newExp])
    setSelectedExpId(newExp.id)
  }

  // Select recipe after creation
  const handleRecipeSelect = (processId: string) => {
    if (!selectedExpId) return
    const exp = experiments.find((e) => e.id === selectedExpId)
    if (exp) {
      handleUpdateExperiment({
        ...exp,
        processId,
      })
    }
  }

  // Update experiment
  const handleUpdateExperiment = (exp: Experiment) => {
    setExperiments((prev) => prev.map((e) => (e.id === exp.id ? exp : e)))
  }

  const handleUpdateProcess = (updatedProcess: Process) => {
    setProcesses((prev) =>
      prev.map((process) => (process.id === updatedProcess.id ? updatedProcess : process)),
    )
  }

  // Delete experiment
  const handleDeleteExperiment = (expId: string) => {
    modals.openConfirmModal({
      title: "Delete Experiment?",
      children: (
        <Text size="sm">
          Are you sure you want to delete this experiment? This action cannot be
          undone.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        setExperiments((prev) => prev.filter((e) => e.id !== expId))
        setSelectedExpId(null)
      },
    })
  }

  const handleCopyExperiment = (exp: Experiment) => {
    const copy: Experiment = {
      ...exp,
      id: crypto.randomUUID(),
      name: `${exp.name || "Experiment"} (Copy)`,
      substrates: exp.substrates.map((substrate) => ({
        ...substrate,
        id: crypto.randomUUID(),
        parameterValues: { ...(substrate.parameterValues ?? {}) },
      })),
      processingTimes: { ...(exp.processingTimes ?? {}) },
      hasResults: false,
    }
    setExperiments((prev) => [...prev, copy])
    setSelectedExpId(copy.id)
  }

  const groupedExperiments = React.useMemo(() => {
    const processNameById = new Map(processes.map((p) => [p.id, p.name]))
    const groups = new Map<string, Experiment[]>()

    for (const exp of experiments) {
      const key = exp.processId || "__unassigned__"
      const list = groups.get(key)
      if (list) {
        list.push(exp)
      } else {
        groups.set(key, [exp])
      }
    }

    return Array.from(groups.entries())
      .sort((a, b) => {
        const aName =
          a[0] === "__unassigned__"
            ? "Unassigned"
            : (processNameById.get(a[0]) ?? "Unknown Process")
        const bName =
          b[0] === "__unassigned__"
            ? "Unassigned"
            : (processNameById.get(b[0]) ?? "Unknown Process")
        return aName.localeCompare(bName)
      })
      .map(([processId, items]) => {
        const processName =
          processId === "__unassigned__"
            ? "Unassigned"
            : (processNameById.get(processId) ?? "Unknown Process")
        const sortedItems = [...items].sort((a, b) => {
          const byName = (a.name || "").localeCompare(b.name || "")
          if (byName !== 0) return byName
          return (a.date || "").localeCompare(b.date || "")
        })
        return { processId, processName, items: sortedItems }
      })
  }, [experiments, processes])

  return (
    <Group gap={0} align="flex-start" style={{ height: "100%" }}>
      {/* Left Sidebar - Experiment List */}
      <Box
        style={{
          width: "16%",
          minWidth: 220,
          background: "var(--mantine-color-gray-0)",
          borderRight: "1px solid var(--mantine-color-gray-2)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <Stack gap="sm" p="md" style={{ flex: 1, overflowY: "auto" }}>
          <Select
            label="Process"
            placeholder="Select process..."
            size="xs"
            searchable
            data={processes.map((process) => ({
              value: process.id,
              label: process.name || "Untitled",
            }))}
            value={newExperimentProcessId}
            onChange={setNewExperimentProcessId}
          />

          <Button
            fullWidth
            leftSection={<IconPlus size={16} />}
            onClick={handleNewExperiment}
            disabled={!newExperimentProcessId || processes.length === 0}
          >
            New Experiment
          </Button>

          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Experiments ({experiments.length})
          </Text>

          <Stack gap="xs">
            {groupedExperiments.map((group) => (
              <React.Fragment key={`process-group-${group.processId}`}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="xs">
                  {group.processName}
                </Text>
                {group.items.map((exp) => {
                  const status = getExperimentStatus(exp)
                  const isSelected = exp.id === selectedExpId

                  return (
                    <Paper
                      key={exp.id}
                      withBorder
                      p="sm"
                      radius="md"
                      style={{
                        cursor: "pointer",
                        background: isSelected
                          ? "var(--mantine-color-blue-0)"
                          : undefined,
                        borderColor: isSelected
                          ? "var(--mantine-color-blue-4)"
                          : undefined,
                      }}
                      onClick={() => setSelectedExpId(exp.id)}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Group gap="xs" mb={4}>
                            <Text size="sm" fw={600} truncate>
                              {exp.name || "Untitled"}
                            </Text>
                            <Badge
                              size="xs"
                              color={
                                status === "finished"
                                  ? "green"
                                  : status === "ready"
                                    ? "yellow"
                                    : "red"
                              }
                              variant="dot"
                            >
                              {status === "finished"
                                ? "Finished"
                                : status === "ready"
                                  ? "Ready"
                                  : "Incomplete"}
                            </Badge>
                          </Group>
                          <Group gap="xs">
                            <Text size="xs" c="dimmed">
                              {exp.date || "No date"}
                            </Text>
                            <Text size="xs" c="dimmed">
                              •
                            </Text>
                            <Text size="xs" c="dimmed">
                              {exp.substrates.length} substrate
                              {exp.substrates.length !== 1 ? "s" : ""}
                            </Text>
                          </Group>
                        </Box>

                        <Group gap={2} wrap="nowrap">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="teal"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyExperiment(exp)
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
                              handleDeleteExperiment(exp.id)
                            }}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      </Group>
                    </Paper>
                  )
                })}
              </React.Fragment>
            ))}
          </Stack>
        </Stack>
      </Box>

      {/* Main Content Area */}
      <Box style={{ flex: 1, height: "100%", overflowY: "auto", padding: "2rem" }}>
        {!selectedExperiment ? (
          <Stack gap="md" align="center" justify="center" style={{ height: "100%" }}>
            <IconPlus size={48} color="var(--mantine-color-gray-4)" />
            <Text size="lg" fw={500} c="dimmed">
              Select or create an experiment to get started
            </Text>
          </Stack>
        ) : !selectedProcess ? (
          <Stack gap="md" align="center" justify="center" style={{ height: "100%" }}>
            <Alert
              icon={<IconInfoCircle size={16} />}
              title="No Recipe Selected"
              color="yellow"
            >
              Please select a recipe for this experiment to continue.
            </Alert>
            <Button onClick={() => setRecipeModalOpen(true)}>
              Select Recipe
            </Button>
          </Stack>
        ) : (
          <Stack gap="md">
            {/* Header with title and meta info */}
            <Group justify="space-between" align="flex-start">
              <Paper
                withBorder
                p="sm"
                radius="md"
                style={{ flex: 1, background: "var(--mantine-color-gray-1)" }}
              >
                <SimpleGrid cols={4} spacing="sm">
                  <TextInput
                    label="Experiment Name"
                    placeholder="Name"
                    size="sm"
                    value={selectedExperiment.name}
                    onChange={(e) =>
                      handleUpdateExperiment({
                        ...selectedExperiment,
                        name: e.currentTarget.value,
                      })
                    }
                  />

                  <Box>
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                      Date of Execution
                    </Text>
                    <TextInput
                      type="date"
                      value={selectedExperiment.date}
                      onChange={(e) =>
                        handleUpdateExperiment({
                          ...selectedExperiment,
                          date: e.currentTarget.value,
                        })
                      }
                      size="sm"
                    />
                  </Box>

                  <Box>
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                      Status
                    </Text>
                    <Badge
                      size="lg"
                      color={
                        getExperimentStatus(selectedExperiment) === "finished"
                          ? "green"
                          : getExperimentStatus(selectedExperiment) === "ready"
                            ? "blue"
                            : "yellow"
                      }
                    >
                      {getExperimentStatus(selectedExperiment)}
                    </Badge>
                  </Box>

                  <Paper
                    withBorder
                    p="xs"
                    radius="sm"
                    style={{ background: "var(--mantine-color-blue-0)" }}
                  >
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                      Recipe / Process
                    </Text>
                    <Group gap="xs">
                      <Badge color="blue" variant="filled" size="lg">
                        {selectedProcess.name}
                      </Badge>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setRecipeModalOpen(true)}
                      >
                        Change
                      </Button>
                    </Group>
                  </Paper>
                </SimpleGrid>
              </Paper>
            </Group>

            {/* Intent/Description */}
            <Box>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                Intent / Description
              </Text>
              <TextInput
                placeholder="What is the purpose of this experiment?"
                value={selectedExperiment.description}
                onChange={(e) =>
                  handleUpdateExperiment({
                    ...selectedExperiment,
                    description: e.currentTarget.value,
                  })
                }
              />
            </Box>

            <Divider />

            {/* Substrate Management */}
            <SubstrateNameGenerator
              experiment={selectedExperiment}
              process={selectedProcess}
              generatorConfig={generatorConfig}
              onChangeGeneratorConfig={(patch) =>
                setGeneratorConfig((prev) => ({ ...prev, ...patch }))
              }
              nextStepDefaults={nextStepDefaults}
              onChangeNextStepDefault={(stageIndex, value) =>
                setNextStepDefaults((prev) => ({ ...prev, [stageIndex]: value }))
              }
              onUpdate={handleUpdateExperiment}
            />

            {/* Main Grid */}
            <Paper withBorder p="md" radius="md">
              <Text size="sm" fw={600} mb="md">
                Experiment Steps Grid
              </Text>
              <ExperimentGrid
                experiment={selectedExperiment}
                process={selectedProcess}
                generatorConfig={generatorConfig}
                nextStepDefaults={nextStepDefaults}
                onUpdate={handleUpdateExperiment}
                onUpdateProcess={handleUpdateProcess}
              />
            </Paper>

          </Stack>
        )}
      </Box>

      {/* Recipe Selection Modal */}
      <RecipeSelectionModal
        isOpen={recipeModalOpen}
        processes={processes}
        onSelect={handleRecipeSelect}
        onClose={() => setRecipeModalOpen(false)}
      />
    </Group>
  )
}
