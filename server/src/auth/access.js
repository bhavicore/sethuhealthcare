import crypto from 'node:crypto';
import { db, logAudit } from '../db.js';

// ---------------------------------------------------------------------------
// Who can do what, where.
//
// A user holds ASSIGNMENTS (role + facility + validity). Each role lists:
//   - `here`:     permissions at the assigned facility only
//   - `cascade`:  permissions at the assigned facility AND every facility below
//                 it in the tree (district → CHC → PHC)
// Identifiable patient data is only ever `here`. Anything that cascades is
// totals-only (aggregate dashboards, stock, indents) — so a CHC in-charge or
// District Health Officer never sees a PHC's patients unless the patient is
// referred to their facility (see patientFacilities()).
// ---------------------------------------------------------------------------

const DOCTOR = ['patient:lookup', 'patient:read', 'encounter:write', 'referral:create', 'inventory:read'];

export const ROLES = {
  desk: {
    label: 'Registration desk',
    here: ['patient:lookup', 'patient:register', 'patient:consent'],
    cascade: [],
  },
  doctor: {
    label: 'Doctor',
    here: DOCTOR,
    cascade: [],
  },
  pharmacist: {
    label: 'Pharmacist',
    here: ['inventory:read'],
    cascade: [],
  },
  phc_mo: {
    label: 'Medical Officer (in-charge)',
    here: [...DOCTOR, 'patient:register', 'patient:consent', 'dashboard:read', 'indent:create', 'staff:read', 'audit:read'],
    cascade: [],
  },
  chc_incharge: {
    label: 'CHC in-charge',
    here: [...DOCTOR, 'dashboard:read', 'indent:create', 'indent:receive', 'staff:read', 'audit:read'],
    cascade: ['dashboard:aggregate', 'inventory:read', 'indent:read'],
  },
  dho: {
    label: 'District Health Officer',
    here: [],
    cascade: ['dashboard:aggregate', 'inventory:read', 'indent:read', 'staff:read'],
  },
  admin: {
    label: 'System admin',
    here: [],
    cascade: ['staff:read'], // accounts and facilities only — no clinical data
  },
};

// Plain-language scope, shown on the Access screen.
export const SCOPE_TEXT = {
  desk: 'This facility: register and look up patients',
  doctor: 'This facility: patient records, consultations, referrals',
  pharmacist: 'This facility: stock only',
  phc_mo: 'This facility: everything, plus dashboard and indents',
  chc_incharge: 'This CHC + referred patients; totals only for PHCs below',
  dho: 'Whole district, totals only — no patient records',
  admin: 'Staff accounts only — no clinical data',
};

const SESSION_HOURS = 12; // one shift
const MAX_FAILED = 5;
const LOCK_MINUTES = 5;

// --- facility tree -----------------------------------------------------------

function allFacilities() {
  return db.prepare('SELECT * FROM facilities').all();
}

/** The facility itself plus everything below it. */
export function facilityAndDescendants(facilityId) {
  const facilities = allFacilities();
  const out = [facilityId];
  for (let i = 0; i < out.length; i++) {
    for (const f of facilities) if (f.parent_id === out[i]) out.push(f.id);
  }
  return out;
}

export function getFacility(id) {
  return db.prepare('SELECT * FROM facilities WHERE id = ?').get(id) || null;
}

// --- PINs & sessions -----------------------------------------------------------

export function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pin), salt, 32).toString('hex') };
}

function pinMatches(pin, user) {
  const { hash } = hashPin(pin, user.pin_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.pin_hash, 'hex'));
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

export function activeAssignments(userId) {
  const now = nowIso();
  return db
    .prepare(
      `SELECT a.*, f.name AS facility_name, f.type AS facility_type FROM assignments a
       JOIN facilities f ON f.id = a.facility_id
       WHERE a.user_id = ? AND a.valid_from <= ? AND (a.valid_to IS NULL OR a.valid_to > ?)
       ORDER BY a.id`
    )
    .all(userId, now, now);
}

/** Verify a PIN and open a session. Returns { token, ... } or { error, status }. */
export function login(userId, pin) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || user.status !== 'active') return { status: 401, error: 'Unknown or disabled account.' };
  if (user.locked_until && user.locked_until > nowIso()) {
    return { status: 423, error: `Too many wrong PINs. Try again after ${new Date(user.locked_until).toLocaleTimeString('en-IN')}.` };
  }
  if (!/^\d{4,6}$/.test(String(pin || '')) || !pinMatches(pin, user)) {
    const failed = user.failed_attempts + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    logAudit(user.id, 'login-failed', 'user', user.id, { locked: Boolean(lock) });
    return { status: 401, error: lock ? `Too many wrong PINs — locked for ${LOCK_MINUTES} minutes.` : 'Wrong PIN.' };
  }
  const assignments = activeAssignments(user.id);
  if (!assignments.length) return { status: 403, error: 'No active assignment — ask your Medical Officer.' };

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, assignment_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), user.id, assignments[0].id, new Date(Date.now() + SESSION_HOURS * 3600000).toISOString());
  logAudit(user.id, 'login', 'user', user.id, { assignment: assignments[0].id });
  return { token };
}

