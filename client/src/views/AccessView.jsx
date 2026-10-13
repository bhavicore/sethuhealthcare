import { useEffect, useState } from 'react';
import { authApi, parseDbDate } from '../lib/careApi';

/**
 * Read-only view of who is assigned where. Each person sees only the staff
 * of facilities they're responsible for (the server filters the list).
 */
export default function AccessView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    authApi.assignments().then((r) => setRows(r.assignments)).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="view">
      <header className="view__header">
        <h1>Staff Access</h1>
      </header>

      <section className="card">
        <h2>Access Rules</h2>
        <ul className="access-rules small">
          <li><strong>Assignments, not blanket access.</strong> Each person gets a role at a facility, with a start (and optional end) date. One person can hold several — for example a doctor who also covers the CHC.</li>
          <li><strong>Patient records stay with the facility treating the patient.</strong> A CHC sees a PHC patient only after a doctor refers them; the District Health Officer sees totals only.</li>
          <li><strong>Every request is checked on the server</strong> against the logged-in account — the facility comes from the record being opened, never from the screen. Refusals are logged.</li>
          <li><strong>Sign-in is a personal PIN for now.</strong> Fingerprint verification is planned as a second step on the same accounts, first for "Approve &amp; sign".</li>
        </ul>
      </section>

      {error && <p className="form-error">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && (
        <section className="card">
          <h2>Staff Assignments ({rows.length})</h2>
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr><th>Staff</th><th>Role</th><th>Facility</th><th>Scope</th><th>Since</th><th>Fingerprint</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.regNo && <div className="muted small">Reg. {r.regNo}</div>}
                    </td>
                    <td>{r.roleLabel}</td>
                    <td>{r.facilityName}</td>
                    <td className="small">{r.scope}</td>
                    <td className="nowrap small">
                      {parseDbDate(r.validFrom)?.toLocaleDateString('en-IN')}
                      {r.validTo && <div className="muted">until {parseDbDate(r.validTo)?.toLocaleDateString('en-IN')}</div>}
                    </td>
                    <td className="muted small">{r.biometricEnrolled ? 'Enrolled' : 'Not enrolled (planned)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Adding or ending assignments is done by the system admin for now; an in-app editor for Medical Officers is future work.</p>
        </section>
      )}
    </div>
  );
}
