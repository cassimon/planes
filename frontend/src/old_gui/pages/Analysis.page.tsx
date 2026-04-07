import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  MultiSelect,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconFlask,
  IconGripVertical,
  IconPlus,
  IconX,
} from '@tabler/icons-react';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Experiment,
  type ExperimentLayer,
  getExperimentStatus,
  getVariedParameters,
  useAppContext,
  useEntityCollection,
} from '../store/AppContext';

// Lazy-loaded Plotly component to handle ESM/CJS interop at runtime
const LazyPlot = React.lazy(async () => {
  const [{ default: createPlotlyComponent }, Plotly] = await Promise.all([
    import('react-plotly.js/factory'),
    import('plotly.js/dist/plotly-basic'),
  ]);
  const factory = (createPlotlyComponent as any).default ?? createPlotlyComponent;
  const plotlyLib = (Plotly as any).default ?? Plotly;
  return { default: factory(plotlyLib) };
});

function Plot(props: any) {
  return (
    <Suspense fallback={<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>Loading plot...</div>}>
      <LazyPlot {...props} />
    </Suspense>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PlotWidget = {
  id: string;
  type: 'boxplot' | 'jv-curve' | 'scatter' | 'bar';
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Data source references
  experimentId?: string;
  layerIds?: string[];
  parameterKey?: string;
};

type DragState = {
  widgetId: string;
  startX: number;
  startY: number;
  startWidgetX: number;
  startWidgetY: number;
} | null;

type ResizeState = {
  widgetId: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
} | null;

// ─────────────────────────────────────────────────────────────────────────────
// Example Plot Data Generators
// ─────────────────────────────────────────────────────────────────────────────

const PLOT_COLORS = {
  primary: '#228be6',
  secondary: '#fa5252', 
  tertiary: '#40c057',
  quaternary: '#fab005',
  quinary: '#7950f2',
  senary: '#e64980',
};

/** Generate example box plot data for PCE by layer parameter */
function generateBoxPlotData(paramName: string) {
  const categories = ['100°C', '120°C', '140°C', '160°C'];
  const traces = categories.map((cat, idx) => {
    const baseValue = 15 + idx * 1.5;
    const values = Array.from({ length: 20 }, () => 
      baseValue + (Math.random() - 0.5) * 4
    );
    return {
      y: values,
      type: 'box' as const,
      name: cat,
      marker: { 
        color: Object.values(PLOT_COLORS)[idx % 6],
        outliercolor: 'rgba(0,0,0,0.3)',
      },
      boxpoints: 'outliers' as const,
    };
  });
  
  return {
    data: traces,
    layout: {
      title: { text: `PCE vs ${paramName}`, font: { size: 14 } },
      yaxis: { title: { text: 'PCE (%)' }, gridcolor: '#e9ecef' },
      xaxis: { title: { text: paramName } },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 40, r: 20, b: 50, l: 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.2 },
    },
  };
}

/** Generate example JV curve data */
function generateJVCurveData() {
  const generateJVCurve = (voc: number, jsc: number, _ff: number, name: string, color: string) => {
    const voltages: number[] = [];
    const currents: number[] = [];
    
    for (let v = -0.1; v <= voc + 0.1; v += 0.01) {
      voltages.push(v);
      // Simplified diode equation
      const j0 = 1e-10;
      const n = 1.5;
      const vt = 0.026; // thermal voltage at 300K
      const current = jsc - j0 * (Math.exp(v / (n * vt)) - 1);
      currents.push(Math.max(-5, Math.min(current, jsc * 1.1)));
    }
    
    return {
      x: voltages,
      y: currents,
      type: 'scatter' as const,
      mode: 'lines' as const,
      name,
      line: { color, width: 2 },
    };
  };
  
  return {
    data: [
      generateJVCurve(1.1, 22, 0.78, 'Device A (PCE: 18.9%)', PLOT_COLORS.primary),
      generateJVCurve(1.05, 21.5, 0.75, 'Device B (PCE: 16.9%)', PLOT_COLORS.secondary),
      generateJVCurve(1.08, 20, 0.72, 'Device C (PCE: 15.6%)', PLOT_COLORS.tertiary),
    ],
    layout: {
      title: { text: 'J-V Characteristics', font: { size: 14 } },
      xaxis: { 
        title: { text: 'Voltage (V)' }, 
        gridcolor: '#e9ecef',
        zeroline: true,
        zerolinecolor: '#868e96',
      },
      yaxis: { 
        title: { text: 'Current Density (mA/cm²)' }, 
        gridcolor: '#e9ecef',
        zeroline: true,
        zerolinecolor: '#868e96',
      },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 40, r: 20, b: 50, l: 60 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.25 },
    },
  };
}

