// Prescription-parsing matrix: crosses every way of saying medicine, dose,
// frequency, and duration (English, Hindi, Tamil, romanized Hindi, and
// abbreviations) in every common word order, plus two-medicine lines, and
// checks each against the known answer. Run: npm test (from server/).
//
// Adding a new phrasing? Add it to the lists below first, watch it fail, then
// teach clinical/normalize.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Fresh throwaway database (the parser reads the medicine/brand list from it).
const dbPath = path.join(os.tmpdir(), `sethu-matrix-${process.pid}.db`);
process.env.SETHU_DB_PATH = dbPath;
const { ensureSeeded } = await import('../src/seed.js');
const originalLog = console.log;
console.log = () => {};
ensureSeeded();
console.log = originalLog;
const { parseMedicationLines } = await import('../src/clinical/normalize.js');

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

// strength = the stocked tablet (or brand) strength a "tablet" count refers to.
const MEDICINES = [
  { say: 'Paracetamol', generic: 'paracetamol', strength: 500, stated: 500 },
  { say: 'paracetamol', generic: 'paracetamol', strength: 500, stated: 500 },
  { say: 'Amoxicillin', generic: 'amoxicillin', strength: 500, stated: 500 },
  { say: 'Cetirizine', generic: 'cetirizine', strength: 10, stated: 10 },
  { say: 'Metformin', generic: 'metformin', strength: 500, stated: 500 },
  { say: 'Azithromycin', generic: 'azithromycin', strength: 500, stated: 500 },
  { say: 'Omeprazole', generic: 'omeprazole', strength: 20, stated: 20 },
  { say: 'Crocin', generic: 'paracetamol', strength: 500, stated: 500 },
  { say: 'PCM', generic: 'paracetamol', strength: 500, stated: 500 },
  { say: 'Citrizine', generic: 'cetirizine', strength: 10, stated: 10 }, // misheard spelling
  { say: 'पैरासिटामोल', generic: 'paracetamol', strength: 500, stated: 500 }, // Hindi script
  { say: 'பாராசிட்டமால்', generic: 'paracetamol', strength: 500, stated: 500 }, // Tamil script
  { say: 'पेरासिटामोल', generic: 'paracetamol', strength: 500, stated: 500 }, // Hindi, as speech-to-text may spell it
];
const DOLO = { say: 'Dolo 650', generic: 'paracetamol', strength: 650, stated: 650 }; // strength in the brand name

// Dose forms, as a function of the medicine. expected = mg.
const DOSES = [
  { form: (m) => `${m.stated}`, mg: (m) => m.stated },
  { form: (m) => `${m.stated} mg`, mg: (m) => m.stated },
  { form: (m) => `${m.stated}mg`, mg: (m) => m.stated },
  { form: (m) => `${m.stated} milligram`, mg: (m) => m.stated },
  { form: () => '1 tablet', mg: (m) => m.strength },
  { form: () => 'one tablet', mg: (m) => m.strength },
  { form: () => '2 tablets', mg: (m) => 2 * m.strength },
  { form: () => 'half tablet', mg: (m) => m.strength / 2 },
  { form: () => '1 टैबलेट', mg: (m) => m.strength },
  { form: () => 'एक गोली', mg: (m) => m.strength },
  { form: () => 'ஒரு மாத்திரை', mg: (m) => m.strength },
  { form: () => '', mg: (m) => m.strength }, // not stated → one unit, flagged to the doctor
];

