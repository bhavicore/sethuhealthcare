import { db } from './db.js';
import { loadNlem } from './data/nlem.js';
import { parseMedicationLines } from './clinical/normalize.js';
import { runClinicalChecks } from './clinical/rules.js';
import { buildDoseScheduleBlock, DEFAULT_ADVICE_NOTE, WARNING_SIGNS_TEXT } from './clinical/templates.js';
import { hashPin } from './auth/access.js';

// ---------------------------------------------------------------------------
// Synthetic demo data only — see task.md "Data We Need (demo)".
// Nothing here is a real patient, doctor, or facility. Interaction/allergy/dose
// tables are small hand-picked references for the prototype and are NOT a
// substitute for a pharmacist-reviewed clinical database.
// ---------------------------------------------------------------------------

function isSeeded() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM facilities").get();
  return row.n > 0;
}

function seedFacilities() {
  const insert = db.prepare('INSERT INTO facilities (id, name, type, parent_id) VALUES (?, ?, ?, ?)');
  insert.run('chc-1', 'Erode Community Health Centre', 'chc', null);
  insert.run('phc-1', 'Kaveripatnam Primary Health Centre', 'phc', 'chc-1');
}

const MEDICINES = [
  { id: 'paracetamol', generic_name: 'Paracetamol', unit_label: '500 mg tablet', max_daily_dose_mg: 4000, nlem_code: 'NLEM-A01' },
  { id: 'ors', generic_name: 'Oral Rehydration Salts', unit_label: '21 g sachet', max_daily_dose_mg: null, nlem_code: 'NLEM-A02' },
  { id: 'amoxicillin', generic_name: 'Amoxicillin', unit_label: '500 mg capsule', max_daily_dose_mg: 3000, nlem_code: 'NLEM-A03' },
  { id: 'metformin', generic_name: 'Metformin', unit_label: '500 mg tablet', max_daily_dose_mg: 2000, nlem_code: 'NLEM-A04' },
  { id: 'amlodipine', generic_name: 'Amlodipine', unit_label: '5 mg tablet', max_daily_dose_mg: 10, nlem_code: 'NLEM-A05' },
  { id: 'cetirizine', generic_name: 'Cetirizine', unit_label: '10 mg tablet', max_daily_dose_mg: 10, nlem_code: 'NLEM-A06' },
  { id: 'omeprazole', generic_name: 'Omeprazole', unit_label: '20 mg capsule', max_daily_dose_mg: 40, nlem_code: 'NLEM-A07' },
  { id: 'azithromycin', generic_name: 'Azithromycin', unit_label: '500 mg tablet', max_daily_dose_mg: 500, nlem_code: 'NLEM-A08' },
  { id: 'ibuprofen', generic_name: 'Ibuprofen', unit_label: '400 mg tablet', max_daily_dose_mg: 2400, nlem_code: 'NLEM-A09' },
  { id: 'domperidone', generic_name: 'Domperidone', unit_label: '10 mg tablet', max_daily_dose_mg: 30, nlem_code: 'NLEM-A10' },
];

const BRAND_GENERIC = [
  ['Dolo 650', 'paracetamol'], ['Crocin', 'paracetamol'], ['Calpol', 'paracetamol'],
  ['Electral', 'ors'], ['ORSL', 'ors'], ['Enerzal', 'ors'],
  ['Novamox', 'amoxicillin'], ['Mox', 'amoxicillin'], ['Almox', 'amoxicillin'],
  ['Glycomet', 'metformin'], ['Gluformin', 'metformin'], ['Glyciphage', 'metformin'],
  ['Amlopres', 'amlodipine'], ['Amlodac', 'amlodipine'], ['Stamlo', 'amlodipine'],
  ['Cetrizet', 'cetirizine'], ['Alerid', 'cetirizine'], ['Zyrtec', 'cetirizine'],
  ['Omez', 'omeprazole'], ['Ocid', 'omeprazole'], ['Protoloc', 'omeprazole'],
  ['Azithral', 'azithromycin'], ['Zithrox', 'azithromycin'], ['Azee', 'azithromycin'],
  ['Brufen', 'ibuprofen'], ['Ibugesic', 'ibuprofen'], ['Combiflam', 'ibuprofen'],
  ['Domstal', 'domperidone'], ['Vomiheal', 'domperidone'], ['Domperi', 'domperidone'],
];

