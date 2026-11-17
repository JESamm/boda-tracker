import type { Metadata } from 'next';
import { DashboardShell } from '../components/dashboard-shell';
import { DirectoryManagement } from '../directory-management';
import { requireDashboardSession } from '../lib/require-session';

export const metadata: Metadata = { title: 'Fleet' };

export default async function FleetPage() {
  await requireDashboardSession();
  return (
    <DashboardShell activeSection="fleet">
      <section className="page-heading">
        <div><p className="eyebrow">PEOPLE & FLEET</p><h1>Fleet</h1><p className="page-description">Register and review vehicles belonging to your SACCO.</p></div>
        <span className="preview-badge"><span /> SACCO-scoped</span>
      </section>
      <DirectoryManagement type="vehicles" />
    </DashboardShell>
  );
}