// Frequency forms → doses per day (0 = as needed).
const FREQUENCIES = [
  // abbreviations
  ['OD', 1], ['od', 1], ['BD', 2], ['bd', 2], ['BID', 2], ['b.i.d.', 2], ['b.d.', 2], ['TDS', 3], ['TID', 3], ['t.i.d.', 3], ['t.d.s.', 3],
  ['QID', 4], ['QDS', 4], ['q.i.d.', 4], ['HS', 1], ['h.s.', 1], ['SOS', 0], ['PRN', 0], ['STAT', 1],
  ['q8h', 3], ['q12h', 2], ['q6h', 4],
  // number patterns
  ['1-0-1', 2], ['1-1-1', 3], ['1-0-0', 1], ['0-0-1', 1], ['1-1-0', 2], ['0-1-0', 1], ['0-1-1', 2], ['1-1-1-1', 4],
  ['1+0+1', 2], ['1 - 0 - 1', 2],
  // English
  ['once a day', 1], ['once daily', 1], ['daily', 1], ['every day', 1], ['every morning', 1], ['in the morning', 1],
  ['twice a day', 2], ['twice daily', 2], ['two times a day', 2], ['2 times a day', 2], ['2 times daily', 2], ['2x daily', 2],
  ['morning and night', 2], ['night and morning', 2], ['morning and evening', 2], ['after breakfast and dinner', 2],
  ['after lunch and after dinner', 2], ['every 12 hours', 2], ['12 hourly', 2],
  ['thrice a day', 3], ['three times a day', 3], ['3 times a day', 3], ['3 times daily', 3],
  ['morning afternoon and night', 3], ['after breakfast, lunch and dinner', 3], ['every 8 hours', 3], ['8 hourly', 3],
  ['four times a day', 4], ['4 times a day', 4], ['every 6 hours', 4], ['6 hourly', 4],
  ['at night', 1], ['at bedtime', 1], ['before sleep', 1], ['night only', 1], ['only at night', 1], ['in the evening', 1],
  ['in the afternoon', 1], ['after lunch', 1],
  ['as needed', 0], ['when required', 0], ['if fever', 0], ['if pain', 0],
  // Hindi
  ['दिन में एक बार', 1], ['रोज़ एक बार', 1], ['रोज़', 1], ['सुबह', 1], ['शाम को', 1], ['रात को', 1], ['सोते समय', 1],
  ['दिन में दो बार', 2], ['दो बार', 2], ['सुबह शाम', 2], ['सुबह और शाम', 2], ['सुबह और रात', 2],
  ['दिन में तीन बार', 3], ['तीन बार', 3], ['सुबह दोपहर शाम', 3], ['सुबह, दोपहर और रात', 3], ['दिन में चार बार', 4],
  ['ज़रूरत पड़ने पर', 0], ['जरूरत हो तो', 0], ['बुखार होने पर', 0],
  // romanized Hindi
  ['subah shaam', 2], ['din mein do baar', 2], ['do baar', 2], ['teen baar', 3], ['din mein teen baar', 3],
  ['subah dopahar shaam', 3], ['raat ko', 1], ['ek baar', 1], ['roz', 1], ['zarurat padne par', 0],
  // Tamil
  ['ஒரு வேளை', 1], ['தினமும்', 1], ['காலை', 1], ['இரவில்', 1], ['இரவு மட்டும்', 1], ['மாலையில்', 1],
  ['இரண்டு வேளை', 2], ['இரண்டு முறை', 2], ['காலை மற்றும் இரவு', 2], ['காலை இரவு', 2],
  ['மூன்று வேளை', 3], ['மூன்று முறை', 3], ['காலை மதியம் இரவு', 3], ['நான்கு முறை', 4],
  ['தேவைப்பட்டால்', 0], ['தேவைப்படும்போது', 0], ['காய்ச்சல் இருந்தால்', 0],
];

// Duration forms → days (null = not stated).
const DURATIONS = [
  ['3 days', 3], ['3 day', 3], ['3d', 3], ['for 3 days', 3], ['x 3 days', 3], ['× 3 days', 3], ['3/7', 3],
  ['for three days', 3], ['three days', 3], ['for five days', 5], ['10 days', 10],
  ['1 week', 7], ['a week', 7], ['for a week', 7], ['one week', 7], ['2 weeks', 14], ['two weeks', 14], ['1/52', 7],
  ['1 month', 30], ['a month', 30],
  ['3 दिन', 3], ['3 दिन तक', 3], ['तीन दिन', 3], ['तीन दिनों तक', 3], ['३ दिन', 3], ['एक हफ्ता', 7], ['दो हफ्ते', 14], ['एक महीना', 30],
  ['3 din', 3], ['teen din', 3], ['3 din tak', 3], ['ek hafta', 7],
  ['3 நாள்', 3], ['3 நாட்களுக்கு', 3], ['மூன்று நாட்கள்', 3], ['மூன்று நாட்களுக்கு', 3], ['ஒரு வாரம்', 7],
  ['', null],
];

// Word orders for one medicine.
const ORDERS = {
  'name dose freq dur': (n, d, f, u) => `${n} ${d} ${f} ${u}`,
  'name dose dur freq': (n, d, f, u) => `${n} ${d} ${u} ${f}`,
  'freq name dose dur': (n, d, f, u) => `${f} ${n} ${d} ${u}`,
  'dur name dose freq': (n, d, f, u) => `${u} ${n} ${d} ${f}`,
  'take … for': (n, d, f, u) => `take ${n} ${d} ${f} ${u}`,
  'Hindi verb': (n, d, f, u) => `${n} ${d} ${u} ${f} लीजिए`,
};

const clean = (s) => s.replace(/\s+/g, ' ').trim();

