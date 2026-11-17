import type { Metadata } from 'next';
import { DashboardShell } from '../components/dashboard-shell';
import { requireDashboardSession } from '../lib/require-session';
import { SaccoManagement } from './sacco-management';

export const metadata: Metadata = {
  title: 'SACCOs',
};

export default async function SaccosPage() {
  await requireDashboardSession();
  return (
    <DashboardShell activeSection="saccos">
      <section className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM ADMINISTRATION</p>
          <h1>SACCOs</h1>
          <p className="page-description">Provision organisations and their first administrator accounts.</p>
        </div>
        <span className="preview-badge"><span /> Authorised platform admins</span>
      </section>
      <SaccoManagement />
    </DashboardShell>
  );
}
