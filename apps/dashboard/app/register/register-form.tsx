'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

const initialForm = {
  name: '',
  registrationNumber: '',
  phoneNumber: '',
  operatingArea: '',
  adminFullName: '',
  adminPhoneNumber: '',
  adminEmail: '',
  adminPassword: '',
};

const configuredApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const apiBaseUrl = configuredApiUrl.replace(/\/+$/, '').endsWith('/api/v1')
  ? configuredApiUrl.replace(/\/+$/, '')
  : `${configuredApiUrl.replace(/\/+$/, '')}/api/v1`;

export function RegisterForm() {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationNotice, setVerificationNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/saccos/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.code === 'ACCOUNT_CREATED_EMAIL_FAILED') {
          setNeedsSignIn(false);
          setVerificationNotice('Your SACCO workspace was created, but the confirmation email could not be sent. Request a code again after email delivery is configured.');
          return;
        }
        setError(result.error?.message ?? 'Could not create your SACCO workspace.');
        return;
      }
      setNeedsSignIn(false);
      setVerificationNotice('A confirmation code was sent to your email. Enter it below to verify your account.');
      setVerificationCode('');
    } catch {
      setError(`Could not reach the registration service at ${apiBaseUrl}. If you already submitted the form, check whether your SACCO was created before trying again.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/email/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.adminEmail,
          code: verificationCode,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not verify the email. Check the code and try again.');
        return;
      }
      setNeedsSignIn(true);
      setVerificationNotice('');
      setForm(initialForm);
    } catch {
      setError('Could not reach the email verification service. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendVerificationCode() {
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/email/verification/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.adminEmail }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not resend the confirmation code.');
        return;
      }
      setVerificationNotice('If this email has an unverified account, a new confirmation code has been sent.');
    } catch {
      setError('Could not reach the email verification service. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (needsSignIn) {
    return (
      <div className="registration-success" role="status">
        <strong>Your email is verified and SACCO workspace is ready.</strong>
        <span>Sign in using your email and password. A separate code will be sent for email sign-in.</span>
        <Link className="login-submit" href="/login">Continue to sign in <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  if (verificationNotice || verificationCode) {
    return (
      <form className="login-form registration-form" onSubmit={verifyEmail}>
        <h2>Verify administrator email</h2>
        <p>{verificationNotice || `Enter the confirmation code sent to ${form.adminEmail}.`}</p>
        <label htmlFor="register-email-code">Six-digit email code</label>
        <input id="register-email-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} onChange={(event) => setVerificationCode(event.target.value)} required value={verificationCode} />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" disabled={isSubmitting || verificationCode.length !== 6} type="submit">
          {isSubmitting ? 'Verifying…' : 'Verify email'}
        </button>
        <button className="login-secondary" disabled={isSubmitting} onClick={() => void resendVerificationCode()} type="button">Resend code</button>
      </form>
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
      <label htmlFor="register-admin-email">Administrator email (primary login)</label>
      <input id="register-admin-email" autoComplete="email" inputMode="email" maxLength={254} onChange={(event) => updateField('adminEmail', event.target.value)} required type="email" value={form.adminEmail} />
      <label htmlFor="register-admin-password">Create password</label>
      <input id="register-admin-password" autoComplete="new-password" minLength={14} maxLength={128} onChange={(event) => updateField('adminPassword', event.target.value)} required type="password" value={form.adminPassword} />
      <p className="registration-note">Use a unique password with at least 14 characters. We’ll email a confirmation code before enabling sign-in.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Creating workspace…' : 'Create SACCO workspace'}
        {!isSubmitting && <span aria-hidden="true">→</span>}
      </button>
    </form>
  );
}