function check(line, expected) {
  const got = parseMedicationLines(line);
  const summary = got.map((m) => ({ generic: m.generic, mg: m.doseMg, perDay: m.timesPerDay, days: m.durationDays }));
  const ok = summary.length === expected.length && expected.every((e, i) => Object.entries(e).every(([k, v]) => summary[i][k] === v));
  return { ok, summary };
}

function runMatrix(name, cases) {
  const failures = [];
  for (const { line, expected, tag } of cases) {
    const { ok, summary } = check(line, expected);
    if (!ok) failures.push({ tag, line, expected, got: summary });
  }
  const byTag = {};
  for (const f of failures) byTag[f.tag] = (byTag[f.tag] || 0) + 1;
  if (failures.length) {
    console.log(`\n${name}: ${cases.length - failures.length}/${cases.length} passed. Failures by form:`, byTag);
    for (const f of failures.slice(0, 25)) {
      console.log(`  ✗ "${f.line}"\n      want ${JSON.stringify(f.expected)}\n      got  ${JSON.stringify(f.got)}`);
    }
  } else {
    console.log(`${name}: all ${cases.length} passed`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 1. Every frequency × every duration × every word order (one medicine each,
//    rotating through the medicines so every name form is exercised).
// ---------------------------------------------------------------------------
test('frequency × duration × word order', () => {
  const cases = [];
  let i = 0;
  for (const [freq, perDay] of FREQUENCIES) {
    for (const [dur, days] of DURATIONS) {
      for (const [orderName, order] of Object.entries(ORDERS)) {
        const med = MEDICINES[i++ % MEDICINES.length];
        cases.push({
          tag: `freq "${freq}"`,
          line: clean(order(med.say, `${med.stated}`, freq, dur)),
          expected: [{ generic: med.generic, mg: med.stated, perDay, days }],
        });
        void orderName;
      }
    }
  }
  assert.equal(runMatrix('frequency × duration × order', cases).length, 0);
});

// ---------------------------------------------------------------------------
// 2. Every medicine name × every dose form × every word order.
// ---------------------------------------------------------------------------
test('medicine × dose × word order', () => {
  const cases = [];
  for (const med of [...MEDICINES, DOLO]) {
    for (const dose of DOSES) {
      if (med === DOLO && dose.form(med) === `${med.stated}`) continue; // "Dolo 650 650" isn't a real phrasing
      for (const order of Object.values(ORDERS)) {
        const doseText = med === DOLO && /^\d/.test(dose.form(med)) && !/tablet/.test(dose.form(med)) ? '' : dose.form(med);
        cases.push({
          tag: `dose "${dose.form({ stated: 'N' })}" / ${med.say}`,
          line: clean(order(med.say, doseText, 'twice a day', 'for 5 days')),
          expected: [{ generic: med.generic, mg: dose.mg(med), perDay: 2, days: 5 }],
        });
      }
    }
  }
  assert.equal(runMatrix('medicine × dose × order', cases).length, 0);
});

// ---------------------------------------------------------------------------
// 2b. Every dose form × every frequency form, so numbers in schedules
//     ("3 times", "every 6 hours", "1-0-1") never leak into the dose.
//     Low-strength medicines (Cetirizine 10 mg) are where this bites.
// ---------------------------------------------------------------------------
test('dose × frequency (no number leaks between them)', () => {
  const cases = [];
  const meds = [MEDICINES[0], MEDICINES[3], MEDICINES[6], DOLO];
  for (const med of meds) {
    for (const dose of DOSES) {
      const doseText = med === DOLO && /^\d/.test(dose.form(med)) && !/tablet/.test(dose.form(med)) ? '' : dose.form(med);
      for (const [freq, perDay] of FREQUENCIES) {
        for (const order of [ORDERS['name dose freq dur'], ORDERS['freq name dose dur'], ORDERS['name dose dur freq']]) {
          cases.push({
            tag: `"${freq}" with dose "${dose.form({ stated: 'N' })}"`,
            line: clean(order(med.say, doseText, freq, 'for 5 days')),
            expected: [{ generic: med.generic, mg: dose.mg(med), perDay, days: 5 }],
          });
        }
      }
    }
  }
  assert.equal(runMatrix('dose × frequency', cases).length, 0);
});

// ---------------------------------------------------------------------------
// 3. Two medicines on one line: connectors × word orders × schedules.
// ---------------------------------------------------------------------------
test('two medicines on one line', () => {
  const PAIRS = [
    [MEDICINES[0], MEDICINES[3]], // Paracetamol + Cetirizine
    [MEDICINES[2], MEDICINES[6]], // Amoxicillin + Omeprazole
    [MEDICINES[10], MEDICINES[3]], // पैरासिटामोल + Cetirizine
    [DOLO, MEDICINES[4]], // Dolo 650 + Metformin
  ];
  const CONNECTORS = [' and ', ', ', ' और ', ' மற்றும் ', ' then ', ' also ', '. '];
  const SCHEDULES = [
    [['twice a day', 2, 'for 3 days', 3], ['at night', 1, 'for 5 days', 5]],
    [['BD', 2, '3 days', 3], ['HS', 1, '5 days', 5]],
    [['सुबह शाम', 2, '3 दिन तक', 3], ['रात को', 1, '5 दिन तक', 5]],
    [['1-0-1', 2, 'x 3 days', 3], ['0-0-1', 1, 'x 5 days', 5]],
    [['three times a day', 3, 'for a week', 7], ['once daily', 1, 'for two weeks', 14]],
  ];
  const PAIR_ORDERS = ['name dose freq dur', 'name dose dur freq', 'freq name dose dur', 'dur name dose freq'];
  const cases = [];
  for (const [a, b] of PAIRS) {
    for (const conn of CONNECTORS) {
      for (const [[fa, pa, da, ya], [fb, pb, db2, yb]] of SCHEDULES) {
        for (const orderName of PAIR_ORDERS) {
          const order = ORDERS[orderName];
          const doseA = a === DOLO ? '' : `${a.stated}`;
          const line = clean(`${order(a.say, doseA, fa, da)}${conn}${order(b.say, `${b.stated}`, fb, db2)}`);
          cases.push({
            tag: `${orderName} / "${conn.trim() || 'space'}"`,
            line,
            expected: [
              { generic: a.generic, mg: a.stated, perDay: pa, days: ya },
              { generic: b.generic, mg: b.stated, perDay: pb, days: yb },
            ],
          });
        }
      }
    }
  }
  assert.equal(runMatrix('two medicines per line', cases).length, 0);
});

// ---------------------------------------------------------------------------
// 4. Things that must NOT be misread.
// ---------------------------------------------------------------------------
test('traps: schedule words are never read as a dose or duration', () => {
  const cases = [
    ['Paracetamol 500 twice a day', [{ generic: 'paracetamol', mg: 500, perDay: 2, days: null }]],
    ['Paracetamol 500 once a day', [{ generic: 'paracetamol', mg: 500, perDay: 1, days: null }]],
    ['Paracetamol 500 दिन में दो बार 3 दिन', [{ generic: 'paracetamol', mg: 500, perDay: 2, days: 3 }]],
    ['Paracetamol 500 din mein do baar 3 din', [{ generic: 'paracetamol', mg: 500, perDay: 2, days: 3 }]],
    ['Paracetamol 500 ஒரு நாளைக்கு இரண்டு முறை 3 நாட்களுக்கு', [{ generic: 'paracetamol', mg: 500, perDay: 2, days: 3 }]],
    ['Cetirizine every 6 hours 3 days', [{ generic: 'cetirizine', mg: 10, perDay: 4, days: 3 }]],
    ['Cetirizine 3 times a day 5 days', [{ generic: 'cetirizine', mg: 10, perDay: 3, days: 5 }]],
    ['Cetirizine 8 hourly for 2 days', [{ generic: 'cetirizine', mg: 10, perDay: 3, days: 2 }]],
    ['Paracetamol TDS 10 days', [{ generic: 'paracetamol', mg: 500, perDay: 3, days: 10 }]],
    ['Metformin BD 30 days', [{ generic: 'metformin', mg: 500, perDay: 2, days: 30 }]],
    ['Dolo 650 1 tablet TDS 3 days', [{ generic: 'paracetamol', mg: 650, perDay: 3, days: 3 }]],
    ['Paracetamol 1 g TDS 3 days', [{ generic: 'paracetamol', mg: 1000, perDay: 3, days: 3 }]],
    ['Paracetamol five hundred twice a day for three days', [{ generic: 'paracetamol', mg: 500, perDay: 2, days: 3 }]],
    ['Dolo six fifty twice a day', [{ generic: 'paracetamol', mg: 650, perDay: 2, days: null }]],
    ['Paracetamol 500 SOS', [{ generic: 'paracetamol', mg: 500, perDay: 0, days: null }]],
    ['Take tablet after dinner at night 5 days', [{ generic: null, mg: null, perDay: 1, days: 5 }]],
  ];
  const failures = runMatrix('traps', cases.map(([line, expected]) => ({ line, expected, tag: line })));
  assert.equal(failures.length, 0);
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
});
