'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

type RecordStatus = 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'MAINTENANCE' | 'RETIRED' | 'ENDED';

interface RiderRecord {
  id: string;
  fullName: string;
  phoneNumber: string;
  status: RecordStatus;
}

interface VehicleRecord {
  id: string;
  registrationNumber: string;
  type: 'MOTORCYCLE' | 'MATATU';
  status: RecordStatus;
}

interface AssignmentRecord {
  id: string;
  status: 'ACTIVE' | 'ENDED';
  assignedAt: string;
  unassignedAt: string | null;
  rider: RiderRecord;
  vehicle: Pick<VehicleRecord, 'id' | 'registrationNumber' | 'type'>;
}

const emptyRiders: RiderRecord[] = [];
const emptyVehicles: VehicleRecord[] = [];
const emptyAssignments: AssignmentRecord[] = [];

export function AssignmentsManagement() {
  const router = useRouter();
  const [riders, setRiders] = useState<RiderRecord[]>(emptyRiders);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(emptyVehicles);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>(emptyAssignments);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [riderId, setRiderId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [endingId, setEndingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status === 'ACTIVE'),
    [assignments],
  );
  const availableRiders = useMemo(
    () => riders.filter((rider) => rider.status === 'ACTIVE'
      && !activeAssignments.some((assignment) => assignment.rider.id === rider.id)),
    [activeAssignments, riders],
  );
  const availableVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === 'ACTIVE'
      && !activeAssignments.some((assignment) => assignment.vehicle.id === vehicle.id)),
    [activeAssignments, vehicles],
  );

  const loadData = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch('/api/directory/riders?limit=100', { cache: 'no-store' }),
        fetch('/api/directory/vehicles?limit=100', { cache: 'no-store' }),
        fetch('/api/directory/assignments', { cache: 'no-store' }),
      ]);
      if (responses.some((response) => response.status === 401)) {
        router.replace('/login');
        return;
      }

      const results = await Promise.all(responses.map(async (response) => ({
        ok: response.ok,
        body: await response.json(),
      })));
      const failed = results.find((result) => !result.ok);
      if (failed) {
        setError(failed.body.error?.message ?? 'Could not load assignment records.');
        return;
      }
      setError('');
      setRiders(results[0].body.data);
      setVehicles(results[1].body.data);
      setAssignments(results[2].body.data);
    } catch {
      setError('The assignment service is unavailable. Check the API connection.');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/directory/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ riderId, vehicleId }),
      });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not assign this vehicle.');
        return;
      }
      setNotice('Vehicle assigned to rider.');
      setRiderId('');
      setVehicleId('');
      await loadData();
    } catch {
      setError('The request could not be confirmed. Refresh assignments before retrying.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function endAssignment(assignmentId: string) {
    setError('');
    setNotice('');
    setEndingId(assignmentId);
    try {
      const response = await fetch(`/api/directory/assignments/${encodeURIComponent(assignmentId)}/end`, {
        method: 'POST',
      });
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not end this assignment.');
        return;
      }
      setNotice('Assignment ended.');
      await loadData();
    } catch {
      setError('The request could not be confirmed. Refresh assignments before retrying.');
    } finally {
      setEndingId('');
    }
  }

  return (
    <div className="directory-management">
      <section className="panel directory-table-panel">
        <div className="directory-panel-heading">
          <div><h2>Assignment register</h2><p>Each active rider and vehicle can have only one assignment.</p></div>
          <span className="record-count">{isLoading ? 'Loading' : `${activeAssignments.length} active`}</span>
        </div>
        {error && <p className="sacco-form-error" role="alert">{error}</p>}
        {notice && <p className="sacco-form-success" role="status">{notice}</p>}
        {isLoading ? (
          <div className="directory-record-empty">Loading assignments…</div>
        ) : assignments.length === 0 ? (
          <div className="directory-record-empty">
            <strong>No assignments yet</strong>
            <span>Register an active rider and vehicle, then assign them here.</span>
          </div>
        ) : (
          <div className="directory-record-list">
            {assignments.map((assignment) => (
              <article className="directory-record" key={assignment.id}>
                <span className="directory-icon">A</span>
                <div className="directory-record-main">
                  <strong>{assignment.rider.fullName}</strong>
                  <span>{assignment.vehicle.registrationNumber} · {assignment.vehicle.type}</span>
                </div>
                <span className={`sacco-status ${assignment.status === 'ACTIVE' ? 'active' : ''}`}>{assignment.status}</span>
                {assignment.status === 'ACTIVE' && (
                  <button
                    className="load-more-button"
                    disabled={endingId === assignment.id}
                    onClick={() => void endAssignment(assignment.id)}
                    type="button"
                  >
                    {endingId === assignment.id ? 'Ending…' : 'End assignment'}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel directory-create-panel">
        <div className="sacco-form-heading">
          <span className="info-eyebrow">SACCO OPERATIONS</span>
          <h2>Assign a vehicle</h2>
          <p>Only active, unassigned riders and vehicles are available.</p>
        </div>
        {availableRiders.length === 0 || availableVehicles.length === 0 ? (
          <div className="directory-record-empty">
            <strong>Nothing available to assign</strong>
            <span>Ensure this SACCO has an unassigned active rider and an unassigned active vehicle.</span>
          </div>
        ) : (
          <form className="sacco-form" onSubmit={createAssignment}>
            <label htmlFor="assignment-rider">Rider</label>
            <select id="assignment-rider" onChange={(event) => setRiderId(event.target.value)} required value={riderId}>
              <option value="">Select a rider</option>
              {availableRiders.map((rider) => (
                <option key={rider.id} value={rider.id}>{rider.fullName} · {rider.phoneNumber}</option>
              ))}
            </select>
            <label htmlFor="assignment-vehicle">Vehicle</label>
            <select id="assignment-vehicle" onChange={(event) => setVehicleId(event.target.value)} required value={vehicleId}>
              <option value="">Select a vehicle</option>
              {availableVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.registrationNumber} · {vehicle.type}</option>
              ))}
            </select>
            <button className="assignment-submit" disabled={isSubmitting || !riderId || !vehicleId} type="submit">
              {isSubmitting ? 'Assigning…' : 'Assign vehicle'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
