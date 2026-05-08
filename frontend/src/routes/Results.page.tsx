import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  useMantineTheme,
} from "@mantine/core"
import { Dropzone, MIME_TYPES } from "@mantine/dropzone"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClipboard,
  IconCloudUpload,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFlask,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { OpenAPI } from "../client/core/OpenAPI"
import { NomadService } from "../client/sdk.gen"
import type {
  NomadConfigResponse,
  NomadUploadRequest,
  NomadUploadResponse,
} from "../client/types.gen"
import {
  type CanvasCollectionElement,
  type DeviceGroup,
  type Experiment,
  type ExperimentResults,
  getExperimentStatus,
  type Material,
  type MeasurementFile,
  type MeasurementType,
  newExperimentResults,
  newMeasurementFile,
  useAppContext,
  useEntityCollection,
} from "../store/AppContext"

// ─────────────────────────────────────────────────────────────────────────────
// File Parsing Utilities (ported from Streamlit app)
// ─────────────────────────────────────────────────────────────────────────────

/** Get file category based on extension */
function getFileCategory(fileName: string): MeasurementType | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".txt")) {
    return "Unknown"
  } // Will be determined by content
  if (lower.match(/\.(png|jpg|jpeg|tiff|tif|gif|webp)$/)) {
    return "Image"
  }
  if (lower.match(/\.(pdf|docx?|odt|rtf)$/)) {
    return "Document"
  }
  if (lower.match(/\.(zip|7z|rar|tar|gz)$/)) {
    return "Archive"
  }
  return null
}

/** Extract device name from filename */
function extractDeviceFromFilename(fileName: string): string {
  // Remove extension
  const baseName = fileName.replace(/\.[^/.]+$/, "")

  // Pattern 1: Two uppercase letters followed by 2-3 digits anywhere in the
  // name (e.g. "AI44" inside "2025-11-19_AI44-1C"). Matches the primary
  // substrate-ID convention used in the lab.
  const match1 = baseName.match(/\b([A-Z]{2}\d{2,3})\b/)
  if (match1) {
    return match1[1]
  }

  // Pattern 2: Word containing letters-then-digits at start of basename
  // (e.g. "Device01")
  const match2 = baseName.match(/^([A-Za-z]+\d+)/)
  if (match2) {
    return match2[1].toUpperCase()
  }

  // Pattern 3: Anything before the first underscore or dash
  const match3 = baseName.match(/^([^_\-\s]+)/)
  if (match3) {
    return match3[1]
  }

  return baseName
}

/** Parse device name supporting formats like "AI44-1C" or "3C_C1_2" */
function parseDeviceName(deviceString: string): {
  device: string
  cell: string
  pixel: string
} {
  if (!deviceString) {
    return { device: "", cell: "", pixel: "" }
  }

  const trimmed = deviceString.trim()

  // New format: "AI44-1C"
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-")
    if (parts.length === 2) {
      const device = parts[0]
      const tail = parts[1]
      const cell = tail.replace(/[^0-9]/g, "")
      const pixel = tail.replace(/[^A-Za-z]/g, "").toUpperCase()
      return { device, cell, pixel }
    }
  }

  // Old format: "3C_C1_2"
  const parts = trimmed.split("_")
  if (parts.length >= 3) {
    return {
      device: parts.slice(0, -2).join("_"),
      cell: parts[parts.length - 2],
      pixel: parts[parts.length - 1],
    }
  }
  if (parts.length === 2) {
    return { device: parts[0], cell: "", pixel: parts[1] }
  }

  return { device: trimmed, cell: "", pixel: "" }
}

/** Parse .txt file content to determine measurement type and extract data */
function parseTxtContent(
  content: string,
  fileName: string,
): Partial<MeasurementFile> {
  const lines = content.split("\n").map((l) => l.trim())

  let measurementType: MeasurementType = "Document"
  let value: number | undefined
  let deviceName = ""
  let user = ""
  let measurementDate = ""

  for (const line of lines) {
    const lower = line.toLowerCase()

    // Detect JV measurement
    if (
      lower.includes("jv") ||
      lower.includes("i-v") ||
      lower.includes("current-voltage")
    ) {
      measurementType = "JV"
    }
    // Detect Dark JV
    if (
      lower.includes("dark") &&
      (lower.includes("jv") || lower.includes("i-v"))
    ) {
      measurementType = "Dark JV"
    }
    // Detect IPCE
    if (
      lower.includes("ipce") ||
      lower.includes("eqe") ||
      lower.includes("quantum efficiency")
    ) {
      measurementType = "IPCE"
    }
    // Detect Stability measurements
    if (lower.includes("stability")) {
      if (lower.includes("tracking") || lower.includes("mpp")) {
        measurementType = "Stability (Tracking)"
      } else if (lower.includes("parameter")) {
        measurementType = "Stability (Parameters)"
      } else {
        measurementType = "Stability (JV)"
      }
    }

    // Extract PCE value
    const pceMatch = line.match(/pce[:\s]*(\d+\.?\d*)\s*%?/i)
    if (pceMatch) {
      value = parseFloat(pceMatch[1])
    }

    // Extract device name
    const deviceMatch = line.match(/device[:\s]*([^\s,]+)/i)
    if (deviceMatch) {
      deviceName = deviceMatch[1]
    }

    // Extract user
    const userMatch = line.match(/user[:\s]*([^\s,]+)/i)
    if (userMatch) {
      user = userMatch[1]
    }

    // Extract date
    const dateMatch = line.match(/date[:\s]*(\d{4}[-/]\d{2}[-/]\d{2})/i)
    if (dateMatch) {
      measurementDate = dateMatch[1]
    }
  }

  // If no device found in content, extract from filename
  if (!deviceName) {
    deviceName = extractDeviceFromFilename(fileName)
  }

  return {
    fileType: measurementType,
    deviceName,
    value,
    user,
    measurementDate,
  }
}

/** Compute similarity score between two strings (0-1) */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim().toLowerCase()
  const s2 = str2.trim().toLowerCase()

  if (s1 === s2) {
    return 1
  }
  if (s1.length === 0 || s2.length === 0) {
    return 0
  }

  // Simple Levenshtein-based similarity
  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1

  if (longer.includes(shorter)) {
    return shorter.length / longer.length
  }

  // Count matching characters in order
  let matches = 0
  let j = 0
  for (let i = 0; i < longer.length && j < shorter.length; i++) {
    if (longer[i] === shorter[j]) {
      matches++
      j++
    }
  }

  return (2 * matches) / (s1.length + s2.length)
}

// ─────────────────────────────────────────────────────────────────────────────
// Experiment List Item (read-only version)
// ─────────────────────────────────────────────────────────────────────────────

