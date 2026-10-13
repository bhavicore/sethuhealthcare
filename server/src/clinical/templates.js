// Hand-written Hindi/Tamil sentence templates (task.md "Data We Need": dose
// schedule + warning-sign sentences, "checked by native Hindi and Tamil
// speakers"). In this build they have NOT actually been reviewed by native
// speakers — that review is listed as a pre-deployment requirement, not
// something this session can do. Treat the hi/ta text as a draft.
//
// Dose instructions never go through an LLM: medicine, dose, frequency, and
// duration are always rendered from these fixed templates (Task 2.2).

export const SCHEDULE_TEXT = {
  od: { en: 'morning', hi: 'सुबह', ta: 'காலை' },
  '1-0-0': { en: 'morning', hi: 'सुबह', ta: 'காலை' },
  bd: { en: 'morning & night', hi: 'सुबह और रात', ta: 'காலை மற்றும் இரவு' },
  '1-0-1': { en: 'morning & night', hi: 'सुबह और रात', ta: 'காலை மற்றும் இரவு' },
  tds: { en: 'morning, afternoon & night', hi: 'सुबह, दोपहर और रात', ta: 'காலை, மதியம் மற்றும் இரவு' },
  tid: { en: 'morning, afternoon & night', hi: 'सुबह, दोपहर और रात', ta: 'காலை, மதியம் மற்றும் இரவு' },
  '1-1-1': { en: 'morning, afternoon & night', hi: 'सुबह, दोपहर और रात', ta: 'காலை, மதியம் மற்றும் இரவு' },
  qid: { en: 'four times a day', hi: 'दिन में चार बार', ta: 'நாளொன்றுக்கு நான்கு முறை' },
  hs: { en: 'at night', hi: 'रात को', ta: 'இரவில்' },
  '0-0-1': { en: 'at night', hi: 'रात को', ta: 'இரவில்' },
  '1-1-0': { en: 'morning & afternoon', hi: 'सुबह और दोपहर', ta: 'காலை மற்றும் மதியம்' },
  '0-1-0': { en: 'afternoon', hi: 'दोपहर', ta: 'மதியம்' },
  '0-1-1': { en: 'afternoon & night', hi: 'दोपहर और रात', ta: 'மதியம் மற்றும் இரவு' },
  '1-1-1-1': { en: 'four times a day', hi: 'दिन में चार बार', ta: 'நாளொன்றுக்கு நான்கு முறை' },
  evening: { en: 'in the evening', hi: 'शाम को', ta: 'மாலையில்' },
  sos: { en: 'as needed', hi: 'ज़रूरत पड़ने पर', ta: 'தேவைப்படும்போது' },
  prn: { en: 'as needed', hi: 'ज़रूरत पड़ने पर', ta: 'தேவைப்படும்போது' },
  stat: { en: 'immediately', hi: 'तुरंत', ta: 'உடனடியாக' },
};

const DURATION_TEXT = {
  en: (n) => `for ${n} day${n === 1 ? '' : 's'}`,
  hi: (n) => `${n} दिनों तक`,
  ta: (n) => `${n} நாட்களுக்கு`,
};

const DAILY_LABEL = { en: 'Duration not stated', hi: 'अवधि नहीं बताई गई', ta: 'கால அளவு குறிப்பிடப்படவில்லை' };

// Medicine names in the patient's script, printed with the English name in
// brackets so the patient can match it to the strip. Hand-written
// transliterations — pending native-speaker review like the rest of this file.
export const MEDICINE_NAMES = {
  paracetamol: { hi: 'पैरासिटामोल', ta: 'பாராசிட்டமால்' },
  ors: { hi: 'ओआरएस घोल', ta: 'ஓ.ஆர்.எஸ். கரைசல்' },
  amoxicillin: { hi: 'एमोक्सिसिलिन', ta: 'அமோக்ஸிசிலின்' },
  metformin: { hi: 'मेटफॉर्मिन', ta: 'மெட்ஃபார்மின்' },
  amlodipine: { hi: 'एम्लोडिपिन', ta: 'அம்லோடிபைன்' },
  cetirizine: { hi: 'सेटिरिज़िन', ta: 'செட்டிரிசின்' },
  omeprazole: { hi: 'ओमेप्राज़ोल', ta: 'ஒமெப்ரசோல்' },
  azithromycin: { hi: 'एज़िथ्रोमाइसिन', ta: 'அசித்ரோமைசின்' },
  ibuprofen: { hi: 'आइबुप्रोफेन', ta: 'இப்யூப்ரூஃபன்' },
  domperidone: { hi: 'डोमपेरिडोन', ta: 'டோம்பெரிடோன்' },
};

/** One line per medicine: "Paracetamol — 500 mg, morning, afternoon & night, for 3 days". */
export function buildDoseScheduleLine(med, lang = 'en') {
  const l = ['en', 'hi', 'ta'].includes(lang) ? lang : 'en';
  const english = med.genericName || med.matchedText || med.raw;
  const native = l !== 'en' ? MEDICINE_NAMES[med.generic]?.[l] : null;
  const name = native ? `${native} (${english})` : english;
  const dose = med.doseMg ? `${med.doseMg} mg` : '';
  const schedule = med.frequencyToken ? SCHEDULE_TEXT[med.frequencyToken.toLowerCase()]?.[l] : null;
  const duration = med.durationDays ? DURATION_TEXT[l](med.durationDays) : DAILY_LABEL[l];
  return [name, dose, schedule, duration].filter(Boolean).join(' — ').replace(' — ', ' — ');
}

// A medicine that isn't in the list can't be put into a template, but it must
// still reach the patient — so it's printed exactly as the doctor dictated it.
export function buildDoseScheduleBlock(medications, lang = 'en') {
  return medications
    .map((m) => (m.unmatched ? m.raw : buildDoseScheduleLine(m, lang)))
    .join('\n');
}

// Standard safety-net line (Doctor-in-Control Rule 3: red flags go to the
// doctor, but the printed/spoken patient advice always carries this same
// pre-approved escalation sentence). Source: ICMR STW-style danger signs;
// hand-written for this prototype, not yet reviewed by a clinician.
export const WARNING_SIGNS_TEXT = {
  en: 'Come to the PHC immediately if you have: chest pain, difficulty breathing, heavy bleeding, high fever that does not come down, or if symptoms get worse.',
  hi: 'यदि आपको सीने में दर्द, सांस लेने में तकलीफ़, अधिक रक्तस्राव, तेज़ बुख़ार जो कम न हो, या लक्षण बढ़ें — तो तुरंत PHC आएं।',
  ta: 'மார்பு வலி, மூச்சுத் திணறல், அதிக இரத்தப்போக்கு, குறையாத கடுமையான காய்ச்சல் அல்லது அறிகுறிகள் மோசமடைந்தால் உடனே PHC-க்கு வாருங்கள்.',
};

// Used when the doctor leaves the advice box empty. Fixed text in every
// language, so the common case needs no Gemini call at all. hi/ta are drafts
// pending native-speaker review, like the rest of this file.
export const DEFAULT_ADVICE_NOTE = {
  en: 'Take the medicines as prescribed, rest, and drink plenty of fluids.',
  hi: 'दवाइयाँ बताए अनुसार लें, आराम करें और खूब पानी पिएँ।',
  ta: 'மருந்துகளைப் பரிந்துரைத்தபடி எடுத்துக்கொள்ளுங்கள், ஓய்வெடுங்கள், நிறைய நீர் அருந்துங்கள்.',
};
