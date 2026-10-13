import { db } from '../db.js';
import { MEDICINE_NAMES } from './templates.js';

// Deterministic, rule-based normalization — no LLM in this step. The doctor's
// own words are what get recorded; this only expands shorthand and maps
// brand names to generics so the checks in rules.js can run reliably, and
// shows the doctor the expanded form before they approve.
//
// A prescription line is read along four dimensions — medicine, dose,
// frequency, duration — in English, Hindi, Tamil, romanized Hindi, or a mix,
// in any order. server/test/prescription-matrix.test.mjs crosses every form
// listed below against every other; keep it passing when adding forms.

// ---------------------------------------------------------------------------
// Reference data (cached briefly: it changes only when the seed changes)
// ---------------------------------------------------------------------------

// Common shorthand doctors write that isn't a brand.
const EXTRA_ALIASES = { pcm: 'paracetamol', amox: 'amoxicillin', azithro: 'azithromycin' };

let refCache = null;
function loadReferenceData() {
  if (refCache && Date.now() - refCache.at < 30000) return refCache.data;
  const medicines = db.prepare('SELECT * FROM medicines').all();
  const brandRows = db.prepare('SELECT * FROM brand_generic').all();
  const abbrevRows = db.prepare('SELECT * FROM abbreviations').all();

  const medicinesById = new Map(medicines.map((m) => [m.id, m]));
  const abbreviations = new Map(abbrevRows.map((r) => [r.abbrev.toLowerCase(), r.expansion]));

  // Generic name, id slug (so "ORS" matches), brand names, shorthand, and the
  // Hindi/Tamil spellings (speech-to-text in Hindi/Tamil mode writes names in
  // that script). parseMedicationLine prefers the longest match.
  const nameToMedicineId = new Map();
  for (const m of medicines) {
    nameToMedicineId.set(m.generic_name.toLowerCase(), m.id);
    nameToMedicineId.set(m.id.toLowerCase(), m.id);
    for (const local of Object.values(MEDICINE_NAMES[m.id] || {})) nameToMedicineId.set(local, m.id);
  }
  for (const r of brandRows) {
    nameToMedicineId.set(r.brand.toLowerCase(), r.medicine_id);
    // "Dolo 650" → also "Dolo", so "Dolo 500" or a misheard "Dolo 655" is still
    // recognised; the dose then comes from the number actually said.
    const word = r.brand.toLowerCase().replace(/\s*\d+$/, '');
    if (word !== r.brand.toLowerCase() && word.length >= 4 && !nameToMedicineId.has(word)) {
      nameToMedicineId.set(word, r.medicine_id);
    }
  }
  for (const [alias, id] of Object.entries(EXTRA_ALIASES)) if (medicinesById.has(id)) nameToMedicineId.set(alias, id);

  const data = { medicinesById, abbreviations, nameToMedicineId };
  refCache = { at: Date.now(), data };
  return data;
}

/** Expand abbreviations in free text for the doctor-facing "normalized" preview. */
export function expandAbbreviations(text) {
  if (!text) return text;
  const { abbreviations } = loadReferenceData();
  return text.replace(/\b[\w-]+\b/g, (token) => {
    const hit = abbreviations.get(token.toLowerCase());
    return hit ? `${token} (${hit})` : token;
  });
}

const escapeRegExp = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const isLatin = (s) => /^[\x20-\x7e]+$/.test(s);

// ---------------------------------------------------------------------------
// Working copy of the text: same words, tidied so the patterns stay simple.
// ---------------------------------------------------------------------------
const SPOKEN_DOSES = [
  [/\bsix\s+fifty\b|\bsix\s+hundred\s+(?:and\s+)?fifty\b/gi, '650'],
  [/\btwo\s+fifty\b|\btwo\s+hundred\s+(?:and\s+)?fifty\b/gi, '250'],
  [/\bfive\s+hundred\b/gi, '500'],
  [/\bfour\s+hundred\b/gi, '400'],
  [/पा[ंँ]च\s*सौ/g, '500'],
  [/ஐநூறு/g, '500'],
];

