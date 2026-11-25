'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);
  const [confirmationCodeSent, setConfirmationCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(loginMethod === 'email' ? { email, password } : { phoneNumber, password }),
      });
      const result = await response.json();
      if (response.status === 202 && result.verificationRequired) {
        setVerificationRequired(true);
        setVerificationCode('');
        setError('');
        return;
      }
      if (!response.ok) {
        if (loginMethod === 'email' && result.error?.code === 'EMAIL_NOT_VERIFIED') {
          setEmailConfirmationRequired(true);
          setConfirmationCodeSent(false);
          setVerificationCode('');
          setError(result.error.message ?? 'Confirm your email before signing in.');
          return;
        }
        setError(result.error?.message ?? 'Sign-in failed. Check your details and try again.');
        return;
      }
      setPassword('');
      router.replace('/');
      router.refresh();
    } catch {
      setError('The sign-in service is unavailable. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/login/email/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? 'The code is invalid or expired. Sign in again to request another.');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('The email verification service is unavailable. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestEmailConfirmation() {
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/email/verification/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not send a confirmation code. Try again shortly.');
        return;
      }
      setConfirmationCodeSent(true);
    } catch {
      setError('The email confirmation service is unavailable. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/email/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message ?? 'The code is invalid or expired. Request a new one and try again.');
        return;
      }
      setEmailConfirmationRequired(false);
      setConfirmationCodeSent(false);
      setVerificationCode('');
      setError('Email confirmed. Sign in again to receive your sign-in code.');
    } catch {
      setError('The email confirmation service is unavailable. Try again shortly.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (emailConfirmationRequired) {
    return (
      <form className="login-form" onSubmit={confirmEmail}>
        <p>{confirmationCodeSent
          ? `Enter the six-digit confirmation code sent to ${email}.`
          : `Your email needs confirmation. Send a code to ${email} to continue.`}</p>
        {confirmationCodeSent && (
          <>
            <label htmlFor="email-confirmation-code">Email confirmation code</label>
            <input
              autoComplete="one-time-code"
              id="email-confirmation-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setVerificationCode(event.target.value)}
              required
              value={verificationCode}
            />
          </>
        )}
        {error && <p className="login-error" role="alert">{error}</p>}
        {confirmationCodeSent ? (
          <>
            <button className="login-submit" disabled={isSubmitting || verificationCode.length !== 6} type="submit">
              {isSubmitting ? 'Verifying…' : 'Confirm email'}
            </button>
            <button className="login-secondary" disabled={isSubmitting} onClick={() => void requestEmailConfirmation()} type="button">Resend code</button>
          </>
        ) : (
          <button className="login-submit" disabled={isSubmitting} onClick={() => void requestEmailConfirmation()} type="button">
            {isSubmitting ? 'Sending…' : 'Send confirmation code'}
          </button>
        )}
        <button className="login-secondary" disabled={isSubmitting} onClick={() => {
          setEmailConfirmationRequired(false);
          setError('');
        }} type="button">Back to sign in</button>
      </form>
    );
  }

  return (
    verificationRequired ? (
      <form className="login-form" onSubmit={verifyEmailLogin}>
        <p>A six-digit sign-in code was sent to {email}.</p>
        <label htmlFor="email-code">Email verification code</label>
        <input
          autoComplete="one-time-code"
          id="email-code"
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => setVerificationCode(event.target.value)}
          required
          value={verificationCode}
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" disabled={isSubmitting || verificationCode.length !== 6} type="submit">
          {isSubmitting ? 'Verifying…' : 'Verify and sign in'}
        </button>
        <button className="login-secondary" disabled={isSubmitting} onClick={() => setVerificationRequired(false)} type="button">Back to sign in</button>
      </form>
    ) : (
      <form className="login-form" onSubmit={submit}>
        {loginMethod === 'email' ? (
          <>
            <label htmlFor="email">Email address</label>
            <input
              autoComplete="username"
              id="email"
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </>
        ) : (
          <>
            <label htmlFor="phone-number">Phone number</label>
            <input
              autoComplete="username"
              id="phone-number"
              inputMode="tel"
              maxLength={20}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="+254 7XX XXX XXX"
              required
              value={phoneNumber}
            />
          </>
        )}
        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          maxLength={128}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          required
          type="password"
          value={password}
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
          {!isSubmitting && <span aria-hidden="true">→</span>}
        </button>
        <button className="login-secondary" onClick={() => setLoginMethod(loginMethod === 'email' ? 'phone' : 'email')} type="button">
          {loginMethod === 'email' ? 'Use phone number instead' : 'Use email instead'}
        </button>
        <p className="login-help">
          New to Boda-Tracker? <Link href="/register">Create your SACCO workspace</Link>
        </p>
      </form>
    )
  );
}

function apiBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
  const normalizedUrl = configuredUrl.replace(/\/+$/, '');
  return normalizedUrl.endsWith('/api/v1') ? normalizedUrl : `${normalizedUrl}/api/v1`;
}
