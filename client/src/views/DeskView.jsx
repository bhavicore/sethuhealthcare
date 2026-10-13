import { useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle } from 'lucide-react';
import { careApi } from '../lib/careApi';

const EMPTY_FORM = {
  name: '', age: '', gender: '', phone: '', language: 'hi', messageFormat: 'text',
  allergies: '', chronicConditions: '',
};

export default function DeskView({ me, onSendToDoctor }) {
  const [lookupPhone, setLookupPhone] = useState('');
  const [found, setFound] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [registered, setRegistered] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(null);

  // Hand the patient to the doctor's waiting list; someone who is also a
  // doctor here (e.g. the Medical Officer) goes straight to the console.
  async function sendToDoctor(patient) {
    setError(null);
    try {
      await careApi.queuePatient(patient.id);
      if (me.can.doctor) onSendToDoctor(patient.id);
      else setQueued(patient.name);
    } catch (err) {
      setError(err.message);
    }
  }

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function showWhatsappQr() {
    const waNumber = import.meta.env.VITE_WHATSAPP_DEMO_NUMBER || '910000000000';
    setQrDataUrl(await QRCode.toDataURL(`https://wa.me/${waNumber}?text=Hi`, { margin: 2, width: 240 }));
  }

  async function handleLookup(e) {
    e.preventDefault();
    setError(null);
    setFound(null);
    setNotFound(false);
    setQrDataUrl(null);
    try {
      const { patient } = await careApi.lookupPatient(lookupPhone.trim());
      setFound(patient);
      // The 24-hour window has to be opened again on every visit, not just at registration.
      if (patient.messageFormat !== 'text' && !patient.whatsappWindowOpen) await showWhatsappQr();
    } catch (err) {
      setNotFound(true);
      setForm((f) => ({ ...f, phone: lookupPhone.trim() }));
      setError(err.message);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { patient } = await careApi.registerPatient({
        name: form.name.trim(),
        age: Number(form.age),
        gender: form.gender || null,
        phone: form.phone.trim(),
        language: form.language,
        messageFormat: form.messageFormat,
        allergies: form.allergies.split(',').map((s) => s.trim()).filter(Boolean),
        chronicConditions: form.chronicConditions.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setRegistered(patient);
      setForm(EMPTY_FORM);
      if (patient.messageFormat !== 'text') await showWhatsappQr();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmWhatsapp(patientId, setPatient) {
    setError(null);
    try {
      const { patient } = await careApi.confirmWhatsapp(patientId);
      setPatient(patient);
    } catch (err) {
      setError(err.message);
    }
  }

  function whatsappWindowPanel(patient, setPatient) {
    if (patient.messageFormat === 'text') return null;
    return (
      <div style={{ textAlign: 'center' }}>
        {patient.whatsappWindowOpen ? (
          <span className="badge badge--synced">WhatsApp window open for today</span>
        ) : (
          <>
            <p className="muted small">
              Voice-preference patient — scan this QR with WhatsApp and send the pre-filled "Hi" to open the
              24-hour window for today's voice note.
            </p>
            {qrDataUrl && <img src={qrDataUrl} alt="WhatsApp opt-in QR" style={{ width: 200, margin: '0.75rem auto' }} />}
            <button className="btn btn--secondary btn--sm" onClick={() => handleConfirmWhatsapp(patient.id, setPatient)}>
              Simulate: patient scanned &amp; sent "Hi"
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="view">
      <header className="view__header">
        <h1>Patient Registration</h1>
      </header>

      <form className="card" onSubmit={handleLookup} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="lookupPhone">Search Existing Patient by Phone Number</label>
          <input id="lookupPhone" value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} placeholder="98000 00001" />
        </div>
        <button className="btn btn--primary" type="submit">Look up</button>
      </form>

      {found && (
        <section className="card">
          <h2>Patient Found: {found.name}</h2>
          <p className="muted small">{found.age} {found.gender} · {found.phone} · {found.language.toUpperCase()} · {found.messageFormat}</p>
          {found.allergies.length > 0 && <p className="allergy allergy--yes allergy--inline"><AlertTriangle size={15} /> Allergies: {found.allergies.join(', ')}</p>}
          {whatsappWindowPanel(found, setFound)}
          <div className="form-actions" style={{ marginTop: '1rem' }}>
            <button className="btn btn--primary" onClick={() => sendToDoctor(found)}>Send to Doctor →</button>
          </div>
        </section>
      )}

      {notFound && (
        <section className="card">
          <p className="muted">No record for this phone number. Register as a new patient below.</p>
        </section>
      )}

      {(notFound || !found) && (
        <form className="card form-grid" onSubmit={handleRegister}>
          <h2 className="field--full">New Patient Registration</h2>
          <div className="field"><label>Name *</label><input required value={form.name} onChange={update('name')} /></div>
          <div className="field field--small"><label>Age *</label><input required type="number" min="0" value={form.age} onChange={update('age')} /></div>
          <div className="field field--small">
            <label>Gender</label>
            <select value={form.gender} onChange={update('gender')}>
              <option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="Other">Other</option>
            </select>
          </div>
          <div className="field"><label>Phone *</label><input required value={form.phone} onChange={update('phone')} /></div>
          <div className="field field--small">
            <label>Language</label>
            <select value={form.language} onChange={update('language')}>
              <option value="hi">Hindi</option><option value="ta">Tamil</option><option value="en">English</option>
            </select>
          </div>
          <div className="field field--small">
            <label>Message format</label>
            <select value={form.messageFormat} onChange={update('messageFormat')}>
              <option value="text">Text (printout only)</option>
              <option value="voice">Voice (WhatsApp)</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="field field--full">
            <label>Allergies (comma-separated — ask every first-time patient)</label>
            <input value={form.allergies} onChange={update('allergies')} placeholder="e.g. Penicillin" />
          </div>
          <div className="field field--full">
            <label>Chronic conditions (comma-separated)</label>
            <input value={form.chronicConditions} onChange={update('chronicConditions')} placeholder="e.g. Hypertension, Diabetes" />
          </div>
          <div className="field field--full form-actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>Register patient</button>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}
      {queued && <p className="form-notice">{queued} has been added to the doctor's waiting list.</p>}

      {registered && (
        <section className="card">
          <h2>Patient Registered: {registered.name}</h2>
          <p className="muted small">Patient ID {registered.id} · {registered.phone}</p>
          {whatsappWindowPanel(registered, setRegistered)}
          <div className="form-actions" style={{ marginTop: '1rem' }}>
            <button className="btn btn--primary" onClick={() => sendToDoctor(registered)}>Send to Doctor →</button>
          </div>
        </section>
      )}
    </div>
  );
}
