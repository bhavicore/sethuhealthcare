# Sethu

**An honest prototype for two connected agent loops in a rural PHC, plus the
original offline referral bridge.**

Tamil/Sanskrit for *bridge*. This repo now covers three things, in order of
how they were built:

1. **Consultation (Loop 1).** A patient registers at the desk. The moment
   they're called in, the doctor's screen already shows their history —
   allergies highlighted, chronic conditions, current medicines, last visit.
   The doctor examines the patient directly (never recorded) and dictates
   findings, diagnosis, and medicines. The agent normalizes the dictation,
   checks it against the patient's history and the PHC's stock, and drafts a
   report with any allergy conflicts, drug interactions, dose issues, or
   missing details flagged — as warnings, never blocks. The doctor edits and
   approves; only then is anything final. The signed printout carries the
   advice in the patient's language (Hindi/Tamil), and voice-preference
   patients also get a WhatsApp voice note.
2. **Inventory (Loop 2).** Every approved prescription deducts PHC stock. A
   plain formula — not an LLM — tracks how fast each medicine is being used,
   flags a monsoon-style surge, and drafts a requisition (indent) to the CHC
   before the PHC actually runs out. The Medical Officer approves or edits
   the indent before anything is sent; the CHC sees it in an inbox.
3. **Referral bridge (the original demo).** When a patient is referred from a
   PHC to a CHC, Sethu compiles the visit into a compressed, self-contained
   QR code — no login, no connectivity needed at either end.

