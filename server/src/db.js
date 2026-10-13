import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SETHU_DB_PATH || path.join(__dirname, '..', 'sethu.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// Referral-bridge schema (Loop 0 — the original QR referral demo)
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    server_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id      TEXT UNIQUE NOT NULL,
    name          TEXT,
    age           TEXT,
    gender        TEXT,
    abha_id       TEXT,
    facility      TEXT,
    symptoms      TEXT,
    diagnosis     TEXT,
    medications   TEXT,
    allergies     TEXT,
    notes         TEXT,
    created_at    TEXT,
    received_at   TEXT NOT NULL DEFAULT (datetime('now')),
    origin        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_visits_abha ON visits (abha_id);
`);

const insertStmt = db.prepare(`
  INSERT INTO visits (
    local_id, name, age, gender, abha_id, facility,
    symptoms, diagnosis, medications, allergies, notes, created_at, origin
  ) VALUES (
    @localId, @name, @age, @gender, @abhaId, @facility,
    @symptoms, @diagnosis, @medications, @allergies, @notes, @createdAt, @origin
  )
  ON CONFLICT(local_id) DO NOTHING
`);

const findByLocalIdStmt = db.prepare('SELECT server_id FROM visits WHERE local_id = ?');
const findByAbhaStmt = db.prepare('SELECT * FROM visits WHERE abha_id = ? ORDER BY received_at DESC');
const listStmt = db.prepare('SELECT * FROM visits ORDER BY received_at DESC LIMIT ?');

/** Upsert-by-localId so a client retrying a sync (e.g. after a dropped connection) never duplicates a visit. */
export function upsertVisit(visit) {
  insertStmt.run({
    localId: visit.localId,
    name: visit.name ?? null,
    age: visit.age != null ? String(visit.age) : null,
    gender: visit.gender ?? null,
    abhaId: visit.abhaId || null,
    facility: visit.facility ?? null,
    symptoms: visit.symptoms ?? null,
    diagnosis: visit.diagnosis ?? null,
    medications: visit.medications ?? null,
    allergies: visit.allergies ?? null,
    notes: visit.notes ?? null,
    createdAt: visit.createdAt ?? null,
    origin: visit.origin ?? 'phc',
  });
  return findByLocalIdStmt.get(visit.localId).server_id;
}

export function findVisitsByAbha(abhaId) {
  return findByAbhaStmt.all(abhaId);
}

export function listRecentVisits(limit = 100) {
  return listStmt.all(limit);
}

// ---------------------------------------------------------------------------
// Consultation + Inventory schema (Loop 1 / Loop 2 — task.md)
// Synthetic demo data only. See server/src/seed.js.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS facilities (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,          -- 'phc' | 'chc'
    parent_id   TEXT REFERENCES facilities(id)
  );

  CREATE TABLE IF NOT EXISTS medicines (
    id                TEXT PRIMARY KEY,  -- generic slug, e.g. 'paracetamol'
    generic_name      TEXT NOT NULL,
    unit_label        TEXT NOT NULL,     -- e.g. '500 mg tablet'
    max_daily_dose_mg REAL,              -- null = no simple daily-dose ceiling (e.g. ORS)
    nlem_code         TEXT
  );

  CREATE TABLE IF NOT EXISTS brand_generic (
    brand     TEXT PRIMARY KEY COLLATE NOCASE,
    medicine_id TEXT NOT NULL REFERENCES medicines(id)
  );

  CREATE TABLE IF NOT EXISTS abbreviations (
    abbrev    TEXT PRIMARY KEY COLLATE NOCASE,
    expansion TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS allergy_classes (
    medicine_id TEXT NOT NULL REFERENCES medicines(id),
    class       TEXT NOT NULL,           -- e.g. 'penicillin'
    PRIMARY KEY (medicine_id, class)
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_a    TEXT NOT NULL,             -- medicine id or allergy-class-style generic name
    drug_b    TEXT NOT NULL,
    severity  TEXT NOT NULL,             -- 'major' | 'moderate' | 'minor'
    note      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS patients (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    age                 INTEGER,
    gender              TEXT,
    phone               TEXT UNIQUE,
    language            TEXT NOT NULL DEFAULT 'hi',   -- 'hi' | 'ta' | 'en'
    message_format      TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'voice' | 'both'
    whatsapp_consent    INTEGER NOT NULL DEFAULT 0,
    whatsapp_window_opened_at TEXT,
    allergies           TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings, verbatim as recorded
    chronic_conditions  TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    origin              TEXT NOT NULL DEFAULT 'live'   -- 'live' | 'synthetic'
  );

  CREATE TABLE IF NOT EXISTS encounters (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id          TEXT NOT NULL REFERENCES patients(id),
    facility_id         TEXT NOT NULL REFERENCES facilities(id),
    doctor_name         TEXT,
    doctor_reg_no       TEXT,
    chief_complaint     TEXT,
    dictation_raw       TEXT,
    dictation_lang      TEXT,
    normalized_text     TEXT,
    vitals              TEXT DEFAULT '{}',   -- JSON
    diagnosis           TEXT,
    medications         TEXT DEFAULT '[]',   -- JSON array
    warnings            TEXT DEFAULT '[]',   -- JSON array, as drafted
    override_reasons    TEXT DEFAULT '[]',   -- JSON array, doctor's reasons for proceeding past warnings
    advice_english      TEXT,
    advice_patient_lang TEXT,
    status              TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'approved'
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at         TEXT,
    approved_by         TEXT,
    origin              TEXT NOT NULL DEFAULT 'live'   -- 'live' (recorded in the app) | 'synthetic' (seed.js history)
  );

  CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters (patient_id);

  CREATE TABLE IF NOT EXISTS inventory (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id   TEXT NOT NULL REFERENCES facilities(id),
    medicine_id   TEXT NOT NULL REFERENCES medicines(id),
    batch_no      TEXT NOT NULL,
    expiry_date   TEXT NOT NULL,
    stock_qty     REAL NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inventory_facility_medicine ON inventory (facility_id, medicine_id);

  CREATE TABLE IF NOT EXISTS usage_history (
    facility_id   TEXT NOT NULL REFERENCES facilities(id),
    medicine_id   TEXT NOT NULL REFERENCES medicines(id),
    date          TEXT NOT NULL,        -- 'YYYY-MM-DD'
    qty_used      REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (facility_id, medicine_id, date)
  );

  CREATE TABLE IF NOT EXISTS medicine_facility_settings (
    facility_id        TEXT NOT NULL REFERENCES facilities(id),
    medicine_id        TEXT NOT NULL REFERENCES medicines(id),
    seasonal_multiplier REAL NOT NULL DEFAULT 1.0,
    surge_months       TEXT NOT NULL DEFAULT '[]', -- JSON array of month numbers (1-12) set by the MO
    lead_time_days     REAL NOT NULL DEFAULT 3,
    safety_stock_days  REAL NOT NULL DEFAULT 3,
    cycle_days         REAL NOT NULL DEFAULT 30,
    PRIMARY KEY (facility_id, medicine_id)
  );

  CREATE TABLE IF NOT EXISTS indents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_facility   TEXT NOT NULL REFERENCES facilities(id),
    to_facility     TEXT NOT NULL REFERENCES facilities(id),
    medicine_id     TEXT NOT NULL REFERENCES medicines(id),
    qty             REAL NOT NULL,
    justification   TEXT,
    surge_flag      INTEGER NOT NULL DEFAULT 0,
    near_expiry_note TEXT,
    status          TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'approved' | 'sent' | 'rejected'
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    approved_by     TEXT,
    approved_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    actor       TEXT,
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT,
    detail      TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS whatsapp_outbox (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id   TEXT NOT NULL REFERENCES patients(id),
    encounter_id INTEGER REFERENCES encounters(id),
    kind         TEXT NOT NULL,   -- 'voice' | 'text'
    payload      TEXT NOT NULL,   -- JSON: { text } or { audioPath, text }
    status       TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'sent' | 'mocked'
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Staff access (see server/src/auth/access.js for how these are checked).
// A person gets ASSIGNMENTS — role + facility + validity — never blanket access.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    reg_no           TEXT,                          -- medical council registration (doctors)
    pin_hash         TEXT NOT NULL,                 -- scrypt(PIN, salt); the PIN itself is never stored
    pin_salt         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
    failed_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until     TEXT,
    biometric_enrolled_at TEXT,                     -- future (Task 7.3): set when a local fingerprint template is enrolled
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES users(id),
    role         TEXT NOT NULL,                     -- key of ROLES in auth/access.js
    facility_id  TEXT NOT NULL REFERENCES facilities(id),
    valid_from   TEXT NOT NULL DEFAULT (datetime('now')),
    valid_to     TEXT,                              -- null = open-ended
    granted_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash    TEXT PRIMARY KEY,                 -- sha256 of the bearer token; the token itself is never stored
    user_id       TEXT NOT NULL REFERENCES users(id),
    assignment_id INTEGER NOT NULL REFERENCES assignments(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at    TEXT NOT NULL
  );

  -- A referral is what gives another facility access to a patient's record.
  CREATE TABLE IF NOT EXISTS referrals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id    TEXT NOT NULL REFERENCES patients(id),
    from_facility TEXT NOT NULL REFERENCES facilities(id),
    to_facility   TEXT NOT NULL REFERENCES facilities(id),
    reason        TEXT,
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_referrals_patient ON referrals (patient_id);

  -- Desk → doctor hand-off: the desk queues a patient, the doctor picks them up.
  CREATE TABLE IF NOT EXISTS visit_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id   TEXT NOT NULL REFERENCES patients(id),
    facility_id  TEXT NOT NULL REFERENCES facilities(id),
    status       TEXT NOT NULL DEFAULT 'waiting',  -- 'waiting' | 'seen'
    created_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Columns added after the first release: add them in place on older databases.
function addColumnIfMissing(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('patients', 'origin', "TEXT NOT NULL DEFAULT 'live'");
addColumnIfMissing('encounters', 'origin', "TEXT NOT NULL DEFAULT 'live'");
addColumnIfMissing('patients', 'registered_facility_id', 'TEXT REFERENCES facilities(id)'); // where the patient was registered
db.exec('CREATE INDEX IF NOT EXISTS idx_encounters_facility_created ON encounters (facility_id, created_at)');

export function logAudit(actor, action, entity, entityId, detail = {}) {
  db.prepare(
    'INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(actor || 'system', action, entity, String(entityId ?? ''), JSON.stringify(detail));
}

export function listAudit({ entity, entityId, limit = 200 } = {}) {
  if (entity && entityId != null) {
    return db
      .prepare('SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT ?')
      .all(entity, String(entityId), limit);
  }
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}
