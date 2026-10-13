# Healthcare Agent — Task Plan

## Scope

This is an honest prototype, not a complete fix for public healthcare. The demo shows two connected loops:

**Loop 1 — Consultation:** Patient registers → doctor instantly sees history and allergies → patient talks to the doctor normally → doctor dictates → agent drafts the report and flags problems → doctor corrects and approves → printout signed by the doctor → patient gets the advice in their language: on the printout, plus a WhatsApp voice note if they chose voice.

**Loop 2 — Inventory:** Approved prescriptions reduce PHC stock → agent tracks how fast each medicine is used → when stock will run out before a resupply can arrive, the agent drafts an indent (requisition) to the CHC → Medical Officer approves → the CHC sees the request.

### Consultation Flow (Loop 1)

1. **Registration:** the patient's details are entered at the desk (name, age, phone; ABHA later). Returning patients are looked up by phone number in the first demo; **from the final review, by fingerprint** (see Phase 7, Task 7.0), with phone number as the fallback.
   - **Preferences:** language (Hindi / Tamil / English) and message format (text, voice, or both).
   - **WhatsApp QR code (voice patients only):** the patient scans a QR code at the desk and sends the pre-filled "Hi". This opens WhatsApp's 24-hour window so the same-day voice note can be delivered, records consent to be messaged, and confirms the phone number works.
2. **History on the doctor's screen, immediately:** allergies (highlighted), chronic conditions, current medicines, past visits and diagnoses, last vitals. The agent writes a 3–4 line summary; allergies and medicines are shown exactly as recorded, never inferred. First-time patients are asked about allergies at registration.
3. **Consultation:** the patient talks to the doctor normally. **The patient is not recorded.** The doctor's understanding is the clinical filter.
   - *Exception — language mismatch:* if the doctor and patient don't share a language (e.g., a Hindi-speaking migrant worker and a Tamil-speaking doctor), the doctor can press **Translate** to record the patient and see an English/Tamil translation.
4. **Doctor dictates** findings, diagnosis, and medicines (English, Hindi, Tamil, or mixed).
5. **Agent drafts the report** and checks it against the history: allergy conflicts, drug interactions, dose limits, missing details (e.g., "amoxicillin: duration not stated"), and stock ("ORS: out of stock at this PHC"). These are warnings, not blocks.
6. **Doctor reviews on screen, edits, and clicks Approve.** Corrections are made on screen before printing; if anything changes after printing, the report is reprinted.
7. **Printout:** doctor's name and registration number, the report and prescription in English, a section in the patient's language with a simple dose schedule (morning / afternoon / night), and a signature line. **The doctor signs it**, which is the final verification.
8. **After approval:** text-only patients take home the printout, which already has the advice in their language. Voice patients also get a WhatsApp voice note and text summary (via the QR window). Stock is deducted, the visit is added to the patient's history, and every step is logged.

- **What makes it an agent:** it prepares the patient's history before the doctor asks, checks the dictation for gaps and conflicts, flags stock problems at the moment of prescribing, and watches stock and drafts indents on its own. Humans approve all clinical content and every indent before it is sent.

### Doctor-in-Control Rules

The agent is a helper. It prepares, drafts, flags, and reminds; the doctor decides.

1. **The agent never diagnoses, prescribes, or gives medical advice.** Diagnoses and medicines come only from the doctor's own dictation or edits.
2. **The agent does not talk to the patient before the doctor.** The patient speaks to the doctor directly; the only recording of the patient is when the doctor presses Translate.
3. **Red flags go to the doctor, not the patient.** If a follow-up reply mentions a danger sign (e.g., chest pain, breathlessness, bleeding in pregnancy), the agent alerts the doctor or ASHA worker and sends one pre-approved message: "Please come to the PHC now."
4. **Everything the agent produces is a draft.** The report, the advice, the reminders, and indents all wait for human approval. The doctor's edits are final, the agent never changes a record after approval, and the signed printout is the final verification.
5. **Warnings inform, they don't block.** Drug-interaction, allergy, and dose alerts are shown to the doctor, who can proceed after giving a short reason.
6. **Follow-ups escalate, never advise.** If a patient reports feeling worse, the agent alerts the doctor or ASHA worker; it does not tell the patient what to do.
7. **Everything is logged:** what the agent suggested, what the doctor changed, and who approved it and when. The record shows the doctor made the decision.

