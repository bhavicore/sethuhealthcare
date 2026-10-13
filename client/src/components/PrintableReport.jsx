import { parseDbDate } from '../lib/careApi';

// Doctor name and registration number come from the saved encounter, which the
// server fills from the signing doctor's login — not from anything typed.
export default function PrintableReport({ encounter, patient }) {
  const doctorName = encounter.doctor_name;
  const doctorRegNo = encounter.doctor_reg_no;
  return (
    <section className="card printable-report">
      <div className="no-print form-actions" style={{ marginBottom: '1rem' }}>
        <button className="btn btn--primary" onClick={() => window.print()}>Print signed report</button>
      </div>

      <div className="report-sheet">
        <header className="report-sheet__header">
          <h2>SETHU — Consultation Report</h2>
          <p className="muted small">{parseDbDate(encounter.approved_at)?.toLocaleString() ?? '—'}</p>
        </header>

        <dl>
          <dt>Patient</dt><dd>{patient.name} · {patient.age}{patient.gender} · {patient.phone}</dd>
          <dt>Doctor</dt><dd>{doctorName} (Reg. No. {doctorRegNo || '—'})</dd>
          <dt>Chief complaint</dt><dd>{encounter.chief_complaint || '—'}</dd>
          <dt>Diagnosis</dt><dd>{encounter.diagnosis || '—'}</dd>
          <dt>Vitals</dt>
          <dd>{Object.entries(encounter.vitals).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</dd>
        </dl>

        <h3>Prescription</h3>
        <table className="report-table">
          <thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th></tr></thead>
          <tbody>
            {encounter.medications.map((m, i) => (
              <tr key={i}>
                <td>{m.genericName || m.raw}</td>
                <td>{m.doseMg ? `${m.doseMg} mg` : '—'}</td>
                <td>{m.frequencyToken || '—'}</td>
                <td>{m.durationDays ? `${m.durationDays} days` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {encounter.overrideReasons?.length > 0 && (
          <>
            <h3>Doctor's notes on flagged warnings</h3>
            <ul>
              {encounter.overrideReasons.map((r, i) => <li key={i} className="small">{r.message} — {r.reason}</li>)}
            </ul>
          </>
        )}

        <h3>{patient.language === 'ta' ? 'நோயாளிக்கான அறிவுரை' : patient.language === 'hi' ? 'रोगी के लिए सलाह' : 'Advice for the patient'}</h3>
        <p style={{ whiteSpace: 'pre-line' }}>{encounter.advice_patient_lang}</p>

        <h3 className="muted small">English (for the doctor's reference)</h3>
        <p className="small" style={{ whiteSpace: 'pre-line' }}>{encounter.advice_english}</p>

        <div className="report-sheet__signature">
          <div className="report-sheet__signature-line" />
          <p className="muted small">{doctorName} — signature</p>
        </div>
      </div>
    </section>
  );
}