const ABBREVIATIONS = [
  ['OD', 'once a day'], ['BD', 'twice a day'], ['TDS', 'three times a day'],
  ['TID', 'three times a day'], ['QID', 'four times a day'], ['SOS', 'as needed'],
  ['PRN', 'as needed'], ['HS', 'at bedtime'], ['STAT', 'immediately'],
  ['1-0-1', 'morning and night'], ['1-1-1', 'morning, afternoon and night'],
  ['1-0-0', 'morning only'], ['0-0-1', 'night only'], ['1-1-0', 'morning and afternoon'],
  ['PO', 'by mouth'], ['AC', 'before food'], ['PC', 'after food'],
];

const ALLERGY_CLASSES = [
  ['amoxicillin', 'penicillin'],
  ['azithromycin', 'macrolide'],
  ['ibuprofen', 'nsaid'],
];

// Small hand-built reference table (~20 pairs). Demo-relevant pairs use the
// 10 NLEM medicines above; the rest are well-known pairs kept for reference
// even though this demo's medicine list won't always trigger them.
const INTERACTIONS = [
  ['ibuprofen', 'amlodipine', 'moderate', 'NSAIDs can blunt the blood-pressure-lowering effect of amlodipine.'],
  ['ibuprofen', 'metformin', 'moderate', 'NSAIDs can impair renal clearance; caution in renal impairment.'],
  ['azithromycin', 'domperidone', 'moderate', 'Both can prolong the QT interval — avoid combining where possible.'],
  ['omeprazole', 'clopidogrel', 'moderate', 'Omeprazole may reduce the antiplatelet effect of clopidogrel.'],
  ['warfarin', 'azithromycin', 'moderate', 'Macrolides can potentiate warfarin, raising INR.'],
  ['warfarin', 'ibuprofen', 'major', 'Combined bleeding risk — NSAIDs plus anticoagulants.'],
  ['warfarin', 'aspirin', 'major', 'Combined bleeding risk.'],
  ['sildenafil', 'nitrates', 'major', 'Risk of severe, life-threatening hypotension.'],
  ['simvastatin', 'azithromycin', 'moderate', 'Macrolides can raise statin levels, increasing myopathy risk.'],
  ['methotrexate', 'trimethoprim', 'major', 'Combined folate-antagonist toxicity.'],
  ['digoxin', 'amiodarone', 'major', 'Amiodarone raises digoxin levels — risk of toxicity.'],
  ['theophylline', 'ciprofloxacin', 'moderate', 'Ciprofloxacin can raise theophylline levels.'],
  ['lithium', 'ibuprofen', 'moderate', 'NSAIDs can raise lithium levels.'],
  ['phenytoin', 'valproate', 'moderate', 'Complex protein-binding interaction — monitor levels.'],
  ['ace inhibitor', 'spironolactone', 'moderate', 'Risk of hyperkalaemia.'],
  ['maoi', 'ssri', 'major', 'Risk of serotonin syndrome.'],
  ['metformin', 'contrast dye', 'moderate', 'Risk of lactic acidosis in renal impairment — hold around imaging.'],
  ['amoxicillin', 'oral contraceptive', 'minor', 'Rare reports of reduced contraceptive efficacy.'],
  ['omeprazole', 'atazanavir', 'major', 'PPIs markedly reduce atazanavir absorption.'],
  ['ibuprofen', 'ssri', 'moderate', 'Combined bleeding risk (GI).'],
];

function seedMedicines() {
  const insertMed = db.prepare(
    'INSERT INTO medicines (id, generic_name, unit_label, max_daily_dose_mg, nlem_code) VALUES (@id, @generic_name, @unit_label, @max_daily_dose_mg, @nlem_code)'
  );
  for (const m of MEDICINES) insertMed.run(m);

  const insertBrand = db.prepare('INSERT INTO brand_generic (brand, medicine_id) VALUES (?, ?)');
  for (const [brand, id] of BRAND_GENERIC) insertBrand.run(brand, id);

  const insertAbbrev = db.prepare('INSERT INTO abbreviations (abbrev, expansion) VALUES (?, ?)');
  for (const [abbrev, expansion] of ABBREVIATIONS) insertAbbrev.run(abbrev, expansion);

  const insertClass = db.prepare('INSERT INTO allergy_classes (medicine_id, class) VALUES (?, ?)');
  for (const [id, cls] of ALLERGY_CLASSES) insertClass.run(id, cls);

  const insertInteraction = db.prepare(
    'INSERT INTO interactions (drug_a, drug_b, severity, note) VALUES (?, ?, ?, ?)'
  );
  for (const [a, b, severity, note] of INTERACTIONS) insertInteraction.run(a, b, severity, note);
}