### Limits

- Built and tested on synthetic data only; not validated with real patients, clinicians, or pharmacists.
- Inventory is not a replacement for existing state systems (e-Aushadhi / DVDMS, TNMSC); it shows the agent layer that could sit on top of them.
- The phases below are the full roadmap. The demo covers Loop 1 (Tasks 2.1–2.3, 3.1, and the alerts in 3.2) and Loop 2 (Task 4.2); everything else is future work.

## Review Feedback: Risks & Mitigations

External review flagged five friction points for live deployment. Each is either handled in the demo or recorded as a deployment requirement.

| Risk | Why it matters | Demo | Deployment |
|---|---|---|---|
| **Consultation speed** — busy PHC doctors have ~2 minutes per patient | If the system is slower than a paper prescription, doctors won't use it | Short dictation ("fever 3 days, paracetamol 500 TDS 3 days"); one-tap templates for common cases (fever, diarrhoea, cough); quick-pick buttons for missing fields (duration: 3 / 5 / 7 days); review by exception (only flagged items need attention, one-tap Approve when there are no warnings); desk staff handle registration before the doctor. **Measure doctor time per patient vs. paper and report it honestly.** | Time-and-motion study with real doctors before claiming time savings |
| **Offline / poor connectivity** | Cloud APIs (Sarvam, Gemini, WhatsApp) fail on weak networks | Local database for registration, history, printing, and inventory; store-and-forward queue for dictation audio, voice notes, and indents; the UI never waits on the network; manual entry (typing / quick-pick) when offline | Local speech-to-text on an edge device (e.g., a small IndicWhisper model) and sync-conflict handling |
| **WhatsApp 24-hour rule** — no free-form text or audio unless the patient messaged in the last 24 hours | Same-day messages would be blocked | **Voice patients:** QR code at registration opens the 24-hour window. **Text-only patients:** no QR and no WhatsApp; the printout is their same-day text | Later reminders as Meta-approved Utility text templates in Hindi/Tamil (charged per message); optional secure, expiring audio link for voice-preference patients; SMS via TRAI DLT registration for feature phones |
| **Code-mixed terminology** — "TDS", "SOS", "BD", "1-0-1", brand names like "Dolo 650" | Mapping raw speech straight to codes misclassifies them | Normalization step *before* coding: abbreviation dictionary (TDS → three times a day, SOS → as needed) and brand → generic table (Dolo 650 → paracetamol 650 mg); pass these terms as Saaras keyterms; show the expanded form to the doctor during review | Larger verified brand–generic list; accuracy testing on real dictations |
| **Seasonal surges** — 90-day averages lag behind monsoon outbreaks (dengue, diarrhoea) | Stockouts during surges, when medicines matter most | Surge-aware demand: use the higher of the 7-day and 90-day average; seasonal multiplier per medicine (e.g., ORS × 1.5, June–September) **set by the Medical Officer, not the AI**; surge flag when 7-day use exceeds 1.5 × the 90-day average | Multipliers learned from previous years' data; link to outbreak detection (Task 3.3) |

## Data We Need (demo)

No real patient data; synthetic and public sources only.

