import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Container,
  Group,
  NativeSelect,
  rem,
  ScrollArea,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core"
import { modals } from "@mantine/modals"
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconSelector,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { DependencyBlockModal } from "../components/DependencyBlockModal"
import {
  getDependentLocations,
  type MaterialCategory,
  type Material,
  newMaterial,
  useAppContext,
  useEntityCollection,
} from "../store/AppContext"

type Column = {
  key: keyof Material
  label: string
}

const COMMON_COLUMNS: Column[] = [
  { key: "name", label: "Name" },
  { key: "supplier", label: "Supplier" },
  { key: "supplierNumber", label: "Supplier Number" },
  { key: "inventoryLabel", label: "Inventory Label" },
]

const CHEMICAL_COLUMNS: Column[] = [
  ...COMMON_COLUMNS,
  { key: "casNumber", label: "CAS Number" },
  { key: "pubchemCid", label: "PubChem CID" },
  { key: "purity", label: "Purity" },
  { key: "stateAtRt", label: "State at RT" },
]

const COMMERCIAL_MIXTURE_COLUMNS: Column[] = [
  ...COMMON_COLUMNS,
  { key: "casNumber", label: "CAS Number" },
  { key: "pubchemCid", label: "CID Numbers (Components)" },
]

const SUBSTRATE_COLUMNS: Column[] = [
  ...COMMON_COLUMNS,
  { key: "substrateRigidity", label: "Flexible / Rigid" },
]

const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  chemical_compound: "Chemical Compounds",
  commercial_mixture: "Commercial Mixtures",
  substrate_material: "Substrate Materials",
}

const CATEGORY_ADD_LABEL: Record<MaterialCategory, string> = {
  chemical_compound: "Add Compound",
  commercial_mixture: "Add Com. Mixture",
  substrate_material: "Add Substrate Material",
}

const CATEGORY_COLUMNS: Record<MaterialCategory, Column[]> = {
  chemical_compound: CHEMICAL_COLUMNS,
  commercial_mixture: COMMERCIAL_MIXTURE_COLUMNS,
  substrate_material: SUBSTRATE_COLUMNS,
}

const ALL_FREE_TEXT_KEYS: Array<keyof Material> = [
  "name",
  "supplier",
  "supplierNumber",
  "casNumber",
  "pubchemCid",
  "inventoryLabel",
  "purity",
]

type SortState = { key: keyof Material; direction: "asc" | "desc" } | null

function SortIcon({
  sorted,
  direction,
}: {
  sorted: boolean
  direction: "asc" | "desc"
}) {
  if (!sorted) {
    return <IconSelector size={14} />
  }
  return direction === "asc" ? (
    <IconChevronUp size={14} />
  ) : (
    <IconChevronDown size={14} />
  )
}

