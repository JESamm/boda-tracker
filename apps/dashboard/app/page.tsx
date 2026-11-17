import Link from 'next/link';
import { DashboardShell } from './components/dashboard-shell';
import { requireDashboardSession } from './lib/require-session';

const overviewMetrics = [
  { label: 'Active riders', value: '—', detail: 'Live data not connected', tone: 'green' },
  { label: 'Vehicles in fleet', value: '—', detail: 'Live data not connected', tone: 'blue' },
  { label: 'Trips today', value: '—', detail: 'Live data not connected', tone: 'amber' },
  { label: 'Reported expenses', value: '—', detail: 'Live data not connected', tone: 'violet' },
] as const;

const modules = [
  { title: 'Rider management', description: 'Manage rider profiles and SACCO membership.', href: '/riders', icon: 'R' },
  { title: 'Fleet management', description: 'Keep vehicle records and assignments organised.', href: '/fleet', icon: 'F' },
  { title: 'Daily operations', description: 'Review trips, work sessions, and reported expenses.', href: '/trips', icon: 'O' },
] as const;

export default async function HomePage() {
  await requireDashboardSession();

  return (
    <DashboardShell activeSection="overview">
      <section className="page-heading">
        <div>
          <p className="eyebrow">DAILY OVERVIEW</p>
          <h1>Operations overview</h1>
          <p className="page-description">A clear view of your SACCO&apos;s daily operations.</p>
        </div>
        <span className="preview-badge"><span /> Preview workspace</span>
      </section>

      <section className="connection-banner" aria-label="Workspace connection status">
        <span className="connection-icon" aria-hidden="true">i</span>
        <div>
          <strong>Your workspace is not connected to a SACCO yet</strong>
          <p>This preview contains no operational records. Connect the API and provision a SACCO to see live information.</p>
        </div>
        <span className="connection-status">Awaiting setup</span>
      </section>

      <section className="metrics-grid" aria-label="Operations summary">
        {overviewMetrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className="metric-topline">
              <span>{metric.label}</span>
              <span className={`metric-icon ${metric.tone}`} aria-hidden="true">{metric.label.slice(0, 1)}</span>
            </div>
            <strong className="metric-value">{metric.value}</strong>
            <span className="metric-detail">{metric.detail}</span>
          </article>
        ))}
      </section>

      <section className="overview-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Today&apos;s activity</h2>
              <p>Work sessions and trips recorded today</p>
            </div>
            <Link className="text-link" href="/trips">View trips <span aria-hidden="true">→</span></Link>
          </div>
          <div className="empty-activity">
            <div className="empty-illustration" aria-hidden="true">
              <span className="empty-road" />
              <span className="empty-pin">•</span>
            </div>
            <strong>No activity to show yet</strong>
            <p>When your SACCO is connected, recorded work sessions and trips will appear here.</p>
          </div>
        </article>

        <article className="panel setup-panel">
          <div className="panel-heading">
            <div>
              <h2>Getting started</h2>
              <p>What this workspace needs before operations begin</p>
            </div>
          </div>
          <ol className="setup-list">
            <li>
              <span className="setup-step">1</span>
              <div><strong>Connect the API and database</strong><p>Enable secure, persistent storage for SACCO records.</p></div>
              <span className="step-status">Needed</span>
            </li>
            <li>
              <span className="setup-step">2</span>
              <div><strong>Set up your SACCO</strong><p>Provision an organisation and its administrators.</p></div>
              <span className="step-status">Needed</span>
            </li>
            <li>
              <span className="setup-step pending">3</span>
              <div><strong>Add riders and vehicles</strong><p>Build your fleet records and rider assignments.</p></div>
              <span className="step-status pending">Next</span>
            </li>
          </ol>
        </article>
      </section>

      <section className="modules-section" aria-labelledby="modules-title">
        <div className="section-heading">
          <div>
            <h2 id="modules-title">Your workspace</h2>
            <p>Explore the areas designed for SACCO administration.</p>
          </div>
        </div>
        <div className="module-grid">
          {modules.map((module) => (
            <Link className="module-card" href={module.href} key={module.title}>
              <span className="module-icon" aria-hidden="true">{module.icon}</span>
              <span className="module-copy">
                <strong>{module.title}</strong>
                <span>{module.description}</span>
              </span>
              <span className="module-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>
    </DashboardShell>
  );
}