const PATIENTS = [
  {
    id: 'pat-001',
    name: 'Lakshmi Raman',
    age: 52,
    gender: 'F',
    phone: '9800000001',
    language: 'ta',
    message_format: 'both',
    whatsapp_consent: 1,
    allergies: ['Penicillin'],
    chronic_conditions: ['Type 2 Diabetes', 'Hypertension'],
  },
  {
    id: 'pat-002',
    name: 'Ramesh Kumar',
    age: 34,
    gender: 'M',
    phone: '9800000002',
    language: 'hi',
    message_format: 'text',
    whatsapp_consent: 0,
    allergies: [],
    chronic_conditions: [],
  },
  {
    id: 'pat-003',
    name: 'Meena Devi (for child Aarav, 8y)',
    age: 8,
    gender: 'M',
    phone: '9800000003',
    language: 'hi',
    message_format: 'voice',
    whatsapp_consent: 1,
    allergies: [],
    chronic_conditions: [],
  },
  {
    id: 'pat-004',
    name: 'Suresh Pillai',
    age: 67,
    gender: 'M',
    phone: '9800000004',
    language: 'ta',
    message_format: 'both',
    whatsapp_consent: 1,
    allergies: [],
    chronic_conditions: ['Hypertension'],
  },
];

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function seedPatients() {
  const insert = db.prepare(`
    INSERT INTO patients (id, name, age, gender, phone, language, message_format, whatsapp_consent, whatsapp_window_opened_at, allergies, chronic_conditions, created_at)
    VALUES (@id, @name, @age, @gender, @phone, @language, @message_format, @whatsapp_consent, @whatsapp_window_opened_at, @allergies, @chronic_conditions, @created_at)
  `);
  for (const p of PATIENTS) {
    insert.run({
      ...p,
      whatsapp_window_opened_at: p.whatsapp_consent ? daysAgoISO(0) : null,
      allergies: JSON.stringify(p.allergies),
      chronic_conditions: JSON.stringify(p.chronic_conditions),
      created_at: daysAgoISO(120),
    });
  }

  const insertEncounter = db.prepare(`
    INSERT INTO encounters (
      patient_id, facility_id, doctor_name, doctor_reg_no, chief_complaint,
      dictation_raw, dictation_lang, normalized_text, vitals, diagnosis, medications,
      warnings, override_reasons, advice_english, advice_patient_lang, status, created_at, approved_at, approved_by
    ) VALUES (
      @patient_id, @facility_id, @doctor_name, @doctor_reg_no, @chief_complaint,
      @dictation_raw, @dictation_lang, @normalized_text, @vitals, @diagnosis, @medications,
      @warnings, @override_reasons, @advice_english, @advice_patient_lang, @status, @created_at, @approved_at, @approved_by
    )
  `);

  // Past history for pat-001 (Lakshmi Raman) — diabetes + hypertension follow-ups.
  insertEncounter.run({
    patient_id: 'pat-001',
    facility_id: 'phc-1',
    doctor_name: 'Dr. Anitha Selvam',
    doctor_reg_no: 'TN-MC-44210',
    chief_complaint: 'Routine diabetes review',
    dictation_raw: 'Sugar under control, continue metformin 500 BD',
    dictation_lang: 'en',
    normalized_text: 'Sugar under control, continue metformin 500 mg twice a day',
    vitals: JSON.stringify({ bp: '146/90', pulse: '82', tempC: '36.8', weightKg: '68' }),
    diagnosis: 'Type 2 Diabetes Mellitus — routine review',
    medications: JSON.stringify([
      { raw: 'metformin 500 BD', generic: 'metformin', dose: '500 mg', frequency: 'twice a day', duration: '30 days' },
    ]),
    warnings: JSON.stringify([]),
    override_reasons: JSON.stringify([]),
    advice_english: 'Continue metformin as prescribed. Watch for excessive thirst or dizziness.',
    advice_patient_lang: 'மெட்ஃபார்மின் மருந்தை பரிந்துரைத்தபடி தொடரவும். அதிக தாகம் அல்லது தலைச்சுற்றல் இருந்தால் PHC-க்கு வரவும்.',
    status: 'approved',
    created_at: daysAgoISO(42),
    approved_at: daysAgoISO(42),
    approved_by: 'Dr. Anitha Selvam',
  });
  insertEncounter.run({
    patient_id: 'pat-001',
    facility_id: 'phc-1',
    doctor_name: 'Dr. Anitha Selvam',
    doctor_reg_no: 'TN-MC-44210',
    chief_complaint: 'Blood pressure follow-up, mild headache',
    dictation_raw: 'BP high, start amlodipine 5 OD',
    dictation_lang: 'en',
    normalized_text: 'BP high, start amlodipine 5 mg once a day',
    vitals: JSON.stringify({ bp: '152/94', pulse: '86', tempC: '37.0', weightKg: '69' }),
    diagnosis: 'Hypertension, newly started on treatment',
    medications: JSON.stringify([
      { raw: 'amlodipine 5 OD', generic: 'amlodipine', dose: '5 mg', frequency: 'once a day', duration: '30 days' },
    ]),
    warnings: JSON.stringify([]),
    override_reasons: JSON.stringify([]),
    advice_english: 'Start amlodipine once daily. Return if ankles swell or dizziness occurs.',
    advice_patient_lang: 'அம்லோடிபைன் ஒரு நாளைக்கு ஒரு முறை தொடங்கவும். கால் வீக்கம் அல்லது தலைச்சுற்றல் இருந்தால் திரும்பி வரவும்.',
    status: 'approved',
    created_at: daysAgoISO(10),
    approved_at: daysAgoISO(10),
    approved_by: 'Dr. Anitha Selvam',
  });

  // Past history for pat-004 (Suresh Pillai) — hypertension.
  insertEncounter.run({
    patient_id: 'pat-004',
    facility_id: 'phc-1',
    doctor_name: 'Dr. Anitha Selvam',
    doctor_reg_no: 'TN-MC-44210',
    chief_complaint: 'Hypertension review',
    dictation_raw: 'BP controlled, continue amlodipine 5 OD',
    dictation_lang: 'en',
    normalized_text: 'BP controlled, continue amlodipine 5 mg once a day',
    vitals: JSON.stringify({ bp: '134/84', pulse: '76', tempC: '36.7', weightKg: '74' }),
    diagnosis: 'Hypertension — controlled',
    medications: JSON.stringify([
      { raw: 'amlodipine 5 OD', generic: 'amlodipine', dose: '5 mg', frequency: 'once a day', duration: '30 days' },
    ]),
    warnings: JSON.stringify([]),
    override_reasons: JSON.stringify([]),
    advice_english: 'Continue amlodipine as prescribed.',
    advice_patient_lang: 'அம்லோடிபைன் மருந்தை பரிந்துரைத்தபடி தொடரவும்.',
    status: 'approved',
    created_at: daysAgoISO(25),
    approved_at: daysAgoISO(25),
    approved_by: 'Dr. Anitha Selvam',
  });

  // These four demo patients and their history are seeded, not recorded live.
  db.prepare("UPDATE patients SET origin = 'synthetic' WHERE id LIKE 'pat-00%'").run();
  db.prepare("UPDATE encounters SET origin = 'synthetic' WHERE patient_id LIKE 'pat-00%'").run();
}

