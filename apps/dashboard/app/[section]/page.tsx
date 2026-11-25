import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DashboardShell } from '../components/dashboard-shell';
import { AccountEmailSettings } from '../components/account-email-settings';
import { requireDashboardSession } from '../lib/require-session';

const sections = {
  riders: {
    title: 'Riders',
    description: 'Rider profiles and SACCO membership.',
    eyebrow: 'PEOPLE & FLEET',
    icon: 'R',
    emptyTitle: 'Your rider directory is ready for setup',
    emptyDescription: 'Once a SACCO is provisioned and the API is connected, registered riders will appear here.',
    checklist: ['Rider profiles and contact details', 'SACCO membership status', 'Work and trip history'],
    href: '/assignments',
    next: 'View assignments',
  },
  fleet: {
    title: 'Fleet',
    description: 'Vehicles registered to your SACCO.',
    eyebrow: 'PEOPLE & FLEET',
    icon: 'F',
    emptyTitle: 'Your fleet register is ready for setup',
    emptyDescription: 'Vehicle records will appear here after your SACCO is provisioned and connected to the API.',
    checklist: ['Vehicle registration and type', 'Current availability', 'Assignment history'],
    href: '/assignments',
    next: 'View assignments',
  },
  assignments: {
    title: 'Assignments',
    description: 'Rider and vehicle assignment history.',
    eyebrow: 'PEOPLE & FLEET',
    icon: 'A',
    emptyTitle: 'Assignments will appear here',
    emptyDescription: 'The assignment register depends on connected rider and vehicle records. No assignments are stored yet.',
    checklist: ['Current rider-to-vehicle assignments', 'Assignment start and end dates', 'Historical assignment records'],
    href: '/riders',
    next: 'View riders',
  },
  trips: {
    title: 'Trips',
    description: 'Daily trips and rider work sessions.',
    eyebrow: 'OPERATIONS',
    icon: 'T',
    emptyTitle: 'No trip records to display',
    emptyDescription: 'Trip history will populate from real rider activity after secure sign-in and API workflows are available.',
    checklist: ['Session-linked trip history', 'Rider-reported trip details', 'Daily activity summaries'],
    href: '/expenses',
    next: 'View expenses',
  },
  expenses: {
    title: 'Expenses',
    description: 'Rider-reported operating expenses.',
    eyebrow: 'OPERATIONS',
    icon: 'E',
    emptyTitle: 'No expense records to display',
    emptyDescription: 'Expense entries will appear here once authenticated riders can report operating costs.',
    checklist: ['Rider-reported amounts', 'Expense categories and notes', 'Session-linked expense history'],
    href: '/trips',
    next: 'View trips',
  },
  reports: {
    title: 'Reports',
    description: 'Operational summaries for your SACCO.',
    eyebrow: 'INSIGHTS',
    icon: 'R',
    emptyTitle: 'Reports need connected operational data',
    emptyDescription: 'Summaries and exports will be available after real rider, trip, and expense records are connected.',
    checklist: ['Daily operations summaries', 'Reported fare and expense totals', 'Date-filtered records'],
    href: '/trips',
    next: 'View trips',
  },
  settings: {
    title: 'Settings',
    description: 'SACCO workspace and administrator settings.',
    eyebrow: 'ADMINISTRATION',
    icon: 'S',
    emptyTitle: 'Workspace settings are not connected yet',
    emptyDescription: 'Organisation details and administrator access require SACCO provisioning and secure authentication.',
    checklist: ['SACCO profile', 'Administrator accounts and roles', 'Security and access controls'],
    href: '/',
    next: 'Back to overview',
  },
} as const;

type SectionKey = keyof typeof sections;

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!Object.hasOwn(sections, section)) notFound();
  await requireDashboardSession();

  const page = sections[section as SectionKey];

  return (
    <DashboardShell activeSection={section}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p className="page-description">{page.description}</p>
        </div>
        <span className="preview-badge"><span /> Preview workspace</span>
      </section>

      {section === 'settings' ? <AccountEmailSettings /> : <>
      <section className="directory-status">
        <span className="directory-icon">{page.icon}</span>
        <div><strong>Live SACCO data is not connected</strong><span>This page is a preview of the administration workspace. No sample records are shown.</span></div>
        <span className="connection-status">Setup required</span>
      </section>

      <section className="directory-layout">
        <article className="panel directory-panel">
          <div className="directory-panel-heading">
            <div><h2>{page.title} directory</h2><p>Records are loaded from your secure SACCO workspace.</p></div>
            <span className="record-count">0 records</span>
          </div>
          <div className="directory-empty">
            <span className="directory-empty-icon" aria-hidden="true">{page.icon}</span>
            <h2>{page.emptyTitle}</h2>
            <p>{page.emptyDescription}</p>
            <span className="empty-state-note"><span /> Waiting for API connection</span>
          </div>
        </article>

        <aside className="panel info-panel">
          <span className="info-eyebrow">IN THIS SECTION</span>
          <h2>What you&apos;ll find here</h2>
          <ul>{page.checklist.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul>
          <div className="info-divider" />
          <p className="info-note">Records will only be shown to authorised administrators in their own SACCO.</p>
          <Link className="text-link info-link" href={page.href}>{page.next} <span aria-hidden="true">→</span></Link>
        </aside>
      </section>
      </>}
    </DashboardShell>
  );
}
