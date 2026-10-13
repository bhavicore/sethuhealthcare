// Strips the identifiers we hold for a patient (name, phone) plus anything
// shaped like a phone or ABHA number, before text leaves the server for
// Gemini (task.md Task 2.2). Deterministic and deliberately blunt: it can only
// remove what it knows about — a village or a relative's name typed into the
// advice box would still get through, so the doctor-facing UI says so.

const NAME_STOPWORDS = new Set([
  'for', 'and', 'the', 'with', 'child', 'baby', 'son', 'daughter', 'wife', 'husband', 'mother', 'father',
]);

function escapeRegExp(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function stripPii(text, patient = {}) {
  if (!text) return text;
  let out = text;

  // ABHA (14 digits, optionally 2-4-4-4 hyphenated) and Indian phone numbers.
  out = out.replace(/\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b/g, '[id]');
  out = out.replace(/(?:\+?91[\s-]?)?\b\d{5}[\s-]?\d{5}\b/g, '[phone]');
  if (patient.phone) out = out.replace(new RegExp(escapeRegExp(patient.phone), 'g'), '[phone]');

  // Each part of the patient's name (3+ letters, so initials don't eat words).
  // Desk staff sometimes type "Meena Devi (for child Aarav)" — skip the
  // relationship words so "for 3 days" doesn't become "[patient] 3 days".
  const nameParts = String(patient.name || '')
    .split(/[\s(),.]+/)
    .filter((p) => /^\p{L}{3,}$/u.test(p) && !NAME_STOPWORDS.has(p.toLowerCase()));
  for (const part of nameParts) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, 'gi'), '[patient]');
  }
  return out;
}
