'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type DirectoryType = 'riders' | 'vehicles';

interface DirectoryRecord {
  id: string;
  fullName?: string;
  phoneNumber?: string;
  registrationNumber?: string;
  type?: 'MOTORCYCLE' | 'MATATU';
  status: string;
  createdAt: string;
}

const emptyRiderForm = { fullName: '', phoneNumber: '', initialPassword: '' };
const emptyVehicleForm: { registrationNumber: string; type: 'MOTORCYCLE' | 'MATATU' } = {
  registrationNumber: '',
  type: 'MOTORCYCLE',
};

export function DirectoryManagement({ type }: { type: DirectoryType }) {
  const router = useRouter();
  const [records, setRecords] = useState<DirectoryRecord[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [riderForm, setRiderForm] = useState(emptyRiderForm);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const title = type === 'riders' ? 'Riders' : 'Fleet';
  const itemLabel = type === 'riders' ? 'riders' : 'vehicles';

  const loadPage = useCallback(async (cursor?: string, append = false) => {
    const params = new URLSearchParams({ limit: '25' });
    if (cursor) params.set('cursor', cursor);

    try {
      const response = await fetch(`/api/directory/${type}?${params}`, { cache: 'no-store' });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        setError(result.error?.message ?? `Could not load ${itemLabel}.`);
        if (!append) setRecords([]);
        return;
      }
      setRecords((current) => append ? [...(current ?? []), ...result.data] : result.data);
      setNextCursor(result.nextCursor);
    } catch {
      setError(`The ${itemLabel} service is unavailable. Check the API connection.`);
      if (!append) setRecords([]);
    } finally {
      setIsLoadingMore(false);
    }
  }, [itemLabel, router, type]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);

    const body = type === 'riders' ? riderForm : vehicleForm;
    try {
      const response = await fetch(`/api/directory/${type}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        setError(result.error?.message ?? `Could not create ${type === 'riders' ? 'rider' : 'vehicle'}.`);
        return;
      }
      setRecords((current) => [result.data, ...(current ?? [])]);
      setNextCursor(null);
      setRiderForm(emptyRiderForm);
      setVehicleForm(emptyVehicleForm);
      setNotice(type === 'riders'
        ? 'Rider account created. Share the login phone and initial password privately; they can sign in to the Boda-Tracker rider app.'
        : 'Vehicle registered to this SACCO.');
    } catch {
      setError('The request could not be confirmed. Check the directory before retrying.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function loadMore() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    void loadPage(nextCursor, true);
  }

  return (
    <div className="directory-management">
      <section className="panel directory-table-panel">
        <div className="directory-panel-heading">
          <div><h2>{title} directory</h2><p>Only records in your SACCO are shown.</p></div>
          <span className="record-count">{records === null ? 'Loading' : `${records.length}${nextCursor ? '+' : ''} ${itemLabel}`}</span>
        </div>
        {error && <p className="sacco-form-error" role="alert">{error}</p>}
        {notice && <p className="sacco-form-success" role="status">{notice}</p>}
        {records === null ? (
          <div className="directory-record-empty">Loading {itemLabel}…</div>
        ) : records.length === 0 ? (
          <div className="directory-record-empty">
            <strong>No {itemLabel} registered yet</strong>
            <span>Use the form to add the first {type === 'riders' ? 'rider account' : 'vehicle'} to this SACCO.</span>
          </div>
        ) : (
          <>
            <div className="directory-record-list">
              {records.map((record) => (
                <article className="directory-record" key={record.id}>
                  <span className="directory-icon">{type === 'riders' ? 'R' : 'V'}</span>
                  <div className="directory-record-main">
                    <strong>{type === 'riders' ? record.fullName : record.registrationNumber}</strong>
                    <span>{type === 'riders' ? record.phoneNumber : record.type}</span>
                  </div>
                  <span className={`sacco-status ${record.status === 'ACTIVE' ? 'active' : ''}`}>{record.status}</span>
                </article>
              ))}
            </div>
            {nextCursor && <button className="load-more-button" disabled={isLoadingMore} onClick={loadMore} type="button">{isLoadingMore ? 'Loading…' : 'Load more'}</button>}
          </>
        )}
      </section>

      <section className="panel directory-create-panel">
        <div className="sacco-form-heading">
          <span className="info-eyebrow">SACCO DIRECTORY</span>
          <h2>{type === 'riders' ? 'Add a rider' : 'Register a vehicle'}</h2>
          <p>The record will be created under your authenticated SACCO.</p>
        </div>
        <form className="sacco-form" onSubmit={submit}>
          {type === 'riders' ? (
            <>
              <label htmlFor="rider-name">Rider full name</label>
              <input id="rider-name" maxLength={100} onChange={(event) => setRiderForm((current) => ({ ...current, fullName: event.target.value }))} required value={riderForm.fullName} />
              <label htmlFor="rider-phone">Login phone number</label>
              <input id="rider-phone" autoComplete="username" inputMode="tel" maxLength={20} onChange={(event) => setRiderForm((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="+254 7XX XXX XXX" required value={riderForm.phoneNumber} />
              <label htmlFor="rider-password">Initial password</label>
              <input id="rider-password" autoComplete="new-password" minLength={14} maxLength={128} onChange={(event) => setRiderForm((current) => ({ ...current, initialPassword: event.target.value }))} required type="password" value={riderForm.initialPassword} />
              <p className="sacco-password-note">Use a unique password of at least 14 characters. Share it with the rider privately.</p>
            </>
          ) : (
            <>
              <label htmlFor="vehicle-registration">Registration number</label>
              <input id="vehicle-registration" autoCapitalize="characters" maxLength={20} onChange={(event) => setVehicleForm((current) => ({ ...current, registrationNumber: event.target.value }))} placeholder="KCA 123A" required value={vehicleForm.registrationNumber} />
              <label htmlFor="vehicle-type">Vehicle type</label>
              <select id="vehicle-type" onChange={(event) => {
                const value = event.target.value;
                if (value === 'MOTORCYCLE' || value === 'MATATU') {
                  setVehicleForm((current) => ({ ...current, type: value }));
                }
              }} value={vehicleForm.type}>
                <option value="MOTORCYCLE">Motorcycle</option>
                <option value="MATATU">Matatu</option>
              </select>
            </>
          )}
          <button className="login-submit sacco-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Saving…' : type === 'riders' ? 'Create rider account' : 'Register vehicle'}
          </button>
        </form>
      </section>
    </div>
  );
}
