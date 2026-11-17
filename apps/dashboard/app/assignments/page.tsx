import type { Metadata } from 'next';
import { DashboardShell } from '../components/dashboard-shell';
import { AssignmentsManagement } from '../assignments-management';
import { requireDashboardSession } from '../lib/require-session';

export const metadata: Metadata = { title: 'Assignments' };

export default async function AssignmentsPage() {
  await requireDashboardSession();
  return (
    <DashboardShell activeSection="assignments">
      <section className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE & FLEET</p>
          <h1>Assignments</h1>
          <p className="page-description">Assign active SACCO vehicles to riders and manage current assignments.</p>
        </div>
        <span className="preview-badge"><span /> SACCO-scoped</span>
      </section>
      <AssignmentsManagement />
    </DashboardShell>
  );
}