This is a **synthetic-data prototype**, not a validated clinical system — see
[Limits](#limits) below and `task.md` for the full roadmap this demo is a
slice of.

## How Loop 1 works

1. **Registration** (desk): name, age, phone, language, message format
   (text/voice/both). First-time patients are asked about allergies.
   Voice-preference patients scan a WhatsApp QR code, opening the 24-hour
   messaging window.
2. **History, instantly** (doctor console): allergies (highlighted), chronic
   conditions, current medicines, past visits, last vitals, and a short
   deterministic summary. Allergies and medicines are shown exactly as
   recorded — never inferred.
3. **Dictation**: chief complaint, diagnosis, and medicines (one per line,
   e.g. `Paracetamol 500 TDS 3 days`). With `SARVAM_API_KEY` set, the doctor
   can tap **Dictate consultation** once and speak the whole visit. Audio is
   cut at pauses and transcribed live (silence is never sent). On Finish,
   each box fills itself and the draft runs automatically:
   - If the doctor says section words ("diagnosis…", "medicines…",
     "advice…", or निदान / दवाइयाँ / सलाह), fixed rules sort the text.
   - Otherwise Gemini sorts natural speech, but it may only **copy** phrases
     from the transcript, and the server checks that every piece appears
     there word for word. If anything was changed, or Gemini is unavailable,
     the result is discarded and simple rules are used instead.
   - Medicines or numbers left out of every box are shown to the doctor.
   Typing, and the small per-field mic buttons, still work for corrections.
4. **Draft & check**: the agent expands abbreviations (TDS, BD, 1-0-1, …),
   maps brand names to generics (Dolo 650 → paracetamol), and checks the
   draft against the patient's allergies, a small drug-interaction table
   (covering both today's medicines and the ones the patient is already
   taking), dose ceilings, missing details, and PHC stock. It also prepares
   the patient-language advice, with an English back-translation.
5. **Review & approve**: warnings are shown, but never block. A major
   warning (like an allergy conflict) asks the doctor for a short reason
   before Approve is enabled — the reason is logged, not enforced. The
   review shows exactly what the patient will get; if the doctor edits the
   dictation afterwards, Approve waits for a re-check, so what's saved is
   always what was reviewed.
6. **Signed report**: printable, with the doctor's name and registration
   number, the report/prescription in English, a patient-language section
   with a morning/afternoon/night dose schedule (fixed templates, never
   LLM-generated), and a signature line.
7. **After approval**: stock is deducted (medicines with no duration, or
   as-needed ones like `SOS`, are listed for manual entry instead), the
   visit is added to history, voice-preference patients whose WhatsApp
   24-hour window is open get a voice note (advice + dose schedule) and a
   text summary, and every step is logged to the audit trail.

## How Loop 2 works

- Inventory screens (PHC and CHC) show each medicine's stock, days of stock
  left, and status (OK / Low / Reorder / Near expiry).
- `daily use = max(7-day avg, 90-day avg)` — so a surge is caught fast —
  `× seasonal multiplier` (set per medicine by the Medical Officer, e.g. ORS
  ×1.5 in June–September). `reorder point = adjusted daily use × lead time +
  safety stock`. `indent quantity = adjusted daily use × cycle days − current
  stock`. All arithmetic, no LLM.
- A surge flag fires when the 7-day average exceeds 1.5× the 90-day average.
- Gemini (if configured) writes a one-sentence justification note for the
  indent; every number in it comes from the formula above.
- The PHC Medical Officer approves or edits the quantity before it's sent;
  the CHC sees it in an inbox.

## Login and access

Staff sign in by picking their name and entering a personal 4–6 digit PIN.
Five wrong PINs lock the account for five minutes. A session lasts one shift
(12 hours) and ends when the browser closes. Fingerprint verification is
planned on top of the same accounts (Task 7.3).

**Model:** a person holds **assignments**: a role, at a facility, from a date
(optionally until a date). Facilities form a tree: district → CHC → PHC.

| Role | Where | Patient records | Totals (dashboard, stock, indents) |
|---|---|---|---|
| Registration desk | one facility | register and look up | — |
| Doctor | one or more facilities | full, where assigned | stock |
| Pharmacist | one facility | — | stock |
| Medical Officer (in-charge) | one PHC | full | dashboard, indents, staff list |
| CHC in-charge | one CHC | the CHC's own patients, plus patients **referred** to it | full CHC dashboard; totals only for PHCs below it; indent inbox |
| District Health Officer | the district | **none** | totals for every facility in the district |
| System admin | — | none | staff list only |

**How it's enforced:**
- Every `/api/*` request carries a session token, checked on the server by
  `server/src/auth/access.js`.
- The facility a request touches comes from the session or from the record
  being opened, never from the request body.
- Patient-level access requires the patient to be linked to your *active*
  facility: registered there, treated there, or referred there. This is never
  inherited down the tree.
- Totals-only access (dashboards, stock, indents) is inherited by the district
  and CHC levels.
- The signing doctor's name and registration number come from the account.
- Refusals and logins are written to the audit log.

**Demo accounts** (made-up people; PINs are for the demo only):

| Name | Role · facility | PIN |
|---|---|---|
| Priya Natarajan | Registration desk · Kaveripatnam PHC | 1111 |
| Dr. Anitha Selvam | Medical Officer · Kaveripatnam PHC | 2222 |
| Dr. Ravi Kumar | Doctor · Kaveripatnam PHC **and** Erode CHC (switch in the top bar) | 3333 |
| Murugan Pillai | Pharmacist · Kaveripatnam PHC | 4444 |
| Dr. Senthil Rajan | CHC in-charge · Erode CHC | 5555 |
| Dr. Kavitha Subramani | District Health Officer · Erode district | 6666 |
| Sethu Admin | System admin | 9999 |

**Limits:**
- A 4–6 digit PIN is weak on its own; it assumes a registered clinic device
  and the lockout.
- There's no in-app screen yet to add or end assignments.
- The staff list on the login screen is visible without signing in.
- The audit log isn't split by facility, so anyone with audit access sees all
  of it.

## Clinic dashboard

For the PHC Medical Officer, with Today / 7 / 30 / 90-day ranges and PHC or
CHC. It shows:
- **Headline numbers:** visits (vs the previous period), patients seen, new
  registrations, average visits per day, and visits with a safety flag.
- **Visits chart:** visits per day, or per hour for Today, with hover and a
  table view.
- **Breakdowns:** top diagnoses, most-prescribed medicines, which safety
  checks fired, and patient mix by age, language, advice format and sex.
- **Operations:** stock needing attention and the latest visits.

All of it is plain aggregation over approved visits; no model is involved.
Days are counted in IST.

The demo database seeds **~60 days of synthetic visit history** (about 1,500
visits for 350 synthetic patients) so the dashboard has something to show.
Every seeded row is marked `origin = 'synthetic'`, and the dashboard's banner
says how many visits in the range are synthetic and how many were recorded
live in the app. Diagnoses are free text, grouped by exact wording (ICD-10
coding is future work).

## Architecture

```
 Desk → Doctor Console (Loop 1)              PHC/CHC Inventory (Loop 2)
 ┌───────────────────────────┐                ┌───────────────────────────┐
 │ Register / lookup patient  │                │ Stock + 90-day usage       │
 │ History on screen          │──approve──────▶│ history per medicine      │
 │ Dictate → draft → warnings │  (deduct stock) │ Formula-based reorder     │
 │ Doctor approves & signs    │                │ Gemini-worded indent note │
 └──────────────┬──────────────┘                └──────────────┬──────────────┘
                │ printable report + WhatsApp (mocked send)      │ HITL approval
                ▼                                                ▼
        Patient (their language)                          CHC inbox

 PHC — Sethu Client (referral bridge)            CHC — Doctor View
 ┌─────────────────────┐        QR Referral       ┌─────────────────────┐
 │ Log visit            │ ───── Card (offline) ──▶│ Scan QR              │
 │ Local-first storage  │                          │ Instant history view │
 └───────────┬───────────┘                          └───────────┬───────────┘
             │  Local Queue + Background Sync Engine             │
             ▼                                                     ▼
                      ┌────────────────────────────┐
                      │   Central Store (server/)   │
                      │   Express + SQLite           │
                      └────────────────────────────┘
```

## Repo layout

- `client/` — React + Vite PWA. Desk, Doctor Console, Inventory, and CHC
  views for Loop 1/2, plus the original PHC/CHC referral views. See
  [`client/README.md`](client/README.md).
- `server/` — Express + SQLite. Clinical rules engine, inventory formulas,
  Gemini/Sarvam wrappers (both optional, with graceful fallback), and the
  original referral-sync API. See [`server/README.md`](server/README.md).

## Deploying it

The repo ships a `Dockerfile` that builds the client and runs one Node
process serving the app and API (port 8080, HTTPS terminated by the host).
The SQLite file lives at `/data/sethu.db`, so **mount a persistent volume at
`/data` and run a single instance**; without a volume, data is lost on every
redeploy.

- **Fly.io:** `fly launch --no-deploy --copy-config`, then
  `fly volumes create sethu_data --size 1`, `fly deploy`.
- **Render:** New → Blueprint, pointing at this repo (`render.yaml`; disks
  need a paid instance).
- Set `GEMINI_API_KEY` / `SARVAM_API_KEY` as host secrets if wanted.

**Before exposing it publicly:** the database seeds synthetic patients and the
demo accounts listed under "Login and access" (PINs `1111`…`9999`). Anyone who
finds the URL can sign in with them. Keep the deployment demo-only, behind
access control, and never load real patient data.

## Running it

Sethu is a client–server app: the **server** (`server/`, Express + SQLite)
owns the data, rules and API under `/api`, and the **client** (`client/`,
React PWA) talks to it over HTTP on the same origin.

**Production-style (one process, one port):**

```bash
npm run install:all   # once
npm start             # builds client/dist, then serves app + API on http://localhost:4000
```

**Development** (Vite on :5173 with hot reload, proxying `/api` to the server
on :4000):

**One command** (installs dependencies on first run, starts both, Ctrl+C
stops both):

```bash
./start.sh
```

Then open http://localhost:5173. Or run the two parts separately:

```bash
# Terminal 1 — central store
cd server
npm install
# npm 11+ blocks install scripts by default, and better-sqlite3 needs one to
# build its native module. If the server fails to start with a
# better-sqlite3 error, run:
#   npm approve-scripts better-sqlite3 && npm rebuild better-sqlite3
cp .env.example .env   # optional: add SARVAM_API_KEY / GEMINI_API_KEY here
npm run start:env      # http://localhost:4000, loads .env if present
# (plain `npm start` also works if you'd rather export env vars yourself)

# Terminal 2 — client
cd client
npm install
npm run dev             # http://localhost:5173
```

Demo data is seeded automatically on first server start: two facilities
(`phc-1`, `chc-1`), 10 NLEM medicines, a hand-built interaction/allergy table,
four synthetic patients (one with a penicillin allergy — phone
`9800000001`), 90 days of usage history with a built-in ORS monsoon surge,
and stock levels tuned so ORS is about to run out and one cetirizine batch
is near expiry.

**Before a demo, delete `server/sethu.db`** so it's re-seeded that day. The
synthetic history is dated relative to the seeding day, so an old database
drifts: the ORS surge ages out of the 7-day window, and the seeded patients'
WhatsApp windows close after 24 hours. The ORS ×1.5 seasonal multiplier also
only applies in June–September.

**A scripted walkthrough:** Desk → look up `9800000001` (Lakshmi Raman) →
Send to Doctor → dictate `Amoxicillin 500 BD` as the medicine → Draft → the
draft flags a penicillin allergy conflict and a missing duration → tap the
`5d` quick-pick → Re-check → give a one-line reason for the allergy warning →
Approve → the printed report carries the Tamil advice and dose schedule, and
amoxicillin stock drops by 10. (Try `Ibuprofen 400 TDS 3 days` for the same
patient to see an interaction flagged against her current amlodipine.) Then
check Inventory → ORS shows **Reorder** with a surge flag → Draft indent →
Approve & send → switch to CHC → Indent Inbox to see it arrive.

## What's real vs. mocked

- **Real:** the clinical rules engine (allergy/interaction/dose/missing-detail/
  stock checks), abbreviation and brand→generic normalization, the
  inventory reorder formulas and surge detection, stock deduction on
  approval, the audit trail, the printable signed report, and (from the
  original demo) local-first storage, QR encode/decode, and the background
  sync engine.
- **Optional, with graceful fallback:** Sarvam Saaras v3 (speech-to-text)
  and Bulbul v3 (text-to-speech) — without `SARVAM_API_KEY`, doctors type
  dictation and no voice notes are generated. Gemini — used only to reword
  the doctor's own advice note into Hindi/Tamil, after the patient's name
  and phone number are stripped out. Without `GEMINI_API_KEY`, that note
  stays in English (the review screen says so) and indent justifications use
  a plain template sentence. The default advice line, dose schedules, and
  warning-sign sentences are **always** fixed templates, never the model.
- **Mocked (integration point is real, upstream call is stubbed):** the
  Meta WhatsApp Cloud API send — messages are queued in `whatsapp_outbox`
  and logged, but never delivered, even if WhatsApp credentials are set
  (the send call isn't written yet). Also the ABDM/ABHA linkage check from
  the original referral demo.

## Limits

- Built and tested on synthetic data only; not validated with real patients,
  clinicians, or pharmacists. The Hindi/Tamil sentence templates and the
  ~20-pair interaction table need native-speaker and clinician review before
  any real use.
- Only the original referral flow is offline-first in this build. The desk
  (registration, lookup), the doctor console, and inventory all call the
  server and need a connection to it. Local on-device speech-to-text is
  future work — see `task.md`.
- Login is a personal PIN with role-based access (see "Login and access").
  It isn't hardened for real deployment yet: no HTTPS setup, no device
  registration, and no in-app assignment editor.
- One patient per phone number. Families that share a phone can't each
  register yet.
- Stock deduction assumes one stocked unit per dose (e.g. a 650 mg dose
  counts as one 500 mg tablet), and indents don't yet subtract earlier
  indents that are still in transit.
- The PII scrub before Gemini only removes the patient's name, phone, and
  phone/ABHA-shaped numbers. Anything else identifying typed into the
  advice note (a village, a relative's name) would still be sent.
- Inventory is not a replacement for e-Aushadhi / DVDMS / TNMSC; it shows the
  agent layer that could sit on top of them.
- Doctor-console timing shown after Approve is unvalidated demo
  instrumentation, not a claimed time saving — see `task.md`'s review-feedback
  table for what a real time-and-motion study would need.
