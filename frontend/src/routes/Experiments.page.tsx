import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
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
  IconInfoCircle,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import {
  type Experiment,
  getExperimentStatus,
  newExperiment,
  type Process,
  type ProcessStep,
  useAppContext,
} from "../store/AppContext"

// ─────────────────────────────────────────────────────────────────────────────
// Edit SubstrateName Generator (simplified display above table)
// ─────────────────────────────────────────────────────────────────────────────

function SubstrateNameGenerator({
  experiment,
  onUpdate,
}: {
  experiment: Experiment
  onUpdate: (exp: Experiment) => void
}) {
  const [generatorName, setGeneratorName] = useState("substrate")

  const handleAddOne = () => {
    const newSubstrates = [
      ...experiment.substrates,
      {
        id: crypto.randomUUID(),
        name: `${generatorName}_${experiment.substrates.length + 1}`,
      },
    ]
    onUpdate({ ...experiment, substrates: newSubstrates })
  }

  const handleAddMultiple = () => {
    modals.openConfirmModal({
      title: "Add Multiple Substrates",
      children: (
        <Stack gap="md">
          <NumberInput
            label="How many substrates to add?"
            defaultValue={5}
            min={1}
            max={100}
            id="substrate-count-input"
          />
        </Stack>
      ),
      labels: { confirm: "Add", cancel: "Cancel" },
      confirmProps: { color: "blue" },
      onConfirm: () => {
        const input = document.getElementById(
          "substrate-count-input",
        ) as HTMLInputElement
        const count = parseInt(input?.value || "5", 10)
        const newSubstrates = [
          ...experiment.substrates,
          ...Array.from({ length: count }, (_, i) => ({
            id: crypto.randomUUID(),
            name: `${generatorName}_${experiment.substrates.length + i + 1}`,
          })),
        ]
        onUpdate({ ...experiment, substrates: newSubstrates })
      },
    })
  }

  return (
    <Paper withBorder p="md" radius="md" mb="md">
      <Group justify="space-between" align="flex-end">
        <Box style={{ flex: 1 }}>
          <Text size="sm" fw={600} mb="xs">
            Substrate Name Generator
          </Text>
          <Group gap="sm" align="flex-end">
            <TextInput
              label="Name Prefix"
              placeholder="e.g. substrate"
              size="sm"
              value={generatorName}
              onChange={(e) => setGeneratorName(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 200 }}
            />
            <Button
              size="sm"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={handleAddOne}
            >
              Add 1
            </Button>
            <Button
              size="sm"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={handleAddMultiple}
            >
              Add Multiple
            </Button>
          </Group>
        </Box>
        <Text size="xs" c="dimmed">
          Total: {experiment.substrates.length}
        </Text>
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
  onSelect,
}: {
  alternatives: ProcessStep[]
  selectedStepId: string | undefined | null
  onSelect: (stepId: string | null) => void
}) {
  const data = [
    { value: "SKIP", label: "Skip this step" },
    ...alternatives.map((step) => ({
      value: step.id,
      label: step.name,
    })),
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
      value={selectedStepId || "SKIP"}
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
  onUpdate,
}: {
  experiment: Experiment
  process: Process
  onUpdate: (exp: Experiment) => void
}) {
  // Store selected steps per substrate per stage: { [substrateId]: { [stageIndex]: stepId | null } }
  const [selectedSteps, setSelectedSteps] = useState<
    { [subId: string]: { [stageIdx: number]: string | null } }
  >({})

  // Initialize selectedSteps from experiment data if available
  useEffect(() => {
    const initial: typeof selectedSteps = {}
    experiment.substrates.forEach((sub) => {
      initial[sub.id] = {}
      // You could load from experiment.parameterValues or similar
    })
    setSelectedSteps(initial)
  }, [experiment])

  const handleStepSelect = (
    substrateId: string,
    stageIndex: number,
    stepId: string | null,
  ) => {
    setSelectedSteps((prev) => {
      const newStages = { ...prev[substrateId], [stageIndex]: stepId }
      return {
        ...prev,
        [substrateId]: newStages,
      }
    })
  }

  const handleRemoveSubstrate = (substrateId: string) => {
    const newSubstrates = experiment.substrates.filter(
      (s) => s.id !== substrateId,
    )
    onUpdate({ ...experiment, substrates: newSubstrates })
  }

  return (
    <Box style={{ overflowX: "auto", marginBottom: "2rem" }}>
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
              {/* Substrate name column */}
              <td
                style={{
                  padding: "12px 8px",
                  fontWeight: 500,
                  background: "var(--mantine-color-gray-0)",
                }}
              >
                {substrate.name}
              </td>

              {/* Step selector columns */}
              {process.stages.map((stage, stageIdx) => (
                <td
                  key={`${substrate.id}-stage-${stageIdx}`}
                  style={{
                    padding: "8px 4px",
                  }}
                >
                  <ProcessStepSelector
                    alternatives={stage.alternatives}
                    selectedStepId={
                      selectedSteps[substrate.id]?.[stageIdx] ?? null
                    }
                    onSelect={(stepId) =>
                      handleStepSelect(substrate.id, stageIdx, stepId)
                    }
                  />
                </td>
              ))}

              {/* Remove button */}
              <td
                style={{
                  padding: "8px 4px",
                  textAlign: "center",
                }}
              >
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {experiment.substrates.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          No substrates added. Use the generator above to add substrates.
        </Text>
      )}
    </Box>
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
  } = useAppContext()

  const [selectedExpId, setSelectedExpId] = useState<string | null>(null)
  const [recipeModalOpen, setRecipeModalOpen] = useState(false)

  const selectedExperiment = experiments.find((e) => e.id === selectedExpId)
  const selectedProcess =
    selectedExperiment && processes.find((p) => p.id === selectedExperiment.processId)

  // Create new experiment
  const handleNewExperiment = () => {
    // Create with temporary processId, will be set via modal
    const newExp = newExperiment("") // Will update after recipe selection
    setExperiments((prev) => [...prev, newExp])
    setSelectedExpId(newExp.id)
    setRecipeModalOpen(true)
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

  return (
    <Group gap={0} align="flex-start" style={{ height: "100%" }}>
      {/* Left Sidebar - Experiment List */}
      <Box
        style={{
          width: "20%",
          minWidth: 250,
          background: "var(--mantine-color-gray-0)",
          borderRight: "1px solid var(--mantine-color-gray-2)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <Stack gap="sm" p="md" style={{ flex: 1, overflowY: "auto" }}>
          <Button
            fullWidth
            leftSection={<IconPlus size={16} />}
            onClick={handleNewExperiment}
          >
            New Experiment
          </Button>

          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Experiments ({experiments.length})
          </Text>

          <Stack gap="xs">
            {experiments.map((exp) => {
              const status = getExperimentStatus(exp)
              const isSelected = exp.id === selectedExpId

              return (
                <Paper
                  key={exp.id}
                  p="sm"
                  withBorder
                  style={{
                    cursor: "pointer",
                    background: isSelected
                      ? "var(--mantine-color-blue-0)"
                      : undefined,
                    borderColor: isSelected ? "var(--mantine-color-blue-3)" : undefined,
                  }}
                  onClick={() => setSelectedExpId(exp.id)}
                >
                  <Group justify="space-between" gap="xs" mb={4}>
                    <Text
                      size="sm"
                      fw={isSelected ? 600 : 500}
                      lineClamp={1}
                      style={{ flex: 1 }}
                    >
                      {exp.name || "Unnamed"}
                    </Text>
                    {status === "finished" && (
                      <Badge size="xs" color="green">
                        Done
                      </Badge>
                    )}
                    {status === "ready" && (
                      <Badge size="xs" color="blue">
                        Ready
                      </Badge>
                    )}
                    {status === "incomplete" && (
                      <Badge size="xs" color="yellow">
                        Draft
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {exp.date}
                  </Text>
                  {isSelected && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      fullWidth
                      mt="xs"
                      leftSection={<IconTrash size={12} />}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteExperiment(exp.id)
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </Paper>
              )
            })}
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
              <Box style={{ flex: 1 }}>
                <TextInput
                  label="Experiment Name"
                  placeholder="Enter experiment name..."
                  size="lg"
                  value={selectedExperiment.name}
                  onChange={(e) =>
                    handleUpdateExperiment({
                      ...selectedExperiment,
                      name: e.currentTarget.value,
                    })
                  }
                  style={{ marginBottom: "1rem" }}
                />

                <SimpleGrid cols={3} spacing="md">
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

                  <Box>
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                      Recipe
                    </Text>
                    <Group gap="xs">
                      <Text size="sm" fw={500}>
                        {selectedProcess.name}
                      </Text>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setRecipeModalOpen(true)}
                      >
                        Change
                      </Button>
                    </Group>
                  </Box>
                </SimpleGrid>
              </Box>
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
                onUpdate={handleUpdateExperiment}
              />
            </Paper>

            {/* Add Variation Section */}
            <Paper withBorder p="md" radius="md" style={{ background: "var(--mantine-color-blue-0)" }}>
              <Group justify="space-between">
                <Box>
                  <Text size="sm" fw={600} mb="xs">
                    Add Parameter Variation
                  </Text>
                  <Text size="xs" c="dimmed">
                    Create variations for specific parameters across different substrates
                  </Text>
                </Box>
                <Group gap="sm">
                  <Select
                    placeholder="Select step..."
                    searchable
                    data={selectedProcess.stages.flatMap((stage, idx) =>
                      stage.alternatives.map((step) => ({
                        value: `${idx}:${step.id}`,
                        label: `${idx + 1}. ${step.name}`,
                      })),
                    )}
                    size="sm"
                    style={{ minWidth: 250 }}
                  />
                  <Button size="sm">
                    Add Variation
                  </Button>
                </Group>
              </Group>
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
