'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const initialForm = {
  name: '',
  registrationNumber: '',
  phoneNumber: '',
  operatingArea: '',
  adminFullName: '',
  adminPhoneNumber: '',
  adminPassword: '',
};

const configuredApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const apiBaseUrl = configuredApiUrl.replace(/\/+$/, '').endsWith('/api/v1')
  ? configuredApiUrl.replace(/\/+$/, '')
  : `${configuredApiUrl.replace(/\/+$/, '')}/api/v1`;

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    let workspaceCreated = false;

    try {
      const response = await fetch(`${apiBaseUrl}/saccos/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      workspaceCreated = response.ok;
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not create your SACCO workspace.');
        return;
      }

      const login = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: form.adminPhoneNumber,
          password: form.adminPassword,
        }),
      });
      if (!login.ok) {
        setNeedsSignIn(true);
        setForm(initialForm);
        return;
      }

      router.replace('/riders');
      router.refresh();
    } catch {
      if (workspaceCreated) {
        setNeedsSignIn(true);
        setForm(initialForm);
      } else {
        setError(`Could not reach the registration service at ${apiBaseUrl}. If you already submitted the form, check whether your SACCO was created before trying again.`);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (needsSignIn) {
    return (
      <div className="registration-success" role="status">
        <strong>Your SACCO workspace is ready.</strong>
        <span>Sign in with the administrator phone number and password you entered to start adding riders.</span>
        <Link className="login-submit" href="/login">Continue to sign in <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  return (
    <form className="login-form registration-form" onSubmit={submit}>
      <h2>SACCO details</h2>
      <label htmlFor="register-sacco-name">SACCO name</label>
      <input id="register-sacco-name" autoComplete="organization" maxLength={120} onChange={(event) => updateField('name', event.target.value)} required value={form.name} />
      <div className="registration-fields-row">
        <div>
          <label htmlFor="register-sacco-number">Registration number <span>(optional)</span></label>
          <input id="register-sacco-number" maxLength={40} onChange={(event) => updateField('registrationNumber', event.target.value)} value={form.registrationNumber} />
        </div>
        <div>
          <label htmlFor="register-operating-area">Operating area <span>(optional)</span></label>
          <input id="register-operating-area" maxLength={120} onChange={(event) => updateField('operatingArea', event.target.value)} value={form.operatingArea} />
        </div>
      </div>
      <label htmlFor="register-sacco-phone">SACCO contact phone <span>(optional)</span></label>
      <input id="register-sacco-phone" inputMode="tel" maxLength={20} onChange={(event) => updateField('phoneNumber', event.target.value)} placeholder="+254 7XX XXX XXX" value={form.phoneNumber} />

      <h2>Workspace administrator</h2>
      <label htmlFor="register-admin-name">Full name</label>
      <input id="register-admin-name" autoComplete="name" maxLength={100} onChange={(event) => updateField('adminFullName', event.target.value)} required value={form.adminFullName} />
      <label htmlFor="register-admin-phone">Administrator login phone</label>
      <input id="register-admin-phone" autoComplete="username" inputMode="tel" maxLength={20} onChange={(event) => updateField('adminPhoneNumber', event.target.value)} placeholder="+254 7XX XXX XXX" required value={form.adminPhoneNumber} />
      <label htmlFor="register-admin-password">Create password</label>
      <input id="register-admin-password" autoComplete="new-password" minLength={14} maxLength={128} onChange={(event) => updateField('adminPassword', event.target.value)} required type="password" value={form.adminPassword} />
      <p className="registration-note">Use a unique password with at least 14 characters. Your workspace is activated immediately.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Creating workspace…' : 'Create SACCO workspace'}
        {!isSubmitting && <span aria-hidden="true">→</span>}
      </button>
    </form>
  );
}