| Data | Source | Notes |
|---|---|---|
| Doctor dictation clips | Our own team reading scripted dictations (English, Tamil, Hindi, and mixed) | 10–15 clips; consent-clean and free |
| Patient clips for the Translate case | A few scripted Hindi patient complaints read by our team | Only needed for the language-mismatch demo |
| Patient history | Our own generator script: past visits, allergies, chronic conditions, current medicines | Include one patient with a penicillin allergy so the allergy warning fires in the demo |
| Extra speech for accuracy testing | AI4Bharat IndicVoices, Mozilla Common Voice (both have Hindi and Tamil) | Not clinical speech; check each dataset's license |
| Synthetic patient records | Our own generator script (Indian names, ages, complaints), optionally Synthea for FHIR structure | Label everything as synthetic |
| Symptom / diagnosis codes | ICD-10 (WHO browser, free); SNOMED CT via NRCeS (free for use in India, registration needed) | Hand-pick ~50 common symptoms; copy codes from the source, never invent them |
| Medicines and dose limits | National List of Essential Medicines (NLEM 2022), ICMR Standard Treatment Workflows | Public PDFs |
| Drug interactions / allergies | Small hand-built table (~20 pairs) from DDInter or DrugBank (free academic access) | Ask a doctor or pharmacist to check it |
| Guidelines for advice | ICMR Standard Treatment Workflows, MoHFW guidelines | Source of any warning signs in patient advice |
| Medicine list for inventory | ~10 common medicines from NLEM 2022 (e.g., paracetamol, ORS, amoxicillin, metformin, amlodipine) | Keep the demo list small |
| Stock levels and 90-day usage history | Generated by our own script for 1 PHC and 1 CHC | Synthetic; include one medicine that is about to run out and one near expiry |
| Fingerprints (final review) | Team members enrol their own fingerprints as the demo patients | Never use real patients' fingerprints; delete after the review |
| Resupply lead times | Assumed values (e.g., PHC ← CHC: 3 days; CHC ← district warehouse: 7 days) | State clearly that these are assumptions |
| Hindi / Tamil dose-schedule sentences | Written by our team, used on the printout and in voice notes | Checked by native Hindi and Tamil speakers |
| Abbreviation dictionary | Standard prescription abbreviations (OD, BD, TDS, QID, SOS, HS, 1-0-1) | Small, hand-built; have a doctor check it |
| Brand → generic table | ~30 common brands for the demo medicines (e.g., Dolo 650 / Crocin → paracetamol) | Verify each pair against the product label or CDSCO listing |
| Monsoon surge in usage history | Built into the synthetic 90-day history | One medicine (e.g., ORS) with a sharp rise, so the surge flag fires |

---

## Phase 1: Core Foundation & ABDM Data Architecture

- [ ] **Task 1.1: Design Hierarchical Data Model**
  - [ ] Define Patient-level schema (Demographics, ABHA ID, Encounters, Observations, Prescriptions) compliant with FHIR R4.
  - [ ] Define PHC-level schema (Facility ID, Daily Outpatient Logs, Inventory, Staff Allocation, Catchment Villages).
  - [ ] Define District-level schema (Aggregated Metrics, Anonymized Disease Trends, Regional Inventory Nodes).
  - [ ] Establish foreign keys and hierarchical relationships (`District` -> `PHC` -> `Patient`).

- [ ] **Task 1.2: ABDM & ABHA Integration Setup**
  - [ ] Set up ABDM Sandbox APIs for ABHA Creation, Verification, and Linkage.
  - [ ] Implement Health Information Exchange & Consent Manager (HIECM) workflow for consent-based data sharing.
  - [ ] Create FHIR Profile converters for standard HL7 payload mapping.

- [ ] **Task 1.3: Data Security & PII Anonymization Pipeline**
  - [ ] Implement automated PII (Personally Identifiable Information) scrubber for data flowing from PHC to District level.
  - [ ] Configure role-based access control (RBAC) separating Doctor, ASHA Worker, PHC Medical Officer, and District Health Officer permissions.
  - [ ] Set up audit logging database for compliance tracing.

---

## Phase 2: Vernacular & Speech Intelligence Layer (Patient Tier)

- [ ] **Task 2.1: Speech-to-Text (STT) Integration for Indic Languages**
  - [ ] Integrate **Sarvam Saaras** (`https://api.sarvam.ai/speech-to-text`) as the primary STT for the two target languages: **Hindi** (`hi-IN`) and **Tamil** (`ta-IN`).
  - [ ] Use Saaras `codemix` mode for code-mixed speech (Hinglish, Tanglish), since clinical terms are often spoken in English.
  - [ ] Test `saaras:v4` keyterms to bias recognition toward drug names and clinical vocabulary.
  - [ ] Keep Bhashini / IndicWhisper as a fallback and as the benchmark baseline.
  - [ ] Store the API key in a `SARVAM_API_KEY` environment variable; never commit it.
  - [ ] Build audio preprocessing pipeline (noise reduction, downsampling) optimized for low-cost mobile devices used by ASHA workers.
  - [ ] Benchmark Word Error Rate (WER) on colloquial clinical phrases in Hindi and Tamil, including regional Tamil variants (e.g., Chennai, Madurai, Kongu), comparing Sarvam against the baseline.