// Small deterministic PRNG so the demo data is reproducible across seeds.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// usage_history dates must be UTC calendar dates, to line up with SQLite's
// date('now') in clinical/inventory.js and the approve route's toISOString().
function utcDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function seedInventoryAndUsage() {
  const rand = mulberry32(20260914);
  const insertInventory = db.prepare(
    'INSERT INTO inventory (facility_id, medicine_id, batch_no, expiry_date, stock_qty) VALUES (?, ?, ?, ?, ?)'
  );
  const insertUsage = db.prepare(
    'INSERT INTO usage_history (facility_id, medicine_id, date, qty_used) VALUES (?, ?, ?, ?)'
  );
  const insertSettings = db.prepare(`
    INSERT INTO medicine_facility_settings
      (facility_id, medicine_id, seasonal_multiplier, surge_months, lead_time_days, safety_stock_days, cycle_days)
    VALUES (@facility_id, @medicine_id, @seasonal_multiplier, @surge_months, @lead_time_days, @safety_stock_days, @cycle_days)
  `);

  // Baseline daily usage per medicine (units/day) at the PHC, before any surge.
  const BASELINE = {
    paracetamol: 18, ors: 10, amoxicillin: 9, metformin: 14, amlodipine: 8,
    cetirizine: 6, omeprazole: 5, azithromycin: 3, ibuprofen: 7, domperidone: 4,
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const med of MEDICINES) {
    const base = BASELINE[med.id];
    for (let i = 89; i >= 0; i--) {
      const dateStr = utcDaysAgo(i);
      let qty = Math.max(0, Math.round(base * (0.75 + rand() * 0.5)));

      // Monsoon surge, built into the synthetic history: ORS use climbs sharply
      // in the most recent week so the surge flag fires in the demo.
      if (med.id === 'ors' && i < 7) {
        qty = Math.round(qty * (2.2 + rand() * 0.6));
      }
      insertUsage.run('phc-1', med.id, dateStr, qty);
    }

    // CHC keeps a lighter, steadier usage history (it dispenses less directly).
    for (let i = 89; i >= 0; i--) {
      const dateStr = utcDaysAgo(i);
      const qty = Math.max(0, Math.round(base * 0.3 * (0.7 + rand() * 0.6)));
      insertUsage.run('chc-1', med.id, dateStr, qty);
    }

    insertSettings.run({
      facility_id: 'phc-1',
      medicine_id: med.id,
      seasonal_multiplier: med.id === 'ors' ? 1.5 : 1.0,
      surge_months: med.id === 'ors' ? JSON.stringify([6, 7, 8, 9]) : '[]',
      lead_time_days: 3,   // PHC <- CHC, per task.md assumption
      safety_stock_days: 3,
      cycle_days: 30,
    });
    insertSettings.run({
      facility_id: 'chc-1',
      medicine_id: med.id,
      seasonal_multiplier: med.id === 'ors' ? 1.5 : 1.0,
      surge_months: med.id === 'ors' ? JSON.stringify([6, 7, 8, 9]) : '[]',
      lead_time_days: 7,   // CHC <- district warehouse, per task.md assumption
      safety_stock_days: 5,
      cycle_days: 30,
    });
  }

  // Current stock levels. ORS is deliberately low (about to run out given the
  // surge above); cetirizine has a batch near expiry.
  const STOCK_PHC = {
    paracetamol: { qty: 620, expiryDays: 400 },
    ors: { qty: 22, expiryDays: 300 },       // low — will trip Reorder given the surge
    amoxicillin: { qty: 260, expiryDays: 250 },
    metformin: { qty: 410, expiryDays: 500 },
    amlodipine: { qty: 300, expiryDays: 450 },
    cetirizine: { qty: 180, expiryDays: 20 }, // near-expiry batch
    omeprazole: { qty: 150, expiryDays: 200 },
    azithromycin: { qty: 90, expiryDays: 180 },
    ibuprofen: { qty: 210, expiryDays: 220 },
    domperidone: { qty: 120, expiryDays: 240 },
  };
  for (const med of MEDICINES) {
    const s = STOCK_PHC[med.id];
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + s.expiryDays);
    insertInventory.run('phc-1', med.id, `B-${med.id.slice(0, 3).toUpperCase()}-1`, expiry.toISOString().slice(0, 10), s.qty);
  }

  // CHC holds a larger reserve of everything (it's the level above the PHC).
  for (const med of MEDICINES) {
    const s = STOCK_PHC[med.id];
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + Math.max(s.expiryDays, 200));
    insertInventory.run('chc-1', med.id, `B-${med.id.slice(0, 3).toUpperCase()}-CHC1`, expiry.toISOString().slice(0, 10), Math.round(s.qty * 4));
  }
}