function normalizeForParsing(text) {
  let s = text
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966)) // Devanagari digits
    .replace(/[௦-௯]/g, (d) => String(d.charCodeAt(0) - 0xbe6)) // Tamil digits
    .replace(/[×✕]/g, ' x ')
    .replace(/½/g, ' half ')
    // 1+0+1, 1–0–1, 1 - 0 - 1 → 1-0-1
    .replace(/(?<!\d)([01])\s*[-+–—]\s*([01])\s*[-+–—]\s*([01])(?:\s*[-+–—]\s*([01]))?(?!\d)/g, (m, a, b, c, d) => [a, b, c, d].filter((x) => x != null).join('-'))
    // b.i.d. / t.d.s. / o.d. / h.s. → bid / tds / od / hs
    .replace(/\b([a-z])\.\s?([a-z])\.(?:\s?([a-z])\.)?(?:\s?([a-z])\.)?/gi, (m, a, b, c, d) => [a, b, c, d].filter(Boolean).join(''));
  for (const [re, digits] of SPOKEN_DOSES) s = s.replace(re, digits);
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------

// Written abbreviations → [display token, doses per day]. SOS/PRN are 0: "as
// needed" is excluded from dose ceilings and automatic stock deduction.
const ABBREVIATION_FREQUENCIES = {
  od: ['OD', 1], qd: ['OD', 1], bd: ['BD', 2], bid: ['BD', 2], tds: ['TDS', 3], tid: ['TDS', 3],
  qid: ['QID', 4], qds: ['QID', 4], hs: ['HS', 1], stat: ['STAT', 1], sos: ['SOS', 0], prn: ['SOS', 0],
  q24h: ['OD', 1], q12h: ['BD', 2], q8h: ['TDS', 3], q6h: ['QID', 4],
};
const NUMERIC_FREQUENCIES = {
  '1-1-1-1': 4, '1-0-1': 2, '1-1-1': 3, '1-0-0': 1, '0-0-1': 1, '1-1-0': 2, '0-1-0': 1, '0-1-1': 2,
};
const ABBREVIATION_RE = new RegExp(`(?<![A-Za-z0-9])(${Object.keys(ABBREVIATION_FREQUENCIES).join('|')})(?![A-Za-z0-9])`, 'i');
const NUMERIC_RE = new RegExp(`(?<![\\d-])(${Object.keys(NUMERIC_FREQUENCIES).sort((a, b) => b.length - a.length).join('|')})(?![\\d-])`);

