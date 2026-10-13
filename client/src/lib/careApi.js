import { API_BASE } from './sync';
import { authToken, clearSession } from './auth';

async function request(path, options = {}, { base = '/api/care', token = authToken() } = {}) {
  const res = await fetch(`${API_BASE}${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) clearSession(); // expired or revoked — back to the login screen
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * The server stores SQLite datetime('now') values ("YYYY-MM-DD HH:MM:SS",
 * UTC, no zone) alongside ISO strings from the seed. Browsers read the
 * former as local time, so parse both as UTC before displaying.
 */
export function parseDbDate(value) {
  if (!value) return null;
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const post = (body) => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export const authApi = {
  staff: () => request('/staff', {}, { base: '/api/auth', token: null }),
  login: (userId, pin) => request('/login', post({ userId, pin }), { base: '/api/auth', token: null }),
  me: (token) => request('/me', {}, { base: '/api/auth', token: token || authToken() }),
  logout: () => request('/logout', post(), { base: '/api/auth' }),
  switchAssignment: (assignmentId) => request('/switch', post({ assignmentId }), { base: '/api/auth' }),
  assignments: () => request('/assignments', {}, { base: '/api/auth' }),
};

export const careApi = {
  config: () => request('/config'),
  facilities: () => request('/facilities'),

  registerPatient: (payload) => request('/patients/register', post(payload)),
  lookupPatient: (phone) => request(`/patients/lookup?phone=${encodeURIComponent(phone)}`),
  patientHistory: (patientId) => request(`/patients/${patientId}/history`),
  confirmWhatsapp: (patientId) => request(`/patients/${patientId}/whatsapp-consent`, post()),
  referPatient: (patientId, reason) => request(`/patients/${patientId}/referrals`, post({ reason })),

  queuePatient: (patientId) => request('/queue', post({ patientId })),
  queue: () => request('/queue'),

  draftEncounter: (payload) => request('/encounters/draft', post(payload)),
  approveEncounter: (payload) => request('/encounters/approve', post(payload)),
  getEncounter: (id) => request(`/encounters/${id}`),

  transcribe: (payload) => request('/stt', post(payload)),
  routeDictation: (text, patientId) => request('/dictation/route', post({ text, patientId })),

  dashboard: (facilityId, days) => request(`/dashboard/${facilityId}?days=${days}`),
  inventory: (facilityId) => request(`/inventory/${facilityId}`),
  draftIndent: (facilityId, medicineId) => request(`/inventory/${facilityId}/indents/draft`, post({ medicineId })),
  createIndent: (payload) => request('/indents', post(payload)),
  listIndents: (facility, direction) => request(`/indents?facility=${facility}&direction=${direction}`),
  approveIndent: (id, payload) => request(`/indents/${id}/approve`, post(payload)),
  rejectIndent: (id, payload) => request(`/indents/${id}/reject`, post(payload)),
};
