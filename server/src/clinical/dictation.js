import { parseMedicationLine, parseMedicationLines } from './normalize.js';
import { extractDictationFields, geminiConfigured } from '../lib/gemini.js';
import { stripPii } from '../lib/pii.js';

// Routes one continuous consultation dictation into the form's four fields.
// Deterministic — no LLM decides what counts as a diagnosis or a medicine.
//
// 1. Spoken section words at the start of a sentence switch the section:
//    "diagnosis …", "medicines …", "advice …" (or Hindi/Tamil equivalents).
// 2. A sentence that clearly reads as a prescription — a listed medicine AND
//    a frequency or duration — goes to Medicines even without a section word.
//    "Took Crocin at home" has neither, so it stays in the complaint and never
//    turns into a prescription.
// Everything lands in the editable form and goes through Draft, so the doctor
// reviews every word before Approve.

const SECTION_WORDS = [
  ['chiefComplaint', ['chief complaint', 'complaint', 'complaints', 'findings', 'history', 'शिकायत', 'लक्षण', 'புகார்', 'அறிகுறிகள்']],
  ['diagnosis', ['diagnosis', 'impression', 'provisional diagnosis', 'निदान', 'डायग्नोसिस', 'நோயறிதல்', 'டயக்னோசிஸ்']],
  ['medicationLines', ['medicines', 'medicine', 'medications', 'prescription', 'rx', 'treatment', 'दवाइयाँ', 'दवाइयां', 'दवाई', 'दवा', 'மருந்துகள்', 'மருந்து']],
  ['adviceNotes', ['advice', 'advise', 'instructions', 'सलाह', 'अडवाइस', 'எட்வைஸ்', 'அறிவுரை']],
];

// Longest first so "chief complaint" wins over "complaint", "दवाइयाँ" over "दवा".
const SECTION_PATTERNS = SECTION_WORDS
  .flatMap(([field, words]) => words.map((w) => [field, w]))
  .sort((a, b) => b[1].length - a[1].length)
  .map(([field, word]) => [
    field,
    // At the start of a sentence, optionally followed by punctuation or "is"/"है"
    // ("Medicines.", "Diagnosis:", "निदान है").
    new RegExp(`^${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\s*(?:[:\\-–—.,।]|is|hai|है|:-))?(?=\\s|$)\\s*`, 'i'),
  ]);

function splitSentences(text) {
  return text
    .split(/\n+|(?<=[.?!।|])\s+/)
    .map((s) => s.trim().replace(/^[,;]\s*/, ''))
    .filter(Boolean);
}

// A prescription line is short. A long sentence that merely mentions a
// medicine ("chest pain … take Dolo … eat light …") must not be swallowed
// whole into the Medicines box.
const MAX_PRESCRIPTION_WORDS = 14;

function looksLikePrescription(sentence) {
  if (sentence.split(/\s+/).length > MAX_PRESCRIPTION_WORDS) return false;
  const med = parseMedicationLine(sentence);
  return Boolean(med?.generic && (med.frequencyToken || med.durationDays));
}

// ---------------------------------------------------------------------------
// Natural dictation (no section words): Gemini sorts, the server verifies.
// ---------------------------------------------------------------------------

// Compare ignoring case, punctuation, and spacing — but nothing else.
function normalizeForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,;:!?।|"'“”‘’()[\]\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_KEYS = ['chiefComplaint', 'diagnosis', 'medicationLines', 'adviceNotes'];
// Each field is a list of verbatim pieces (a bare string is accepted as one piece).
const piecesOf = (value) =>
  (Array.isArray(value) ? value : [value]).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
const phrasesOf = (raw) => FIELD_KEYS.flatMap((k) => piecesOf(raw[k]));

function findChangedPhrases(raw, transcript) {
  const source = normalizeForCompare(transcript);
  return phrasesOf(raw).filter((p) => !source.includes(normalizeForCompare(p)));
}

/**
 * Accept Gemini's sorting only if every phrase it returned is copied verbatim
 * (same words, same order) from the transcript. Returns null on any mismatch.
 */
function verifyExtraction(raw, transcript) {
  if (!raw || typeof raw !== 'object') return null;
  if (!phrasesOf(raw).length || findChangedPhrases(raw, transcript).length) return null;
  // An advice piece that names a listed medicine ("give ORS after every loose
  // stool") is a prescription in effect — move it to Medicines so the allergy,
  // interaction, and stock checks see it. Complaint pieces are left alone:
  // "took Crocin at home" is history, not a prescription.
  const advice = [];
  const meds = piecesOf(raw.medicationLines);
  for (const piece of piecesOf(raw.adviceNotes)) {
    if (parseMedicationLine(piece)?.generic) meds.push(piece);
    else advice.push(piece);
  }
  // Separate pieces are joined with a separator we add, never with words.
  const joinPieces = (pieces) => pieces.map((p) => p.replace(/[,;]$/, '')).join('; ');
  return {
    chiefComplaint: joinPieces(piecesOf(raw.chiefComplaint)),
    diagnosis: joinPieces(piecesOf(raw.diagnosis)),
    medicationLines: meds.join('\n'),
    adviceNotes: joinPieces(advice),
  };
}

