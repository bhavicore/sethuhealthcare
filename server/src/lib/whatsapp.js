import { db } from '../db.js';

// Meta WhatsApp Cloud API integration is out of scope for this build (needs a
// registered WhatsApp Business number and Meta app review). This stub queues
// the same-day voice note / text summary into whatsapp_outbox exactly where
// the real Cloud API call would go, so the integration point is real even
// though the upstream send is mocked — same pattern as the ABDM/ABHA stub.

function metaConfigured() {
  return Boolean(process.env.WHATSAPP_CLOUD_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function whatsappConfigured() {
  return metaConfigured();
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Meta only allows free-form text/audio within 24 hours of the patient's last
 * message to us. The desk QR scan ("Hi") is that message, so the window has
 * to be re-opened on every visit, not just at first registration.
 */
export function isWindowOpen(patientRow, now = Date.now()) {
  const opened = patientRow?.whatsapp_window_opened_at;
  if (!patientRow?.whatsapp_consent || !opened) return false;
  const iso = opened.includes('T') ? opened : `${opened.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t < WINDOW_MS;
}

/**
 * Queue a message for a patient whose 24-hour window is open. Nothing is
 * actually delivered in this build: the Cloud API call is not implemented,
 * even when credentials are set, so every row stays 'mocked'.
 */
export async function queueWhatsappMessage({ patientId, encounterId, kind, text, audioBase64 }) {
  const payload = { text, audioBase64: audioBase64 || null };

  db.prepare(
    'INSERT INTO whatsapp_outbox (patient_id, encounter_id, kind, payload, status) VALUES (?, ?, ?, ?, ?)'
  ).run(patientId, encounterId ?? null, kind, JSON.stringify(payload), 'mocked');

  // Real send would go here: POST to graph.facebook.com/{version}/{phone_number_id}/messages
  // using WHATSAPP_CLOUD_API_TOKEN, uploading the audio as audio/ogg (Opus) media first.
  return {
    status: 'mocked',
    note: metaConfigured()
      ? 'WhatsApp credentials are set, but the Cloud API send is not implemented in this build — message queued locally, not sent.'
      : 'WhatsApp Cloud API not configured — message queued locally, not sent.',
  };
}

export function listOutboxForPatient(patientId) {
  return db
    .prepare('SELECT * FROM whatsapp_outbox WHERE patient_id = ? ORDER BY id DESC')
    .all(patientId);
}