// ---------------------------------------------------------------------------
// Synthetic visit history for the clinic dashboard (~60 days at phc-1).
// Every row is marked origin = 'synthetic' so the dashboard can say exactly
// how much of what it shows is seeded vs recorded live in the demo. The case
// mix is hand-picked, not drawn from real PHC data; diarrhoea visits rise in
// the last week to match the ORS surge in the usage history above.
// ---------------------------------------------------------------------------

const VISIT_TEMPLATES = [
  { weight: 22, complaint: 'Fever for 2 days with body ache', diagnosis: 'Viral fever', meds: 'Paracetamol 500 TDS 3 days' },
  { weight: 16, complaint: 'Cough and cold for 4 days', diagnosis: 'Upper respiratory tract infection', meds: 'Paracetamol 500 SOS\nCetirizine 10 OD 5 days' },
  { weight: 10, surge: true, complaint: 'Loose motions for 2 days, mild dehydration', diagnosis: 'Acute gastroenteritis', meds: 'ORS SOS 3 days\nDomperidone 10 BD 3 days' },
  { weight: 12, chronic: 'Hypertension', complaint: 'BP review', diagnosis: 'Hypertension — follow-up', meds: 'Amlodipine 5 OD 30 days' },
  { weight: 10, chronic: 'Type 2 Diabetes', complaint: 'Sugar review', diagnosis: 'Type 2 diabetes — follow-up', meds: 'Metformin 500 BD 30 days' },
  { weight: 9, complaint: 'Burning in upper abdomen after meals', diagnosis: 'Gastritis', meds: 'Omeprazole 20 OD 7 days' },
  { weight: 7, minAge: 40, complaint: 'Knee pain for a week', diagnosis: 'Osteoarthritis knee', meds: 'Ibuprofen 400 BD 5 days' },
  { weight: 8, complaint: 'Sore throat and fever for 2 days', diagnosis: 'Acute pharyngitis', meds: 'Amoxicillin 500 TDS 5 days\nParacetamol 500 SOS' },
  { weight: 6, complaint: 'Itchy rash since yesterday', diagnosis: 'Urticaria', meds: 'Cetirizine 10 HS 5 days' },
  // Hypertensive patient with joint pain: the ibuprofen–amlodipine interaction
  // gets flagged, so the dashboard's safety panel has something real to count.
  { weight: 2, chronic: 'Hypertension', complaint: 'BP review, back pain for 3 days', diagnosis: 'Hypertension; mechanical back pain', meds: 'Amlodipine 5 OD 30 days\nIbuprofen 400 BD 3 days' },
];

