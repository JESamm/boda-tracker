import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from './register-form';

export const metadata: Metadata = {
  title: 'Create a SACCO workspace',
};

export default function RegisterPage() {
  return (
    <main className="login-page">
      <div className="login-brand-row">
        <Link className="brand" href="/" aria-label="Boda-Tracker">
          <span className="brand-mark">B</span>
          <span className="brand-name">boda<span>-tracker</span></span>
        </Link>
        <Link className="auth-page-link" href="/login">Already have an account? Sign in</Link>
      </div>
      <section className="login-card register-card" aria-labelledby="register-title">
        <span className="eyebrow">SACCO WORKSPACE SETUP</span>
        <h1 id="register-title">Bring your SACCO online</h1>
        <p className="login-description">
          Create your SACCO workspace and administrator account. Once set up, add riders from your portal so they can sign in to the Boda-Tracker rider app.
        </p>
        <RegisterForm />
      </section>
      <p className="login-footer">Your workspace is available as soon as registration is complete.</p>
    </main>
  );
}