/** Generate example scatter plot for parameter correlation */
function generateScatterPlotData() {
  const n = 30;
  const x = Array.from({ length: n }, () => 100 + Math.random() * 60);
  const y = x.map(xi => 12 + (xi - 100) * 0.08 + (Math.random() - 0.5) * 3);
  
  return {
    data: [{
      x,
      y,
      type: 'scatter' as const,
      mode: 'markers' as const,
      marker: { 
        color: y,
        colorscale: 'Viridis',
        size: 10,
        showscale: true,
        colorbar: { title: { text: 'PCE (%)' } },
      },
    }],
    layout: {
      title: { text: 'Annealing Temp vs PCE', font: { size: 14 } },
      xaxis: { title: { text: 'Annealing Temperature (°C)' }, gridcolor: '#e9ecef' },
      yaxis: { title: { text: 'PCE (%)' }, gridcolor: '#e9ecef' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 40, r: 20, b: 50, l: 50 },
    },
  };
}

/** Generate example bar chart for layer comparison */
function generateBarChartData() {
  const layers = ['ETL', 'Perovskite', 'HTL', 'Metal'];
  const pceContribution = [2.1, 12.5, 3.2, 0.8];
  
  return {
    data: [{
      x: layers,
      y: pceContribution,
      type: 'bar' as const,
      marker: {
        color: [PLOT_COLORS.primary, PLOT_COLORS.secondary, PLOT_COLORS.tertiary, PLOT_COLORS.quaternary],
      },
    }],
    layout: {
      title: { text: 'Layer Contribution to PCE', font: { size: 14 } },
      xaxis: { title: { text: 'Layer' } },
      yaxis: { title: { text: 'PCE Contribution (%)' }, gridcolor: '#e9ecef' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 40, r: 20, b: 50, l: 50 },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plot Widget Component
// ─────────────────────────────────────────────────────────────────────────────

function PlotWidgetComponent({
  widget,
  onMouseDownDrag,
  onMouseDownResize,
  onDelete,
  isSelected,
  onSelect,
}: {
  widget: PlotWidget;
  onMouseDownDrag: (e: React.MouseEvent) => void;
  onMouseDownResize: (e: React.MouseEvent) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // Generate plot data based on type
  const plotConfig = useMemo(() => {
    switch (widget.type) {
      case 'boxplot':
        return generateBoxPlotData('Annealing Temp');
      case 'jv-curve':
        return generateJVCurveData();
      case 'scatter':
        return generateScatterPlotData();
      case 'bar':
        return generateBarChartData();
      default:
        return generateBoxPlotData('Parameter');
    }
  }, [widget.type]);

  return (
    <Paper
      withBorder
      shadow={isSelected ? 'md' : 'xs'}
      style={{
        position: 'absolute',
        left: widget.x,
        top: widget.y,
        width: widget.width,
        height: widget.height,
        cursor: 'default',
        borderColor: isSelected ? 'var(--mantine-color-blue-5)' : undefined,
        borderWidth: isSelected ? 2 : 1,
        overflow: 'hidden',
        background: 'white',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Header */}
      <Group
        justify="space-between"
        px="xs"
        py={4}
        style={{
          background: 'var(--mantine-color-gray-0)',
          borderBottom: '1px solid var(--mantine-color-gray-3)',
          cursor: 'grab',
        }}
        onMouseDown={onMouseDownDrag}
      >
        <Group gap="xs">
          <IconGripVertical size={14} color="var(--mantine-color-gray-5)" />
          <Text size="xs" fw={500} truncate style={{ maxWidth: widget.width - 80 }}>
            {widget.title}
          </Text>
        </Group>
        <ActionIcon
          size="xs"
          variant="subtle"
          color="red"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <IconX size={12} />
        </ActionIcon>
      </Group>

      {/* Plot */}
      <Box style={{ height: widget.height - 32, width: '100%' }}>
        <Plot
          data={plotConfig.data}
          layout={{
            ...plotConfig.layout,
            autosize: true,
          }}
          config={{
            responsive: true,
            displayModeBar: false,
          }}
          style={{ width: '100%', height: '100%' }}
        />
      </Box>

      {/* Resize Handle */}
      <Box
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: 'se-resize',
          background: 'linear-gradient(135deg, transparent 50%, var(--mantine-color-gray-4) 50%)',
        }}
        onMouseDown={onMouseDownResize}
      />
    </Paper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Experiment List Item
// ─────────────────────────────────────────────────────────────────────────────

function ExperimentListItem({
  experiment,
  isSelected,
  onSelect,
  collectionColor,
}: {
  experiment: Experiment;
  isSelected: boolean;
  onSelect: () => void;
  collectionColor?: string;
}) {
  const status = getExperimentStatus(experiment);
  const statusColor = status === 'finished' ? 'green' : status === 'ready' ? 'yellow' : 'red';
  const statusLabel = status === 'finished' ? 'Finished' : status === 'ready' ? 'Ready' : 'Incomplete';

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      style={{
        cursor: 'pointer',
        background: isSelected ? 'var(--mantine-color-blue-0)' : undefined,
        borderColor: isSelected ? 'var(--mantine-color-blue-4)' : undefined,
        borderLeft: collectionColor ? `4px solid ${collectionColor}` : undefined,
      }}
      onClick={onSelect}
    >
      <Group justify="space-between" wrap="nowrap">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text size="sm" fw={600} truncate>
              {experiment.name || 'Untitled'}
            </Text>
            <Badge size="xs" color={statusColor} variant="dot">
              {statusLabel}
            </Badge>
          </Group>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              {experiment.date || 'No date'}
            </Text>
            <Text size="xs" c="dimmed">•</Text>
            <Text size="xs" c="dimmed">
              {experiment.substrates.length} substrate{experiment.substrates.length !== 1 ? 's' : ''}
            </Text>
          </Group>
        </Box>
      </Group>
    </Paper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Table Component
// ─────────────────────────────────────────────────────────────────────────────

const PARAM_KEYS = [
  'depositionMethod', 'substrateTemp', 'depositionAtmosphere', 'solutionVolume',
  'dryingMethod', 'annealingTime', 'annealingTemp', 'annealingAtmosphere',
] as const;

function formatParamName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function DataTablePanel({
  experiment,
  isExpanded,
  onToggleExpand,
}: {
  experiment: Experiment | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [selectedLayers, setSelectedLayers] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'varied'>('all');

  if (!experiment) {
    return (
      <Paper
        withBorder
        style={{
          borderTop: '2px solid var(--mantine-color-blue-4)',
          background: 'var(--mantine-color-gray-0)',
        }}
      >
        <Group justify="space-between" p="sm">
          <Group gap="sm">
            <IconChartBar size={18} />
            <Text size="sm" fw={500}>Data Table</Text>
          </Group>
          <ActionIcon variant="subtle" onClick={onToggleExpand}>
            {isExpanded ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
          </ActionIcon>
        </Group>
        {isExpanded && (
          <Box p="md" pt={0}>
            <Text size="sm" c="dimmed" ta="center" py="lg">
              Select an experiment to view data
            </Text>
          </Box>
        )}
      </Paper>
    );
  }

  const variedParams = getVariedParameters(experiment);
  const variedParamKeys = new Set(variedParams.map(p => p.paramKey));

  // Build layer options for filter
  const layerOptions = experiment.layers.map(l => ({
    value: l.id,
    label: l.name,
  }));

  // Filter layers based on selection
  const filteredLayers = selectedLayers.length > 0
    ? experiment.layers.filter(l => selectedLayers.includes(l.id))
    : experiment.layers;

  // Get parameter columns based on filter mode
  const getVisibleParams = (layer: ExperimentLayer) => {
    return PARAM_KEYS.filter(key => {
      const param = layer[key];
      if (!param) {return false;}
      if (filterMode === 'varied') {
        const paramKey = `${layer.id}:${key}`;
        return variedParamKeys.has(paramKey);
      }
      return true;
    });
  };

  // Build table data: each row is a substrate, columns are layer parameters
  const buildTableData = () => {
    const columns: { key: string; label: string; layerName: string; isVaried: boolean }[] = [];
    
    for (const layer of filteredLayers) {
      const visibleParams = getVisibleParams(layer);
      for (const paramKey of visibleParams) {
        const fullKey = `${layer.id}:${paramKey}`;
        columns.push({
          key: fullKey,
          label: formatParamName(paramKey),
          layerName: layer.name,
          isVaried: variedParamKeys.has(fullKey),
        });
      }
    }

    const rows = experiment.substrates.map(substrate => {
      const rowData: { [key: string]: string } = {
        substrateName: substrate.name,
      };
      
      for (const col of columns) {
        // Check if substrate has specific value (for varied params)
        const substrateValue = substrate.parameterValues?.[col.key];
        if (substrateValue) {
          rowData[col.key] = substrateValue;
        } else {
          // Get constant value from layer
          const [layerId, paramName] = col.key.split(':');
          const layer = experiment.layers.find(l => l.id === layerId);
          const param = layer?.[paramName as keyof typeof layer];
          if (param && typeof param === 'object' && 'value' in param) {
            rowData[col.key] = param.value;
          } else {
            rowData[col.key] = '—';
          }
        }
      }
      
      return rowData;
    });

    return { columns, rows };
  };

  const { columns, rows } = buildTableData();

  return (
    <Paper
      withBorder
      style={{
        borderTop: '2px solid var(--mantine-color-blue-4)',
        background: 'var(--mantine-color-gray-0)',
      }}
    >
      {/* Header */}
      <Group justify="space-between" p="sm">
        <Group gap="sm">
          <IconChartBar size={18} />
          <Text size="sm" fw={500}>Data Table</Text>
          <Badge size="xs" variant="light">
            {experiment.substrates.length} substrates × {columns.length} parameters
          </Badge>
        </Group>
        <Group gap="sm">
          {/* Filters */}
          <SegmentedControl
            size="xs"
            value={filterMode}
            onChange={(v) => setFilterMode(v as 'all' | 'varied')}
            data={[
              { value: 'all', label: 'All Parameters' },
              { value: 'varied', label: 'Varied Only' },
            ]}
          />
          <MultiSelect
            size="xs"
            placeholder="Filter layers..."
            data={layerOptions}
            value={selectedLayers}
            onChange={setSelectedLayers}
            clearable
            style={{ minWidth: 150 }}
          />
          <ActionIcon variant="subtle" onClick={onToggleExpand}>
            {isExpanded ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
          </ActionIcon>
        </Group>
      </Group>

      {/* Table */}
      {isExpanded && (
        <ScrollArea h={200} p="sm" pt={0}>
          {columns.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="lg">
              No parameters to display. {filterMode === 'varied' ? 'No varied parameters in this experiment.' : 'No layers with parameters.'}
            </Text>
          ) : (
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ position: 'sticky', left: 0, background: 'var(--mantine-color-gray-1)', zIndex: 1 }}>
                    Substrate
                  </Table.Th>
                  {columns.map(col => (
                    <Table.Th key={col.key}>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">{col.layerName}</Text>
                        <Group gap={4}>
                          <Text size="xs">{col.label}</Text>
                          {col.isVaried && (
                            <Badge size="xs" color="violet" variant="light">varied</Badge>
                          )}
                        </Group>
                      </Stack>
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row, idx) => (
                  <Table.Tr key={idx}>
                    <Table.Td style={{ position: 'sticky', left: 0, background: idx % 2 === 0 ? 'white' : 'var(--mantine-color-gray-0)', fontWeight: 500 }}>
                      {row.substrateName}
                    </Table.Td>
                    {columns.map(col => (
                      <Table.Td key={col.key}>
                        <Text size="xs">{row[col.key] || '—'}</Text>
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      )}
    </Paper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

const GRID_SIZE = 20; // snap grid size
const MIN_WIDGET_SIZE = 200;

export function AnalysisPage() {
  const { experiments, setActiveEntity } = useAppContext();
  const { getEntityColor, isEntityVisible } = useEntityCollection();
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [dataTableExpanded, setDataTableExpanded] = useState(true);
  
  // Plot widgets state
  const [widgets, setWidgets] = useState<PlotWidget[]>(() => [
    // Initial example widgets
    {
      id: crypto.randomUUID(),
      type: 'boxplot',
      title: 'PCE Distribution by Annealing Temp',
      x: 20,
      y: 20,
      width: 400,
      height: 320,
    },
    {
      id: crypto.randomUUID(),
      type: 'jv-curve',
      title: 'J-V Characteristics',
      x: 440,
      y: 20,
      width: 450,
      height: 320,
    },
    {
      id: crypto.randomUUID(),
      type: 'scatter',
      title: 'Annealing Temp vs PCE',
      x: 20,
      y: 360,
      width: 380,
      height: 300,
    },
    {
      id: crypto.randomUUID(),
      type: 'bar',
      title: 'Layer Contributions',
      x: 420,
      y: 360,
      width: 350,
      height: 300,
    },
  ]);
  
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const planeRef = useRef<HTMLDivElement>(null);

  const selectExperiment = (id: string | null) => {
    setSelectedExperimentId(id);
    setActiveEntity(id ? { kind: 'experiment', id } : null);
  };

  const selectedExperiment = experiments.find(e => e.id === selectedExperimentId);

  // Snap to grid helper
  const snapToGrid = (value: number): number => {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  };

  // Handle drag start
  const handleDragStart = (widgetId: string, e: React.MouseEvent) => {
    e.preventDefault();
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) {return;}
    
    setDragState({
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      startWidgetX: widget.x,
      startWidgetY: widget.y,
    });
    setSelectedWidgetId(widgetId);
  };

  // Handle resize start
  const handleResizeStart = (widgetId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) {return;}
    
    setResizeState({
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: widget.width,
      startHeight: widget.height,
    });
    setSelectedWidgetId(widgetId);
  };

  // Handle mouse move for drag/resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragState) {
        const deltaX = e.clientX - dragState.startX;
        const deltaY = e.clientY - dragState.startY;
        
        setWidgets(prev => prev.map(w => {
          if (w.id !== dragState.widgetId) {return w;}
          return {
            ...w,
            x: snapToGrid(Math.max(0, dragState.startWidgetX + deltaX)),
            y: snapToGrid(Math.max(0, dragState.startWidgetY + deltaY)),
          };
        }));
      }
      
      if (resizeState) {
        const deltaX = e.clientX - resizeState.startX;
        const deltaY = e.clientY - resizeState.startY;
        
        setWidgets(prev => prev.map(w => {
          if (w.id !== resizeState.widgetId) {return w;}
          return {
            ...w,
            width: snapToGrid(Math.max(MIN_WIDGET_SIZE, resizeState.startWidth + deltaX)),
            height: snapToGrid(Math.max(MIN_WIDGET_SIZE, resizeState.startHeight + deltaY)),
          };
        }));
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
      setResizeState(null);
    };

    if (dragState || resizeState) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, resizeState]);

  // Add new widget
  const addWidget = (type: PlotWidget['type']) => {
    const newWidget: PlotWidget = {
      id: crypto.randomUUID(),
      type,
      title: type === 'boxplot' ? 'Box Plot' 
           : type === 'jv-curve' ? 'J-V Curve'
           : type === 'scatter' ? 'Scatter Plot'
           : 'Bar Chart',
      x: snapToGrid(20 + widgets.length * 20),
      y: snapToGrid(20 + widgets.length * 20),
      width: 400,
      height: 300,
    };
    setWidgets(prev => [...prev, newWidget]);
    setSelectedWidgetId(newWidget.id);
  };

  // Delete widget
  const deleteWidget = (widgetId: string) => {
    setWidgets(prev => prev.filter(w => w.id !== widgetId));
    if (selectedWidgetId === widgetId) {
      setSelectedWidgetId(null);
    }
  };

  // Filter experiments
  const visibleExperiments = experiments.filter(e => isEntityVisible('experiment', e.id));

  return (
    <Box style={{ display: 'flex', height: 'calc(100vh - 60px)', flexDirection: 'column' }}>
      <Box style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Main: Plot Plane */}
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <Group p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)', background: 'white' }}>
            <Text size="sm" fw={500}>Add Plot:</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => addWidget('boxplot')}>
              Box Plot
            </Button>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => addWidget('jv-curve')}>
              J-V Curve
            </Button>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => addWidget('scatter')}>
              Scatter
            </Button>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => addWidget('bar')}>
              Bar Chart
            </Button>
            <Divider orientation="vertical" />
            <Text size="xs" c="dimmed">
              {widgets.length} plot{widgets.length !== 1 ? 's' : ''} • Drag to move, corner to resize
            </Text>
          </Group>

          {/* Plot Plane */}
          <Box
            ref={planeRef}
            style={{
              flex: 1,
              position: 'relative',
              overflow: 'auto',
              background: `
                linear-gradient(to right, var(--mantine-color-gray-2) 1px, transparent 1px),
                linear-gradient(to bottom, var(--mantine-color-gray-2) 1px, transparent 1px)
              `,
              backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
              backgroundColor: 'var(--mantine-color-gray-0)',
            }}
            onClick={() => setSelectedWidgetId(null)}
          >
            {/* Widgets */}
            {widgets.map(widget => (
              <PlotWidgetComponent
                key={widget.id}
                widget={widget}
                onMouseDownDrag={(e) => handleDragStart(widget.id, e)}
                onMouseDownResize={(e) => handleResizeStart(widget.id, e)}
                onDelete={() => deleteWidget(widget.id)}
                isSelected={selectedWidgetId === widget.id}
                onSelect={() => setSelectedWidgetId(widget.id)}
              />
            ))}
            
            {/* Empty state */}
            {widgets.length === 0 && (
              <Box
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                }}
              >
                <IconChartBar size={64} color="var(--mantine-color-gray-4)" />
                <Text size="lg" c="dimmed" mt="md">
                  No plots yet
                </Text>
                <Text size="sm" c="dimmed" mt="xs">
                  Use the toolbar above to add plots
                </Text>
              </Box>
            )}
          </Box>
        </Box>

        {/* Right Sidebar: Experiment List */}
        <Box
          style={{
            width: 280,
            borderLeft: '1px solid var(--mantine-color-default-border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'white',
          }}
        >
          <Group justify="space-between" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <Title order={5}>Experiments</Title>
          </Group>

          <ScrollArea style={{ flex: 1 }} p="sm">
            <Stack gap="sm">
              {visibleExperiments.length === 0 ? (
                <Paper p="lg" ta="center" style={{ background: 'var(--mantine-color-gray-0)' }}>
                  <IconFlask size={32} color="var(--mantine-color-gray-5)" />
                  <Text size="sm" c="dimmed" mt="sm">
                    No experiments
                  </Text>
                </Paper>
              ) : (
                visibleExperiments.map(exp => (
                  <ExperimentListItem
                    key={exp.id}
                    experiment={exp}
                    isSelected={selectedExperimentId === exp.id}
                    onSelect={() => selectExperiment(exp.id)}
                    collectionColor={getEntityColor('experiment', exp.id) ?? undefined}
                  />
                ))
              )}
            </Stack>
          </ScrollArea>
        </Box>
      </Box>

      {/* Bottom: Data Table */}
      <DataTablePanel
        experiment={selectedExperiment ?? null}
        isExpanded={dataTableExpanded}
        onToggleExpand={() => setDataTableExpanded(!dataTableExpanded)}
      />
    </Box>
  );
}
