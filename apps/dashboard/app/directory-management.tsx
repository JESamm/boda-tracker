'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type DirectoryType = 'riders' | 'vehicles';

interface DirectoryRecord {
  id: string;
  fullName?: string;
  phoneNumber?: string;
  email?: string | null;
  registrationNumber?: string;
  type?: 'MOTORCYCLE' | 'MATATU';
  status: string;
  createdAt: string;
}

const emptyRiderForm = { fullName: '', phoneNumber: '', email: '' };
const emptyRiderEditForm = { fullName: '', phoneNumber: '', email: '' };
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
  const [editingRiderId, setEditingRiderId] = useState<string | null>(null);
  const [riderEditForm, setRiderEditForm] = useState(emptyRiderEditForm);
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
        if (type === 'riders'
          && ['RIDER_CREATED_EMAIL_FAILED', 'VERIFICATION_RATE_LIMITED'].includes(result.error?.code ?? '')) {
          setRiderForm(emptyRiderForm);
          await loadPage();
        }
        return;
      }
      setRecords((current) => [result.data, ...(current ?? [])]);
      setNextCursor(null);
      setRiderForm(emptyRiderForm);
      setVehicleForm(emptyVehicleForm);
      setNotice(type === 'riders'
        ? 'Rider account created and an activation code was sent by email. The rider can verify their email and set a password in the Boda-Tracker app.'
        : 'Vehicle registered to this SACCO.');
    } catch {
      setError('The request could not be confirmed. Check the directory before retrying.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveRiderEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRiderId) return;
    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/directory/riders/${encodeURIComponent(editingRiderId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...riderEditForm,
          email: riderEditForm.email.trim() || null,
        }),
      });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (result.data) {
        setRecords((current) => current?.map((record) => record.id === result.data.id ? result.data : record) ?? []);
      }
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not update this rider account.');
        if (['RIDER_UPDATED_EMAIL_FAILED', 'VERIFICATION_RATE_LIMITED'].includes(result.error?.code ?? '')) {
          setEditingRiderId(null);
        }
        return;
      }

      const changedEmail = records?.find((record) => record.id === editingRiderId)?.email !== result.data.email;
      setEditingRiderId(null);
      setNotice(changedEmail && result.data.email
        ? 'Rider details updated. A verification code was sent to the new email address.'
        : 'Rider details updated.');
    } catch {
      setError('The update could not be confirmed. Reload the rider directory before retrying.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deactivateRider(record: DirectoryRecord) {
    if (type !== 'riders' || record.status === 'SUSPENDED') return;
    const confirmed = window.confirm(
      `Deactivate ${record.fullName ?? 'this rider'}? They will lose app access, active work will end, and historical records will be kept.`,
    );
    if (!confirmed) return;

    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/directory/riders/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok || !result.data) {
        setError(result.error?.message ?? 'Could not deactivate this rider account.');
        return;
      }
      setRecords((current) => current?.map((item) => item.id === record.id ? result.data : item) ?? []);
      setNotice('Rider account deactivated. Historical records have been preserved.');
    } catch {
      setError('The deactivation could not be confirmed. Reload the rider directory before retrying.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteSuspendedRider(record: DirectoryRecord) {
    if (type !== 'riders' || record.status !== 'SUSPENDED') return;
    const confirmed = window.confirm(
      `Remove ${record.fullName ?? 'this rider'} from the directory? Their phone number and email will be freed for a new account. Historical trips, expenses, sessions, and location records will remain with identifying details anonymized. This cannot be undone.`,
    );
    if (!confirmed) return;

    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/directory/riders/${encodeURIComponent(record.id)}/account`, { method: 'DELETE' });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not remove this rider account.');
        return;
      }
      setRecords((current) => current?.filter((item) => item.id !== record.id) ?? []);
      setNotice('Rider account removed. Their phone number and email are available for a new account; historical records were anonymized.');
    } catch {
      setError('The deletion could not be confirmed. Reload the rider directory before retrying.');
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
                    {type === 'riders' && <span>{record.email || 'No email address'}</span>}
                  </div>
                  <span className={`sacco-status ${record.status === 'ACTIVE' ? 'active' : ''}`}>{record.status}</span>
                  {type === 'riders' && (
                    <div className="directory-record-actions">
                      {record.status !== 'SUSPENDED' && (
                        <button
                          className="directory-action-button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setError('');
                            setNotice('');
                            setEditingRiderId(record.id);
                            setRiderEditForm({
                              fullName: record.fullName ?? '',
                              phoneNumber: record.phoneNumber ?? '',
                              email: record.email ?? '',
                            });
                          }}
                          type="button"
                        >
                          Edit
                        </button>
                      )}
                      {record.status !== 'SUSPENDED' && (
                        <button
                          className="directory-action-button danger"
                          disabled={isSubmitting}
                          onClick={() => void deactivateRider(record)}
                          type="button"
                        >
                          Deactivate
                        </button>
                      )}
                      {record.status === 'SUSPENDED' && (
                        <button
                          className="directory-action-button danger"
                          disabled={isSubmitting}
                          onClick={() => void deleteSuspendedRider(record)}
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                  {type === 'riders' && editingRiderId === record.id && (
                    <form className="directory-rider-edit-form" onSubmit={saveRiderEdit}>
                      <label htmlFor={`edit-rider-name-${record.id}`}>Rider full name</label>
                      <input
                        id={`edit-rider-name-${record.id}`}
                        maxLength={100}
                        onChange={(event) => setRiderEditForm((current) => ({ ...current, fullName: event.target.value }))}
                        required
                        value={riderEditForm.fullName}
                      />
                      <label htmlFor={`edit-rider-phone-${record.id}`}>Login phone number</label>
                      <input
                        id={`edit-rider-phone-${record.id}`}
                        autoComplete="username"
                        inputMode="tel"
                        maxLength={20}
                        onChange={(event) => setRiderEditForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                        required
                        value={riderEditForm.phoneNumber}
                      />
                      <label htmlFor={`edit-rider-email-${record.id}`}>Email address</label>
                      <input
                        id={`edit-rider-email-${record.id}`}
                        autoComplete="email"
                        inputMode="email"
                        maxLength={254}
                        onChange={(event) => setRiderEditForm((current) => ({ ...current, email: event.target.value }))}
                        type="email"
                        value={riderEditForm.email}
                      />
                      <p className="sacco-password-note">A changed email must be verified before email sign-in can be used.</p>
                      <div className="directory-edit-actions">
                        <button className="login-submit sacco-submit" disabled={isSubmitting} type="submit">
                          {isSubmitting ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                          className="directory-action-button"
                          disabled={isSubmitting}
                          onClick={() => setEditingRiderId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
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
              <label htmlFor="rider-email">Email address</label>
              <input id="rider-email" autoComplete="email" inputMode="email" maxLength={254} onChange={(event) => setRiderForm((current) => ({ ...current, email: event.target.value }))} required type="email" value={riderForm.email} />
              <p className="sacco-password-note">The rider receives an email confirmation code and creates their own password in the app. Passwords are never sent by email or SMS.</p>
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