// Name pools by language and sex, so a synthetic record never reads "Suresh, F".
const NAMES = {
  ta: {
    F: ['Selvi', 'Kavitha', 'Lakshmi', 'Meena', 'Priya', 'Valli', 'Deepa', 'Revathi'],
    M: ['Murugan', 'Ravi', 'Senthil', 'Karthik', 'Arumugam', 'Suresh', 'Ganesh', 'Anbu'],
    last: { F: ['Raman', 'Pillai', 'Selvam', 'Murugesan', 'Rajan', 'Natarajan'], M: ['Raman', 'Pillai', 'Kumar', 'Selvam', 'Rajan', 'Natarajan', 'Subramani'] },
  },
  hi: {
    F: ['Sunita', 'Pooja', 'Rekha', 'Anita', 'Geeta', 'Kiran'],
    M: ['Ramesh', 'Rajesh', 'Amit', 'Manoj', 'Vikas', 'Sanjay'],
    last: { F: ['Devi', 'Yadav', 'Singh', 'Sharma', 'Gupta', 'Kumari'], M: ['Kumar', 'Yadav', 'Singh', 'Prasad', 'Sharma', 'Gupta', 'Mahto'] },
  },
};

function seedVisitHistory() {
  const rand = mulberry32(424242);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const IST_MS = 330 * 60000;

  // Pre-parse each template once; stock warnings are dropped because the
  // stock level on each historical day isn't modelled.
  const templates = VISIT_TEMPLATES.map((t) => {
    const medications = parseMedicationLines(t.meds);
    const warnings = runClinicalChecks({ medications, patientAllergies: [], currentMedications: [], facilityId: 'phc-1' })
      .filter((w) => w.type !== 'stock');
    return { ...t, medications, warnings };
  });

  // Synthetic patients: about 350, mostly Tamil- and Hindi-speaking.
  const patients = [];
  for (let i = 0; i < 350; i++) {
    const r = rand();
    const language = r < 0.55 ? 'ta' : r < 0.9 ? 'hi' : 'en';
    const gender = rand() < 0.52 ? 'F' : 'M';
    const pool = NAMES[language === 'hi' ? 'hi' : 'ta']; // English-preferring patients get Tamil names (Tamil Nadu PHC)
    const [first, last] = [pick(pool[gender]), pick(pool.last[gender])];
    const ageRoll = rand();
    const age = ageRoll < 0.12 ? 1 + Math.floor(rand() * 12) : ageRoll < 0.6 ? 18 + Math.floor(rand() * 27) : 45 + Math.floor(rand() * 35);
    const chronic = [];
    if (age >= 35 && rand() < 0.35) chronic.push('Hypertension');
    if (age >= 35 && rand() < 0.28) chronic.push('Type 2 Diabetes');
    const f = rand();
    patients.push({
      id: `syn-${String(i + 1).padStart(3, '0')}`,
      name: `${first} ${last}`,
      age,
      gender,
      phone: String(9700000000 + i + 1),
      language,
      message_format: f < 0.5 ? 'text' : f < 0.8 ? 'voice' : 'both',
      allergies: rand() < 0.04 ? ['Penicillin'] : [],
      chronic,
      firstSeen: null,
    });
  }
  const chronicPool = (condition) => patients.filter((p) => p.chronic.includes(condition));

  const visits = [];
  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    const dayStartUtc = new Date(now - daysAgo * 86400000);
    const istDate = new Date(dayStartUtc.getTime() + IST_MS);
    let count = 22 + Math.floor(rand() * 12);
    if (istDate.getUTCDay() === 0) count = Math.round(count * 0.35); // Sunday: emergency OPD only
    const inSurge = daysAgo < 7;
    for (let v = 0; v < count; v++) {
      // OPD hours 9:00–13:30 IST, spread through the morning.
      const minutes = 9 * 60 + Math.floor(rand() * 270);
      const istMidnight = Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate());
      const at = istMidnight + minutes * 60000 - IST_MS;
      if (at > now) continue; // today: only visits that would already have happened
      const weights = templates.map((t) => t.weight * (inSurge && t.surge ? 3 : 1));
      let roll = rand() * weights.reduce((a, b) => a + b, 0);
      const template = templates[weights.findIndex((w) => (roll -= w) < 0)];
      const pool = (template.chronic ? chronicPool(template.chronic) : patients).filter((p) => p.age >= (template.minAge || 0));
      const patient = pool.length ? pick(pool) : pick(patients);
      if (!patient.firstSeen || at < patient.firstSeen) patient.firstSeen = at;
      visits.push({ at, template, patient });
    }
  }

  const insertPatient = db.prepare(`
    INSERT INTO patients (id, name, age, gender, phone, language, message_format, whatsapp_consent, allergies, chronic_conditions, created_at, origin)
    VALUES (@id, @name, @age, @gender, @phone, @language, @message_format, 0, @allergies, @chronic_conditions, @created_at, 'synthetic')
  `);
  for (const p of patients) {
    insertPatient.run({
      id: p.id, name: p.name, age: p.age, gender: p.gender, phone: p.phone, language: p.language,
      message_format: p.message_format,
      allergies: JSON.stringify(p.allergies),
      chronic_conditions: JSON.stringify(p.chronic),
      // Registered on their first visit; patients never seen registered earlier.
      created_at: new Date(p.firstSeen ?? now - 120 * 86400000).toISOString(),
    });
  }

  const insertVisit = db.prepare(`
    INSERT INTO encounters (
      patient_id, facility_id, doctor_name, doctor_reg_no, chief_complaint, dictation_raw, dictation_lang,
      normalized_text, vitals, diagnosis, medications, warnings, override_reasons,
      advice_english, advice_patient_lang, status, created_at, approved_at, approved_by, origin
    ) VALUES (
      @patient_id, 'phc-1', 'Dr. Anitha Selvam', 'TN-MC-44210', @complaint, NULL, 'en',
      @normalized, '{}', @diagnosis, @medications, @warnings, @overrides,
      @advice_english, @advice_patient_lang, 'approved', @at, @at, 'Dr. Anitha Selvam', 'synthetic'
    )
  `);
  for (const { at, template, patient } of visits) {
    const lang = patient.language;
    // A patient's recorded penicillin allergy makes the amoxicillin template
    // raise the same major warning the live app would.
    const warnings = patient.allergies.length
      ? runClinicalChecks({ medications: template.medications, patientAllergies: patient.allergies, currentMedications: [], facilityId: 'phc-1' })
          .filter((w) => w.type !== 'stock')
      : template.warnings;
    const overrides = warnings
      .filter((w) => w.severity === 'major')
      .map((w) => ({ message: w.message, reason: w.type === 'allergy' ? 'Mild rash only in the past; patient counselled' : 'Short course, monitored' }));
    const iso = new Date(at).toISOString();
    insertVisit.run({
      patient_id: patient.id,
      complaint: template.complaint,
      normalized: `${template.complaint}. ${template.diagnosis}`,
      diagnosis: template.diagnosis,
      medications: JSON.stringify(template.medications),
      warnings: JSON.stringify(warnings),
      overrides: JSON.stringify(overrides),
      advice_english: `${DEFAULT_ADVICE_NOTE.en} ${WARNING_SIGNS_TEXT.en}\n\nDose schedule:\n${buildDoseScheduleBlock(template.medications, 'en')}`,
      advice_patient_lang: `${DEFAULT_ADVICE_NOTE[lang]} ${WARNING_SIGNS_TEXT[lang]}\n\n${buildDoseScheduleBlock(template.medications, lang)}`,
      at: iso,
    });
  }
  return { patients: patients.length, visits: visits.length };
}