- [ ] **Task 2.2: Clinical Translation & Normalization Agent**
  - [ ] Build Agent prompt templates and RAG pipeline mapping colloquial Hindi and Tamil symptoms (e.g., "छाती में जलन", "நெஞ்சு எரிச்சல்") to standard SNOMED-CT / ICD-10 terminology.
  - [ ] Implement bi-directional translation pipeline: Hindi/Tamil Input → English Clinical Terms → Hindi/Tamil Patient Advice.
    - Inbound: Saaras `translate` mode (Hindi/Tamil speech → English text) for the doctor's dictation, and for the patient only when the doctor presses Translate. The original-language transcript is kept for doctor review and the audit trail.
    - Outbound: **Gemini API** turns doctor-approved English instructions into plain-language Hindi/Tamil advice in one step (Sarvam Translate / Mayura kept as fallback).
  - [ ] Use the Gemini API (a Flash model) for plain-language patient advice. It only rewords what the doctor approved; it must not add diagnoses, drugs, or doses.
  - [ ] Keep dose instructions out of the model: medicine, dose, frequency, and duration are filled into fixed Hindi/Tamil sentence templates written once and checked by native speakers. Gemini writes only the general advice and warning signs.
  - [ ] Show the doctor an English back-translation of the Gemini text, since the doctor may not read the patient's language.
  - [ ] Strip PII (name, ABHA ID, phone, village) before any Gemini call; send only the de-identified instructions. Use synthetic data only while on the free tier.
  - [ ] Store the key in a `GEMINI_API_KEY` environment variable; never commit it.
  - [ ] Set up fallback handlers for ambiguous regional idioms, dialect blending, and Hindi/Tamil–English code-mixing.

- [ ] **Task 2.3: Low-Literacy Patient Engagement Agent**
  - [ ] Deliver advice in the format the patient chose at registration (text, voice, or both):
    - **Text-only patients:** the printout, already in their language. No WhatsApp message.
    - **Voice patients (WhatsApp):** send to the patient's or a family member's phone via the Meta WhatsApp Cloud API. The patient scans the **QR code** at registration, which sends a pre-filled "Hi" and opens the 24-hour window. The same-day voice note (audio converted to OGG/Opus) and a short text summary go out after approval.
    - **ASHA home visit (no-phone patients):** the note is queued on the ASHA worker's app and played during her next visit, where she also checks whether the patient is taking the medicine.
    - **Language-mismatch case:** play in the consultation room only when the doctor and patient don't share a language (e.g., Hindi-speaking migrant workers seeing Tamil-speaking doctors).
  - [ ] Implement Text-to-Speech with **Sarvam Bulbul v3** to send Hindi and Tamil voice notes for dosage instructions and warning signs, only for patients who chose voice (saves credits).
  - *Later scope (not in the demo):*
    - **Reminders (day 3 onward, outside the 24-hour window):** Meta-approved Utility text templates in Hindi and Tamil with blanks filled per patient, e.g. "{{medicine}}: {{dose}}, {{times}} times a day for {{days}} days." Needs recorded messaging consent at registration (tick box or verbal) and Meta template approval; charged per message. Voice-preference patients can get an optional secure, expiring audio link.
    - **Symptom follow-up agent:** collects recovery status via simple tap buttons or voice. Reminder content and timing are proposed by the agent and approved by the doctor; if the patient reports feeling worse, the agent alerts the doctor or ASHA worker instead of advising the patient.
    - **SMS** for feature phones, after registering the sender and templates on TRAI's DLT system.
    - **IVR** voice calls for feature-phone users.

---

## Phase 3: Clinical & Facility Agents (PHC Tier)