export function logout(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function switchAssignment(auth, assignmentId) {
  const target = activeAssignments(auth.user.id).find((a) => a.id === Number(assignmentId));
  if (!target) return false;
  db.prepare('UPDATE sessions SET assignment_id = ? WHERE token_hash = ?').run(target.id, auth.tokenHash);
  logAudit(auth.user.id, 'switch-facility', 'user', auth.user.id, { assignment: target.id });
  return true;
}

// --- the check ---------------------------------------------------------------

/** Does this user hold `permission` at `facilityId` through any active assignment? */
export function can(auth, permission, facilityId) {
  if (!auth || !facilityId) return false;
  return auth.assignments.some((a) => {
    const role = ROLES[a.role];
    if (!role) return false;
    if (a.facility_id === facilityId && role.here.includes(permission)) return true;
    return role.cascade.includes(permission) && facilityAndDescendants(a.facility_id).includes(facilityId);
  });
}

/** Facilities a patient's record is visible at: where registered, treated, or referred to. */
export function patientFacilities(patientId) {
  const p = db.prepare('SELECT registered_facility_id FROM patients WHERE id = ?').get(patientId);
  if (!p) return [];
  const treated = db.prepare('SELECT DISTINCT facility_id FROM encounters WHERE patient_id = ?').all(patientId).map((r) => r.facility_id);
  const referred = db.prepare('SELECT DISTINCT to_facility FROM referrals WHERE patient_id = ?').all(patientId).map((r) => r.to_facility);
  return [...new Set([p.registered_facility_id, ...treated, ...referred].filter(Boolean))];
}

/**
 * Patient-level access is judged at the user's ACTIVE facility: the patient
 * must be linked to it (registered, treated, or referred there) and the user
 * must hold the permission there. Never cascades.
 */
export function canForPatient(auth, permission, patientId) {
  return patientFacilities(patientId).includes(auth.facilityId) && can(auth, permission, auth.facilityId);
}

/** Express middleware: resolve the bearer token to a user + active assignment. */
export function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  const tokenHash = sha256(token);
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
  if (!session || session.expires_at <= nowIso()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return res.status(401).json({ error: 'Session expired — please log in again.' });
  }
  const user = db.prepare("SELECT id, name, reg_no, status, biometric_enrolled_at FROM users WHERE id = ? AND status = 'active'").get(session.user_id);
  const assignments = user ? activeAssignments(user.id) : [];
  const active = assignments.find((a) => a.id === session.assignment_id);
  if (!user || !active) return res.status(401).json({ error: 'Your access has changed — please log in again.' });
  req.auth = { user, assignments, assignment: active, facilityId: active.facility_id, tokenHash };
  next();
}

/** Route guard for facility-scoped permissions. `facilityOf(req)` names the facility the request touches. */
export function requirePermission(permission, facilityOf = (req) => req.auth.facilityId) {
  return (req, res, next) => {
    const facilityId = facilityOf(req);
    if (!can(req.auth, permission, facilityId)) {
      logAudit(req.auth.user.id, 'access-denied', 'facility', facilityId || '', { permission, path: req.path });
      return res.status(403).json({ error: "You don't have access to this for that facility." });
    }
    next();
  };
}

/** Name for the audit trail: always the logged-in account, never a typed name. */
export const actorOf = (req) => `${req.auth.user.name} [${req.auth.user.id}]`;

/** What the app needs to shape its menus for this session. */
export function describeSession(auth) {
  const facilities = allFacilities();
  const name = (id) => facilities.find((f) => f.id === id)?.name || id;
  const here = (perm) => can(auth, perm, auth.facilityId);

  // Dashboards: identifiable where the user holds dashboard:read, totals-only where it cascades.
  const dashboards = [];
  for (const f of facilities) {
    if (can(auth, 'dashboard:read', f.id)) dashboards.push({ id: f.id, name: f.name, type: f.type, mode: 'full' });
    else if (can(auth, 'dashboard:aggregate', f.id)) dashboards.push({ id: f.id, name: f.name, type: f.type, mode: 'totals' });
  }
  const order = { district: 0, chc: 1, phc: 2 };
  dashboards.sort((a, b) => (a.id === auth.facilityId ? -1 : b.id === auth.facilityId ? 1 : order[a.type] - order[b.type]));

  return {
    user: { id: auth.user.id, name: auth.user.name, regNo: auth.user.reg_no, biometricEnrolled: Boolean(auth.user.biometric_enrolled_at) },
    active: {
      assignmentId: auth.assignment.id,
      role: auth.assignment.role,
      roleLabel: ROLES[auth.assignment.role]?.label || auth.assignment.role,
      facilityId: auth.facilityId,
      facilityName: name(auth.facilityId),
      facilityType: auth.assignment.facility_type,
      parentFacilityId: facilities.find((f) => f.id === auth.facilityId)?.parent_id || null,
      parentFacilityName: name(facilities.find((f) => f.id === auth.facilityId)?.parent_id),
    },
    assignments: auth.assignments.map((a) => ({
      id: a.id, role: a.role, roleLabel: ROLES[a.role]?.label || a.role, facilityId: a.facility_id, facilityName: a.facility_name,
    })),
    can: {
      desk: here('patient:register'), // doctors look patients up from their own console
      doctor: here('encounter:write'),
      inventory: facilities.some((f) => f.type !== 'district' && can(auth, 'inventory:read', f.id)),
      indentInbox: here('indent:receive'),
      dashboard: dashboards.length > 0,
      access: facilities.some((f) => can(auth, 'staff:read', f.id)),
      referralLegacy: here('encounter:write'),
    },
    dashboards,
    inventoryFacilities: facilities
      .filter((f) => f.type !== 'district' && can(auth, 'inventory:read', f.id))
      .map((f) => ({ id: f.id, name: f.name, canIndent: can(auth, 'indent:create', f.id) })),
  };
}
