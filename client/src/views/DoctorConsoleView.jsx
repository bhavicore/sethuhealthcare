import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Search, Send, X, RefreshCw, Pill, History,
} from 'lucide-react';
import { careApi, parseDbDate } from '../lib/careApi';
import MicButton from '../components/MicButton';
import ConsultDictation from '../components/ConsultDictation';
import PrintableReport from '../components/PrintableReport';

const TEMPLATES = [
  { label: 'Fever', complaint: 'Fever for 3 days, no other symptoms', diagnosis: 'Viral fever', meds: 'Paracetamol 500 TDS 3 days' },
  { label: 'Diarrhoea', complaint: 'Loose motions for 2 days, mild dehydration', diagnosis: 'Acute gastroenteritis', meds: 'ORS SOS\nDomperidone 10 BD 3 days' },
  { label: 'Cough / cold', complaint: 'Cough and cold for 4 days', diagnosis: 'Upper respiratory tract infection', meds: 'Paracetamol 500 SOS\nCetirizine 10 OD 5 days' },
];

const DURATION_PICKS = [3, 5, 7];

const SEVERITY_ORDER = { major: 0, moderate: 1, minor: 2 };
const SEVERITY = {
  major: { label: 'Major', className: 'badge badge--danger' },
  moderate: { label: 'Moderate', className: 'badge badge--pending' },
  minor: { label: 'Minor', className: 'badge' },
};

const EMPTY_CONSULT = {
  chiefComplaint: '', diagnosis: '', medicationLines: '', adviceNotes: '',
  bp: '', pulse: '', tempC: '', weightKg: '',
};

// Fields that feed the draft. Editing any of them after Draft makes the draft
// stale; Approve then waits for a re-check so the saved report is always the
// one the doctor reviewed. (Vitals don't affect the draft, so they're excluded.)
const DRAFT_FIELDS = ['chiefComplaint', 'diagnosis', 'medicationLines', 'adviceNotes'];
const draftInputOf = (consult) => Object.fromEntries(DRAFT_FIELDS.map((f) => [f, consult[f]]));

const DICTATION_LANGS = [
  { value: 'en', label: 'English / mixed' },
  { value: 'ta', label: 'Tamil' },
  { value: 'hi', label: 'Hindi' },
];

const LANGUAGE_NAME = { hi: 'Hindi', ta: 'Tamil', en: 'English' };
const FORMAT_NAME = { text: 'printout', voice: 'voice note', both: 'printout + voice note' };
const SEX_NAME = { F: 'female', M: 'male' };

const ADVICE_SOURCE_LABEL = {
  template: 'Standard advice',
  doctor: 'Your words',
  gemini: 'Reworded by Gemini · check the back-translation',
  untranslated: 'Not translated · Gemini unavailable',
};

const formatClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function DoctorConsoleView({ me, activePatientId, onPatientLoaded }) {
  const [phone, setPhone] = useState('');
  const [patient, setPatient] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState({ geminiConfigured: false, sarvamConfigured: false });

  const [consult, setConsult] = useState(EMPTY_CONSULT);
  const [draft, setDraft] = useState(null);
  const [draftInput, setDraftInput] = useState(null);
  const [dictationLang, setDictationLang] = useState('en');
  const [overrideReasons, setOverrideReasons] = useState({});
  const [drafting, setDrafting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [queue, setQueue] = useState([]);
  const [referral, setReferral] = useState({ open: false, reason: '', busy: false, done: null });
  const [showAllVisits, setShowAllVisits] = useState(false);

  // Referrals go up the chain to a clinic — from a PHC to its CHC.
  const canRefer = me.active.facilityType === 'phc' && me.active.parentFacilityId;

  useEffect(() => {
    careApi.config().then(setConfig).catch(() => {});
  }, []);

  // Patients the desk has sent in, refreshed every 20 s.
  const loadQueue = () => careApi.queue().then((r) => setQueue(r.queue)).catch(() => {});
  useEffect(() => {
    loadQueue();
    const t = setInterval(loadQueue, 20000);
    return () => clearInterval(t);
  }, []);

  // Consultation clock in the patient banner (demo instrumentation only).
  useEffect(() => {
    if (!patient || approved) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [patient, approved]);

  useEffect(() => {
    if (activePatientId) loadPatient(activePatientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatientId]);

  async function loadPatient(id) {
    setError(null);
    try {
      const { patient: p, encounters, summary, currentMedications, referrals } = await careApi.patientHistory(id);
      setPatient(p);
      setHistory({ encounters, summary, currentMedications, referrals });
      setReferral({ open: false, reason: '', busy: false, done: null });
      setShowAllVisits(false);
      onPatientLoaded?.(id);
      setConsult(EMPTY_CONSULT);
      setDraft(null);
      setDraftInput(null);
      setApproved(null);
      setOverrideReasons({});
      setStartedAt(Date.now());
      setNow(Date.now());
    } catch (err) {
      setError(err.message);
    }
  }

  function closePatient() {
    setPatient(null);
    setHistory(null);
    setApproved(null);
    setDraft(null);
    onPatientLoaded?.(null);
    loadQueue();
  }

  async function handleLookup(e) {
    e.preventDefault();
    if (!phone.trim()) return;
    setError(null);
    try {
      const { patient: p } = await careApi.lookupPatient(phone.trim());
      setPhone('');
      loadPatient(p.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRefer() {
    setReferral((r) => ({ ...r, busy: true }));
    try {
      const { referral: made } = await careApi.referPatient(patient.id, referral.reason);
      setReferral({ open: false, reason: '', busy: false, done: made.toFacilityName });
      const refreshed = await careApi.patientHistory(patient.id);
      setHistory((h) => ({ ...h, referrals: refreshed.referrals }));
    } catch (err) {
      setError(err.message);
      setReferral((r) => ({ ...r, busy: false }));
    }
  }

  function applyTemplate(t) {
    setConsult((c) => ({ ...c, chiefComplaint: t.complaint, diagnosis: t.diagnosis, medicationLines: t.meds }));
  }

  function appendDuration(days) {
    setConsult((c) => {
      const lines = c.medicationLines.split('\n');
      const lastIdx = [...lines].map((l) => l.trim()).lastIndexOf(lines.map((l) => l.trim()).filter(Boolean).slice(-1)[0]);
      if (lastIdx < 0) return c;
      if (/day/i.test(lines[lastIdx])) return c;
      lines[lastIdx] = `${lines[lastIdx].trim()} ${days} days`;
      return { ...c, medicationLines: lines.join('\n') };
    });
  }

  /** Whole-consultation dictation finished: add each field's text, then draft. */
  function handleDictationDone(fields) {
    const merged = { ...consult };
    for (const f of DRAFT_FIELDS) {
      const text = fields[f]?.trim();
      if (!text) continue;
      const sep = f === 'medicationLines' ? '\n' : ' ';
      merged[f] = merged[f]?.trim() ? `${merged[f].trimEnd()}${sep}${text}` : text;
    }
    setConsult(merged);
    handleDraft(draftInputOf(merged));
  }

  function set(field) {
    return (e) => setConsult((c) => ({ ...c, [field]: e.target.value }));
  }
  function append(field) {
    // Each dictated clip of medicines goes on its own line, so it isn't glued
    // onto the medicine typed or dictated before it.
    const sep = field === 'medicationLines' ? '\n' : ' ';
    return (text) => setConsult((c) => ({ ...c, [field]: c[field] ? `${c[field].trimEnd()}${sep}${text}` : text }));
  }

  // `input` is passed explicitly after dictation, since the consult state
  // set in the same tick isn't readable yet.
  async function handleDraft(input = draftInputOf(consult)) {
    setDrafting(true);
    setError(null);
    try {
      const d = await careApi.draftEncounter({ patientId: patient.id, ...input, dictationLang });
      setDraft(d);
      setDraftInput(input);
      // Keep reasons the doctor already typed for warnings that are still present.
      setOverrideReasons((prev) =>
        Object.fromEntries(d.warnings.filter((w) => prev[w.message]).map((w) => [w.message, prev[w.message]]))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDrafting(false);
    }
  }

  const draftStale = useMemo(
    () => Boolean(draft && draftInput && DRAFT_FIELDS.some((f) => consult[f] !== draftInput[f])),
    [draft, draftInput, consult]
  );

  const unresolvedMajor = useMemo(() => {
    if (!draft) return [];
    return draft.warnings.filter((w) => w.severity === 'major' && !overrideReasons[w.message]?.trim());
  }, [draft, overrideReasons]);

  async function handleApprove() {
    if (draftStale) return;
    setApproving(true);
    setError(null);
    try {
      // Everything clinical comes from the draft the doctor reviewed, not the live form.
      const res = await careApi.approveEncounter({
        patientId: patient.id,
        chiefComplaint: draft.chiefComplaint,
        dictationRaw: [draftInput.chiefComplaint, draftInput.diagnosis, draftInput.medicationLines].filter(Boolean).join('\n'),
        dictationLang: draft.dictationLang,
        diagnosis: draft.diagnosis,
        medications: draft.medications,
        vitals: { bp: consult.bp, pulse: consult.pulse, tempC: consult.tempC, weightKg: consult.weightKg },
        warnings: draft.warnings,
        overrideReasons: draft.warnings
          .filter((w) => overrideReasons[w.message]?.trim())
          .map((w) => ({ message: w.message, reason: overrideReasons[w.message].trim() })),
        advice: draft.advice,
      });
      setApproved(res);
      loadQueue();
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  }

  const elapsedSeconds = startedAt ? Math.max(0, Math.round(((approved ? Date.now() : now) - startedAt) / 1000)) : 0;
  const waiting = queue.filter((q) => q.patientId !== patient?.id);
  const visits = history?.encounters || [];

  return (
    <div className="consult">
      <header className="page-header">
        <h1>OPD Consultation</h1>
        <div className="page-header__tools">
          <form className="search" onSubmit={handleLookup} role="search">
            <Search size={15} className="search__icon" aria-hidden="true" />
            <input
              aria-label="Find patient by phone number"
              placeholder="Search patient by phone number"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button type="submit" className="btn btn--secondary">Search</button>
          </form>
          <label className="inline-select">
            <span>Dictation language</span>
            <select value={dictationLang} onChange={(e) => setDictationLang(e.target.value)}>
              {DICTATION_LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
        </div>
      </header>

      {error && <div className="alert alert--danger" role="alert"><AlertTriangle size={16} /> {error}</div>}

      {!patient && (
        <section className="card">
          <div className="card__header">
            <h2>Patients Waiting</h2>
            <span className="muted small">{queue.length} today</span>
          </div>
          {queue.length === 0 ? (
            <p className="muted">No one is waiting. Find a patient by phone number above.</p>
          ) : (
            <QueueList queue={queue} onOpen={loadPatient} />
          )}
        </section>
      )}

      {patient && (
        <>
          <section className="patient-banner" aria-label="Patient">
            <div className="patient-banner__who">
              <div className="patient-banner__name">{patient.name}</div>
              <div className="patient-banner__meta">
                {patient.age} y · {SEX_NAME[patient.gender] || patient.gender || '—'} · {patient.phone} ·{' '}
                {LANGUAGE_NAME[patient.language] || patient.language} · advice by {FORMAT_NAME[patient.messageFormat] || patient.messageFormat}
              </div>
            </div>
            <div className={patient.allergies.length ? 'allergy allergy--yes' : 'allergy'}>
              {patient.allergies.length ? (
                <><AlertTriangle size={15} /> Allergies: {patient.allergies.join(', ')}</>
              ) : (
                'No known allergies'
              )}
            </div>
            <div className="patient-banner__actions">
              <span className="timer" title="Time since this patient was opened. Demo instrumentation, not a measured time saving.">
                <Clock size={14} /> {formatClock(elapsedSeconds)}
              </span>
              {canRefer && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setReferral((r) => ({ ...r, open: !r.open }))}>
                  <Send size={14} /> Refer to CHC
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={closePatient} aria-label="Close patient">
                <X size={16} />
              </button>
            </div>
          </section>

          {referral.open && (
            <div className="card referral-strip">
              <input
                autoFocus
                placeholder={`Reason for referral to ${me.active.parentFacilityName}`}
                value={referral.reason}
                onChange={(e) => setReferral((r) => ({ ...r, reason: e.target.value }))}
              />
              <button type="button" className="btn btn--primary btn--sm" disabled={referral.busy || !referral.reason.trim()} onClick={handleRefer}>
                {referral.busy ? 'Referring…' : 'Refer'}
              </button>
              <span className="muted small">Gives {me.active.parentFacilityName} access to this record.</span>
            </div>
          )}
          {referral.done && <div className="alert alert--ok"><CheckCircle2 size={16} /> Referred to {referral.done}.</div>}

          <div className="consult__grid">
            {/* ---------------- Record (left) ---------------- */}
            <aside className="consult__record">
              <section className="card record">
                <h2>Medical History</h2>
                {patient.chronicConditions.length > 0 && (
                  <div className="record__section">
                    <h3>Known Conditions</h3>
                    <div className="chips">
                      {patient.chronicConditions.map((c) => <span key={c} className="chip">{c}</span>)}
                    </div>
                  </div>
                )}

                <div className="record__section">
                  <h3><Pill size={15} /> Current Medicines</h3>
                  {history?.currentMedications?.length ? (
                    <ul className="plain-list">
                      {history.currentMedications.map((m) => <li key={m.generic}>{m.raw}</li>)}
                    </ul>
                  ) : (
                    <p className="muted small">None recorded</p>
                  )}
                </div>

                <div className="record__section">
                  <h3><History size={15} /> Previous Visits ({visits.length})</h3>
                  {visits.length === 0 && <p className="muted small">First visit</p>}
                  <ul className="timeline">
                    {(showAllVisits ? visits : visits.slice(0, 4)).map((e) => (
                      <li key={e.id}>
                        <span className="timeline__date">{parseDbDate(e.created_at)?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        <span className="timeline__dx">{e.diagnosis || 'No diagnosis recorded'}</span>
                        {e.medications.length > 0 && (
                          <span className="timeline__meds">{e.medications.map((m) => m.genericName || m.raw).join(', ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {visits.length > 4 && (
                    <button type="button" className="link-button" onClick={() => setShowAllVisits((v) => !v)}>
                      {showAllVisits ? 'Show fewer' : `Show all ${visits.length}`}
                    </button>
                  )}
                </div>

                {history?.referrals?.length > 0 && (
                  <div className="record__section">
                    <h3>Referrals</h3>
                    <ul className="plain-list small">
                      {history.referrals.map((r) => (
                        <li key={r.id}>
                          {r.to_facility_name}, {parseDbDate(r.created_at)?.toLocaleDateString('en-IN')}
                          {r.reason && <span className="muted"> · {r.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {waiting.length > 0 && (
                <section className="card">
                  <div className="card__header">
                    <h2>Patients Waiting</h2>
                    <span className="muted small">{waiting.length}</span>
                  </div>
                  <QueueList queue={waiting} onOpen={loadPatient} compact />
                </section>
              )}
            </aside>

            {/* ---------------- Work (right) ---------------- */}
            <div className="consult__work">
              {!approved && (
                <>
                  <section className="card">
                    <h2>Clinical Notes</h2>
                    <div className="toolbar">
                      <ConsultDictation
                        language={dictationLang}
                        patientId={patient.id}
                        sarvamConfigured={config.sarvamConfigured}
                        onDone={handleDictationDone}
                        disabled={drafting}
                      />
                      <div className="quick-fill">
                        <span className="muted small">Common cases:</span>
                        {TEMPLATES.map((t) => (
                          <button key={t.label} type="button" className="btn btn--secondary btn--sm" onClick={() => applyTemplate(t)}>{t.label}</button>
                        ))}
                      </div>
                    </div>

                    <hr className="divider" />

                    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); handleDraft(); }}>
                      <div className="field field--full">
                        <label htmlFor="cc">Complaints and Findings <MicButton language={dictationLang} sarvamConfigured={config.sarvamConfigured} onTranscript={append('chiefComplaint')} /></label>
                        <textarea id="cc" rows={2} value={consult.chiefComplaint} onChange={set('chiefComplaint')} />
                      </div>
                      <div className="field field--full">
                        <label htmlFor="dx">Diagnosis <MicButton language={dictationLang} sarvamConfigured={config.sarvamConfigured} onTranscript={append('diagnosis')} /></label>
                        <input id="dx" value={consult.diagnosis} onChange={set('diagnosis')} />
                      </div>
                      <div className="field field--full">
                        <span className="field-label">Vitals</span>
                        <div className="vitals">
                          <input aria-label="Blood pressure" placeholder="BP 120/80" value={consult.bp} onChange={set('bp')} />
                          <input aria-label="Pulse" placeholder="Pulse" value={consult.pulse} onChange={set('pulse')} />
                          <input aria-label="Temperature in Celsius" placeholder="Temp °C" value={consult.tempC} onChange={set('tempC')} />
                          <input aria-label="Weight in kg" placeholder="Weight kg" value={consult.weightKg} onChange={set('weightKg')} />
                        </div>
                      </div>
                      <div className="field field--full">
                        <label htmlFor="rx">
                          Prescription <span className="subtle">(one medicine per line)</span>
                          <MicButton language={dictationLang} sarvamConfigured={config.sarvamConfigured} onTranscript={append('medicationLines')} />
                        </label>
                        <textarea id="rx" rows={3} value={consult.medicationLines} onChange={set('medicationLines')} placeholder="Paracetamol 500 TDS 3 days" />
                        <div className="inline-picks">
                          <span className="muted small">Add days:</span>
                          {DURATION_PICKS.map((d) => (
                            <button key={d} type="button" className="btn btn--ghost btn--sm" onClick={() => appendDuration(d)}>{d} days</button>
                          ))}
                        </div>
                      </div>
                      <div className="field field--full">
                        <label htmlFor="advice">Advice to Patient <MicButton language={dictationLang} sarvamConfigured={config.sarvamConfigured} onTranscript={append('adviceNotes')} /></label>
                        <textarea id="advice" rows={2} value={consult.adviceNotes} onChange={set('adviceNotes')} placeholder="Leave blank for the standard advice" />
                      </div>
                      <div className="field field--full form-actions">
                        <button className="btn btn--primary" type="submit" disabled={drafting}>
                          {drafting ? 'Checking…' : 'Check Prescription'}
                        </button>
                        <span className="muted small">Checks allergies, interactions, doses and stock.</span>
                      </div>
                    </form>
                  </section>

                  {draft && (
                    <section className="card review">
                      <div className="card__header">
                        <h2>Prescription Review</h2>
                        {draft.warnings.length === 0
                          ? <span className="badge badge--synced"><CheckCircle2 size={12} /> No warnings</span>
                          : <span className="badge badge--pending">{draft.warnings.length} warning{draft.warnings.length === 1 ? '' : 's'}</span>}
                      </div>

                      {draftStale && (
                        <div className="alert alert--warn">
                          <RefreshCw size={15} /> You changed the notes after drafting. Re-check before approving.
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleDraft()} disabled={drafting}>
                            {drafting ? 'Checking…' : 'Re-check'}
                          </button>
                        </div>
                      )}

                      <h3>Medicines</h3>
                      <div className="table-scroll">
                        <table className="report-table rx-table">
                          <thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th></tr></thead>
                          <tbody>
                            {draft.medications.map((m, i) => (
                              <tr key={i}>
                                <td>
                                  {m.genericName || m.raw}
                                  {m.heardAs && <div className="subtle small">heard “{m.heardAs}”</div>}
                                  {m.unmatched && <div><span className="badge badge--pending">Not in medicine list</span></div>}
                                </td>
                                <td>{m.doseMg ? `${m.doseMg} mg` : <span className="subtle">—</span>}</td>
                                <td>{m.frequencyToken || <span className="subtle">—</span>}</td>
                                <td>{m.durationDays ? `${m.durationDays} days` : <span className="subtle">—</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {draft.warnings.length > 0 && <h3>Safety Warnings</h3>}
                      {draft.warnings.length > 0 && (
                        <ul className="checks">
                          {[...draft.warnings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).map((w, i) => (
                            <li key={i} className={`checks__item checks__item--${w.severity}`}>
                              <span className={SEVERITY[w.severity]?.className || 'badge'}>{SEVERITY[w.severity]?.label || w.severity}</span>
                              <div className="checks__body">
                                <div>{w.message}</div>
                                {w.severity === 'major' && (
                                  <input
                                    aria-label={`Reason to proceed: ${w.message}`}
                                    placeholder="Reason to proceed (required)"
                                    value={overrideReasons[w.message] || ''}
                                    onChange={(e) => setOverrideReasons((r) => ({ ...r, [w.message]: e.target.value }))}
                                  />
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="patient-copy">
                        <div className="patient-copy__header">
                          <h3>Advice to Patient ({LANGUAGE_NAME[draft.advice.language] || draft.advice.language})</h3>
                          <span className="subtle small">{ADVICE_SOURCE_LABEL[draft.advice.source] || draft.advice.source}</span>
                        </div>
                        <div className="advice-preview">
                          <p style={{ whiteSpace: 'pre-line' }}>{draft.advice.patientLanguageText}{'\n\n'}{draft.doseSchedule.patientLang}</p>
                        </div>
                        {patient.language !== 'en' && draft.advice.source === 'gemini' && (
                          <dl className="compare small">
                            {draft.advice.adviceNote && <><dt>Your note</dt><dd>{draft.advice.adviceNote}</dd></>}
                            <dt>Back-translation</dt><dd>{draft.advice.englishBackTranslation}</dd>
                          </dl>
                        )}
                        {draft.advice.note && <p className="form-error small">{draft.advice.note}</p>}
                      </div>

                      <div className="review__footer">
                        <span className="muted small">
                          Signing as {me.user.name}{me.user.regNo ? ` · Reg. ${me.user.regNo}` : ''}
                        </span>
                        <div className="form-actions" style={{ margin: 0 }}>
                          {unresolvedMajor.length > 0 && <span className="small muted">Add a reason for each major warning.</span>}
                          <button
                            className="btn btn--primary"
                            onClick={handleApprove}
                            disabled={approving || drafting || draftStale || unresolvedMajor.length > 0}
                          >
                            {approving ? 'Signing…' : 'Approve & Sign'}
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                </>
              )}

              {approved && (
                <>
                  <section className="card">
                    <div className="card__header">
                      <h2 className="signed"><CheckCircle2 size={20} /> Prescription Signed</h2>
                      <div className="form-actions" style={{ margin: 0 }}>
                        <button className="btn btn--secondary btn--sm" onClick={() => loadPatient(patient.id)}>New Visit for This Patient</button>
                        <button className="btn btn--ghost btn--sm" onClick={closePatient}>Close</button>
                      </div>
                    </div>
                    <ul className="outcomes">
                      {approved.stock?.deducted?.length > 0 && (
                        <li><span className="muted">Stock</span> {approved.stock.deducted.map((d) => `${d.medicine} −${d.qty}${d.shortBy ? ` (short by ${d.shortBy})` : ''}`).join(', ')}</li>
                      )}
                      {approved.stock?.skipped?.length > 0 && (
                        <li className="outcomes__warn"><span className="muted">Not deducted</span> {approved.stock.skipped.map((s) => `${s.medicine} (${s.reason})`).join(', ')}. Record the quantity dispensed.</li>
                      )}
                      {approved.whatsapp && (
                        <li>
                          <span className="muted">WhatsApp</span> {approved.whatsapp.status === 'skipped' ? 'Not sent: 24-hour window closed' : 'Queued (sending is mocked in this demo)'}
                          {approved.whatsapp.tts && (approved.whatsapp.tts.generated ? ', voice note ready' : ', no voice note')}
                        </li>
                      )}
                      {approved.advice?.note && <li className="outcomes__warn">{approved.advice.note}</li>}
                    </ul>
                  </section>
                  <PrintableReport encounter={approved.encounter} patient={patient} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QueueList({ queue, onOpen, compact }) {
  return (
    <ul className={compact ? 'queue queue--compact' : 'queue'}>
      {queue.map((q) => (
        <li key={q.id}>
          <button type="button" className="queue__row" onClick={() => onOpen(q.patientId)}>
            <span className="queue__name">{q.name}</span>
            <span className="muted">{q.age}{q.gender}</span>
            {q.hasAllergies && <span className="badge badge--danger"><AlertTriangle size={11} /> Allergy</span>}
            {!compact && (
              <span className="queue__time subtle">
                {parseDbDate(q.queuedAt)?.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