- [ ] **Task 3.1: EHR Ingestion & Structuring Agent**
  - [ ] Build patient registration and lookup (by phone number; ABHA later), with allergies asked for first-time patients, preferred language and message format (text / voice / both), and the WhatsApp QR code for voice patients.
  - [ ] Build the doctor's history view: allergies (highlighted), chronic conditions, current medicines, past visits, last vitals, and a short agent-written summary. Allergies and medicines are shown exactly as recorded.
  - [ ] Develop agent to convert the doctor's dictation (English, Hindi, Tamil, or code-mixed) into FHIR JSON records, reusing the Phase 2 STT pipeline. The patient is not recorded, except when the doctor presses Translate.
  - [ ] Send dictations under 30 seconds to the Sarvam REST endpoint; split longer ones into chunks or use the Sarvam Batch API.
  - [ ] Normalize the transcript before coding: expand prescription abbreviations (TDS, SOS, BD, 1-0-1) and map brand names to generics (Dolo 650 → paracetamol 650 mg); show the expanded form to the doctor.
  - [ ] Implement automatic tagging of symptoms, vitals, diagnosis, and prescribed medications, all taken from the doctor's dictation.
  - [ ] Keep it faster than paper: one-tap templates for common cases, quick-pick buttons for missing fields, and review by exception (one-tap Approve when nothing is flagged). Measure doctor time per patient.
  - [ ] Work offline: local database for registration, history, and printing; queue dictation audio and send it when the network returns; manual entry as the fallback. The UI never waits on the network.
  - [ ] Check the draft against the patient's history and flag: allergy conflicts, drug interactions, dose limits, missing details (dose, frequency, duration), and PHC stock for each prescribed medicine.
  - [ ] Show the draft to the doctor for review and correction; the doctor clicks Approve.
  - [ ] Generate a printable report (PDF): doctor's name and registration number, report and prescription in English, a patient-language section with a morning / afternoon / night dose schedule, and a signature line. The doctor signs the printout.
  - [ ] Only after approval: send the WhatsApp message (text, voice, or both), deduct stock, add the visit to the patient's history, and log the approval.
  - *Deferred: handwritten prescription OCR is out of scope.*

- [ ] **Task 3.2: Clinical Decision Support System (CDSS) Agent**
  - [ ] Implement background agent to cross-reference new patient records with historical data.
  - [ ] Build alert mechanism for drug-drug interactions, drug-allergy warnings, and chronic disease progression (e.g., uncontrolled hypertension). Alerts are warnings, not blocks: the doctor can proceed after entering a short reason, which is logged.
  - [ ] *(Future)* Configure differential diagnosis suggestions for PHC doctors with confidence scores and literature citations. Show them only when the doctor asks, and after the doctor has entered their own impression, so the AI does not anchor the doctor's judgment.

- [ ] **Task 3.3: PHC Outbreak & Cluster Anomaly Detection Agent**
  - [ ] Build real-time streaming agent monitoring daily symptom frequency across PHC consultation logs.
  - [ ] Implement spatial-temporal clustering algorithm (e.g., DBSCAN or Moving Average Spikes) to detect localized illness surges (e.g., fever/diarrhea clusters).
  - [ ] Create automatic alert trigger to notify the PHC Medical Officer when a threshold is breached.

- [ ] **Task 3.4: Automated HMIS Reporting Agent**
  - [ ] Map PHC EHR data fields to national Health Management Information System (HMIS) monthly reporting forms.
  - [ ] Build agent to auto-aggregate indicators (e.g., ANC visits, immunization coverage, TB screening) and draft HMIS submissions.
  - [ ] Add Human-in-the-Loop (HITL) approval dashboard for Medical Officers before report submission.

---

## Phase 4: Population Health & Logistics Agents (District Tier)

- [ ] **Task 4.1: District Disease Surveillance Agent**
  - [ ] Implement data ingestion pipeline gathering anonymized feeds from all PHCs under the district.
  - [ ] Develop epidemic modeling agent tracking effective reproduction rate ($R_t$) and vector-borne outbreak risks.
  - [ ] Build geospatial visualization dashboard (heatmaps) for District Health Officers showing active infection zones.

