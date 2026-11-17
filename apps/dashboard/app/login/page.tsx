import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-brand-row">
        <Link className="brand" href="/" aria-label="Boda-Tracker">
          <span className="brand-mark">B</span>
          <span className="brand-name">boda<span>-tracker</span></span>
        </Link>
        <span className="preview-badge"><span /> Secure admin sign-in</span>
      </div>
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
          </svg>
        </span>
        <p className="eyebrow">SACCO ADMINISTRATION</p>
        <h1 id="login-title">Welcome back</h1>
        <p className="login-description">Sign in to access your Boda-Tracker workspace.</p>
        <LoginForm />
      </section>
      <p className="login-footer">Secure access for authorised Boda-Tracker administrators.</p>
    </main>
  );
}