function ExperimentListItem({
  experiment,
  isSelected,
  onSelect,
  collectionColor,
}: {
  experiment: Experiment
  isSelected: boolean
  onSelect: () => void
  collectionColor?: string
}) {
  const status = getExperimentStatus(experiment)
  const statusColor =
    status === "finished" ? "green" : status === "ready" ? "yellow" : "red"
  const statusLabel =
    status === "finished"
      ? "Finished"
      : status === "ready"
        ? "Ready"
        : "Incomplete"

  return (
    <Paper
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
      onClick={onSelect}
    >
      <Group justify="space-between" wrap="nowrap">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text size="sm" fw={600} truncate>
              {experiment.name || "Untitled"}
            </Text>
            <Badge size="xs" color={statusColor} variant="dot">
              {statusLabel}
            </Badge>
          </Group>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              {experiment.date || "No date"}
            </Text>
            <Text size="xs" c="dimmed">
              •
            </Text>
            <Text size="xs" c="dimmed">
              {experiment.substrates.length} substrate
              {experiment.substrates.length !== 1 ? "s" : ""}
            </Text>
          </Group>
        </Box>
      </Group>
    </Paper>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// File Type Badge
// ─────────────────────────────────────────────────────────────────────────────

function FileTypeBadge({ type }: { type: MeasurementType }) {
  const colors: Record<MeasurementType, string> = {
    JV: "blue",
    "Dark JV": "indigo",
    IPCE: "cyan",
    "Stability (JV)": "teal",
    "Stability (Tracking)": "green",
    "Stability (Parameters)": "lime",
    Document: "gray",
    Image: "orange",
    Archive: "violet",
    Unknown: "gray",
  }

  return (
    <Badge size="xs" color={colors[type]} variant="light">
      {type}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Substrate Card - Shows matched files for a specific substrate
// ─────────────────────────────────────────────────────────────────────────────

function SubstrateCard({
  substrate,
  substrateMaterial,
  files,
  onUnmatchFile,
  onDropFile,
  onDropGroup,
  onDragEnter,
  onDragLeave,
  isDropTarget,
  expanded,
  onToggleExpand,
}: {
  substrate: { id: string; name: string; substrateMaterialId?: string }
  substrateMaterial?: Material
  files: MeasurementFile[]
  onUnmatchFile: (fileId: string) => void
  onDropFile: (fileId: string) => void
  onDropGroup: (groupId: string) => void
  onDragEnter: () => void
  onDragLeave: () => void
  isDropTarget: boolean
  expanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      onDragOver={(e) => {
        e.preventDefault()
        onDragEnter()
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        const data = e.dataTransfer.getData("text/plain")
        if (data) {
          // Check if it's a group or file ID
          if (data.startsWith("group:")) {
            const groupId = data.substring(6)
            onDropGroup(groupId)
          } else {
            onDropFile(data)
          }
        }
        onDragLeave()
      }}
      style={{
        borderColor: isDropTarget ? "var(--mantine-color-green-5)" : undefined,
        background: isDropTarget ? "var(--mantine-color-green-0)" : undefined,
      }}
    >
      <Group justify="space-between" mb="xs">
        <Group gap="sm">
          <ActionIcon variant="subtle" size="sm" onClick={onToggleExpand}>
            {expanded ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
          </ActionIcon>
          <div>
            <Text fw={600} size="sm">
              {substrate.name}
            </Text>
            {substrateMaterial && (
              <Text size="xs" c="dimmed">
                ({substrateMaterial.type || substrateMaterial.name})
              </Text>
            )}
          </div>
        </Group>

        <Badge size="xs" variant="light" color={files.length > 0 ? "green" : "gray"}>
          {files.length} file{files.length !== 1 ? "s" : ""}
        </Badge>
      </Group>

      {expanded && files.length > 0 && (
        <Box mt="sm" pl="xl">
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>File</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Cell</Table.Th>
                <Table.Th>Pixel</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {files.map((file) => (
                <Table.Tr 
                  key={file.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", file.id)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  style={{ cursor: "grab" }}
                >
                  <Table.Td style={{ maxWidth: 260 }}>
                    <Tooltip
                      label={file.fileName}
                      position="top-start"
                      withArrow
                      openDelay={300}
                    >
                      <Group
                        gap={4}
                        wrap="nowrap"
                        style={{ overflow: "hidden" }}
                      >
                        <IconFile size={14} style={{ flexShrink: 0 }} />
                        <Text
                          size="xs"
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 220,
                            cursor: "default",
                          }}
                        >
                          {file.fileName}
                        </Text>
                      </Group>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>
                    <FileTypeBadge type={file.fileType} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{file.cell || "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{file.pixel || "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {file.value !== undefined
                        ? `${file.value.toFixed(2)}%`
                        : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Move to unmatched" withArrow>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => onUnmatchFile(file.id)}
                      >
                        <IconX size={12} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Paper>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Results Detail View
// ─────────────────────────────────────────────────────────────────────────────

function ResultsDetail({
  experiment,
  experimentResults,
  onUpdateResults,
}: {
  experiment: Experiment
  experimentResults: ExperimentResults | null
  onUpdateResults: (results: ExperimentResults) => void
}) {
  const [expandedSubstrates, setExpandedSubstrates] = useState<Set<string>>(new Set())
  const { materials } = useAppContext()
  const theme = useMantineTheme()

  // NOMAD upload state
  const [nomadConfig, setNomadConfig] = useState<NomadConfigResponse | null>(
    null,
  )
  const [nomadUploading, setNomadUploading] = useState(false)
  const [nomadMetadataPreview, setNomadMetadataPreview] = useState<
    string | null
  >(null)
  const [showMetadataModal, setShowMetadataModal] = useState(false)
  const [fabricationMetadataPreview, setFabricationMetadataPreview] = useState<
    string | null
  >(null)
  const [showFabricationModal, setShowFabricationModal] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [lastArchivePath, setLastArchivePath] = useState<string | null>(null)
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(
    null,
  )

  // Fetch NOMAD config on mount
  useEffect(() => {
    NomadService.getNomadConfig()
      .then(setNomadConfig)
      .catch((err: unknown) =>
        console.warn("Failed to fetch NOMAD config:", err),
      )
  }, [])

  // Load any persisted archive path for this experiment from the session
  useEffect(() => {
    try {
      const key = `nomad_archive:${experiment.id}`
      const v = sessionStorage.getItem(key)
      if (v) setLastArchivePath(v)
    } catch (e) {
      // ignore sessionStorage errors in restrictive environments
    }
  }, [experiment.id])

  const fallbackResults = useMemo(
    () => newExperimentResults(experiment.id),
    [experiment.id],
  )
  const results = experimentResults ?? fallbackResults

  const groupedFileIds = useMemo(() => {
    const ids = new Set<string>()
    for (const group of results.deviceGroups) {
      for (const file of group.files) {
        ids.add(file.id)
      }
    }
    return ids
  }, [results.deviceGroups])

  const ungroupedFiles = useMemo(
    () => results.files.filter((file) => !groupedFileIds.has(file.id)),
    [results.files, groupedFileIds],
  )

  const toggleSubstrateExpand = (substrateId: string) => {
    setExpandedSubstrates((prev) => {
      const next = new Set(prev)
      if (next.has(substrateId)) {
        next.delete(substrateId)
      } else {
        next.add(substrateId)
      }
      return next
    })
  }

  // Group files by device name based on strategy
  const groupFilesByDevice = useCallback(
    (
      files: MeasurementFile[],
      strategy: "exact" | "search" | "fuzzy",
    ): DeviceGroup[] => {
      const groups: DeviceGroup[] = []
      const filesByDevice = new Map<string, MeasurementFile[]>()

      if (strategy === "exact") {
        // Group by exact device name
        for (const file of files) {
          const key = file.deviceName
          const existing = filesByDevice.get(key) ?? []
          existing.push(file)
          filesByDevice.set(key, existing)
        }
      } else if (strategy === "search") {
        // Group by exact device name — same as the Python app's
        // "Search by Device Name" which uses groupby("Device Name").
        // Files are only grouped together when their extracted device name
        // is identical (case-insensitive). Substring inclusion was removed
        // because it caused false merges (e.g. "AI4" folded into "AI44").
        for (const file of files) {
          const key = file.deviceName.toUpperCase()
          const existing = filesByDevice.get(key) ?? []
          existing.push(file)
          filesByDevice.set(key, existing)
        }
      } else {
        // Fuzzy matching - group similar names together
        const assigned = new Set<string>()
        for (const file of files) {
          if (assigned.has(file.id)) {
            continue
          }

          const groupFiles = [file]
          assigned.add(file.id)

          for (const other of files) {
            if (assigned.has(other.id)) {
              continue
            }
            const similarity = stringSimilarity(
              file.deviceName,
              other.deviceName,
            )
            if (similarity > 0.8) {
              groupFiles.push(other)
              assigned.add(other.id)
            }
          }

          const key = file.deviceName || `group-${groups.length}`
          filesByDevice.set(key, groupFiles)
        }
      }

      for (const [deviceName, groupFiles] of filesByDevice.entries()) {
        groups.push({
          id: crypto.randomUUID(),
          deviceName,
          files: groupFiles,
          assignedSubstrateId: null,
        })
      }

      return groups
    },
    [],
  )

  // Match groups to substrates
  const matchGroupsToSubstrates = useCallback(
    (
      groups: DeviceGroup[],
      substrates: { id: string; name: string }[],
      strategy: "fuzzy" | "sequential" | "manual",
    ): DeviceGroup[] => {
      if (strategy === "manual") {
        return groups // No auto-matching
      }

      if (strategy === "sequential") {
        return groups.map((group, idx) => ({
          ...group,
          assignedSubstrateId:
            idx < substrates.length ? substrates[idx].id : null,
          matchScore: idx < substrates.length ? 1 : 0,
        }))
      }

      // Fuzzy matching
      return groups.map((group) => {
        let bestMatch: { id: string; score: number } | null = null

        for (const substrate of substrates) {
          const score = stringSimilarity(group.deviceName, substrate.name)
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { id: substrate.id, score }
          }
        }

        return {
          ...group,
          assignedSubstrateId:
            bestMatch && bestMatch.score > 0.6 ? bestMatch.id : null,
          matchScore: bestMatch?.score ?? 0,
        }
      })
    },
    [],
  )

  // Process dropped files
  const handleDrop = useCallback(
    async (droppedFiles: File[]) => {
      const newFiles: MeasurementFile[] = []

      for (const file of droppedFiles) {
        const measurementFile = newMeasurementFile(file.name)
        const category = getFileCategory(file.name)

        if (category === null) {
          // Unsupported file type, skip
          continue
        }

        if (file.name.toLowerCase().endsWith(".txt")) {
          // Parse text content
          const content = await file.text()
          const parsed = parseTxtContent(content, file.name)
          Object.assign(measurementFile, parsed)

          // Parse device name for cell/pixel
          const { device, cell, pixel } = parseDeviceName(
            measurementFile.deviceName || "",
          )
          if (device) {
            measurementFile.deviceName = device
          }
          if (cell) {
            measurementFile.cell = cell
          }
          if (pixel) {
            measurementFile.pixel = pixel
          }
        } else {
          measurementFile.fileType = category
          measurementFile.deviceName = extractDeviceFromFilename(file.name)
        }

        newFiles.push(measurementFile)
      }

      if (newFiles.length === 0) {
        return
      }

      // Store the actual File objects for NOMAD upload
      setUploadedFiles((prev) => [
        ...prev,
        ...droppedFiles.filter((f) => {
          const category = getFileCategory(f.name)
          return category !== null
        }),
      ])
      ;

      // Upload dropped files to create a temporary archive on the server
      (async () => {
        try {
          const filesToSend = droppedFiles.filter((f) => getFileCategory(f.name) !== null)
          if (filesToSend.length === 0) return

          const form = new FormData()
          form.append("experiment_id", experiment.id)
          form.append("experiment_name", experiment.name)
          for (const f of filesToSend) {
            form.append("files", f)
          }

          const token =
            typeof OpenAPI.TOKEN === "function"
              ? await OpenAPI.TOKEN({} as any)
              : OpenAPI.TOKEN || localStorage.getItem("access_token")

          const res = await fetch(`${OpenAPI.BASE}/api/v1/nomad/upload/files`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: form,
          })

          if (!res.ok) {
            const text = await res.text()
            notifications.show({
              title: "Upload Error",
              message: `Failed to upload files: ${res.status} ${text}`,
              color: "red",
            })
            return
          }

          const data = await res.json()
          // Persist archive path in session state so it survives reloads this session
          if (data?.archive_path) {
            try {
              const key = `nomad_archive:${experiment.id}`
              sessionStorage.setItem(key, data.archive_path)
            } catch (e) {
              // ignore
            }
            setLastArchivePath(data.archive_path)
          }
          notifications.show({
            title: "Files Uploaded",
            message: data.archive_path
              ? `Created archive: ${data.archive_path}`
              : "Files uploaded successfully",
            color: "green",
          })
        } catch (err) {
          console.error("upload files error", err)
          notifications.show({
            title: "Upload Error",
            message: err instanceof Error ? err.message : String(err),
            color: "red",
          })
        }
      })()

      // Group files by device name while preserving existing ungrouped files
      const groupedExistingFiles = results.files.filter((f) =>
        groupedFileIds.has(f.id),
      )
      const allFiles = [...results.files, ...newFiles]
      const deviceGroups = groupFilesByDevice(
        [...groupedExistingFiles, ...newFiles],
        "search",  // Always use search strategy
      )

      // Auto-match to substrates using fuzzy matching
      const matchedGroups = matchGroupsToSubstrates(
        deviceGroups,
        experiment.substrates,
        "fuzzy",  // Always use fuzzy matching
      )

      onUpdateResults({
        ...results,
        files: allFiles,
        deviceGroups: matchedGroups,
        updatedAt: new Date().toISOString(),
      })
    },
    [
      experiment.substrates,
      results,
      groupedFileIds,
      onUpdateResults,
      groupFilesByDevice,
      matchGroupsToSubstrates,
    ],
  )

  // Handle manual assignment of unmatched group to substrate
  const handleAssignGroupToSubstrate = (
    groupId: string,
    substrateId: string,
  ) => {
    const updatedGroups = results.deviceGroups.map((g) =>
      g.id === groupId ? { ...g, assignedSubstrateId: substrateId } : g,
    )

    onUpdateResults({
      ...results,
      deviceGroups: updatedGroups,
      updatedAt: new Date().toISOString(),
    })
  }

  // Move a file from substrate to unmatched
  const handleUnmatchFile = (fileId: string, fromSubstrateId: string) => {
    const updatedGroups = results.deviceGroups.map((g) => {
      if (g.assignedSubstrateId !== fromSubstrateId) return g
      return {
        ...g,
        files: g.files.filter((f) => f.id !== fileId),
      }
    }).filter((g) => g.files.length > 0)

    onUpdateResults({
      ...results,
      deviceGroups: updatedGroups,
      updatedAt: new Date().toISOString(),
    })
  }

  // Assign file from unmatched to substrate
  const handleAssignFileToSubstrate = (fileId: string, substrateId: string) => {
    const file = results.files.find((f) => f.id === fileId)
    if (!file) return

    // Remove from any existing groups
    const withoutFile = results.deviceGroups.map((g) => ({
      ...g,
      files: g.files.filter((f) => f.id !== fileId),
    })).filter((g) => g.files.length > 0)

    // Find or create group for this substrate
    const existingGroup = withoutFile.find((g) => g.assignedSubstrateId === substrateId)
    
    const updatedGroups = existingGroup
      ? withoutFile.map((g) =>
          g.id === existingGroup.id
            ? { ...g, files: [...g.files, file] }
            : g,
        )
      : [
          ...withoutFile,
          {
            id: crypto.randomUUID(),
            deviceName: file.deviceName,
            files: [file],
            assignedSubstrateId: substrateId,
            matchScore: 1,
          },
        ]

    onUpdateResults({
      ...results,
      deviceGroups: updatedGroups,
      updatedAt: new Date().toISOString(),
    })
  }

  const handleClearAll = () => {
    onUpdateResults({
      ...results,
      files: [],
      deviceGroups: [],
      updatedAt: new Date().toISOString(),
    })
  }

  const substrates = experiment.substrates.map((s) => ({
    id: s.id,
    name: s.name,
  }))
  
  // Separate matched groups (assigned to substrates) from unmatched
  const matchedGroups = results.deviceGroups.filter((g) => g.assignedSubstrateId)
  const unmatchedGroups = results.deviceGroups.filter((g) => !g.assignedSubstrateId)
  
  // Get files for each substrate
  const getSubstrateFiles = (substrateId: string) => {
    const groups = matchedGroups.filter((g) => g.assignedSubstrateId === substrateId)
    return groups.flatMap((g) => g.files)
  }
  
  const totalMatchedFiles = matchedGroups.reduce((sum, g) => sum + g.files.length, 0)
  const totalUnmatchedFiles = unmatchedGroups.reduce((sum, g) => sum + g.files.length, 0) + ungroupedFiles.length
  const allFilesMatched = results.files.length > 0 && ungroupedFiles.length === 0 && unmatchedGroups.length === 0

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Group
        justify="space-between"
        p="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Group gap="sm">
          <Title order={4}>Results for {experiment.name}</Title>
          <Badge color="blue" variant="light">
            {experiment.substrates.length} substrates
          </Badge>
        </Group>
        {results.files.length > 0 && (
          <Button
            size="xs"
            color="red"
            variant="subtle"
            leftSection={<IconTrash size={14} />}
            onClick={handleClearAll}
          >
            Clear All
          </Button>
        )}
      </Group>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="lg">
          {/* Drop Zone */}
          <Dropzone
            onDrop={handleDrop}
            accept={[
              MIME_TYPES.png,
              MIME_TYPES.jpeg,
              MIME_TYPES.gif,
              "text/plain",
              "application/pdf",
              "application/msword",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/zip",
              "application/x-7z-compressed",
              "image/tiff",
            ]}
            maxSize={50 * 1024 ** 2}
            style={{
              borderStyle: "dashed",
              borderWidth: 2,
              borderColor:
                results.files.length > 0
                  ? "var(--mantine-color-green-4)"
                  : "var(--mantine-color-gray-4)",
              background:
                results.files.length > 0
                  ? "var(--mantine-color-green-0)"
                  : "var(--mantine-color-gray-0)",
            }}
          >
            <Group
              justify="center"
              gap="xl"
              mih={120}
              style={{ pointerEvents: "none" }}
            >
              <Dropzone.Accept>
                <IconUpload
                  size={48}
                  color={theme.colors.blue[6]}
                  stroke={1.5}
                />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={48} color={theme.colors.red[6]} stroke={1.5} />
              </Dropzone.Reject>
              <Dropzone.Idle>
                {results.files.length > 0 ? (
                  <IconCheck
                    size={48}
                    color={theme.colors.green[6]}
                    stroke={1.5}
                  />
                ) : (
                  <IconUpload
                    size={48}
                    color={theme.colors.gray[4]}
                    stroke={1.5}
                  />
                )}
              </Dropzone.Idle>

              <div>
                <Text size="lg" inline fw={500}>
                  {results.files.length > 0
                    ? `${results.files.length} files uploaded`
                    : "Drop Results here"}
                </Text>
                <Text size="sm" c="dimmed" inline mt={7}>
                  {results.files.length > 0
                    ? "Drop more files to add them"
                    : "Drag & drop measurement files (.txt, images, documents)"}
                </Text>
              </div>
            </Group>
          </Dropzone>

          {lastArchivePath && (
            <Text size="xs" c="dimmed" mt={8}>
              Last created archive: {lastArchivePath}
            </Text>
          )}

          {results.files.length > 0 && (
            <>
              {/* User Instructions */}
              <Alert color="blue" radius="md" title="Review Automatic Assignments">
                <Text size="sm">
                  Files have been automatically grouped by device name and matched to substrates. 
                  <Text span fw={600}> Check that automatic substrate assignments are correct.</Text>
                </Text>
              </Alert>

              {/* Unmatched Files Warning - Only show if there are unmatched items */}
              {totalUnmatchedFiles > 0 && (
                <Alert color="red" radius="md" title="Action Required">
                  <Text size="sm">
                    <Text span fw={600}>
                      {totalUnmatchedFiles} file{totalUnmatchedFiles !== 1 ? 's' : ''} need{totalUnmatchedFiles === 1 ? 's' : ''} to be assigned.
                    </Text>
                    {" "}Drag and drop files or groups from left to right, or use assignment dropdowns to associate them with substrates.
                  </Text>
                </Alert>
              )}

              {/* Summary */}
              <Paper
                withBorder
                p="sm"
                radius="md"
                style={{ background: "var(--mantine-color-blue-0)" }}
              >
                <Group justify="space-between">
                  <Group gap="lg">
                    <Group gap="xs">
                      <Text size="sm" fw={600}>
                        Total Files:
                      </Text>
                      <Text size="sm">{results.files.length}</Text>
                    </Group>
                    <Group gap="xs">
                      <Text size="sm" fw={600}>
                        Matched to Substrates:
                      </Text>
                      <Text
                        size="sm"
                        c={allFilesMatched ? "green" : "orange"}
                      >
                        {totalMatchedFiles} / {results.files.length}
                      </Text>
                    </Group>
                    <Group gap="xs">
                      <Text size="sm" fw={600}>
                        Unmatched:
                      </Text>
                      <Text size="sm" c={totalUnmatchedFiles > 0 ? "orange" : "green"}>
                        {totalUnmatchedFiles}
                      </Text>
                    </Group>
                  </Group>
                </Group>
              </Paper>

              {/* All-files-matched completion banner */}
              {allFilesMatched && (
                <Alert
                  icon={<IconCheck size={18} />}
                  color="green"
                  radius="md"
                  title="All device groups assigned!"
                >
                  <Group justify="space-between" align="center">
                    <Text size="sm">
                      All {results.files.length} file{results.files.length !== 1 ? "s are" : " is"} matched to substrates.
                    </Text>
                    <Group gap="xs">
                      <Button
                        size="sm"
                        variant="light"
                        color="blue"
                        onClick={async () => {
                          try {
                            const preview =
                              await NomadService.previewNomadMetadata({
                                requestBody: {
                                  experiment_id: experiment.id,
                                  experiment_name: experiment.name,
                                  custom_metadata: {
                                    experiment,
                                  },
                                  substrates: substrates,
                                  measurement_files: results.files.map((f) => ({
                                    fileName: f.fileName,
                                    fileType: f.fileType,
                                    deviceName: f.deviceName,
                                    cell: f.cell,
                                    pixel: f.pixel,
                                    value: f.value,
                                  })),
                                  device_groups: results.deviceGroups.map(
                                    (g) => ({
                                      id: g.id,
                                      deviceName: g.deviceName,
                                      assignedSubstrateId:
                                        g.assignedSubstrateId,
                                      files: g.files.map((f) => ({
                                        fileName: f.fileName,
                                        fileType: f.fileType,
                                        deviceName: f.deviceName,
                                        cell: f.cell,
                                        pixel: f.pixel,
                                        value: f.value,
                                      })),
                                    }),
                                  ),
                                },
                              })
                            setNomadMetadataPreview(preview.yaml_content)
                            setShowMetadataModal(true)
                          } catch (_err) {
                            notifications.show({
                              title: "Error",
                              message: "Failed to generate metadata preview",
                              color: "red",
                            })
                          }
                        }}
                      >
                        Preview File Metadata
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        color="violet"
                        onClick={async () => {
                          try {
                            const preview =
                              await NomadService.previewNomadMetadata({
                                requestBody: {
                                  experiment_id: experiment.id,
                                  experiment_name: experiment.name,
                                  custom_metadata: {
                                    experiment,
                                  },
                                  substrates: substrates,
                                  measurement_files: results.files.map((f) => ({
                                    fileName: f.fileName,
                                    fileType: f.fileType,
                                    deviceName: f.deviceName,
                                    cell: f.cell,
                                    pixel: f.pixel,
                                    value: f.value,
                                  })),
                                  device_groups: results.deviceGroups.map(
                                    (g) => ({
                                      id: g.id,
                                      deviceName: g.deviceName,
                                      assignedSubstrateId:
                                        g.assignedSubstrateId,
                                      files: g.files.map((f) => ({
                                        fileName: f.fileName,
                                        fileType: f.fileType,
                                        deviceName: f.deviceName,
                                        cell: f.cell,
                                        pixel: f.pixel,
                                        value: f.value,
                                      })),
                                    }),
                                  ),
                                },
                              })
                            // Show fabrication metadata in YAML format
                            setFabricationMetadataPreview(
                              preview.metadata_yaml || "No metadata available",
                            )
                            setShowFabricationModal(true)
                          } catch (_err) {
                            notifications.show({
                              title: "Error",
                              message:
                                "Failed to generate fabrication metadata preview",
                              color: "red",
                            })
                          }
                        }}
                      >
                        Preview Fabrication Metadata
                      </Button>
                      <Button
                        size="sm"
                        color="green"
                        leftSection={
                          nomadUploading ? (
                            <Loader size={14} color="white" />
                          ) : (
                            <IconCloudUpload size={16} />
                          )
                        }
                        disabled={nomadUploading || !nomadConfig?.enabled}
                        onClick={async () => {
                          if (!nomadConfig?.enabled) {
                            notifications.show({
                              title: "NOMAD Not Configured",
                              message:
                                "Please configure NOMAD credentials in the auth file (../sensitive config/.nomad_auth)",
                              color: "orange",
                            })
                            return
                          }

                          modals.openConfirmModal({
                            title: "Save to NOMAD",
                            children: (
                              <Stack gap="sm">
                                <Text size="sm">
                                  This will export all {results.files.length}{" "}
                                  file
                                  {results.files.length !== 1 ? "s" : ""} with
                                  their substrate assignments to NOMAD.
                                </Text>
                                <Text size="xs" c="dimmed">
                                  Using NOMAD URL: {nomadConfig.url}
                                </Text>
                              </Stack>
                            ),
                            labels: {
                              confirm: "Upload to NOMAD",
                              cancel: "Cancel",
                            },
                            confirmProps: {
                              color: "green",
                              leftSection: <IconCloudUpload size={14} />,
                            },
                            onConfirm: async () => {
                              setNomadUploading(true)
                              try {
                                // Build request data
                                const requestData: NomadUploadRequest = {
                                  experiment_id: experiment.id,
                                  experiment_name: experiment.name,
                                  custom_metadata: {
                                    experiment,
                                  },
                                  substrates: substrates,
                                  measurement_files: results.files.map((f) => ({
                                    fileName: f.fileName,
                                    fileType: f.fileType,
                                    deviceName: f.deviceName,
                                    cell: f.cell,
                                    pixel: f.pixel,
                                    value: f.value,
                                  })),
                                  device_groups: results.deviceGroups.map(
                                    (g) => ({
                                      id: g.id,
                                      deviceName: g.deviceName,
                                      assignedSubstrateId:
                                        g.assignedSubstrateId,
                                      files: g.files.map((f) => ({
                                        fileName: f.fileName,
                                        fileType: f.fileType,
                                        deviceName: f.deviceName,
                                        cell: f.cell,
                                        pixel: f.pixel,
                                        value: f.value,
                                      })),
                                    }),
                                  ),
                                }

                                // Create FormData for the upload
                                const formData = new FormData()
                                formData.append(
                                  "request_json",
                                  JSON.stringify(requestData),
                                )

                                // Add uploaded files if we have them stored
                                // Note: In production, you'd store the actual File objects
                                // For now, we'll create placeholder files from the metadata
                                for (const file of uploadedFiles) {
                                  formData.append("files", file)
                                }

                                // If no files stored, we need to handle this differently
                                // The backend will need to work with metadata only
                                if (uploadedFiles.length === 0) {
                                  notifications.show({
                                    title: "Note",
                                    message:
                                      "No files to upload. Metadata will be saved.",
                                    color: "blue",
                                  })
                                }

                                // Make the upload request
                                const token =
                                  typeof OpenAPI.TOKEN === "function"
                                    ? await OpenAPI.TOKEN({} as any)
                                    : OpenAPI.TOKEN ||
                                      localStorage.getItem("access_token")
                                const response = await fetch(
                                  `${OpenAPI.BASE}/api/v1/nomad/upload/nomad`,
                                  {
                                    method: "POST",
                                    headers: {
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: formData,
                                  },
                                )

                                const result: NomadUploadResponse =
                                  await response.json()

                                if (result.success) {
                                  // Update results with NOMAD info
                                  const updatedResults = {
                                    ...results,
                                    nomad: {
                                      upload_id: result.upload_id ?? undefined,
                                      entry_ids: result.entry_ids ?? undefined,
                                      upload_time:
                                        result.upload_create_time ?? undefined,
                                      status:
                                        result.processing_status ?? undefined,
                                    },
                                    updatedAt: new Date().toISOString(),
                                  }
                                  onUpdateResults(updatedResults)

                                  notifications.show({
                                    title: "Upload Successful!",
                                    message: (
                                      <Stack gap={4}>
                                        <Text size="sm">
                                          Data uploaded to NOMAD.
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          Upload ID: {result.upload_id}
                                        </Text>
                                      </Stack>
                                    ),
                                    color: "green",
                                    autoClose: 10000,
                                  })

                                  // Show success modal with details
                                  modals.open({
                                    title: "NOMAD Upload Complete",
                                    children: (
                                      <Stack gap="md">
                                        <Alert
                                          color="green"
                                          icon={<IconCheck size={16} />}
                                        >
                                          Successfully uploaded to NOMAD
                                        </Alert>
                                        <Table>
                                          <Table.Tbody>
                                            <Table.Tr>
                                              <Table.Td fw={600}>
                                                Upload ID
                                              </Table.Td>
                                              <Table.Td>
                                                <Code>{result.upload_id}</Code>
                                              </Table.Td>
                                            </Table.Tr>
                                            {result.entry_ids &&
                                              result.entry_ids.length > 0 && (
                                                <Table.Tr>
                                                  <Table.Td fw={600}>
                                                    Entry IDs
                                                  </Table.Td>
                                                  <Table.Td>
                                                    {result.entry_ids.map(
                                                      (
                                                        id: string,
                                                        i: number,
                                                      ) => (
                                                        <Code key={i} block>
                                                          {id}
                                                        </Code>
                                                      ),
                                                    )}
                                                  </Table.Td>
                                                </Table.Tr>
                                              )}
                                            <Table.Tr>
                                              <Table.Td fw={600}>
                                                Upload Time
                                              </Table.Td>
                                              <Table.Td>
                                                {result.upload_create_time}
                                              </Table.Td>
                                            </Table.Tr>
                                            <Table.Tr>
                                              <Table.Td fw={600}>
                                                Status
                                              </Table.Td>
                                              <Table.Td>
                                                <Badge color="blue">
                                                  {result.processing_status ||
                                                    "Processing"}
                                                </Badge>
                                              </Table.Td>
                                            </Table.Tr>
                                          </Table.Tbody>
                                        </Table>
                                        <Button
                                          variant="light"
                                          leftSection={
                                            <IconExternalLink size={14} />
                                          }
                                          onClick={() => {
                                            const nomadUrl =
                                              nomadConfig?.url?.replace(
                                                "/api/v1",
                                                "",
                                              )
                                            if (!nomadUrl) {
                                              notifications.show({
                                                title: "NOMAD URL Missing",
                                                message:
                                                  "NOMAD base URL is not configured.",
                                                color: "orange",
                                              })
                                              return
                                            }
                                            window.open(
                                              `${nomadUrl}/user/uploads/upload/id/${result.upload_id}`,
                                              "_blank",
                                            )
                                          }}
                                        >
                                          View in NOMAD
                                        </Button>
                                      </Stack>
                                    ),
                                  })
                                } else {
                                  notifications.show({
                                    title: "Upload Failed",
                                    message:
                                      result.message ||
                                      "Unknown error occurred",
                                    color: "red",
                                  })
                                }
                              } catch (err) {
                                console.error("NOMAD upload error:", err)
                                notifications.show({
                                  title: "Upload Error",
                                  message:
                                    err instanceof Error
                                      ? err.message
                                      : "Failed to upload to NOMAD",
                                  color: "red",
                                })
                              } finally {
                                setNomadUploading(false)
                              }
                            },
                          })
                        }}
                      >
                        {nomadUploading ? "Uploading..." : "Save to NOMAD"}
                      </Button>
                    </Group>
                  </Group>
                </Alert>
              )}

              {/* NOMAD Info Display (if already uploaded) */}
              {results.nomad?.upload_id && (
                <Alert
                  icon={<IconCloudUpload size={16} />}
                  color="blue"
                  radius="md"
                  title="Uploaded to NOMAD"
                >
                  <Stack gap="xs">
                    <Group gap="lg">
                      <Text size="sm">
                        <Text span fw={600}>
                          Upload ID:
                        </Text>{" "}
                        <Code>{results.nomad.upload_id}</Code>
                      </Text>
                      {results.nomad.entry_ids &&
                        results.nomad.entry_ids.length > 0 && (
                          <Text size="sm">
                            <Text span fw={600}>
                              Entries:
                            </Text>{" "}
                            {results.nomad.entry_ids.length}
                          </Text>
                        )}
                    </Group>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconExternalLink size={14} />}
                      onClick={() => {
                        const nomadUrl = nomadConfig?.url?.replace(
                          "/api/v1",
                          "",
                        )
                        if (!nomadUrl) {
                          notifications.show({
                            title: "NOMAD URL Missing",
                            message: "NOMAD base URL is not configured.",
                            color: "orange",
                          })
                          return
                        }
                        window.open(
                          `${nomadUrl}/user/uploads/upload/id/${results.nomad?.upload_id}`,
                          "_blank",
                        )
                      }}
                    >
                      View in NOMAD
                    </Button>
                  </Stack>
                </Alert>
              )}

              {/* File Metadata Preview Modal */}
              <Modal
                opened={showMetadataModal}
                onClose={() => setShowMetadataModal(false)}
                title="NOMAD File Metadata Preview"
                size="xl"
              >
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    This YAML will be included in your upload to describe the
                    data structure.
                  </Text>
                  <ScrollArea
                    style={{
                      height: "60vh",
                      background: "var(--mantine-color-gray-0)",
                      padding: 8,
                      borderRadius: 6,
                    }}
                  >
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        fontFamily: "monospace",
                        fontSize: 12,
                        margin: 0,
                      }}
                    >
                      {nomadMetadataPreview || ""}
                    </pre>
                  </ScrollArea>
                  <Button onClick={() => setShowMetadataModal(false)}>
                    Close
                  </Button>
                </Stack>
              </Modal>

              {/* Fabrication Metadata Preview Modal */}
              <Modal
                opened={showFabricationModal}
                onClose={() => setShowFabricationModal(false)}
                title="Review Fabrication Metadata"
                size="xl"
              >
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    Perovskite solar cell fabrication metadata for NOMAD upload.
                    Use the buttons below to download or copy the YAML.
                  </Text>
                  <ScrollArea
                    style={{
                      height: "60vh",
                      background: "var(--mantine-color-gray-0)",
                      padding: 8,
                      borderRadius: 6,
                    }}
                  >
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        fontFamily: "monospace",
                        fontSize: 12,
                        margin: 0,
                      }}
                    >
                      {fabricationMetadataPreview || ""}
                    </pre>
                  </ScrollArea>
                  <Group justify="flex-end">
                    <Button
                      variant="light"
                      color="teal"
                      leftSection={<IconClipboard size={16} />}
                      onClick={() => {
                        navigator.clipboard
                          .writeText(fabricationMetadataPreview || "")
                          .then(() => {
                            notifications.show({
                              title: "Copied",
                              message: "Metadata copied to clipboard",
                              color: "teal",
                            })
                          })
                          .catch(() => {
                            notifications.show({
                              title: "Copy failed",
                              message: "Could not access clipboard",
                              color: "red",
                            })
                          })
                      }}
                    >
                      Copy to Clipboard
                    </Button>
                    <Button
                      variant="light"
                      color="blue"
                      leftSection={<IconDownload size={16} />}
                      onClick={() => {
                        const blob = new Blob(
                          [fabricationMetadataPreview || ""],
                          { type: "application/yaml" },
                        )
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement("a")
                        a.href = url
                        a.download = "archive.yaml"
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      Download YAML
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() => setShowFabricationModal(false)}
                    >
                      Close
                    </Button>
                  </Group>
                </Stack>
              </Modal>

              <Divider label="File Organization" labelPosition="center" />

              <Group align="flex-start" grow wrap="nowrap">
                <Paper
                  withBorder
                  p="sm"
                  radius="md"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <Text size="sm" fw={600}>
                          Unmatched Files
                        </Text>
                        <Badge size="xs" variant="light" color={totalUnmatchedFiles > 0 ? "orange" : "green"}>
                          {totalUnmatchedFiles}
                        </Badge>
                      </Group>
                    </Group>

                    {totalUnmatchedFiles === 0 ? (
                      <Text size="sm" c="dimmed" ta="center" py="md">
                        All files matched to substrates!
                      </Text>
                    ) : (
                      <Stack gap="sm">
                        {/* Automatically Grouped Files */}
                        {unmatchedGroups.length > 0 && (
                          <Paper withBorder p="sm" radius="md">
                            <Text size="xs" fw={600} mb="xs" c="dimmed">
                              Automatically Grouped Files
                            </Text>
                            <Table striped>
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Group Name</Table.Th>
                                  <Table.Th>Files</Table.Th>
                                  <Table.Th>Match Score</Table.Th>
                                  <Table.Th style={{ width: 180 }}>Assign to</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {unmatchedGroups.map((group) => (
                                  <Table.Tr
                                    key={group.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", `group:${group.id}`)
                                      e.dataTransfer.effectAllowed = "move"
                                    }}
                                    style={{ cursor: "grab" }}
                                  >
                                    <Table.Td>
                                      <Group gap={4} wrap="nowrap">
                                        <IconFile size={14} style={{ flexShrink: 0 }} />
                                        <Text size="xs" fw={500}>
                                          {group.deviceName || "(Unknown Device)"}
                                        </Text>
                                      </Group>
                                    </Table.Td>
                                    <Table.Td>
                                      <Badge size="xs" variant="light">
                                        {group.files.length}
                                      </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                      {group.matchScore !== undefined ? (
                                        <Badge
                                          size="xs"
                                          color={
                                            group.matchScore > 0.8
                                              ? "green"
                                              : group.matchScore > 0.5
                                                ? "yellow"
                                                : "red"
                                          }
                                        >
                                          {(group.matchScore * 100).toFixed(0)}%
                                        </Badge>
                                      ) : (
                                        <Text size="xs" c="dimmed">—</Text>
                                      )}
                                    </Table.Td>
                                    <Table.Td>
                                      <Select
                                        size="xs"
                                        placeholder="Select substrate..."
                                        value={null}
                                        onChange={(v) => v && handleAssignGroupToSubstrate(group.id, v)}
                                        data={substrates.map((s) => ({
                                          value: s.id,
                                          label: s.name,
                                        }))}
                                      />
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </Paper>
                        )}
                        
                        {/* Individual ungrouped files */}
                        {ungroupedFiles.length > 0 && (
                          <Paper withBorder p="sm" radius="md">
                            <Text size="xs" fw={600} mb="xs" c="dimmed">
                              Individual Files
                            </Text>
                            <Table striped>
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>File</Table.Th>
                                  <Table.Th>Type</Table.Th>
                                  <Table.Th>Device</Table.Th>
                                  <Table.Th style={{ width: 180 }}>Assign to</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {ungroupedFiles.map((file) => (
                                  <Table.Tr
                                    key={file.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", file.id)
                                      e.dataTransfer.effectAllowed = "move"
                                    }}
                                    style={{ cursor: "grab" }}
                                  >
                                    <Table.Td>
                                      <Group
                                        gap={4}
                                        wrap="nowrap"
                                        style={{ overflow: "hidden", maxWidth: 200 }}
                                      >
                                        <IconFile
                                          size={14}
                                          style={{ flexShrink: 0 }}
                                        />
                                        <Text
                                          size="xs"
                                          style={{
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {file.fileName}
                                        </Text>
                                      </Group>
                                    </Table.Td>
                                    <Table.Td>
                                      <FileTypeBadge type={file.fileType} />
                                    </Table.Td>
                                    <Table.Td>
                                      <Text size="xs">{file.deviceName || "—"}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Select
                                        size="xs"
                                        placeholder="Select substrate..."
                                        value={null}
                                        onChange={(v) => v && handleAssignFileToSubstrate(file.id, v)}
                                        data={substrates.map((s) => ({
                                          value: s.id,
                                          label: s.name,
                                        }))}
                                      />
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </Paper>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </Paper>

                <Paper
                  withBorder
                  p="sm"
                  radius="md"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <Text size="sm" fw={600}>
                          Substrates
                        </Text>
                        <Badge size="xs" variant="light">
                          {experiment.substrates.length}
                        </Badge>
                      </Group>
                    </Group>

                    {experiment.substrates.length === 0 ? (
                      <Text size="sm" c="dimmed" ta="center" py="md">
                        No substrates in this experiment.
                      </Text>
                    ) : (
                      <Stack gap="sm">
                        {experiment.substrates.map((substrate) => {
                          const substrateMaterial = materials.find(
                            (m) => m.id === substrate.substrateMaterialId
                          )
                          const files = getSubstrateFiles(substrate.id)
                          return (
                            <SubstrateCard
                              key={substrate.id}
                              substrate={substrate}
                              substrateMaterial={substrateMaterial}
                              files={files}
                              onUnmatchFile={(fileId) => handleUnmatchFile(fileId, substrate.id)}
                              onDropFile={(fileId) => handleAssignFileToSubstrate(fileId, substrate.id)}
                              onDropGroup={(groupId) => handleAssignGroupToSubstrate(groupId, substrate.id)}
                              onDragEnter={() => setDropTargetGroupId(substrate.id)}
                              onDragLeave={() =>
                                setDropTargetGroupId((prev) =>
                                  prev === substrate.id ? null : prev,
                                )
                              }
                              isDropTarget={dropTargetGroupId === substrate.id}
                              expanded={expandedSubstrates.has(substrate.id)}
                              onToggleExpand={() => toggleSubstrateExpand(substrate.id)}
                            />
                          )
                        })}
                      </Stack>
                    )}
                  </Stack>
                </Paper>
              </Group>
            </>
          )}
        </Stack>
      </ScrollArea>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function ResultsPage() {
  const {
    experiments,
    setExperiments,
    results,
    setResults,
    planes,
    updateElement,
    pendingCollectionLink,
    setPendingCollectionLink,
    setActiveEntity,
  } = useAppContext()
  const { getEntityColor, isEntityVisible } = useEntityCollection()
  const [selectedExperimentId, setSelectedExperimentId] = useState<
    string | null
  >(null)

  const selectExperiment = (id: string | null) => {
    setSelectedExperimentId(id)
    setActiveEntity(id ? { kind: "experiment", id } : null)
  }

  const selectedExperiment = experiments.find(
    (e) => e.id === selectedExperimentId,
  )
  const experimentResults =
    results.find((r) => r.experimentId === selectedExperimentId) ?? null
  const processedPendingRequestIdsRef = useRef<Set<string>>(new Set())

  // When arriving from a collection's "Add Results" action, preselect the
  // linked experiment to make result linking explicit and predictable.
  useEffect(() => {
    if (!pendingCollectionLink || pendingCollectionLink.kind !== "result") {
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

    const plane = planes.find((p) => p.id === planeId)
    const collection = plane?.elements.find((e) => e.id === collectionId)
    if (!collection || collection.type !== "collection") {
      return
    }

    const linkedExperimentId = collection.refs.find(
      (r) => r.kind === "experiment",
    )?.id
    if (linkedExperimentId) {
      selectExperiment(linkedExperimentId)
    }
  }, [
    pendingCollectionLink,
    planes,
    setPendingCollectionLink,
    selectExperiment,
  ])

  const syncResultRefsForExperiment = (
    experimentId: string,
    resultIdsForExperiment: string[],
    nextResultId: string | null,
  ) => {
    const resultIdSet = new Set(resultIdsForExperiment)

    for (const plane of planes) {
      for (const element of plane.elements) {
        if (element.type !== "collection") {
          continue
        }
        const collection = element as CanvasCollectionElement
        const hasExperimentRef = collection.refs.some(
          (ref) => ref.kind === "experiment" && ref.id === experimentId,
        )
        if (!hasExperimentRef) {
          continue
        }

        const withoutOldResultRefs = collection.refs.filter(
          (ref) => !(ref.kind === "result" && resultIdSet.has(ref.id)),
        )
        const nextRefs =
          nextResultId === null
            ? withoutOldResultRefs
            : [
                ...withoutOldResultRefs,
                { kind: "result" as const, id: nextResultId },
              ]

        const refsChanged =
          nextRefs.length !== collection.refs.length ||
          nextRefs.some((ref, idx) => {
            const prev = collection.refs[idx]
            return !prev || prev.kind !== ref.kind || prev.id !== ref.id
          })

        if (refsChanged) {
          updateElement(plane.id, {
            ...collection,
            refs: nextRefs,
          })
        }
      }
    }
  }

  const updateResults = (updatedResults: ExperimentResults) => {
    const hasFiles = updatedResults.files.length > 0
    const existingForExperiment = results.find(
      (r) => r.experimentId === updatedResults.experimentId,
    )
    const resultIdsForExperiment = results
      .filter((r) => r.experimentId === updatedResults.experimentId)
      .map((r) => r.id)

    setResults((prev) => {
      if (!hasFiles) {
        return prev.filter(
          (r) => r.experimentId !== updatedResults.experimentId,
        )
      }

      const exists = prev.some(
        (r) => r.experimentId === updatedResults.experimentId,
      )
      if (exists) {
        return prev.map((r) =>
          r.experimentId === updatedResults.experimentId ? updatedResults : r,
        )
      }
      return [...prev, updatedResults]
    })

    // Keep experiment.hasResults in sync so the status propagates everywhere.
    // Treat "finished" as equivalent to all device groups assigned.
    const totalGroups = updatedResults.deviceGroups.length
    const matchedCount = updatedResults.deviceGroups.filter(
      (g) => g.assignedSubstrateId,
    ).length
    const allAssigned = totalGroups > 0 && matchedCount === totalGroups

    setExperiments((prev) =>
      prev.map((e) =>
        e.id === updatedResults.experimentId
          ? { ...e, hasResults: hasFiles || allAssigned }
          : e,
      ),
    )

    // Keep collection result refs in sync with the effective persisted state.
    syncResultRefsForExperiment(
      updatedResults.experimentId,
      resultIdsForExperiment.length > 0
        ? resultIdsForExperiment
        : existingForExperiment
          ? [existingForExperiment.id]
          : [updatedResults.id],
      hasFiles ? (existingForExperiment?.id ?? updatedResults.id) : null,
    )
  }

  // Filter experiments that are at least "ready" status
  const visibleExperiments = experiments.filter((e) => {
    if (!isEntityVisible("experiment", e.id)) {
      return false
    }
    const status = getExperimentStatus(e)
    // Show experiments that are ready or finished
    return status === "ready" || status === "finished"
  })

  useEffect(() => {
    if (
      selectedExperimentId &&
      !visibleExperiments.some(
        (experiment) => experiment.id === selectedExperimentId,
      )
    ) {
      selectExperiment(null)
    }
  }, [selectedExperimentId, visibleExperiments])

  return (
    <Box style={{ display: "flex", height: "calc(100vh - 60px)" }}>
      {/* Main: Results Detail */}
      <Box style={{ flex: 1, background: "var(--mantine-color-gray-0)" }}>
        {selectedExperiment ? (
          <ResultsDetail
            experiment={selectedExperiment}
            experimentResults={experimentResults}
            onUpdateResults={updateResults}
          />
        ) : (
          <Box
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconFlask size={64} color="var(--mantine-color-gray-4)" />
            <Text size="lg" c="dimmed" mt="md">
              Select an experiment to upload results
            </Text>
            <Text size="sm" c="dimmed" mt="xs">
              Only experiments with "Ready" or "Finished" status are shown
            </Text>
          </Box>
        )}
      </Box>

      {/* Right Sidebar: Experiment List */}
      <Box
        style={{
          width: 280,
          borderLeft: "1px solid var(--mantine-color-default-border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Group
          justify="space-between"
          p="md"
          style={{
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <Title order={5}>Experiments</Title>
        </Group>

        <ScrollArea style={{ flex: 1 }} p="sm">
          <Stack gap="sm">
            {visibleExperiments.length === 0 ? (
              <Paper
                p="lg"
                ta="center"
                style={{ background: "var(--mantine-color-gray-0)" }}
              >
                <IconFlask size={32} color="var(--mantine-color-gray-5)" />
                <Text size="sm" c="dimmed" mt="sm">
                  No ready experiments
                </Text>
                <Text size="xs" c="dimmed" mt="xs">
                  Complete an experiment first
                </Text>
              </Paper>
            ) : (
              visibleExperiments.map((exp) => (
                <ExperimentListItem
                  key={exp.id}
                  experiment={exp}
                  isSelected={selectedExperimentId === exp.id}
                  onSelect={() => selectExperiment(exp.id)}
                  collectionColor={
                    getEntityColor("experiment", exp.id) ?? undefined
                  }
                />
              ))
            )}
          </Stack>
        </ScrollArea>
      </Box>
    </Box>
  )
}
