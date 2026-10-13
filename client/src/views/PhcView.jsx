import { useEffect, useState } from 'react';
import { saveVisit, listVisits } from '../lib/db';
import { notifyNewVisitQueued, subscribeSyncStatus } from '../lib/sync';
import ReferralCardModal from '../components/ReferralCardModal';

const EMPTY_FORM = {
  name: '',
  age: '',
  gender: '',
  abhaId: '',
  facility: '',
  symptoms: '',
  diagnosis: '',
  medications: '',
  allergies: '',
  notes: '',
};

export default function PhcView() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [visits, setVisits] = useState([]);
  const [cardVisit, setCardVisit] = useState(null);
  const [savedNotice, setSavedNotice] = useState(false);

  async function refresh() {
    setVisits(await listVisits());
  }

  useEffect(() => {
    refresh();
    // Re-read the list whenever the background sync engine finishes a round,
    // so "pending" badges flip to "synced" without needing a manual refresh.
    return subscribeSyncStatus(() => refresh());
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.age.toString().trim()) return;

    const record = await saveVisit(form);
    notifyNewVisitQueued();
    setForm(EMPTY_FORM);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
    await refresh();
    setCardVisit(record);
  }

  return (
    <div className="view">
      <header className="view__header">
        <h1>PHC — Log Visit</h1>
        <p className="muted">
          Record the visit, then hand the patient a QR referral card. Works with zero network.
        </p>
      </header>

      <form className="card form-grid" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="name">Patient name *</label>
          <input id="name" required value={form.name} onChange={update('name')} />
        </div>
        <div className="field field--small">
          <label htmlFor="age">Age *</label>
          <input id="age" required type="number" min="0" value={form.age} onChange={update('age')} />
        </div>
        <div className="field field--small">
          <label htmlFor="gender">Gender</label>
          <select id="gender" value={form.gender} onChange={update('gender')}>
            <option value="">—</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="abhaId">ABHA ID (optional)</label>
          <input
            id="abhaId"
            placeholder="14-digit ABHA number, if available"
            value={form.abhaId}
            onChange={update('abhaId')}
          />
        </div>
        <div className="field">
          <label htmlFor="facility">PHC / facility name</label>
          <input id="facility" value={form.facility} onChange={update('facility')} />
        </div>

        <div className="field field--full">
          <label htmlFor="symptoms">Symptoms</label>
          <textarea id="symptoms" rows={2} value={form.symptoms} onChange={update('symptoms')} />
        </div>
        <div className="field field--full">
          <label htmlFor="diagnosis">Diagnosis</label>
          <textarea id="diagnosis" rows={2} value={form.diagnosis} onChange={update('diagnosis')} />
        </div>
        <div className="field field--full">
          <label htmlFor="medications">Medications</label>
          <textarea id="medications" rows={2} value={form.medications} onChange={update('medications')} />
        </div>
        <div className="field field--full">
          <label htmlFor="allergies">Allergies</label>
          <input id="allergies" value={form.allergies} onChange={update('allergies')} />
        </div>
        <div className="field field--full">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" rows={2} value={form.notes} onChange={update('notes')} />
        </div>

        <div className="field field--full form-actions">
          <button type="submit" className="btn btn--primary">
            Save visit &amp; generate referral card
          </button>
          {savedNotice && <span className="form-notice">Saved on this device.</span>}
        </div>
      </form>

      <section className="card">
        <h2>Logged visits ({visits.length})</h2>
        {visits.length === 0 && <p className="muted">No visits logged yet on this device.</p>}
        <ul className="visit-list">
          {visits.map((v) => (
            <li key={v.localId} className="visit-list__item">
              <div>
                <strong>{v.name}</strong>
                <span className="muted"> · {v.age}{v.gender ? `, ${v.gender}` : ''}</span>
                <div className="muted small">{v.diagnosis || v.symptoms || 'No diagnosis recorded'}</div>
              </div>
              <div className="visit-list__actions">
                <span className={`badge badge--${v.syncStatus}`}>{v.syncStatus}</span>
                {v.origin === 'phc' && (
                  <button className="btn btn--secondary btn--sm" onClick={() => setCardVisit(v)}>
                    View QR
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {cardVisit && <ReferralCardModal visit={cardVisit} onClose={() => setCardVisit(null)} />}
    </div>
  );
}
