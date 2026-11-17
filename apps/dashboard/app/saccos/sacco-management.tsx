'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

interface SaccoRecord {
  id: string;
  name: string;
  registrationNumber: string | null;
  phoneNumber: string | null;
  operatingArea: string | null;
  status: string;
  administrator: {
    fullName: string;
    phoneNumber: string;
  };
}

const initialForm = {
  name: '',
  registrationNumber: '',
  phoneNumber: '',
  operatingArea: '',
  adminFullName: '',
  adminPhoneNumber: '',
  adminPassword: '',
};

export function SaccoManagement() {
  const router = useRouter();
  const [saccos, setSaccos] = useState<SaccoRecord[]>([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/saccos', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok) {
          if (mounted) setError(result.error?.message ?? 'Could not load SACCOs.');
          return;
        }
        if (mounted) setSaccos(result.data);
      })
      .catch(() => {
        if (mounted) setError('The SACCO service is unavailable. Check the API connection.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => { mounted = false; };
  }, [router]);

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/saccos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? 'SACCO provisioning failed.');
        return;
      }
      setSaccos((current) => [result.data, ...current]);
      setForm(initialForm);
      setNotice('SACCO and its initial administrator were created.');
    } catch {
      setError('The SACCO service is unavailable. Your entry was not confirmed; check before retrying.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sacco-admin-layout">
      <section className="panel sacco-list-panel">
        <div className="directory-panel-heading">
          <div>
            <h2>Registered SACCOs</h2>
            <p>Organisations currently provisioned on the platform.</p>
          </div>
          <span className="record-count">{isLoading ? 'Loading' : `${saccos.length} SACCO${saccos.length === 1 ? '' : 's'}`}</span>
        </div>
        {error && <p className="sacco-form-error" role="alert">{error}</p>}
        {notice && <p className="sacco-form-success" role="status">{notice}</p>}
        {isLoading ? (
          <p className="sacco-list-empty">Loading organisations…</p>
        ) : saccos.length === 0 ? (
          <div className="sacco-list-empty">
            <strong>No SACCOs have been provisioned yet</strong>
            <span>Create the first organisation and its SACCO administrator using the form.</span>
          </div>
        ) : (
          <div className="sacco-record-list">
            {saccos.map((sacco) => (
              <article className="sacco-record" key={sacco.id}>
                <span className="directory-icon">S</span>
                <div className="sacco-record-main">
                  <strong>{sacco.name}</strong>
                  <span>{sacco.registrationNumber ?? 'Registration pending'}{sacco.operatingArea ? ` · ${sacco.operatingArea}` : ''}</span>
                  <span>Admin: {sacco.administrator.fullName} · {sacco.administrator.phoneNumber}</span>
                </div>
                <span className={`sacco-status ${sacco.status === 'ACTIVE' ? 'active' : ''}`}>{sacco.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel sacco-create-panel">
        <div className="sacco-form-heading">
          <span className="info-eyebrow">NEW ORGANISATION</span>
          <h2>Provision a SACCO</h2>
          <p>Create the SACCO and its initial administrator together.</p>
        </div>
        <form className="sacco-form" onSubmit={submit}>
          <label htmlFor="sacco-name">SACCO name</label>
          <input id="sacco-name" maxLength={120} onChange={(event) => updateField('name', event.target.value)} required value={form.name} />
          <div className="sacco-form-row">
            <div>
              <label htmlFor="sacco-registration">Registration number <span>(optional)</span></label>
              <input id="sacco-registration" maxLength={40} onChange={(event) => updateField('registrationNumber', event.target.value)} placeholder="Can be added later" value={form.registrationNumber} />
            </div>
            <div>
              <label htmlFor="sacco-area">Operating area</label>
              <input id="sacco-area" maxLength={120} onChange={(event) => updateField('operatingArea', event.target.value)} value={form.operatingArea} />
            </div>
          </div>
          <label htmlFor="sacco-phone">SACCO phone <span>(optional)</span></label>
          <input id="sacco-phone" inputMode="tel" maxLength={20} onChange={(event) => updateField('phoneNumber', event.target.value)} placeholder="+254 7XX XXX XXX" value={form.phoneNumber} />
          <div className="sacco-form-divider" />
          <p className="sacco-admin-label">Initial SACCO administrator</p>
          <label htmlFor="admin-name">Full name</label>
          <input id="admin-name" maxLength={100} onChange={(event) => updateField('adminFullName', event.target.value)} required value={form.adminFullName} />
          <label htmlFor="admin-phone">Login phone number</label>
          <input id="admin-phone" autoComplete="username" inputMode="tel" maxLength={20} onChange={(event) => updateField('adminPhoneNumber', event.target.value)} placeholder="+254 7XX XXX XXX" required value={form.adminPhoneNumber} />
          <label htmlFor="admin-password">Initial password</label>
          <input id="admin-password" autoComplete="new-password" minLength={14} maxLength={128} onChange={(event) => updateField('adminPassword', event.target.value)} required type="password" value={form.adminPassword} />
          <p className="sacco-password-note">Use a unique 14+ character password and deliver it to the administrator privately.</p>
          <button className="login-submit sacco-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Creating SACCO…' : 'Create SACCO and admin'}
          </button>
        </form>
      </section>
    </div>
  );
}
