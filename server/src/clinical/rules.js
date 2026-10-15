import { db } from '../db.js';

// Deterministic Clinical Decision Support checks (Task 3.2). These are
// warnings, never blocks — the doctor can proceed after giving a short
// reason, which is logged (Doctor-in-Control Rule 5).

function loadAllergyClasses() {
  const rows = db.prepare('SELECT * FROM allergy_classes').all();
  const byMedicine = new Map();
  for (const r of rows) {
    if (!byMedicine.has(r.medicine_id)) byMedicine.set(r.medicine_id, []);
    byMedicine.get(r.medicine_id).push(r.class);
  }
  return byMedicine;
}

function loadInteractions() {
  return db.prepare('SELECT * FROM interactions').all();
}

/** Does any recorded patient allergy (verbatim strings) conflict with this medicine? */
function checkAllergyConflicts(medications, patientAllergies) {
  if (!patientAllergies?.length) return [];
  const allergyClasses = loadAllergyClasses();
  const warnings = [];
  const allergiesLower = patientAllergies.map((a) => a.toLowerCase());

  for (const med of medications) {
    if (!med.generic) continue;
    const classes = allergyClasses.get(med.generic) || [];
    const names = [med.genericName?.toLowerCase(), med.generic.toLowerCase(), ...classes].filter(Boolean);
    for (const allergy of allergiesLower) {
      if (names.some((n) => n === allergy || n.includes(allergy) || allergy.includes(n))) {
        warnings.push({
          type: 'allergy',
          severity: 'major',
          medicine: med.genericName || med.matchedText,
          message: `Patient has a recorded ${patientAllergies.find((a) => a.toLowerCase() === allergy)} allergy — conflicts with ${med.genericName || med.matchedText}.`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Drug-drug interactions among today's prescribed medicines, and between
 * today's medicines and what the patient is already taking (from history).
 */
function checkInteractions(medications, currentMedications = []) {
  const interactions = loadInteractions();
  const warnings = [];
  const findHit = (a, b) =>
    interactions.find(
      (row) =>
        (row.drug_a.toLowerCase() === a && row.drug_b.toLowerCase() === b) ||
        (row.drug_a.toLowerCase() === b && row.drug_b.toLowerCase() === a)
    );

  const generics = [...new Set(medications.filter((m) => m.generic).map((m) => m.generic))];
  for (let i = 0; i < generics.length; i++) {
    for (let j = i + 1; j < generics.length; j++) {
      const [a, b] = [generics[i], generics[j]];
      const hit = findHit(a, b);
      if (hit) {
        warnings.push({ type: 'interaction', severity: hit.severity, medicine: `${a} + ${b}`, message: hit.note });
      }
    }
  }

  for (const current of currentMedications) {
    if (!current.generic || generics.includes(current.generic)) continue;
    for (const a of generics) {
      const hit = findHit(a, current.generic);
      if (hit) {
        warnings.push({
          type: 'interaction',
          severity: hit.severity,
          medicine: `${a} + ${current.generic} (current)`,
          message: `${hit.note} Patient is already taking ${current.raw || current.generic} (from history).`,
        });
      }
    }
  }
  return warnings;
}

/** Simple max-daily-dose ceiling check (dose x times/day vs. the medicine's known ceiling). */
function checkDoseLimits(medications) {
  const warnings = [];
  for (const med of medications) {
    if (!med.generic || med.doseMg == null || !med.timesPerDay) continue;
    const rowMax = db.prepare('SELECT max_daily_dose_mg FROM medicines WHERE id = ?').get(med.generic);
    const maxDailyMg = rowMax?.max_daily_dose_mg;
    // The NLEM list gives dosage forms, not daily ceilings, so most medicines on
    // it have none on record. Say so rather than letting the check pass silently.
    if (maxDailyMg == null) {
      warnings.push({
        type: 'dose-limit',
        severity: 'minor',
        medicine: med.genericName || med.matchedText,
        message: `${med.genericName || med.matchedText}: no daily dose ceiling on record — this prescription was not dose-checked.`,
      });
      continue;
    }
    const dailyTotal = med.doseMg * med.timesPerDay;
    if (dailyTotal > maxDailyMg) {
      warnings.push({
        type: 'dose-limit',
        severity: 'major',
        medicine: med.genericName || med.matchedText,
        message: `${med.genericName || med.matchedText}: ${dailyTotal} mg/day exceeds the usual ceiling of ${maxDailyMg} mg/day.`,
      });
    }
  }
  return warnings;
}

/**
 * Same generic prescribed more than once (e.g. "Dolo 650" and "Paracetamol
 * 500" are both paracetamol). The per-line dose check can't see this, so check
 * the combined daily dose here.
 */
function checkDuplicates(medications) {
  const byGeneric = new Map();
  for (const med of medications) {
    if (!med.generic) continue;
    if (!byGeneric.has(med.generic)) byGeneric.set(med.generic, []);
    byGeneric.get(med.generic).push(med);
  }
  const warnings = [];
  for (const [generic, meds] of byGeneric) {
    if (meds.length < 2) continue;
    const label = meds[0].genericName || generic;
    const combined = meds.reduce((sum, m) => sum + (m.doseMg && m.timesPerDay ? m.doseMg * m.timesPerDay : 0), 0);
    const maxDailyMg = db.prepare('SELECT max_daily_dose_mg FROM medicines WHERE id = ?').get(generic)?.max_daily_dose_mg;
    const over = maxDailyMg != null && combined > maxDailyMg;
    warnings.push({
      type: 'duplicate',
      severity: over ? 'major' : 'moderate',
      medicine: label,
      message:
        `${label} is prescribed ${meds.length} times (${meds.map((m) => m.matchedText || m.raw).join(', ')}).` +
        (combined ? ` Combined ${combined} mg/day${maxDailyMg != null ? ` (usual ceiling ${maxDailyMg} mg/day)` : ''}.` : ''),
    });
  }
  return warnings;
}

/** Flag anything the doctor's dictation left unstated. */
function checkMissingDetails(medications) {
  const warnings = [];
  for (const med of medications) {
    const label = med.genericName || med.matchedText || med.raw;
    if (med.unmatched) {
      warnings.push({
        type: 'unmatched',
        severity: 'moderate',
        medicine: med.raw,
        message:
          `"${med.raw}" isn't in this PHC's medicine list, so it was NOT checked for allergies, interactions, ` +
          `dose, or stock. It will be printed for the patient exactly as written. Check the name, or use a listed medicine.`,
      });
      continue;
    }
    if (med.heardAs) {
      warnings.push({
        type: 'spelling',
        severity: 'moderate',
        medicine: label,
        message: `Heard "${med.heardAs}" — matched to ${label}. Confirm this is the medicine you meant.`,
      });
    }
    if (!med.durationDays) {
      warnings.push({
        type: 'missing-detail',
        severity: 'minor',
        medicine: label,
        message: `${label}: duration not stated — stock won't be deducted until it is.`,
      });
    }
    if (!med.frequencyToken) {
      warnings.push({
        type: 'missing-detail',
        severity: 'minor',
        medicine: label,
        message: `${label}: frequency not stated — stock won't be deducted until it is.`,
      });
    }
    if (med.doseSource === 'unit-default') {
      warnings.push({
        type: 'missing-detail',
        severity: 'minor',
        medicine: label,
        message: `${label}: dose not stated — assumed one ${med.unitLabel} (${med.doseMg} mg).`,
      });
    }
    if (med.frequencyToken && med.timesPerDay === 0) {
      warnings.push({
        type: 'stock',
        severity: 'minor',
        medicine: label,
        message: `${label}: as-needed (${med.frequencyToken}) — stock can't be deducted automatically; record the quantity dispensed.`,
      });
    }
  }
  return warnings;
}

/** Stock check against this facility's current inventory. */
function checkStock(medications, facilityId) {
  const warnings = [];
  for (const med of medications) {
    if (!med.generic) continue;
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(stock_qty), 0) AS qty FROM inventory
         WHERE facility_id = ? AND medicine_id = ? AND expiry_date >= date('now')`
      )
      .get(facilityId, med.generic);
    const label = med.genericName || med.matchedText;
    if (!row || row.qty <= 0) {
      warnings.push({
        type: 'stock',
        severity: 'moderate',
        medicine: label,
        message: `${label}: out of stock at this facility.`,
      });
    } else if (med.durationDays && med.timesPerDay && row.qty < med.durationDays * med.timesPerDay) {
      warnings.push({
        type: 'stock',
        severity: 'minor',
        medicine: label,
        message: `${label}: only ${row.qty} units left at this facility — may not cover the full course.`,
      });
    }
  }
  return warnings;
}

/**
 * Run every CDSS check against a draft encounter's parsed medications.
 * Returns a flat list of warnings; each carries type/severity/medicine/message.
 */
export function runClinicalChecks({ medications, patientAllergies, currentMedications, facilityId }) {
  return [
    ...checkAllergyConflicts(medications, patientAllergies),
    ...checkInteractions(medications, currentMedications),
    ...checkDoseLimits(medications),
    ...checkDuplicates(medications),
    ...checkMissingDetails(medications),
    ...checkStock(medications, facilityId),
  ];
}
