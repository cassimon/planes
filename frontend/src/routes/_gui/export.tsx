import { createFileRoute } from '@tanstack/react-router';
import { ExportPage } from '../Export.page';

export const Route = createFileRoute('/_gui/export')({
  component: ExportPage,
});
