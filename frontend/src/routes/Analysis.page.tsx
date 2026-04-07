import { Box, Paper, Text, Title } from "@mantine/core"
import { IconChartBar } from "@tabler/icons-react"

export function AnalysisPage() {
  return (
    <Box
      style={{
        height: "calc(100vh - 60px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Paper
        p="xl"
        ta="center"
        style={{ background: "var(--mantine-color-gray-0)" }}
      >
        <IconChartBar size={64} color="var(--mantine-color-gray-4)" />
        <Title order={3} mt="md">
          Analysis
        </Title>
        <Text c="dimmed" mt="sm">
          Plot-based analysis will be available in a future update.
        </Text>
      </Paper>
    </Box>
  )
}
