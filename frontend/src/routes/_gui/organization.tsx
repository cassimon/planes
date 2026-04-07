import { createFileRoute } from '@tanstack/react-router';
import { OrganizationPage } from '../Organization.page';

export const Route = createFileRoute('/_gui/organization')({
  component: OrganizationPage,
});
