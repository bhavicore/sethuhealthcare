import { useEffect, useState } from 'react';
import { buildReferralPayload, payloadToDataUrl } from '../lib/qr';

export default function ReferralCardModal({ visit, onClose }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const payload = buildReferralPayload(visit);
    payloadToDataUrl(payload)
      .then(setDataUrl)
      .catch((err) => setError(err.message));
  }, [visit]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-card referral-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-card__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>Referral Card</h2>
        <p className="referral-card__patient">
          {visit.name} · {visit.age}{visit.gender ? `, ${visit.gender}` : ''}
        </p>

        {error && <p className="form-error">Could not generate QR: {error}</p>}
        {!error && !dataUrl && <p className="muted">Generating QR…</p>}
        {dataUrl && (
          <>
            <img className="referral-card__qr" src={dataUrl} alt="Referral QR code" />
            <p className="muted small">
              Self-contained — the receiving doctor can scan and read this with zero
              connectivity. No login, no lookup required.
            </p>
            <a className="btn btn--secondary" href={dataUrl} download={`sethu-referral-${visit.localId}.png`}>
              Download QR
            </a>
          </>
        )}

        <div className="referral-card__summary">
          <h3>Visit summary</h3>
          <dl>
            {visit.abhaId && (
              <>
                <dt>ABHA ID</dt>
                <dd>{visit.abhaId}</dd>
              </>
            )}
            <dt>Symptoms</dt>
            <dd>{visit.symptoms || '—'}</dd>
            <dt>Diagnosis</dt>
            <dd>{visit.diagnosis || '—'}</dd>
            <dt>Medications</dt>
            <dd>{visit.medications || '—'}</dd>
            <dt>Allergies</dt>
            <dd>{visit.allergies || '—'}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
