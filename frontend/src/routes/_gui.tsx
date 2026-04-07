import { MantineProvider } from '@mantine/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppProvider } from '@/store/AppContext';
import { AppLayout } from '@/components/AppLayout';
import { theme } from '@/gui/theme';
import { isLoggedIn } from '@/hooks/useAuth';

export const Route = createFileRoute('/_gui')({
  component: GuiLayout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: '/login' });
    }
  },
});

function GuiLayout() {
  return (
    <MantineProvider theme={theme}>
      <AppProvider>
        <AppLayout />
      </AppProvider>
    </MantineProvider>
  );
}