export function MaterialsPage() {
  const {
    materials,
    setMaterials,
    setProcesses,
    solutions,
    experiments,
    processes,
    planes,
    updateElement,
    removeCollectionRefs,
    pendingCollectionLink,
    setPendingCollectionLink,
    activeCollectionId,
    activePlaneId,
    activeEntity,
    setActiveEntity,
  } = useAppContext()
  const { getEntityColor, isEntityVisible, getEntityCollection } =
    useEntityCollection()
  const [sort, setSort] = useState<SortState>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuffer, setEditBuffer] = useState<Material | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(
    null,
  )
  const processedPendingRequestIdsRef = useRef<Set<string>>(new Set())
  const returnToRef = useRef<string | null>(null)
  const returnToProcessIdRef = useRef<string | null>(null)
  const navigate = useNavigate()

  const selectMaterial = (id: string | null) => {
    setSelectedMaterialId(id)
  }

  const startEdit = (m: Material) => {
    setEditingId(m.id)
    setEditBuffer({ ...m })
  }

  useEffect(() => {
    if (!editingId) {
      if (activeEntity?.kind === "material") {
        return
      }
      setActiveEntity(null)
      return
    }

    const editingMaterial = materials.find((m) => m.id === editingId)
    if (!editingMaterial || !isEntityVisible("material", editingId)) {
      setEditingId(null)
      setEditBuffer(null)
      setActiveEntity(null)
      return
    }

    if (activeEntity?.kind !== "material" || activeEntity.id !== editingId) {
      setActiveEntity({ kind: "material", id: editingId })
    }
  }, [activeEntity, editingId, isEntityVisible, materials, setActiveEntity])

  useEffect(() => {
    if (activeEntity?.kind !== "material") {
      return
    }
    if (editingId === activeEntity.id) {
      return
    }
    const material = materials.find((m) => m.id === activeEntity.id)
    if (!material || !isEntityVisible("material", material.id)) {
      return
    }
    setSelectedMaterialId(material.id)
    setSelected((prev) => {
      const next = new Set(prev)
      next.add(material.id)
      return next
    })
    setEditingId(null)
    setEditBuffer(null)
    setActiveEntity(null)
  }, [activeEntity, editingId, isEntityVisible, materials, setActiveEntity])

  // Auto-create material + link to collection when navigated from action bubble
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (!pendingCollectionLink || pendingCollectionLink.kind !== "material") {
      return
    }
    if (
      processedPendingRequestIdsRef.current.has(pendingCollectionLink.requestId)
    ) {
      return
    }
    processedPendingRequestIdsRef.current.add(pendingCollectionLink.requestId)

    const { collectionId, planeId, materialCategory, processAttachment, returnTo } = pendingCollectionLink
    setPendingCollectionLink(null)

    if (returnTo) returnToRef.current = returnTo
    if (returnTo && processAttachment?.processId) {
      returnToProcessIdRef.current = processAttachment.processId
    }

    const m = newMaterial(materialCategory)
    setMaterials((prev) => [...prev, m])

    if (processAttachment) {
      setProcesses((prev) =>
        prev.map((process) => {
          if (process.id !== processAttachment.processId) {
            return process
          }
          if (processAttachment.target === "substrate") {
            const substrateIds = process.substrateIds ?? []
            return substrateIds.includes(m.id)
              ? process
              : { ...process, substrateIds: [...substrateIds, m.id] }
          }
          if (processAttachment.target === "step-material" && processAttachment.stepId) {
            return {
              ...process,
              stages: process.stages.map((stage) => ({
                ...stage,
                alternatives: stage.alternatives.map((step) =>
                  step.id === processAttachment.stepId
                    ? { ...step, materialId: m.id, solutionId: undefined }
                    : step,
                ),
              })),
            }
          }
          return process
        }),
      )
    }

    const plane = planes.find((p) => p.id === planeId)
    if (plane) {
      const col = plane.elements.find((e) => e.id === collectionId)
      if (col && col.type === "collection") {
        const updated = {
          ...col,
          refs: [...col.refs, { kind: "material" as const, id: m.id }],
        }
        updateElement(planeId, updated)
      }
    }

    startEdit(m)
  }, [])

  const toggleSort = (key: keyof Material) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" }
      }
      return { key, direction: "asc" }
    })
  }

  const sorted = [...materials]
    .filter((m) => isEntityVisible("material", m.id))
    .sort((a, b) => {
      if (!sort) {
        return 0
      }
      const av = String(a[sort.key] ?? "").toLowerCase()
      const bv = String(b[sort.key] ?? "").toLowerCase()
      const cmp = av.localeCompare(bv)
      return sort.direction === "asc" ? cmp : -cmp
    })

  const groupedByCategory = useMemo(() => {
    return {
      chemical_compound: sorted.filter(
        (m) => (m.category ?? "chemical_compound") === "chemical_compound",
      ),
      commercial_mixture: sorted.filter(
        (m) => (m.category ?? "chemical_compound") === "commercial_mixture",
      ),
      substrate_material: sorted.filter(
        (m) => (m.category ?? "chemical_compound") === "substrate_material",
      ),
    }
  }, [sorted])

  const copyMaterial = (m: Material) => {
    const copied: Material = {
      ...m,
      id: crypto.randomUUID(),
      name: `Copy of ${m.name}`,
    }
    setMaterials((prev) => [...prev, copied])
    const owner = getEntityCollection("material", m.id)
    if (owner) {
      updateElement(owner.plane.id, {
        ...owner.collection,
        refs: [...owner.collection.refs, { kind: "material" as const, id: copied.id }],
      })
    }
    startEdit(copied)
  }

  const deleteMaterial = (id: string) => {
    const mat = materials.find((m) => m.id === id)
    const dependents = getDependentLocations("material", id, {
      solutions,
      experiments,
      processes,
      planes,
    })
    if (dependents.length > 0) {
      modals.open({
        title: "Cannot delete material",
        children: (
          <DependencyBlockModal
            itemName={mat?.name ?? id}
            dependents={dependents}
          />
        ),
      })
      return
    }
    modals.openConfirmModal({
      title: "Delete material",
      children: (
        <Text size="sm">
          Are you sure you want to delete the material "{mat?.name || id}"? This
          cannot be undone.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        setMaterials((prev) => prev.filter((m) => m.id !== id))
        removeCollectionRefs("material", [id])
        if (selectedMaterialId === id) {
          selectMaterial(null)
        }
      },
    })
  }

  const addMaterial = (category: MaterialCategory) => {
    const m = newMaterial(category)
    setMaterials((prev) => [...prev, m])
    // Link to active collection if one is selected
    if (activeCollectionId && activePlaneId) {
      const plane = planes.find((p) => p.id === activePlaneId)
      if (plane) {
        const col = plane.elements.find((e) => e.id === activeCollectionId)
        if (col && col.type === "collection") {
          updateElement(activePlaneId, {
            ...col,
            refs: [...col.refs, { kind: "material" as const, id: m.id }],
          })
        }
      }
    }
    startEdit(m)
  }

  const commitEdit = () => {
    if (!editBuffer) {
      return
    }
    if (!(editBuffer.name ?? "").trim()) {
      cancelEdit(editBuffer.id)
      return
    }
    setMaterials((prev) =>
      prev.map((m) => (m.id === editBuffer.id ? editBuffer : m)),
    )
    setEditingId(null)
    setEditBuffer(null)
    if (returnToRef.current) {
      const route = returnToRef.current
      const processId = returnToProcessIdRef.current
      returnToRef.current = null
      returnToProcessIdRef.current = null
      if (processId) setActiveEntity({ kind: "process", id: processId })
      void navigate({ to: route as never })
    }
  }

  const cancelEdit = (id: string) => {
    const original = materials.find((m) => m.id === id)
    if (original && !(original.name ?? "").trim()) {
      // Row has no name — remove it
      setMaterials((prev) => prev.filter((m) => m.id !== id))
      removeCollectionRefs("material", [id])
    }
    setEditingId(null)
    setEditBuffer(null)
  }

  const confirmDelete = () => {
    // Build dependency report for all selected materials
    const depReport: { materialName: string; count: number }[] = []
    for (const id of selected) {
      const mat = materials.find((m) => m.id === id)
      const dependents = getDependentLocations("material", id, {
        solutions,
        experiments,
        processes,
        planes,
      })
      if (dependents.length > 0) {
        depReport.push({
          materialName: mat?.name || id,
          count: dependents.length,
        })
      }
    }
    if (depReport.length > 0) {
      // Collect all dependents for the first blocked material and show a blocking modal
      const firstBlockedId = [...selected].find(
        (id) =>
          getDependentLocations("material", id, {
            solutions,
            experiments,
            processes,
            planes,
          }).length > 0,
      )!
      const firstMat = materials.find((m) => m.id === firstBlockedId)
      const firstDeps = getDependentLocations("material", firstBlockedId, {
        solutions,
        experiments,
        processes,
        planes,
      })
      modals.open({
        title: "Cannot delete material",
        children: (
          <DependencyBlockModal
            itemName={firstMat?.name ?? firstBlockedId}
            dependents={firstDeps}
          />
        ),
      })
      return
    }
    modals.openConfirmModal({
      title: "Delete materials",
      children: (
        <Text size="sm">
          Are you sure you want to delete {selected.size} material
          {selected.size > 1 ? "s" : ""}? This cannot be undone.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        const deletedIds = [...selected]
        setMaterials((prev) => prev.filter((m) => !selected.has(m.id)))
        removeCollectionRefs("material", deletedIds)
        setSelected(new Set())
        if (selectedMaterialId && selected.has(selectedMaterialId)) {
          selectMaterial(null)
        }
      },
    })
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const renderCellEditor = (material: Material, colKey: keyof Material) => {
    if (!editBuffer) {
      return null
    }
    if (colKey === "stateAtRt") {
      return (
        <NativeSelect
          size="xs"
          value={editBuffer.stateAtRt}
          data={[
            { label: "", value: "" },
            { label: "liquid", value: "liquid" },
            { label: "solid", value: "solid" },
            { label: "gas", value: "gas" },
          ]}
          onChange={(e) => {
            const value = e.currentTarget.value as Material["stateAtRt"]
            setEditBuffer((prev) => (prev ? { ...prev, stateAtRt: value } : prev))
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitEdit()
            }
            if (e.key === "Escape") {
              cancelEdit(material.id)
            }
          }}
        />
      )
    }
    if (colKey === "substrateRigidity") {
      return (
        <NativeSelect
          size="xs"
          value={editBuffer.substrateRigidity}
          data={[
            { label: "", value: "" },
            { label: "Flexible", value: "flexible" },
            { label: "Rigid", value: "rigid" },
          ]}
          onChange={(e) => {
            const value = e.currentTarget.value as Material["substrateRigidity"]
            setEditBuffer((prev) =>
              prev ? { ...prev, substrateRigidity: value } : prev,
            )
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitEdit()
            }
            if (e.key === "Escape") {
              cancelEdit(material.id)
            }
          }}
        />
      )
    }
    return (
      <TextInput
        size="xs"
        value={String(editBuffer[colKey] ?? "")}
        onChange={(e) => {
          const value = e.currentTarget.value
          setEditBuffer((prev) => (prev ? { ...prev, [colKey]: value } : prev))
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitEdit()
          }
          if (e.key === "Escape") {
            cancelEdit(material.id)
          }
        }}
        autoFocus={colKey === "type" || colKey === "name"}
      />
    )
  }

  const renderMaterialRow = (
    material: Material,
    categoryColumns: Column[],
  ) => {
    const isEditing = editingId === material.id
    return (
      <Table.Tr
        key={material.id}
        bg={
          selected.has(material.id)
            ? "var(--mantine-color-blue-light)"
            : undefined
        }
        onClick={() => selectMaterial(material.id)}
        style={{ cursor: "pointer" }}
      >
        <Table.Td
          style={{
            padding: 0,
            width: 6,
            minWidth: 6,
            background:
              getEntityColor("material", material.id) ?? "transparent",
          }}
        />
        <Table.Td>
          <input
            type="checkbox"
            checked={selected.has(material.id)}
            onChange={() => toggleSelect(material.id)}
          />
        </Table.Td>
        {categoryColumns.map((col) => (
          <Table.Td key={col.key}>
            {isEditing && editBuffer ? (
              renderCellEditor(material, col.key)
            ) : (
              <Text size="sm">
                {String(material[col.key] ?? "") || (
                  <Text span c="dimmed" size="sm">
                    —
                  </Text>
                )}
              </Text>
            )}
          </Table.Td>
        ))}
        <Table.Td>
          <Group gap={4} justify="center">
            {isEditing ? (
              <>
                <Tooltip label="Save">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="green"
                    onClick={commitEdit}
                  >
                    <IconCheck size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Cancel">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => cancelEdit(material.id)}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip label="Edit">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="blue"
                    onClick={() => startEdit(material)}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Duplicate">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="teal"
                    onClick={() => copyMaterial(material)}
                  >
                    <IconCopy size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => deleteMaterial(material.id)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
          </Group>
        </Table.Td>
      </Table.Tr>
    )
  }

  const renderCategoryTable = (category: MaterialCategory) => {
    const columns = CATEGORY_COLUMNS[category]
    const items = groupedByCategory[category]

    return (
      <Box key={category}>
        <Group justify="space-between" mb="xs" mt="md">
          <Title order={4}>{CATEGORY_LABEL[category]}</Title>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => addMaterial(category)}
            disabled={!activeCollectionId}
            size="xs"
          >
            {CATEGORY_ADD_LABEL[category]}
          </Button>
        </Group>

        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            stickyHeader
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ padding: 0, width: 6 }} />
                <Table.Th style={{ width: rem(36) }} />
                {columns.map((col) => (
                  <Table.Th key={`${category}-${col.key}`}>
                    <UnstyledButton
                      onClick={() => toggleSort(col.key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: rem(4),
                      }}
                    >
                      <Text fw={600} size="sm">
                        {col.label}
                      </Text>
                      <SortIcon
                        sorted={sort?.key === col.key}
                        direction={
                          sort?.key === col.key ? sort.direction : "asc"
                        }
                      />
                    </UnstyledButton>
                  </Table.Th>
                ))}
                <Table.Th style={{ width: rem(130) }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={columns.length + 3}>
                    <Text c="dimmed" ta="center" py="md">
                      No {CATEGORY_LABEL[category].toLowerCase()} in the selected
                      collection.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                items.map((material) => renderMaterialRow(material, columns))
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
    )
  }

  return (
    <Container fluid>
      <Group justify="space-between" mb="md" mt="md">
        <Title order={2}>Materials</Title>
        <Group>
          {selected.size > 0 && (
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              variant="light"
              onClick={confirmDelete}
            >
              Delete ({selected.size})
            </Button>
          )}
        </Group>
      </Group>

      {!activeCollectionId && (
        <Alert icon={<IconInfoCircle size={16} />} color="blue" mb="md">
          Select or create a collection in the Organization tab to add
          materials.
        </Alert>
      )}

      {renderCategoryTable("chemical_compound")}
      {renderCategoryTable("commercial_mixture")}
      {renderCategoryTable("substrate_material")}

      {materials.length > 0 && (
        <Box mt="xs">
          <Text size="xs" c="dimmed">
            {materials.length} material{materials.length > 1 ? "s" : ""}
          </Text>
        </Box>
      )}
    </Container>
  )
}
