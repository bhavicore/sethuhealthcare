// Deterministic 3-4 line history summary shown on the doctor's screen the
// moment a patient is looked up. No LLM: allergies and medicines must be
// shown exactly as recorded, never inferred (task.md Task 3.1).

/**
 * Timestamps come in two shapes: ISO strings from seed.js, and SQLite's
 * datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC, no zone). Parse both as UTC.
 */
export function parseDbDate(value) {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function summarizeHistory(patient, encounters) {
  const lines = [];
  const allergies = JSON.parse(patient.allergies || '[]');
  const chronic = JSON.parse(patient.chronic_conditions || '[]');

  lines.push(
    `${patient.name}, ${patient.age}${patient.gender ? `${patient.gender}` : ''} — ${encounters.length} prior visit${encounters.length === 1 ? '' : 's'} on record.`
  );

  if (chronic.length) lines.push(`Chronic conditions: ${chronic.join(', ')}.`);
  if (allergies.length) lines.push(`⚠ Allergies: ${allergies.join(', ')}.`);
  else lines.push('No allergies recorded.');

  const last = encounters[0];
  if (last) {
    const vitals = JSON.parse(last.vitals || '{}');
    const vitalsText = Object.entries(vitals)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(
      `Last visit (${parseDbDate(last.created_at)?.toLocaleDateString('en-IN') ?? 'date unknown'}): ${last.diagnosis || 'no diagnosis recorded'}${vitalsText ? ` — ${vitalsText}` : ''}.`
    );
  } else {
    lines.push('First recorded visit at this facility.');
  }

  return lines.join(' ');
}

// Seeded history stores duration as a string ("30 days"); new encounters store durationDays.
function courseDays(med) {
  if (med.durationDays) return med.durationDays;
  const n = parseInt(med.duration, 10);
  return Number.isFinite(n) ? n : null;
}

export function currentMedicationsFromHistory(encounters, now = new Date()) {
  // "Current medicines" = the latest prescription of each medicine whose
  // course hasn't ended yet. A course with no recorded duration is kept, since
  // we can't tell it has ended (safer for the interaction check).
  const seen = new Map();
  for (const enc of encounters) {
    const meds = JSON.parse(enc.medications || '[]');
    for (const med of meds) {
      if (!med.generic || seen.has(med.generic)) continue;
      const started = parseDbDate(enc.created_at);
      const days = courseDays(med);
      const endsAt = started && days ? new Date(started.getTime() + days * 86400000) : null;
      seen.set(med.generic, { ...med, fromVisit: enc.created_at, active: !endsAt || endsAt >= now });
    }
  }
  return [...seen.values()].filter((m) => m.active);
}
