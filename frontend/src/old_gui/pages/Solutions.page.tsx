import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Container,
  Divider,
  Group,
  NativeSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  rem,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import {
  newComponent,
  newSolution,
  type Solution,
  type SolutionComponent,
  useAppContext,
  useEntityCollection,
} from '../store/AppContext';

// ── Component row (material + amount + unit) ──────────────────────────────────

type ComponentRowProps = {
  component: SolutionComponent;
  onChange: (updated: SolutionComponent) => void;
  onDelete: () => void;
  materialName: string;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: () => void;
  onCancel: () => void;
  buffer: SolutionComponent | null;
  onBufferChange: (b: SolutionComponent) => void;
  materialOptions: { value: string; label: string }[];
};

function ComponentRow({
  component,
  onDelete,
  materialName,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  buffer,
  onBufferChange,
  materialOptions,
}: ComponentRowProps) {
  return (
    <Table.Tr>
      <Table.Td>
        {editing && buffer ? (
          <NativeSelect
            size="xs"
            value={buffer.materialId}
            onChange={(e) => onBufferChange({ ...buffer, materialId: e.currentTarget.value })}
            data={[{ value: '', label: '— select material —' }, ...materialOptions]}
          />
        ) : (
          <Text size="sm">{materialName || <Text span c="dimmed" size="sm">—</Text>}</Text>
        )}
      </Table.Td>
      <Table.Td>
        {editing && buffer ? (
          <NumberInput
            size="xs"
            value={buffer.amount}
            onChange={(v) => onBufferChange({ ...buffer, amount: String(v) })}
            min={0}
            style={{ width: rem(100) }}
          />
        ) : (
          <Text size="sm">{component.amount || <Text span c="dimmed" size="sm">—</Text>}</Text>
        )}
      </Table.Td>
      <Table.Td>
        {editing && buffer ? (
          <NativeSelect
            size="xs"
            value={buffer.unit}
            onChange={(e) =>
              onBufferChange({ ...buffer, unit: e.currentTarget.value as 'mg' | 'ml' })
            }
            data={['mg', 'ml']}
            style={{ width: rem(80) }}
          />
        ) : (
          <Badge variant="light" size="sm">{component.unit}</Badge>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4} justify="center">
          {editing ? (
            <>
              <Tooltip label="Save">
                <ActionIcon size="sm" variant="subtle" color="green" onClick={onCommit}>
                  <IconCheck size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Cancel">
                <ActionIcon size="sm" variant="subtle" color="gray" onClick={onCancel}>
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip label="Edit">
                <ActionIcon size="sm" variant="subtle" color="blue" onClick={onStartEdit}>
                  <IconPencil size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Delete">
                <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

// ── Solution card ─────────────────────────────────────────────────────────────

type SolutionCardProps = {
  solution: Solution;
  onUpdate: (s: Solution) => void;
  onDelete: () => void;
  materialOptions: { value: string; label: string }[];
  getMaterialName: (id: string) => string;
  collectionColor?: string;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
};

function SolutionCard({ solution, onUpdate, onDelete, materialOptions, getMaterialName, collectionColor, isSelected: _isSelected, onSelect }: SolutionCardProps) {
  const [open, setOpen] = useState(false);

  const handleToggleOpen = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && onSelect) {
      onSelect(solution.id);
    }
  };
  const [editingName, setEditingName] = useState(false);
  const [nameBuffer, setNameBuffer] = useState(solution.name);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [componentBuffer, setComponentBuffer] = useState<SolutionComponent | null>(null);

  const commitName = () => {
    onUpdate({ ...solution, name: nameBuffer.trim() || solution.name });
    setEditingName(false);
  };

  const addComponent = () => {
    const c = newComponent();
    const updated = { ...solution, components: [...solution.components, c] };
    onUpdate(updated);
    setEditingComponentId(c.id);
    setComponentBuffer(c);
  };

  const commitComponent = () => {
    if (!componentBuffer) {return;}
    onUpdate({
      ...solution,
      components: solution.components.map((c) =>
        c.id === componentBuffer.id ? componentBuffer : c
      ),
    });
    setEditingComponentId(null);
    setComponentBuffer(null);
  };

  const cancelComponent = (id: string) => {
    const original = solution.components.find((c) => c.id === id);
    if (original && !original.materialId && !original.amount) {
      onUpdate({ ...solution, components: solution.components.filter((c) => c.id !== id) });
    }
    setEditingComponentId(null);
    setComponentBuffer(null);
  };

  const deleteComponent = (id: string) => {
    onUpdate({ ...solution, components: solution.components.filter((c) => c.id !== id) });
  };

  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      mb="sm"
      style={{ borderLeft: collectionColor ? `6px solid ${collectionColor}` : undefined }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            onClick={() => handleToggleOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>

          {editingName ? (
            <Group gap={4} wrap="nowrap">
              <TextInput
                size="xs"
                value={nameBuffer}
                onChange={(e) => setNameBuffer(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {commitName();}
                  if (e.key === 'Escape') { setEditingName(false); setNameBuffer(solution.name); }
                }}
                autoFocus
                style={{ width: rem(200) }}
              />
              <ActionIcon size="sm" variant="subtle" color="green" onClick={commitName}><IconCheck size={14} /></ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => { setEditingName(false); setNameBuffer(solution.name); }}><IconX size={14} /></ActionIcon>
            </Group>
          ) : (
            <Group gap={4} wrap="nowrap">
              <Text
                fw={600}
                style={{ cursor: 'pointer' }}
                onClick={() => handleToggleOpen(!open)}
              >
                {solution.name}
              </Text>
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setEditingName(true)}>
                <IconPencil size={12} />
              </ActionIcon>
            </Group>
          )}

          <Badge size="sm" variant="outline" color="gray">
            {solution.components.length} component{solution.components.length !== 1 ? 's' : ''}
          </Badge>
        </Group>

        <Tooltip label="Delete solution">
          <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete}>
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Collapse expanded={open}>
        <Divider my="sm" />
        <ScrollArea>
          <Table withColumnBorders withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Material</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Unit</Table.Th>
                <Table.Th style={{ width: rem(80) }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {solution.components.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" ta="center" size="sm" py="xs">
                      No components yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {solution.components.map((comp) => (
                <ComponentRow
                  key={comp.id}
                  component={comp}
                  onChange={() => {}}
                  onDelete={() => deleteComponent(comp.id)}
                  materialName={getMaterialName(comp.materialId)}
                  editing={editingComponentId === comp.id}
                  onStartEdit={() => { setEditingComponentId(comp.id); setComponentBuffer({ ...comp }); }}
                  onCommit={commitComponent}
                  onCancel={() => cancelComponent(comp.id)}
                  buffer={editingComponentId === comp.id ? componentBuffer : null}
                  onBufferChange={setComponentBuffer}
                  materialOptions={materialOptions}
                />
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Box mt="xs">
          <Button size="xs" leftSection={<IconPlus size={12} />} variant="light" onClick={addComponent}>
            Add Component
          </Button>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ── Solutions page ────────────────────────────────────────────────────────────

export function SolutionsPage() {
  const { materials, solutions, setSolutions, planes, updateElement, pendingCollectionLink, setPendingCollectionLink, activeCollectionId, activePlaneId, setActiveEntity } = useAppContext();
  const { getEntityColor, isEntityVisible } = useEntityCollection();
  const [selectedSolutionId, setSelectedSolutionId] = useState<string | null>(null);

  const selectSolution = (id: string | null) => {
    setSelectedSolutionId(id);
    setActiveEntity(id ? { kind: 'solution', id } : null);
  };

  const materialOptions = materials.map((m) => ({
    value: m.id,
    label: m.name || m.inventoryLabel || m.casNumber || m.id,
  }));

  const getMaterialName = (id: string) => {
    const m = materials.find((mat) => mat.id === id);
    return m ? (m.name || m.inventoryLabel || m.casNumber || id) : id;
  };

  const visibleSolutions = solutions.filter((s) => isEntityVisible('solution', s.id));

  const addSolution = () => {
    const s = newSolution();
    setSolutions((prev) => [...prev, s]);
    if (activeCollectionId && activePlaneId) {
      const plane = planes.find((p) => p.id === activePlaneId);
      if (plane) {
        const col = plane.elements.find((e) => e.id === activeCollectionId);
        if (col && col.type === 'collection') {
          updateElement(activePlaneId, { ...col, refs: [...col.refs, { kind: 'solution' as const, id: s.id }] });
        }
      }
    }
  };

  // Auto-create solution + link to collection when navigated from action bubble
  useEffect(() => {
    if (!pendingCollectionLink || pendingCollectionLink.kind !== 'solution') {
      return;
    }
    const { collectionId, planeId } = pendingCollectionLink;
    setPendingCollectionLink(null);

    const s = newSolution();
    setSolutions((prev) => [...prev, s]);

    const plane = planes.find((p) => p.id === planeId);
    if (plane) {
      const col = plane.elements.find((e) => e.id === collectionId);
      if (col && col.type === 'collection') {
        const updated = { ...col, refs: [...col.refs, { kind: 'solution' as const, id: s.id }] };
        updateElement(planeId, updated);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSolution = (updated: Solution) => {
    setSolutions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const deleteSolution = (id: string) => {
    modals.openConfirmModal({
      title: 'Delete solution',
      children: <Text size="sm">Are you sure you want to delete this solution? This cannot be undone.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        setSolutions((prev) => prev.filter((s) => s.id !== id));
        if (id === selectedSolutionId) {
          selectSolution(null);
        }
      },
    });
  };

  return (
    <Container fluid>
      <Group justify="space-between" mb="md" mt="md">
        <Title order={2}>Solutions</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={addSolution} disabled={!activeCollectionId}>
          New Solution
        </Button>
      </Group>

      {!activeCollectionId && (
        <Alert icon={<IconInfoCircle size={16} />} color="blue" mb="md">
          Select or create a collection in the Organization tab to add solutions.
        </Alert>
      )}

      {visibleSolutions.length === 0 && activeCollectionId && (
        <Text c="dimmed">
          {solutions.length === 0
            ? 'No solutions yet. Click "New Solution" to get started.'
            : 'No solutions in the selected collection.'}
        </Text>
      )}

      <Stack gap={0}>
        {visibleSolutions.map((solution) => (
          <SolutionCard
            key={solution.id}
            solution={solution}
            onUpdate={updateSolution}
            onDelete={() => deleteSolution(solution.id)}
            materialOptions={materialOptions}
            getMaterialName={getMaterialName}
            collectionColor={getEntityColor('solution', solution.id) ?? undefined}
            isSelected={selectedSolutionId === solution.id}
            onSelect={selectSolution}
          />
        ))}
      </Stack>
    </Container>
  );
}
