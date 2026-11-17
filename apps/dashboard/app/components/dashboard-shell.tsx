'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const navigation = [
  {
    label: 'PLATFORM',
    links: [
      { title: 'SACCOs', href: '/saccos', icon: 'users' },
    ],
  },
  {
    label: 'WORKSPACE',
    links: [
      { title: 'Overview', href: '/', icon: 'grid' },
    ],
  },
  {
    label: 'PEOPLE & FLEET',
    links: [
      { title: 'Riders', href: '/riders', icon: 'users' },
      { title: 'Fleet', href: '/fleet', icon: 'vehicle' },
      { title: 'Assignments', href: '/assignments', icon: 'assign' },
    ],
  },
  {
    label: 'OPERATIONS',
    links: [
      { title: 'Trips', href: '/trips', icon: 'route' },
      { title: 'Expenses', href: '/expenses', icon: 'receipt' },
    ],
  },
  {
    label: 'INSIGHTS',
    links: [
      { title: 'Reports', href: '/reports', icon: 'chart' },
    ],
  },
] as const;

function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    vehicle: <><path d="M5 17h14l1-6-2-5H6l-2 5 1 6Z" /><path d="M4 11h16M7 17v2m10-2v2" /><circle cx="7.5" cy="14" r=".5" /><circle cx="16.5" cy="14" r=".5" /></>,
    assign: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 9h8m-8 4h5" /><circle cx="17" cy="15" r="2" /></>,
    route: <><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h4a4 4 0 0 0 4-4V9a4 4 0 0 1 4-4" /></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" /><path d="M9 8h6m-6 4h6" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z" /></>,
  };

  return (
    <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function DashboardShell({
  children,
  activeSection,
}: {
  children: ReactNode;
  activeSection: string;
}) {
  const router = useRouter();
  const [userName, setUserName] = useState('Admin');
  const [userRole, setUserRole] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/session', { method: 'POST' })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        const result = await response.json();
        if (response.ok && mounted) {
          setUserName(result.user?.fullName ?? 'Admin');
          setUserRole(result.user?.role ?? '');
        } else if (mounted) {
          setSessionError(result.error?.message ?? 'Your session could not be verified.');
        }
      })
      .catch(() => {
        if (mounted) setSessionError('Your session could not be verified. Check the API connection.');
      });

    return () => { mounted = false; };
  }, [router]);

  async function signOut() {
    setIsSigningOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        const result = await response.json();
        setSessionError(result.error?.message ?? 'Sign out failed. Try again.');
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setSessionError('Sign out failed because the service is unavailable.');
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Boda-Tracker overview">
          <span className="brand-mark">B</span>
          <span className="brand-name">boda<span>-tracker</span></span>
        </Link>

        <div className="organization-card">
          <span className="organization-avatar">S</span>
          <span className="organization-copy"><strong>SACCO workspace</strong><span>Administrator view</span></span>
          <span className="organization-chevron" aria-hidden="true">⌄</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((group) => (
            group.label === 'PLATFORM' && userRole !== 'PLATFORM_ADMIN' ? null :
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.links.map((link) => {
                const active = activeSection === link.href.replace('/', '') || (link.href === '/' && activeSection === 'overview');
                return (
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={`nav-link${active ? ' active' : ''}`}
                    href={link.href}
                    key={link.href}
                  >
                    <NavigationIcon name={link.icon} />
                    <span>{link.title}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <Link className={`nav-link${activeSection === 'settings' ? ' active' : ''}`} href="/settings" aria-current={activeSection === 'settings' ? 'page' : undefined}>
            <NavigationIcon name="settings" />
            <span>Settings</span>
          </Link>
          <div className="help-card">
            <span className="help-mark" aria-hidden="true">?</span>
            <div><strong>Building your workspace?</strong><span>Setup and connection are still in progress.</span></div>
          </div>
          <div className="sidebar-footer">Boda-Tracker <span>•</span> Preview</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>{activeSection === 'overview' ? 'Overview' : activeSection[0].toUpperCase() + activeSection.slice(1)}</strong></div>
          <div className="topbar-right">
            <span className="topbar-status"><span /> {sessionError ? 'Connection issue' : 'Live data unavailable'}</span>
            <span className="topbar-divider" />
            <span className="profile-name">{userName}</span>
            <button className="sign-out-button" disabled={isSigningOut} onClick={signOut} type="button">
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        {sessionError && <p className="session-error" role="status">{sessionError}</p>}
        <div className="page-content">{children}</div>
        <footer className="content-footer">
          <span>Built for transport operators and SACCOs in Kenya</span>
          <span>Preview environment <span className="footer-dot">•</span> No live records connected</span>
        </footer>
      </main>
    </div>
  );
}