// Spoken schedules, checked top to bottom: multi-dose phrases before single
// slots, since "morning, afternoon and night" also contains "night".
// Hand-written for the demo; the Hindi/Tamil need a native-speaker check.
const alt = (parts) => parts.join('|');
const TIMES = String.raw`\s*(?:times?|x)\s*(?:a\s+day|per\s+day|in\s+a\s+day|daily|a\s+daily)?`;
const SPOKEN_FREQUENCIES = [
  ['TDS', 3, alt([
    String.raw`\b(?:morning|breakfast)\b.{0,25}\b(?:afternoon|noon|lunch)\b.{0,25}\b(?:night|evening|dinner|supper)\b`,
    String.raw`\b(?:three|3)${TIMES}\b`, String.raw`\bthrice\b`,
    String.raw`\bevery\s+8\s*(?:hours?|hrs?|h)\b`, String.raw`\b8\s*(?:hourly|hrly)\b`,
    'सुबह.{0,15}दोपहर.{0,15}(?:शाम|रात)', String.raw`(?:दिन\s*में\s*)?(?:तीन|3)\s*(?:बार|टाइम)`,
    String.raw`\bsubah\b.{0,15}\bdopahar\b.{0,15}\b(?:shaam|sham|raat|rat)\b`, String.raw`\b(?:din\s+(?:mein|me)\s+)?(?:teen|3)\s+(?:baar|bar)\b`,
    'காலை.{0,20}மதியம்.{0,20}(?:இரவு|மாலை)', String.raw`(?:மூன்று|3)\s*(?:முறை|வேளை)`,
  ])],
  ['QID', 4, alt([
    String.raw`\b(?:four|4)${TIMES}\b`, String.raw`\bevery\s+6\s*(?:hours?|hrs?|h)\b`, String.raw`\b6\s*(?:hourly|hrly)\b`,
    String.raw`(?:दिन\s*में\s*)?(?:चार|4)\s*(?:बार|टाइम)`, String.raw`\b(?:din\s+(?:mein|me)\s+)?(?:char|chaar|4)\s+(?:baar|bar)\b`,
    String.raw`(?:நான்கு|4)\s*(?:முறை|வேளை)`,
  ])],
  ['BD', 2, alt([
    String.raw`\bmorning\b.{0,15}\b(?:night|evening)\b`, String.raw`\b(?:night|evening)\b.{0,15}\bmorning\b`,
    String.raw`\btwice\b`, String.raw`\b(?:two|2)${TIMES}\b`,
    String.raw`\bevery\s+12\s*(?:hours?|hrs?|h)\b`, String.raw`\b12\s*(?:hourly|hrly)\b`,
    String.raw`\b(?:breakfast|lunch|morning)\b.{0,20}\b(?:dinner|supper|night)\b`,
    'सुबह.{0,10}(?:शाम|रात)', '(?:रात|शाम).{0,10}सुबह', String.raw`(?:दिन\s*में\s*)?(?:दो|2)\s*(?:बार|टाइम)`,
    String.raw`\bsubah\b.{0,10}\b(?:shaam|sham|raat|rat)\b`, String.raw`\b(?:din\s+(?:mein|me)\s+)?(?:do|2)\s+(?:baar|bar)\b`,
    'காலை.{0,20}(?:இரவு|மாலை)', '(?:இரவு|மாலை).{0,20}காலை', String.raw`(?:இரண்டு|2)\s*(?:முறை|வேளை)`,
  ])],
  ['HS', 1, alt([
    String.raw`\b(?:at|every|only\s+at|in\s+the)\s+night\b`, String.raw`\bnight\s+only\b`, String.raw`\bnightly\b`,
    String.raw`\b(?:at\s+)?bed\s?time\b`, String.raw`\bbefore\s+(?:sleep|sleeping|bed)\b`, String.raw`\bnight\b`,
    String.raw`रात\s*(?:को|में)`, 'सोते\\s*समय', 'सोने\\s*से\\s*पहले',
    String.raw`\b(?:raat|rat)\s+(?:ko|mein|me)\b`, String.raw`\bsote\s+samay\b`, String.raw`\bsone\s+se\s+pehle\b`,
    'இரவில்', 'இரவு\\s*மட்டும்', 'தூங்கும்\\s*முன்', 'இரவு',
  ])],
  ['EVENING', 1, alt([
    String.raw`\bevening\b`, 'शाम\\s*(?:को|में)?', String.raw`\b(?:shaam|sham)\s*(?:ko)?\b`, 'மாலை(?:யில்)?',
  ])],
  ['0-1-0', 1, alt([
    String.raw`\bafternoon\b`, String.raw`\b(?:after|with|at)\s+(?:lunch|noon)\b`, 'दोपहर', String.raw`\bdopahar\b`, 'மதியம்',
  ])],
  ['1-0-0', 1, alt([
    String.raw`\b(?:every|in\s+the|only\s+in\s+the)\s+morning\b`, String.raw`\bmorning\s+only\b`, String.raw`\bmorning\b`,
    String.raw`\b(?:after|with|before)\s+breakfast\b`, 'सुबह', String.raw`\bsubah\b`, 'காலை(?:யில்)?',
  ])],
  ['OD', 1, alt([
    String.raw`\bonce\b`, String.raw`\bdaily\b`, String.raw`\bevery\s*day\b`, String.raw`\bevery\s+24\s*(?:hours?|hrs?|h)\b`,
    String.raw`(?:दिन\s*में\s*)?(?:एक|1)\s*(?:बार|टाइम)`, 'रोज़?(?:ाना)?', 'प्रतिदिन', 'हर\\s*दिन',
    String.raw`\b(?:din\s+(?:mein|me)\s+)?(?:ek|1)\s+(?:baar|bar)\b`, String.raw`\broz(?:ana)?\b`,
    String.raw`(?:ஒரு|1)\s*(?:முறை|வேளை)`, 'தினமும்', 'தினசரி',
  ])],
  ['SOS', 0, alt([
    String.raw`\b(?:as|when|if)\s+(?:needed|required|necessary)\b`, String.raw`\b(?:if|when)\s+(?:there\s+is\s+)?(?:fever|pain)\b`,
    String.raw`\bonly\s+(?:if|when)\b`,
    'ज़?रूरत\\s*(?:पड़ने\\s*पर|हो\\s*तो)', 'आवश्यकता\\s*होने\\s*पर', '(?:बुखार|बुख़ार|दर्द)\\s*होने\\s*पर',
    String.raw`\b(?:zarurat|jarurat|zaroorat|jaroorat)\s+(?:padne\s+par|ho\s+to)\b`,
    'தேவைப்பட்டால்', 'தேவைப்படும்போது', '(?:காய்ச்சல்|வலி)\\s*இருந்தால்',
  ])],
].map(([token, timesPerDay, src]) => ({ token, timesPerDay, re: new RegExp(src, 'i'), reGlobal: new RegExp(src, 'gi') }));