- [ ] **Task 4.2: PHC/CHC Inventory & Indent Agent** *(in demo)*
  - [ ] Build inventory screens for the PHC and the CHC: medicine, current stock, batch, expiry, average daily use, days of stock left, and status (OK / Low / Reorder / Near expiry).
  - [ ] Reduce stock automatically when the doctor approves a prescription (links Loop 1 to Loop 2).
  - [ ] Calculate requirements with a plain formula, not an LLM:
    - Daily use = the higher of the 7-day and 90-day averages, so surges are picked up quickly.
    - Adjusted daily use = daily use × seasonal multiplier (set per medicine by the Medical Officer, e.g., ORS × 1.5 in June–September; default 1.0).
    - Reorder point = adjusted daily use × lead time + safety stock.
    - Indent quantity = enough to cover the next cycle (e.g., 30 days of adjusted use) minus current stock.
  - [ ] Surge flag: when 7-day use exceeds 1.5 × the 90-day average, alert the Medical Officer and mention it in the indent note.
  - [ ] Work offline: indents are queued locally and sent when the network returns.
  - [ ] Agent trigger: when stock falls to the reorder point, or at the monthly indent cycle, the agent drafts an indent to the next level up (PHC → CHC, CHC → district warehouse).
  - [ ] Use Gemini only to write a short justification note (e.g., "Paracetamol: 5 days left at current use; fever cases up this week"). All numbers come from the calculation.
  - [ ] HITL: the PHC Medical Officer (or CHC in-charge) approves or edits the indent before it is sent. Nothing is sent automatically.
  - [ ] Delivery: approved indents appear in the CHC's inbox in the app, with an optional WhatsApp/email notification to a demo number.
  - [ ] Flag near-expiry batches and suggest using them first or transferring them to a facility that uses more.
  - *Future: forecasting from disease trends, vaccines and diagnostic kits, district-wide re-allocation, integration with e-Aushadhi / DVDMS.*

---

## Phase 5: Multi-Agent Orchestration, Guardrails & Safety

- [ ] **Task 5.1: Agent Framework Setup**
  - [ ] Choose and implement orchestration framework (LangGraph / CrewAI / AutoGen).
  - [ ] Define persistent memory management (short-term execution memory + long-term vector storage via Pinecone/Qdrant).
  - [ ] Implement state transition graphs connecting Patient, PHC, and District agent workflows.

