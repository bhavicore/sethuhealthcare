# Sethu — server

Express + SQLite (via `better-sqlite3`). Two things live here: the original
referral-sync API, and the consultation/inventory API for Loop 1 and Loop 2.
See the [root README](../README.md) for the full picture.

## Run

```bash
npm install
cp .env.example .env    # optional — see below
npm run start:env       # http://localhost:4000, loads .env if present
npm run dev:env         # same, with --watch
# or just `npm start` / `npm run dev` if you export env vars yourself
```

Demo data (facilities, medicines, patients, inventory, 90-day usage history)
is seeded automatically on first run — see `src/seed.js`. Data is stored in
`sethu.db` (SQLite, created on first run, git-ignored).

## Tests

```bash
npm test
```

`test/prescription-matrix.test.mjs` crosses every way of writing or saying a
prescription and checks each line against the known answer, currently
46,962 lines. Adding a new phrasing: put it in the lists at the top of that
file first, see it fail, then teach `src/clinical/normalize.js`.

The dimensions it crosses:
- **Medicine names:** generic, brand, shorthand ("PCM"), misheard spellings,
  and Hindi or Tamil script.
- **Doses:** 500, 500 mg, 1 g, and tablet counts ("1 tablet", "2 tablets",
  "half tablet", "एक गोली", "ஒரு மாத்திரை").
- **Frequencies:**
  - abbreviations: OD/BD/TDS/QID/HS/SOS, b.i.d., q8h;
  - number patterns: 1-0-1, 0-1-0, 1+0+1;
  - English: "every 8 hours", "twice daily", meal timings, morning/night in
    any order;
  - Hindi, romanized Hindi and Tamil phrases.
- **Durations:** 3 days, 3d, x 3 days, 3/7, 1/52, words ("three days",
  "a week", "एक हफ्ता", "மூன்று நாட்கள்", "teen din"), and Devanagari digits.
- **Word orders:** name–dose–frequency–duration, duration first, frequency
  first, and a trailing Hindi verb. It also covers two medicines on one line
  with and / , / और / மற்றும் / then.
- **Traps that must never be misread:** "twice a day" is not a 1-day course,
  "500 दिन में दो बार" is not a 500-day course, and "every 6 hours" is not
  a 6 mg dose.

## Optional environment variables

None of these are required — the demo runs fully without them. See
`.env.example`.

| Variable | Enables |
|---|---|
| `SARVAM_API_KEY` | Saaras v3 speech-to-text (dictation mic buttons), Bulbul v3 text-to-speech (WhatsApp voice notes) |
| `SARVAM_TTS_SPEAKER` | Bulbul v3 voice (default `priya`) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Patient-advice rewording into Hindi/Tamil, indent justification notes |
| `WHATSAPP_CLOUD_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Actually sending the queued WhatsApp messages (otherwise they're queued and logged, not delivered) |

Sarvam credits: each mic press is one speech-to-text call, and each approved
visit for a voice-preference patient (with an open WhatsApp window) is one
text-to-speech call. Nothing else calls Sarvam.

The voice note is requested with `output_audio_codec: 'opus'` at 24 kHz (Opus
rejects the API's default 22050 Hz). A live test on 2026-09-15 showed Sarvam
returns it in an OGG container, which is the `audio/ogg` + Opus format
WhatsApp requires for voice notes.

Dictating in Tamil or Hindi mode may return medicine names in that script
(in the same test, "Paracetamol" came back as பாராசிட்டாமோல்). The medicine
list only matches Latin-script names, so dictate the medicines box in
"English / mixed" mode.

## API — referral bridge (original demo)

- `GET /api/health` — liveness check
- `POST /api/sync` — body `{ visits: [...] }`; upserts each by `localId`.
- `GET /api/patients/:abhaId` — synced visits for an ABHA ID.
- `GET /api/abha/:abhaId/link` — mocked ABDM linkage check.
- `GET /api/visits?limit=100` — recent visits, most-recent first.

## API — consultation & inventory (`/api/care/*`)

**Facilities & reference data**
- `GET /api/care/facilities`, `GET /api/care/medicines`, `GET /api/care/config`

**Patients (Task 3.1)**
- `POST /api/care/patients/register`
- `GET /api/care/patients/lookup?phone=...`
- `POST /api/care/patients/:id/whatsapp-consent` — simulates the QR-code opt-in
- `GET /api/care/patients/:id/history` — history + deterministic summary

**Speech-to-text (Task 2.1)**
- `POST /api/care/stt` — body `{ audioBase64, mimeType, language }`

**Encounters (Task 3.1 + 3.2 alerts)**
- `POST /api/care/encounters/draft` — normalize + structure + CDSS checks +
  patient-language advice with back-translation (the only place Gemini runs
  for a consultation); nothing persisted yet
- `POST /api/care/encounters/approve` — persists the reviewed draft
  (including its `advice`), deducts stock in one transaction, queues
  WhatsApp if the 24-hour window is open, logs everything. No model call.
- `GET /api/care/encounters/:id`

**Inventory & indents (Task 4.2)**
- `GET /api/care/inventory/:facilityId` — status per medicine (OK/Low/Reorder/Near expiry)
- `POST /api/care/inventory/:facilityId/indents/draft` — formula-based calc + Gemini note
- `POST /api/care/indents`, `GET /api/care/indents?facility=...&direction=incoming|outgoing`
- `POST /api/care/indents/:id/approve`, `POST /api/care/indents/:id/reject`

**Audit (Doctor-in-Control Rule 7)**
- `GET /api/care/audit?entity=...&entityId=...`

## Code layout

- `src/clinical/normalize.js` — abbreviation expansion + brand→generic +
  medication-line parsing (deterministic, no LLM)
- `src/clinical/rules.js` — allergy/interaction/dose-limit/missing-detail/stock
  checks (deterministic)
- `src/clinical/inventory.js` — the reorder-point/indent-quantity/surge-flag
  formulas (deterministic)
- `src/clinical/templates.js` / `summary.js` — fixed Hindi/Tamil dose-schedule
  sentences and the deterministic history summary
- `src/lib/gemini.js`, `src/lib/sarvam.js`, `src/lib/whatsapp.js` — the three
  external integrations, each with a documented fallback when unconfigured
- `src/routes/care.js` — the `/api/care/*` router
- `src/seed.js` — synthetic demo data (see the root README's "Data We Need" section in `task.md`)
