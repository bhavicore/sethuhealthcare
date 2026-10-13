import { db } from '../db.js';
import { listInventory } from './inventory.js';
import { parseDbDate } from './summary.js';
import { facilityAndDescendants } from '../auth/access.js';

// Clinic-level dashboard for the PHC Medical Officer. Plain aggregation over
// approved encounters — no model involved. Days are counted in IST (the
// facility's local time), so "today" means the clinic's today, not UTC's.

const IST_OFFSET_MS = 330 * 60000;
const istDateKey = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const istHour = (d) => new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();

const AGE_BANDS = [
  { label: '0–5', max: 5 },
  { label: '6–17', max: 17 },
  { label: '18–39', max: 39 },
  { label: '40–59', max: 59 },
  { label: '60+', max: Infinity },
];

const WARNING_TYPE_LABEL = {
  allergy: 'Allergy conflict',
  interaction: 'Drug interaction',
  'dose-limit': 'Dose above ceiling',
  duplicate: 'Same medicine twice',
  spelling: 'Misheard name (confirmed)',
  unmatched: 'Medicine not in list',
  'missing-detail': 'Missing dose / frequency / duration',
};

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key == null) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function topN(counts, n, labelFor = (k) => k) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n).map(([key, count]) => ({ label: labelFor(key), count }));
  const rest = sorted.slice(n).reduce((sum, [, c]) => sum + c, 0);
  return rest ? [...top, { label: `Other (${sorted.length - n})`, count: rest, other: true }] : top;
}