function extractFrequency(line) {
  const numeric = line.match(NUMERIC_RE);
  if (numeric) return { token: numeric[1], timesPerDay: NUMERIC_FREQUENCIES[numeric[1]] };
  const abbr = line.match(ABBREVIATION_RE);
  if (abbr) {
    const [token, timesPerDay] = ABBREVIATION_FREQUENCIES[abbr[1].toLowerCase()];
    return { token, timesPerDay };
  }
  for (const f of SPOKEN_FREQUENCIES) if (f.re.test(line)) return { token: f.token, timesPerDay: f.timesPerDay };
  return null;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------
// "दिन में" / "din mein" (in a day) and Tamil "நாளைக்கு" (per day) are part of
// a schedule ("500 दिन में दो बार"), not a duration, so they're excluded.
const DURATION_UNIT_SRC =
  '(?:days?|d|weeks?|wks?|months?|din(?!\\s+(?:mein|me)\\b)|dino|dinon|hafta|hafte|haftey|mahina|mahine)(?![A-Za-z])' +
  '|(?:दिन(?!\\s*में)|दिवस|हफ|सप्ताह|महीन|நாள(?!ைக்கு)|நாட்கள|வார(?=ம்|ங்கள்|த்)|மாத(?=ம்|ங்கள்|த்த))[^\\s,.;।]*';

// Durations are often spoken as words: "for three days", "तीन दिन", "மூன்று நாள்",
// "teen din". Only real number words count — never "a", so "twice a day" isn't
// read as 1 day.
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, saat: 7, das: 10, pandrah: 15, bees: 20, tees: 30,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'पंद्रह': 15, 'बीस': 20, 'तीस': 30,
  'ஒரு': 1, 'ஒன்று': 1, 'இரண்டு': 2, 'மூன்று': 3, 'நான்கு': 4, 'ஐந்து': 5, 'ஆறு': 6, 'ஏழு': 7, 'எட்டு': 8,
  'ஒன்பது': 9, 'பத்து': 10, 'பதினைந்து': 15,
};
const LATIN_NUMBER_WORDS = Object.keys(NUMBER_WORDS).filter((w) => /^[a-z]+$/.test(w));
const INDIC_NUMBER_WORDS = Object.keys(NUMBER_WORDS).filter((w) => !/^[a-z]+$/.test(w)).sort((a, b) => b.length - a.length);
// JS \b only understands ASCII letters, so Indic number words must follow a space or the line start.
const NUMBER_SRC = `\\d+|\\b(?:${LATIN_NUMBER_WORDS.join('|')})\\b|(?<=^|[\\s,(])(?:${INDIC_NUMBER_WORDS.join('|')})`;

const DURATION_SRC = `(${NUMBER_SRC})\\s*(${DURATION_UNIT_SRC})(?:\\s+(?:तक|को|के\\s+लिए|வரை|tak|ke\\s+liye))?`;
const DURATION_RE = new RegExp(DURATION_SRC, 'i');
// Clinical shorthand: 3/7 = 3 days, 1/52 = 1 week, 1/12 = 1 month.
const SLASH_DURATION_RE = /(?<![\d/])(\d{1,2})\s*\/\s*(7|52|12)(?![\d/])/;
const A_PERIOD_RE = /\b(?:for\s+)?(?:a|one)\s+(week|month)\b/i;
const WEEK_UNIT_RE = /^(?:w|hafta|hafte|haftey|हफ|सप्ताह|வார)/i;
const MONTH_UNIT_RE = /^(?:month|mahin|महीन|மாத)/i; // Tamil only reaches here as மாதம்/மாதங்கள்/மாதத்…