// ---------------------------------------------------------------------------
// District level + demo staff accounts. Runs on every start and only fills in
// what's missing, so older demo databases gain login without a reset.
// All names, registration numbers, and PINs are made up for the demo.
// ---------------------------------------------------------------------------

export const DEMO_STAFF = [
  { id: 'usr-desk-phc1', name: 'Priya Natarajan', pin: '1111', assignments: [['desk', 'phc-1']] },
  { id: 'usr-mo-phc1', name: 'Dr. Anitha Selvam', regNo: 'TN-MC-44210', pin: '2222', assignments: [['phc_mo', 'phc-1']] },
  // Posted at the PHC, covers the CHC on some days: two assignments, one login.
  { id: 'usr-doc-phc1', name: 'Dr. Ravi Kumar', regNo: 'TN-MC-51877', pin: '3333', assignments: [['doctor', 'phc-1'], ['doctor', 'chc-1']] },
  { id: 'usr-pharm-phc1', name: 'Murugan Pillai', pin: '4444', assignments: [['pharmacist', 'phc-1']] },
  { id: 'usr-chc-incharge', name: 'Dr. Senthil Rajan', regNo: 'TN-MC-38102', pin: '5555', assignments: [['chc_incharge', 'chc-1']] },
  { id: 'usr-dho', name: 'Dr. Kavitha Subramani', regNo: 'TN-MC-29455', pin: '6666', assignments: [['dho', 'dist-1']] },
  { id: 'usr-admin', name: 'Sethu Admin', pin: '9999', assignments: [['admin', 'dist-1']] },
];

