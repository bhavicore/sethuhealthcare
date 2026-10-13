import { Router } from 'express';
import { db } from '../db.js';
import {
  ROLES, SCOPE_TEXT, authenticate, can, describeSession, login, logout, switchAssignment, activeAssignments,
} from '../auth/access.js';

export const authRouter = Router();

/**
 * Staff list for the login screen (name + where they work), so a clinic
 * device can show "pick your name, enter your PIN". Contains no patient data.
 */
authRouter.get('/staff', (req, res) => {
  const users = db.prepare("SELECT id, name FROM users WHERE status = 'active' ORDER BY name").all();
  res.json({
    staff: users
      .map((u) => ({
        id: u.id,
        name: u.name,
        roles: activeAssignments(u.id).map((a) => `${ROLES[a.role]?.label || a.role} · ${a.facility_name}`),
      }))
      .filter((u) => u.roles.length),
  });
});

authRouter.post('/login', (req, res) => {
  const { userId, pin } = req.body || {};
  const result = login(userId, pin);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ token: result.token });
});

authRouter.post('/logout', authenticate, (req, res) => {
  logout((req.get('authorization') || '').slice(7));
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json(describeSession(req.auth));
});

authRouter.post('/switch', authenticate, (req, res) => {
  if (!switchAssignment(req.auth, req.body?.assignmentId)) return res.status(403).json({ error: 'Not one of your active assignments.' });
  res.json({ ok: true });
});

/** Staff and their assignments, limited to the facilities this user may see staff for. */
authRouter.get('/assignments', authenticate, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.role, a.facility_id, a.valid_from, a.valid_to, a.granted_by,
              u.id AS user_id, u.name, u.reg_no, u.biometric_enrolled_at, f.name AS facility_name, f.type AS facility_type
       FROM assignments a JOIN users u ON u.id = a.user_id JOIN facilities f ON f.id = a.facility_id
       ORDER BY f.type, f.name, u.name`
    )
    .all()
    .filter((r) => can(req.auth, 'staff:read', r.facility_id));
  res.json({
    assignments: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      regNo: r.reg_no,
      role: r.role,
      roleLabel: ROLES[r.role]?.label || r.role,
      scope: SCOPE_TEXT[r.role] || '',
      facilityId: r.facility_id,
      facilityName: r.facility_name,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      grantedBy: r.granted_by,
      biometricEnrolled: Boolean(r.biometric_enrolled_at),
    })),
  });
});