const toNumber = (token) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()] ?? null);

/** Every duration phrase in the text, in order: [{ index, end, days }]. */
function findDurations(text) {
  const found = [];
  for (const m of text.matchAll(new RegExp(DURATION_SRC, 'gi'))) {
    const n = toNumber(m[1]);
    if (n == null) continue;
    const days = WEEK_UNIT_RE.test(m[2]) ? n * 7 : MONTH_UNIT_RE.test(m[2]) ? n * 30 : n;
    found.push({ index: m.index, end: m.index + m[0].length, days });
  }
  for (const m of text.matchAll(new RegExp(SLASH_DURATION_RE.source, 'g'))) {
    const n = Number(m[1]);
    found.push({ index: m.index, end: m.index + m[0].length, days: m[2] === '7' ? n : m[2] === '52' ? n * 7 : n * 30 });
  }
  for (const m of text.matchAll(new RegExp(A_PERIOD_RE.source, 'gi'))) {
    if (found.some((f) => m.index < f.end && m.index + m[0].length > f.index)) continue;
    found.push({ index: m.index, end: m.index + m[0].length, days: /week/i.test(m[1]) ? 7 : 30 });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** A digit left over once schedule numbers ("q8h", "1-0-1", "2 times") are removed. */
function hasNonScheduleNumber(text) {
  const rest = text
    .replace(new RegExp(NUMERIC_RE.source, 'g'), ' ')
    .replace(new RegExp(ABBREVIATION_RE.source, 'gi'), ' ')
    .replace(SCHEDULE_NUMBER_RE, ' ');
  return /\d/.test(rest);
}

function extractDuration(line) {
  return findDurations(line)[0]?.days ?? null;
}

// ---------------------------------------------------------------------------
// Dose
// ---------------------------------------------------------------------------
const MG_RE = /(\d+(?:\.\d+)?)\s*(?:mg|milli\s?grams?|मिलीग्राम|मि\.ग्रा|மில்லிகிராம்|மி\.கி)(?![A-Za-z])/i;
const GRAM_RE = /(\d+(?:\.\d+)?)\s*(?:g|gm|grams?)(?![A-Za-z])/i;
const COUNT_WORDS = {
  half: 0.5, '1/2': 0.5, one: 1, two: 2, three: 3, ek: 1, do: 2, aadhi: 0.5, aadha: 0.5,
  'एक': 1, 'दो': 2, 'आधी': 0.5, 'आधा': 0.5, 'ஒரு': 1, 'இரண்டு': 2, 'அரை': 0.5,
};
const TABLET_COUNT_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?|1\\/2|${Object.keys(COUNT_WORDS).filter((w) => w !== '1/2').join('|')})\\s*` +
  '(?:tablets?|tabs?|capsules?|caps?|pills?|goli|गोली|गोलियां|गोलियाँ|टैबलेट|மாத்திரை[^\\s,.]*|கேப்ஸ்யூல்[^\\s,.]*)',
  'i'
);
// Numbers that belong to a schedule, not a dose ("3 times", "every 6 hours", "2 बार").
const SCHEDULE_NUMBER_RE = new RegExp(alt([
  String.raw`\b\d+${TIMES}`, String.raw`\bevery\s+\d+\s*(?:hours?|hrs?|h)\b`, String.raw`\b\d+\s*(?:hourly|hrly)\b`,
  String.raw`\bq\d+h\b`, String.raw`\d+\s*(?:बार|टाइम|baar|bar|முறை|வேளை)`,
]), 'gi');

/**
 * Returns { doseMg, doseSource }. doseSource is 'stated' when the doctor said
 * a dose, 'unit-default' when we fell back to one unit of the stocked strength
 * (flagged to the doctor in rules.js), or null when there's nothing to go on.
 */
function extractDose(line, medicine, matchedName) {
  const mg = line.match(MG_RE);
  if (mg) return { doseMg: Number(mg[1]), doseSource: 'stated' };
  const grams = line.match(GRAM_RE);
  if (grams) return { doseMg: Number(grams[1]) * 1000, doseSource: 'stated' };

  // A brand with its strength in the name ("Dolo 650") sets the tablet
  // strength; otherwise it's the stocked unit ("500 mg tablet").
  const brandStrength = Number(matchedName?.match(/\s(\d+(?:\.\d+)?)$/)?.[1]) || null;
  const unitStrength = brandStrength || Number(medicine?.unit_label?.match(/(\d+(?:\.\d+)?)\s*mg/i)?.[1]) || null;
  if (!unitStrength) return { doseMg: null, doseSource: null };

  // "2 tablets", "half tablet", "एक गोली" → a count of the stocked strength.
  const count = line.match(TABLET_COUNT_RE);
  if (count) {
    const n = /^[\d.]+$/.test(count[1]) ? Number(count[1]) : COUNT_WORDS[count[1].toLowerCase()];
    if (n) return { doseMg: n * unitStrength, doseSource: 'stated' };
  }

  // A bare number only counts as a dose once durations and schedule numbers
  // are removed, and only if it's plausible for this medicine — otherwise
  // "Paracetamol TDS 10 days" would read as 10 mg, or "every 6 hours" as 6 mg.
  const ceiling = medicine.max_daily_dose_mg ?? unitStrength * 4;
  let stripped = line.replace(SCHEDULE_NUMBER_RE, ' ').replace(new RegExp(NUMERIC_RE.source, 'g'), ' ');
  for (const d of findDurations(stripped).reverse()) stripped = stripped.slice(0, d.index) + ' ' + stripped.slice(d.end);
  for (const match of stripped.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])/g)) {
    const n = Number(match[1]);
    if (n >= unitStrength / 4 && n <= ceiling) return { doseMg: n, doseSource: 'stated' };
  }
  return { doseMg: unitStrength, doseSource: 'unit-default' };
}

// ---------------------------------------------------------------------------
// Medicine names
// ---------------------------------------------------------------------------

/** Damerau–Levenshtein distance (optimal string alignment variant), on code points. */
function editDistance(aStr, bStr) {
  const a = [...aStr];
  const b = [...bStr];
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const nameRegexCache = new Map();
/** Whole-word matcher for a name. JS \b only knows ASCII, so Indic names use Unicode letter lookarounds. */
function nameRegex(name) {
  if (!nameRegexCache.has(name)) {
    const e = escapeRegExp(name);
    nameRegexCache.set(
      name,
      isLatin(name) ? new RegExp(`\\b${e}\\b`, 'gi') : new RegExp(`(?<![\\p{L}\\p{M}])${e}(?![\\p{L}\\p{M}])`, 'gu')
    );
  }
  return nameRegexCache.get(name);
}

/**
 * Speech-to-text often misspells drug names ("Citrizine" for Cetirizine,
 * "पेरासिटामोल"). Match a word to a listed name in the same script if it's
 * within 1 edit (names of 5–6 letters) or 2 edits (7+) and no other medicine is
 * as close. Short names (Mox, Azee, ORS) are never fuzzy-matched — too easy to
 * misfire. Every fuzzy match is shown to the doctor to confirm (rules.js).
 */
function fuzzyMedicineMatch(word, nameToMedicineId) {
  const w = word.toLowerCase();
  const wLatin = isLatin(w);
  const wLen = [...w].length;
  let best = null;
  let tie = false;
  for (const [name, id] of nameToMedicineId) {
    if (isLatin(name) !== wLatin || /[\s\d]/.test(name)) continue;
    const len = [...name].length;
    if (len < 5) continue;
    const limit = len >= 7 ? 2 : 1;
    if (Math.abs(len - wLen) > limit) continue;
    const dist = editDistance(w, name);
    if (dist === 0 || dist > limit) continue;
    if (!best || dist < best.dist) {
      best = { dist, name, id };
      tie = false;
    } else if (dist === best.dist && id !== best.id) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

/**
 * Every medicine mention in `text`: exact name/brand matches, then fuzzy
 * matches for remaining words (Latin or Indic). Longest wins; no overlaps.
 */
function findMedicineHits(text, nameToMedicineId) {
  const hits = [];
  for (const [name, id] of nameToMedicineId) {
    for (const m of text.matchAll(nameRegex(name))) {
      hits.push({ start: m.index, end: m.index + m[0].length, name, id, heardAs: null });
    }
  }
  for (const m of text.matchAll(/[A-Za-z]{5,}|[\u0900-\u097F\u0B80-\u0BFF]{4,}/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    const fuzzy = fuzzyMedicineMatch(m[0], nameToMedicineId);
    if (fuzzy) hits.push({ start, end, name: fuzzy.name, id: fuzzy.id, heardAs: m[0] });
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept = [];
  for (const h of hits) if (!kept.length || h.start >= kept[kept.length - 1].end) kept.push(h);
  return kept;
}

/** Start offsets of each medicine mention in `text` (exact or fuzzy). */
function medicineNameOffsets(text, nameToMedicineId) {
  return findMedicineHits(text, nameToMedicineId).map((h) => h.start);
}

// ---------------------------------------------------------------------------
// Splitting one spoken line into one piece per medicine
// ---------------------------------------------------------------------------

// "and"/"then" left at either end of a split-off piece ("और Cetirizine …").
const CONJUNCTIONS = '(?:और|फिर|तथा|साथ\\s*में|and|then|also|plus|along\\s+with|aur|phir|மற்றும்|பிறகு)';
const LEADING_CONJUNCTION_RE = new RegExp(`^[,;\\s]*${CONJUNCTIONS}\\s+`, 'i');
const TRAILING_CONJUNCTION_RE = new RegExp(`[\\s,;]+${CONJUNCTIONS}$`, 'i');

/**
 * Dictation has no line breaks, so one spoken line can hold several medicines:
 * "Dolo 650 TDS 5 दिन तक और Paracetamol 500 TDS 2 दिन तक". Split it after each
 * duration and before each further medicine name. A leftover piece with no
 * medicine name and no number ("after food", "तक") stays with the medicine
 * before it; one that has a number but no name is kept separate, so it gets
 * flagged as unrecognised instead of being merged into the wrong medicine.
 */
function splitSpokenLine(line, nameToMedicineId) {
  const durations = findDurations(line);
  const nameStarts = medicineNameOffsets(line, nameToMedicineId);
  // Which order is the doctor using on this line? "Paracetamol … 3 days" (the
  // usual) → cut after each duration. "3 days Paracetamol …, 5 days Cetirizine …"
  // → cut before each duration instead. Only treat a line as duration-first if
  // it OPENS with the duration (nothing but words like "आप" before it): a line
  // like "650 TDS 5 दिन … Paracetamol …" is a medicine whose name got cut off,
  // and must not lend its duration to the next medicine.
  const durationFirst =
    durations.length > 0 &&
    nameStarts.length > 0 &&
    durations[0].index < nameStarts[0] &&
    !/\d/.test(line.slice(0, durations[0].index));
  const durationCuts = durationFirst
    ? durations.slice(1).map((d) => d.index) // words before the first duration ("आप") are just a lead-in
    : durations.map((d) => d.end);
  const cuts = new Set(durationCuts);
  // Cut before a later medicine name only if no duration already separates it
  // from the previous one — otherwise words between them ("और आपको लेना पड़ेगा 1")
  // would become a junk entry of their own.
  for (let i = 1; i < nameStarts.length; i++) {
    if (!durationCuts.some((c) => c > nameStarts[i - 1] && c <= nameStarts[i])) cuts.add(nameStarts[i]);
  }

  const points = [0, ...[...cuts].filter((c) => c > 0 && c < line.length).sort((a, b) => a - b), line.length];
  const merged = [];
  for (let i = 0; i < points.length - 1; i++) {
    const piece = line.slice(points[i], points[i + 1]);
    // "q8h", "1-0-1", "2 times a day" after the duration belong to the medicine
    // before; a piece stands alone only with a name, a duration, or a number
    // that isn't part of a schedule (a medicine whose name got cut off).
    const standalone = medicineNameOffsets(piece, nameToMedicineId).length > 0
      || findDurations(piece).length > 0
      || hasNonScheduleNumber(piece);
    if (merged.length && !standalone) merged[merged.length - 1] += piece;
    else merged.push(piece);
  }
  // Speech often puts the duration first: "2 दिन तक Dolo 650 लीजिए सुबह शाम".
  // A piece with no medicine name joins the next medicine if that medicine
  // has no duration of its own. (If it does, the nameless piece stays separate
  // and gets flagged, e.g. a medicine whose name was cut off by the mic.)
  const pieces = [];
  for (let i = 0; i < merged.length; i++) {
    const piece = merged[i];
    const next = merged[i + 1];
    const nameless = medicineNameOffsets(piece, nameToMedicineId).length === 0;
    if (nameless && next && medicineNameOffsets(next, nameToMedicineId).length > 0 && !findDurations(next).length) {
      merged[i + 1] = `${piece} ${next}`;
      continue;
    }
    pieces.push(piece);
  }
  // "Paracetamol 500 for 3 days twice a day and Cetirizine 10 for 5 days at
  // night": cutting after "3 days" leaves "twice a day" in front of Cetirizine.
  // A schedule sitting before the next medicine's name belongs to the previous
  // medicine when that one has no schedule and the next already has its own.
  for (let i = 1; i < pieces.length; i++) {
    const firstName = medicineNameOffsets(pieces[i], nameToMedicineId)[0];
    if (!firstName) continue;
    const lead = pieces[i].slice(0, firstName);
    const rest = pieces[i].slice(firstName);
    if (extractFrequency(lead) && !extractFrequency(pieces[i - 1]) && extractFrequency(rest)) {
      pieces[i - 1] = `${pieces[i - 1]} ${lead}`;
      pieces[i] = rest;
    }
  }
  return pieces
    .map((s) => s.replace(/\s+/g, ' ').trim().replace(LEADING_CONJUNCTION_RE, '').replace(TRAILING_CONJUNCTION_RE, ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse one dictated/typed medication line (e.g. "Dolo 650 1-0-1 3 days",
 * "amoxicillin 500 TDS", "ORS SOS") into a structured entry. Unrecognised
 * medicine names are kept as-is with unmatched: true so the doctor sees them
 * flagged rather than silently dropped.
 */
export function parseMedicationLine(rawLine) {
  const raw = rawLine.trim();
  if (!raw) return null;
  const line = normalizeForParsing(raw);
  const { medicinesById, nameToMedicineId } = loadReferenceData();

  // Prefer an exact match, then the longest name (e.g. "amoxicillin" over a shorter false match).
  const hits = findMedicineHits(line, nameToMedicineId);
  const hit = hits.find((h) => !h.heardAs && hits.every((o) => o.heardAs || o.name.length <= h.name.length))
    || hits[0]
    || null;
  const matchedId = hit?.id || null;
  const matchedName = hit?.name || null;

  const medicine = matchedId ? medicinesById.get(matchedId) : null;
  const frequency = extractFrequency(line);
  const durationDays = extractDuration(line);
  const { doseMg, doseSource } = medicine ? extractDose(line, medicine, matchedName) : { doseMg: null, doseSource: null };

  return {
    raw,
    matchedText: matchedName || null,
    heardAs: hit?.heardAs || null, // set when the name was a near-miss spelling
    generic: matchedId,
    genericName: medicine?.generic_name || null,
    unitLabel: medicine?.unit_label || null,
    doseMg,
    doseSource,
    frequencyToken: frequency?.token || null,
    timesPerDay: frequency ? frequency.timesPerDay : null,
    durationDays,
    unmatched: !matchedId,
  };
}

/**
 * Parse a block of medication text into structured entries: one per line when
 * typed, and split per medicine when a dictated line holds several.
 */
export function parseMedicationLines(text) {
  if (!text) return [];
  const { nameToMedicineId } = loadReferenceData();
  return text
    .split(/\r?\n/)
    .map((l) => normalizeForParsing(l))
    .filter(Boolean)
    .flatMap((l) => splitSpokenLine(l, nameToMedicineId))
    .map(parseMedicationLine);
}

export function getMedicineById(id) {
  const { medicinesById } = loadReferenceData();
  return medicinesById.get(id) || null;
}
