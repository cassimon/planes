import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Container,
  Group,
  ScrollArea,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
  rem,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconCheck, IconChevronDown, IconChevronUp, IconInfoCircle, IconSelector, IconTrash, IconPlus, IconPencil, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { type Material, newMaterial, useAppContext, useEntityCollection } from '../store/AppContext';

type Column = {
  key: keyof Material;
  label: string;
};

const COLUMNS: Column[] = [
  { key: 'type', label: 'Type' },
  { key: 'name', label: 'Name' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'supplierNumber', label: 'Supplier Number' },
  { key: 'casNumber', label: 'CAS Number' },
  { key: 'pubchemCid', label: 'PubChem CID' },
  { key: 'inventoryLabel', label: 'Inventory Label' },
  { key: 'purity', label: 'Purity' },
];

type SortState = { key: keyof Material; direction: 'asc' | 'desc' } | null;

function SortIcon({ sorted, direction }: { sorted: boolean; direction: 'asc' | 'desc' }) {
  if (!sorted) {return <IconSelector size={14} />;}
  return direction === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
}

export function MaterialsPage() {
  const { materials, setMaterials, planes, updateElement, pendingCollectionLink, setPendingCollectionLink, activeCollectionId, activePlaneId, setActiveEntity } = useAppContext();
  const { getEntityColor, isEntityVisible } = useEntityCollection();
  const [sort, setSort] = useState<SortState>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Material | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  const selectMaterial = (id: string | null) => {
    setSelectedMaterialId(id);
    setActiveEntity(id ? { kind: 'material', id } : null);
  };

  // Auto-create material + link to collection when navigated from action bubble
  useEffect(() => {
    if (!pendingCollectionLink || pendingCollectionLink.kind !== 'material') {
      return;
    }
    const { collectionId, planeId } = pendingCollectionLink;
    setPendingCollectionLink(null);

    const m = newMaterial();
    setMaterials((prev) => [...prev, m]);

    const plane = planes.find((p) => p.id === planeId);
    if (plane) {
      const col = plane.elements.find((e) => e.id === collectionId);
      if (col && col.type === 'collection') {
        const updated = { ...col, refs: [...col.refs, { kind: 'material' as const, id: m.id }] };
        updateElement(planeId, updated);
      }
    }

    startEdit(m);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSort = (key: keyof Material) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const sorted = [...materials]
    .filter((m) => isEntityVisible('material', m.id))
    .sort((a, b) => {
      if (!sort) {return 0;}
      const av = a[sort.key].toLowerCase();
      const bv = b[sort.key].toLowerCase();
      const cmp = av.localeCompare(bv);
      return sort.direction === 'asc' ? cmp : -cmp;
    });

  const addMaterial = () => {
    const m = newMaterial();
    setMaterials((prev) => [...prev, m]);
    // Link to active collection if one is selected
    if (activeCollectionId && activePlaneId) {
      const plane = planes.find((p) => p.id === activePlaneId);
      if (plane) {
        const col = plane.elements.find((e) => e.id === activeCollectionId);
        if (col && col.type === 'collection') {
          updateElement(activePlaneId, { ...col, refs: [...col.refs, { kind: 'material' as const, id: m.id }] });
        }
      }
    }
    startEdit(m);
  };

  const startEdit = (m: Material) => {
    setEditingId(m.id);
    setEditBuffer({ ...m });
  };

  const commitEdit = () => {
    if (!editBuffer) {return;}
    setMaterials((prev) => prev.map((m) => (m.id === editBuffer.id ? editBuffer : m)));
    setEditingId(null);
    setEditBuffer(null);
  };

  const cancelEdit = (id: string) => {
    const original = materials.find((m) => m.id === id);
    if (original && !COLUMNS.some((c) => original[c.key])) {
      // Row was never filled — remove it
      setMaterials((prev) => prev.filter((m) => m.id !== id));
    }
    setEditingId(null);
    setEditBuffer(null);
  };

  const confirmDelete = () => {
    modals.openConfirmModal({
      title: 'Delete materials',
      children: (
        <Text size="sm">
          Are you sure you want to delete {selected.size} material{selected.size > 1 ? 's' : ''}? This cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        setMaterials((prev) => prev.filter((m) => !selected.has(m.id)));
        setSelected(new Set());
        if (selectedMaterialId && selected.has(selectedMaterialId)) {
          selectMaterial(null);
        }
      },
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
          <Button leftSection={<IconPlus size={16} />} onClick={addMaterial} disabled={!activeCollectionId}>
            Add Material
          </Button>
        </Group>
      </Group>

      {!activeCollectionId && (
        <Alert icon={<IconInfoCircle size={16} />} color="blue" mb="md">
          Select or create a collection in the Organization tab to add materials.
        </Alert>
      )}

      <ScrollArea>
        <Table striped highlightOnHover withTableBorder withColumnBorders stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ padding: 0, width: 6 }} />
              <Table.Th style={{ width: rem(36) }} />
              {COLUMNS.map((col) => (
                <Table.Th key={col.key}>
                  <UnstyledButton
                    onClick={() => toggleSort(col.key)}
                    style={{ display: 'flex', alignItems: 'center', gap: rem(4) }}
                  >
                    <Text fw={600} size="sm">{col.label}</Text>
                    <SortIcon
                      sorted={sort?.key === col.key}
                      direction={sort?.key === col.key ? sort.direction : 'asc'}
                    />
                  </UnstyledButton>
                </Table.Th>
              ))}
              <Table.Th style={{ width: rem(80) }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sorted.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={COLUMNS.length + 3}>
                  <Text c="dimmed" ta="center" py="md">
                    {materials.length === 0
                      ? 'No materials yet. Click "Add Material" to get started.'
                      : 'No materials in the selected collection.'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {sorted.map((material) => {
              const isEditing = editingId === material.id;
              return (
                <Table.Tr
                  key={material.id}
                  bg={selected.has(material.id) ? 'var(--mantine-color-blue-light)' : undefined}
                  onClick={() => selectMaterial(material.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td style={{ padding: 0, width: 6, minWidth: 6, background: getEntityColor('material', material.id) ?? 'transparent' }} />
                  <Table.Td>
                    <input
                      type="checkbox"
                      checked={selected.has(material.id)}
                      onChange={() => toggleSelect(material.id)}
                    />
                  </Table.Td>
                  {COLUMNS.map((col) => (
                    <Table.Td key={col.key}>
                      {isEditing && editBuffer ? (
                        <TextInput
                          size="xs"
                          value={editBuffer[col.key]}
                          onChange={(e) =>
                            setEditBuffer((prev) => prev ? { ...prev, [col.key]: e.currentTarget.value } : prev)
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {commitEdit();}
                            if (e.key === 'Escape') {cancelEdit(material.id);}
                          }}
                          autoFocus={col.key === 'type'}
                        />
                      ) : (
                        <Text size="sm">{material[col.key] || <Text span c="dimmed" size="sm">—</Text>}</Text>
                      )}
                    </Table.Td>
                  ))}
                  <Table.Td>
                    <Group gap={4} justify="center">
                      {isEditing ? (
                        <>
                          <Tooltip label="Save">
                            <ActionIcon size="sm" variant="subtle" color="green" onClick={commitEdit}>
                              <IconCheck size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Cancel">
                            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => cancelEdit(material.id)}>
                              <IconX size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </>
                      ) : (
                        <Tooltip label="Edit">
                          <ActionIcon size="sm" variant="subtle" color="blue" onClick={() => startEdit(material)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {materials.length > 0 && (
        <Box mt="xs">
          <Text size="xs" c="dimmed">{materials.length} material{materials.length > 1 ? 's' : ''}</Text>
        </Box>
      )}
    </Container>
  );
}
