import type { Metadata } from 'next';
import { DashboardShell } from '../components/dashboard-shell';
import { DirectoryManagement } from '../directory-management';
import { requireDashboardSession } from '../lib/require-session';

export const metadata: Metadata = { title: 'Riders' };

export default async function RidersPage() {
  await requireDashboardSession();
  return (
    <DashboardShell activeSection="riders">
      <section className="page-heading">
        <div><p className="eyebrow">PEOPLE & FLEET</p><h1>Riders</h1><p className="page-description">Manage rider accounts for your SACCO.</p></div>
        <span className="preview-badge"><span /> SACCO-scoped</span>
      </section>
      <DirectoryManagement type="riders" />
    </DashboardShell>
  );
}