function ensureHierarchyAndStaff() {
  db.prepare("INSERT OR IGNORE INTO facilities (id, name, type, parent_id) VALUES ('dist-1', 'Erode District Health Office', 'district', NULL)").run();
  db.prepare("UPDATE facilities SET parent_id = 'dist-1' WHERE id = 'chc-1' AND parent_id IS NULL").run();
  // Every existing demo patient was registered at the PHC.
  db.prepare("UPDATE patients SET registered_facility_id = 'phc-1' WHERE registered_facility_id IS NULL").run();

  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const insertUser = db.prepare('INSERT INTO users (id, name, reg_no, pin_hash, pin_salt) VALUES (?, ?, ?, ?, ?)');
  const insertAssignment = db.prepare(
    "INSERT INTO assignments (user_id, role, facility_id, valid_from, granted_by) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', 'seed')"
  );
  db.transaction(() => {
    for (const s of DEMO_STAFF) {
      const { hash, salt } = hashPin(s.pin);
      insertUser.run(s.id, s.name, s.regNo || null, hash, salt);
      for (const [role, facility] of s.assignments) insertAssignment.run(s.id, role, facility);
    }
  })();
  console.log(`Seeded ${DEMO_STAFF.length} demo staff accounts (PINs in the README).`);
}

export function ensureSeeded() {
  if (isSeeded()) {
    loadNlem({ quiet: true }); // reference data, safe to refresh on every start
    ensureHierarchyAndStaff();
    return;
  }
  let history;
  const seedAll = db.transaction(() => {
    seedFacilities();
    seedMedicines();
    loadNlem({ quiet: true });
    seedPatients();
    seedInventoryAndUsage();
    history = seedVisitHistory();
  });
  seedAll();
  console.log(
    `Seeded demo data (facilities, NLEM 2022 medicine list, synthetic patients, inventory, 90-day usage history, ` +
    `${history.visits} synthetic visits for ${history.patients} synthetic patients).`
  );
  ensureHierarchyAndStaff();
}