- [ ] **Task 5.2: Medical Guardrails & Safety Execution**
  - [ ] Integrate Guardrails AI / NeMo Guardrails to block unverified medical advice and hallucinated dosages.
  - [ ] Require all clinical content to come from the doctor or from cited clinical guidelines; the model only rewords approved content. (No LLM can guarantee zero hallucination, so the doctor's approval is the real safeguard.)
  - [ ] Establish Human-in-the-Loop (HITL) checkpoints: *No prescription or referral can be finalized without registered doctor approval.*

- [ ] **Task 5.3: Auditability & Lineage Tracking**
  - [ ] Build trace logger capturing input prompts, tool calls, model outputs, and clinical verification timestamps.
  - [ ] Construct provenance graph mapping every district-level alert back to its source anonymized PHC data points.

---

## Phase 6: System Testing, Validation & Pilot Deployment

- [ ] **Task 6.1: Multi-Dialect Vernacular Evaluation**
  - [ ] Test STT and clinical translation accuracy with real sample audio from Hindi-speaking states and Tamil Nadu.
  - [ ] Verify SNOMED-CT mapping accuracy on 500+ Hindi and Tamil symptom descriptions.

- [ ] **Task 6.2: Outbreak Simulation & Agent Load Testing**
  - [ ] Simulate synthetic outbreak scenario (e.g., 200 synthetic Dengue records in 3 villages over 48 hours).
  - [ ] Validate that PHC Anomaly Agent fires alert and District Surveillance Agent generates correct heatmap.
  - [ ] Benchmark supply chain agent re-allocation proposals under simulated stockout conditions.

- [ ] **Task 6.3: ABDM Sandbox Certification & Pilot Rollout**
  - [ ] Complete ABDM compliance checklist and API sandbox verification.
  - [ ] Deploy pilot at 1 PHC with 5 sub-centers and 10 ASHA workers.
  - [ ] Gather feedback on ASHA voice interaction usability and PHC doctor time savings.

---

## Phase 7: Biometric Identification

- [ ] **Task 7.0: Local Fingerprint Patient Identification** *(final review)*
  - [ ] Enrol a fingerprint at the patient's first visit; on later visits, a scan at the desk finds the patient and opens their history on the doctor's screen.
  - [ ] Our own matching only: no Aadhaar and no UIDAI. The fingerprint is never linked to an Aadhaar number.
  - [ ] Hardware: a USB fingerprint scanner whose SDK supports local enrol-and-match without the Aadhaar RD service, or a low-cost optical module (e.g., R307) that does matching on-chip, connected by USB-serial. Phone fingerprint sensors can't be used, because Android and iOS only confirm the phone's owner and never give apps the fingerprint.
  - [ ] Store only the encrypted fingerprint template, never the image. Keep it on the PHC machine and never send it to any cloud API.
  - [ ] Consent and choice: explain the purpose, record explicit consent (DPDP Act), and never make it mandatory. Patients who decline, or whose fingerprints don't scan (worn fingers, elderly patients), are found by phone number instead.
  - [ ] Use case to highlight: migrant workers who change SIM cards still keep one record.
  - *Limit: on-chip modules hold about 1,000 templates; a real PHC would need matching on the computer.*

*Tasks 7.1–7.4 below are long-term future scope. Anything that talks to UIDAI needs an AUA/KUA licence, so they are not feasible for this project.*

- [ ] **Task 7.1: UIDAI L1 Biometric Sensor Middleware Integration**
  - [ ] Integrate Registered Device (RD) Service APIs for hardware compatibility (Mantra MFS110, Morpho).
  - [ ] Build Android/Windows hardware driver wrappers for seamless tablet and kiosk deployment.

- [ ] **Task 7.2: Biometric Identification & ABHA Auto-Lookup**
  - [ ] Link biometric fingerprint capture directly to ABDM OAuth & UIDAI CIDR authentication endpoints.
  - [ ] Implement auto-fetch logic to load patient ABHA records immediately upon successful fingerprint scan.

- [ ] **Task 7.3: Healthcare Provider Biometric RBAC**
  - [ ] Require fingerprint verification for healthcare staff (Doctors, ANMs, ASHA workers) before signing prescriptions or approving AI agent actions.
  - [ ] Add cryptographic signing of provider biometric verifications into the database audit trail.

- [ ] **Task 7.4: Multimodal Authentication Fallbacks**
  - [ ] Implement Iris Scanning integration for patients with worn or unscanable fingerprints (e.g., manual laborers, elderly).
  - [ ] Integrate Aadhaar Face Authentication via mobile device cameras as a non-contact fallback mechanism.

---

## 🛠️ Technology Stack Summary

| Domain | Selected Tools / Frameworks |
| :--- | :--- |
| **Agent Framework** | LangGraph / CrewAI |
| **EHR & Standards** | HL7 FHIR R4, SNOMED-CT, ICD-10, ABDM APIs |
| **Vernacular Speech & Text** | Hindi + Tamil via Sarvam AI (primary): Saaras STT, Bulbul v3 TTS, Sarvam Translate / Mayura (fallback). Gemini API for plain-language patient advice. Bhashini / IndicWhisper as fallback and benchmark baseline |
| **Vector DB / RAG** | Qdrant / Pinecone + Indian National Health Guidelines |
| **Guardrails & Safety** | Guardrails AI, NeMo Guardrails, Custom HITL Middleware |
| **Biometric Hardware** | Final review: USB fingerprint scanner with local-matching SDK, or R307 optical module (local matching, no Aadhaar). Long-term: Mantra MFS110, Morpho, UIDAI RD Service APIs, Iris/Face Auth |
| **Backend & Database** | FastAPI, PostgreSQL (PostGIS for Spatial Data), Redis |
