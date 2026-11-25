'use client';

import { useEffect, useState, type FormEvent } from 'react';

type EmailStatus = {
  email?: string | null;
  emailVerified?: boolean;
};

const configuredApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const normalizedApiUrl = configuredApiUrl.replace(/\/+$/, '');
const apiBaseUrl = normalizedApiUrl.endsWith('/api/v1')
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api/v1`;

export function AccountEmailSettings() {
  const [email, setEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/session', { method: 'POST' })
      .then(async (response) => {
        const result = await response.json() as { user?: EmailStatus; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? 'Could not load account details.');
        if (mounted) {
          setEmail(result.user?.email ?? '');
          setNewEmail(result.user?.email ?? '');
          setIsVerified(result.user?.emailVerified === true);
        }
      })
      .catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : 'Could not load account details.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      const addingEmail = !email;
      const response = await fetch(
        addingEmail ? '/api/auth/email/add' : `${apiBaseUrl}/auth/email/verification/request`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: addingEmail ? newEmail : email }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (addingEmail && ['EMAIL_UPDATE_DELIVERY_FAILED', 'VERIFICATION_RATE_LIMITED'].includes(result.error?.code)) {
          setEmail(newEmail.trim().toLowerCase());
        }
        setError(result.error?.message ?? 'Could not send an email confirmation code.');
        return;
      }
      if (addingEmail) setEmail(newEmail.trim().toLowerCase());
      setIsCodeSent(true);
      setCode('');
      setNotice(`A confirmation code was sent to ${addingEmail ? newEmail : email}.`);
    } catch {
      setError('The email confirmation service is unavailable. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/email/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message ?? 'The code is invalid or expired. Request another code.');
        return;
      }
      setIsVerified(true);
      setIsCodeSent(false);
      setCode('');
      setNotice('Your email is confirmed and ready for email sign-in.');
    } catch {
      setError('The email confirmation service is unavailable. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel account-email-settings">
      <div className="directory-panel-heading">
        <div>
          <h2>Email sign-in</h2>
          <p>Add and confirm an email to use the preferred sign-in method.</p>
        </div>
      </div>
      {isLoading ? (
        <p>Loading account details…</p>
      ) : isVerified ? (
        <p role="status">{email} is confirmed and ready for email sign-in.</p>
      ) : (
        <form className="login-form" onSubmit={isCodeSent ? verifyEmail : (event) => void sendCode(event)}>
          {!email ? (
            <>
              <label htmlFor="account-email">Email address</label>
              <input
                autoComplete="email"
                id="account-email"
                maxLength={254}
                onChange={(event) => setNewEmail(event.target.value)}
                required
                type="email"
                value={newEmail}
              />
            </>
          ) : (
            <p>{email} is awaiting confirmation.</p>
          )}
          {isCodeSent && (
            <>
              <label htmlFor="account-email-code">Six-digit confirmation code</label>
              <input
                autoComplete="one-time-code"
                id="account-email-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </>
          )}
          {notice && <p role="status">{notice}</p>}
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" disabled={isSubmitting || (isCodeSent && code.length !== 6) || (!email && !newEmail.trim())} type="submit">
            {isSubmitting ? 'Please wait…' : isCodeSent ? 'Confirm email' : email ? 'Resend confirmation code' : 'Add email and send code'}
          </button>
          {isCodeSent && (
            <button className="login-secondary" disabled={isSubmitting} onClick={() => void sendCode()} type="button">
              Resend code
            </button>
          )}
        </form>
      )}
    </section>
  );
}