/**
 * Medicines or numbers from the transcript that ended up in no box — shown to
 * the doctor so nothing clinically relevant disappears silently.
 */
function findUnplaced(fields, transcript) {
  // Word-level coverage: mark transcript words covered by any placed piece,
  // then report the uncovered stretches that mention a medicine or a number.
  const words = transcript.split(/\s+/).filter(Boolean);
  const norm = words.map((w) => normalizeForCompare(w));
  const covered = new Array(words.length).fill(false);
  const pieces = Object.values(fields).flatMap((v) => String(v).split(/\n|;\s/));
  for (const piece of pieces) {
    const target = normalizeForCompare(piece).split(' ').filter(Boolean);
    if (!target.length) continue;
    for (let i = 0; i + target.length <= norm.length; i++) {
      if (target.every((t, k) => norm[i + k] === t)) {
        for (let k = 0; k < target.length; k++) covered[i + k] = true;
        break;
      }
    }
  }
  const stretches = [];
  let run = [];
  words.forEach((w, i) => {
    if (!covered[i]) run.push(w);
    else if (run.length) { stretches.push(run.join(' ')); run = []; }
  });
  if (run.length) stretches.push(run.join(' '));
  const relevant = stretches
    .map((s) => s.replace(/^[,;.\s]+|[,;.\s]+$/g, ''))
    .filter((s) => /\d/.test(s) || parseMedicationLines(s).some((m) => m.generic));
  return relevant.length ? relevant.join(' … ') : null;
}

/**
 * Route a whole-consultation dictation. Spoken section words win (rules);
 * otherwise Gemini sorts it and the server verifies every phrase; if Gemini
 * is unavailable or fails verification, fall back to the rules.
 */
export async function routeDictationSmart(text, patient = {}) {
  const byRules = routeDictation(text);
  if (byRules.usedSectionWords) return { ...byRules, method: 'section-words', unplaced: null };
  if (!geminiConfigured()) {
    return { ...byRules, method: 'rules', unplaced: null, note: 'Say "diagnosis…", "medicines…", "advice…" to fill each box (Gemini not configured).' };
  }

  const transcript = stripPii(text, patient);
  let { fields: raw, note } = await extractDictationFields(transcript);
  let fields = raw ? verifyExtraction(raw, transcript) : null;
  if (raw && !fields) {
    // One retry, telling the model which phrase it changed. Still verified.
    const changed = findChangedPhrases(raw, transcript).map((p) => `"${p}"`).join(', ');
    ({ fields: raw, note } = await extractDictationFields(transcript, { retryHint: changed || 'a phrase was not in the transcript' }));
    fields = raw ? verifyExtraction(raw, transcript) : null;
  }
  if (!fields) {
    return {
      ...byRules,
      method: 'rules',
      unplaced: null,
      note: raw
        ? "Automatic sorting was rejected because it didn't match your exact words — sorted by simple rules instead; check each box."
        : `Couldn't sort automatically (${note || 'no reply'}) — sorted by simple rules instead; check each box.`,
    };
  }
  return { fields, usedSectionWords: false, method: 'gemini-verified', unplaced: findUnplaced(fields, transcript) };
}

export function routeDictation(text) {
  const fields = { chiefComplaint: [], diagnosis: [], medicationLines: [], adviceNotes: [] };
  let section = 'chiefComplaint';
  let usedSectionWords = false;

  for (let sentence of splitSentences(text || '')) {
    const hit = SECTION_PATTERNS.find(([, re]) => re.test(sentence));
    if (hit) {
      section = hit[0];
      usedSectionWords = true;
      sentence = sentence.replace(hit[1], '').trim();
      if (!sentence) continue;
    }
    // Medicines section keeps one medicine per line; the prescription check
    // also catches medicines dictated without saying "medicines" first.
    if (section === 'medicationLines' || (section !== 'adviceNotes' && looksLikePrescription(sentence))) {
      fields.medicationLines.push(sentence.replace(/[.।]$/, ''));
    } else {
      fields[section].push(sentence);
    }
  }

  return {
    fields: {
      chiefComplaint: fields.chiefComplaint.join(' '),
      diagnosis: fields.diagnosis.join(' '),
      medicationLines: fields.medicationLines.join('\n'),
      adviceNotes: fields.adviceNotes.join(' '),
    },
    usedSectionWords,
  };
}
