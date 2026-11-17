'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
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
        body: JSON.stringify({ phoneNumber, password }),
      });
      const result = await response.json();
      if (!response.ok) {
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

  return (
    <form className="login-form" onSubmit={submit}>
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
      <p className="login-help">
        New to Boda-Tracker? <Link href="/register">Create your SACCO workspace</Link>
      </p>
    </form>
  );
}