function loadVisits(facilityIds, fromDate) {
  const marks = facilityIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT e.id, e.patient_id, e.facility_id, e.created_at, e.diagnosis, e.medications, e.warnings, e.override_reasons,
              e.doctor_name, e.origin,
              p.name, p.age, p.gender, p.language, p.message_format, p.created_at AS registered_at
       FROM encounters e JOIN patients p ON p.id = e.patient_id
       WHERE e.facility_id IN (${marks}) AND e.status = 'approved' AND e.created_at >= ?`
    )
    .all(...facilityIds, fromDate.toISOString().slice(0, 10))
    .map((row) => ({ ...row, at: parseDbDate(row.created_at) }))
    .filter((row) => row.at);
}

/**
 * @param {string} facilityId  a clinic, or a district (combines every clinic below it)
 * @param {number} days  1 = today, else the last N days including today
 * @param {{identifiable?: boolean}} opts  false = totals only: no patient names or rows
 */
export function buildDashboard(facilityId, days = 30, { identifiable = true } = {}) {
  const facility = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facilityId);
  // A district view combines every clinic below it. A clinic view is just that
  // clinic (a CHC's own dashboard doesn't silently include its PHCs' visits).
  const facilityIds = facility?.type === 'district'
    ? facilityAndDescendants(facilityId).filter((id) => id !== facilityId)
    : [facilityId];
  const marks = facilityIds.map(() => '?').join(',');
  const now = new Date();
  const todayKey = istDateKey(now);
  // Window start: IST midnight N-1 days ago.
  const todayIstMidnight = new Date(Date.parse(`${todayKey}T00:00:00Z`) - IST_OFFSET_MS);
  const start = new Date(todayIstMidnight.getTime() - (days - 1) * 86400000);
  const prevStart = new Date(start.getTime() - days * 86400000);

  // Pull the previous period too, for the delta on the headline number.
  const all = loadVisits(facilityIds, new Date(prevStart.getTime() - 86400000));
  const visits = all.filter((v) => v.at >= start && v.at <= now);
  const prevVisits = all.filter((v) => v.at >= prevStart && v.at < start);

  // Time series: hourly for "today", daily otherwise (zero-filled).
  let series;
  if (days === 1) {
    const byHour = countBy(visits, (v) => istHour(v.at));
    series = Array.from({ length: 12 }, (_, i) => {
      const hour = 8 + i; // OPD window 08:00–19:59 IST
      return { key: `${String(hour).padStart(2, '0')}:00`, visits: byHour.get(hour) || 0 };
    });
  } else {
    const byDay = countBy(visits, (v) => istDateKey(v.at));
    series = Array.from({ length: days }, (_, i) => {
      const key = istDateKey(new Date(start.getTime() + i * 86400000 + IST_OFFSET_MS / 2));
      return { key, visits: byDay.get(key) || 0 };
    });
  }

  // Diagnoses are free text: group case-insensitively by exact wording and
  // show the most common spelling. Not coded (ICD-10 is future work).
  const dxGroups = new Map();
  for (const v of visits) {
    const raw = (v.diagnosis || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase().replace(/[.।]+$/, '');
    const g = dxGroups.get(key) || { count: 0, spellings: new Map() };
    g.count += 1;
    g.spellings.set(raw, (g.spellings.get(raw) || 0) + 1);
    dxGroups.set(key, g);
  }
  const dxCounts = new Map([...dxGroups].map(([k, g]) => [k, g.count]));
  const dxLabel = (k) => [...dxGroups.get(k).spellings].sort((a, b) => b[1] - a[1])[0][0];
  const noDiagnosis = visits.filter((v) => !(v.diagnosis || '').trim()).length;

  const medEntries = visits.flatMap((v) => JSON.parse(v.medications || '[]').map((m) => m.genericName || (m.generic ? m.generic : null)));
  const warningEntries = visits.flatMap((v) => JSON.parse(v.warnings || '[]'));
  const overrides = visits.reduce((n, v) => n + JSON.parse(v.override_reasons || '[]').length, 0);

  // Patient mix counts each patient once, among patients seen in the window.
  const seen = new Map();
  for (const v of visits) seen.set(v.patient_id, v);
  const seenPatients = [...seen.values()];
  const newPatients = seenPatients.filter((p) => {
    const reg = parseDbDate(p.registered_at);
    return reg && reg >= start;
  }).length;
  const prevUnique = new Set(prevVisits.map((v) => v.patient_id)).size;

  const facilityName = (id) => db.prepare('SELECT name FROM facilities WHERE id = ?').get(id)?.name || id;
  const stockAlerts = facilityIds
    .flatMap((fid) => listInventory(fid).map((r) => ({ ...r, facility: fid })))
    .filter((r) => r.stockStatus !== 'OK' || r.hasNearExpiry)
    .map((r) => ({
      medicine: r.medicine.generic_name,
      facility: facilityIds.length > 1 ? facilityName(r.facility) : null,
      status: r.stockStatus !== 'OK' ? r.stockStatus : 'Near expiry',
      nearExpiry: r.hasNearExpiry,
      daysLeft: Number.isFinite(r.daysOfStockLeft) ? Math.round(r.daysOfStockLeft * 10) / 10 : null,
      stock: r.currentStock,
      surge: r.surgeFlag,
    }))
    .sort((a, b) => ['Reorder', 'Low', 'Near expiry'].indexOf(a.status) - ['Reorder', 'Low', 'Near expiry'].indexOf(b.status));

  const indentStats = db
    .prepare(`SELECT status, COUNT(*) AS n FROM indents WHERE from_facility IN (${marks}) GROUP BY status`)
    .all(...facilityIds);

  // WhatsApp outcomes for visits at these facilities (audit rows reference the encounter).
  const isoStart = start.toISOString().replace('T', ' ').slice(0, 19);
  const messaging = db
    .prepare(
      `SELECT a.action, COUNT(*) AS n FROM audit_log a
       JOIN encounters e ON e.id = CAST(a.entity_id AS INTEGER)
       WHERE a.entity = 'encounter' AND a.action IN ('whatsapp-queue', 'whatsapp-skipped')
         AND a.ts >= ? AND e.facility_id IN (${marks})
       GROUP BY a.action`
    )
    .all(isoStart, ...facilityIds);
  const msgCount = (a) => messaging.find((m) => m.action === a)?.n || 0;

  // Average per day over the days the record actually covers: a 90-day window
  // over 60 days of history divides by 60, not 90 (and the UI says so).
  const firstVisit = parseDbDate(
    db.prepare(`SELECT MIN(created_at) AS m FROM encounters WHERE facility_id IN (${marks}) AND status = 'approved'`).get(...facilityIds)?.m
  );
  const coverageDays = days === 1 || !firstVisit
    ? 1
    : Math.max(1, Math.min(days, Math.floor((todayIstMidnight - firstVisit) / 86400000) + 1));

  return {
    facility,
    combinedFacilities: facilityIds.length > 1 ? facilityIds.map(facilityName) : null,
    identifiable,
    days,
    range: { from: istDateKey(start), to: todayKey },
    generatedAt: now.toISOString(),
    kpis: {
      visits: visits.length,
      prevVisits: prevVisits.length,
      uniquePatients: seenPatients.length,
      prevUniquePatients: prevUnique,
      newPatients,
      avgPerDay: Math.round((visits.length / coverageDays) * 10) / 10,
      coverageDays,
      visitsWithWarnings: visits.filter((v) => (v.warnings || '[]') !== '[]').length,
      majorOverridden: overrides,
      registeredTotal: db
        .prepare(`SELECT COUNT(*) AS n FROM patients WHERE registered_facility_id IN (${marks})`)
        .get(...facilityIds).n,
    },
    series: { granularity: days === 1 ? 'hour' : 'day', points: series },
    topDiagnoses: topN(dxCounts, 7, dxLabel),
    noDiagnosis,
    topMedicines: topN(countBy(medEntries, (m) => m), 7),
    safety: [...countBy(warningEntries, (w) => w.type)]
      .filter(([type]) => type !== 'stock')
      .map(([type, count]) => ({ label: WARNING_TYPE_LABEL[type] || type, type, count }))
      .sort((a, b) => b.count - a.count),
    patientMix: {
      language: [...countBy(seenPatients, (p) => ({ hi: 'Hindi', ta: 'Tamil', en: 'English' })[p.language] || p.language)]
        .map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      messageFormat: [...countBy(seenPatients, (p) => ({ text: 'Printout only', voice: 'Voice (WhatsApp)', both: 'Both' })[p.message_format] || p.message_format)]
        .map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      ageBands: AGE_BANDS.map((band, i) => ({
        label: band.label,
        count: seenPatients.filter((p) => p.age != null && p.age <= band.max && p.age > (i ? AGE_BANDS[i - 1].max : -1)).length,
      })),
      gender: [...countBy(seenPatients, (p) => ({ F: 'Female', M: 'Male' })[p.gender] || 'Other / not recorded')]
        .map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    },
    messaging: { voiceNotesQueued: msgCount('whatsapp-queue'), skippedWindowClosed: msgCount('whatsapp-skipped') },
    stock: {
      alerts: stockAlerts,
      indents: Object.fromEntries(indentStats.map((r) => [r.status, r.n])),
    },
    // Totals-only viewers get no patient rows at all.
    recentVisits: !identifiable ? [] : [...visits]
      .sort((a, b) => b.at - a.at)
      .slice(0, 12)
      .map((v) => ({
        id: v.id,
        at: v.at.toISOString(),
        patient: v.name,
        age: v.age,
        gender: v.gender,
        diagnosis: v.diagnosis,
        medicines: JSON.parse(v.medications || '[]').map((m) => m.genericName || m.raw).join(', '),
        warnings: JSON.parse(v.warnings || '[]').filter((w) => w.type !== 'stock').length,
        origin: v.origin,
      })),
    dataNotes: {
      syntheticVisits: visits.filter((v) => v.origin === 'synthetic').length,
      liveVisits: visits.filter((v) => v.origin !== 'synthetic').length,
    },
  };
}
