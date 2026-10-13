import { db } from '../db.js';

// Plain-formula inventory math (Task 4.2). Deliberately not an LLM: every
// number here is auditable arithmetic over the usage_history table.

function currentMonthNumber() {
  return new Date().getMonth() + 1; // 1-12
}

/**
 * Average daily use over the last `days` calendar days, today included.
 * Divides by calendar days, not by rows: a day with no prescriptions has no
 * usage_history row but is still a day of zero use. If the facility's records
 * start inside the window, divide by the days actually covered instead.
 */
function averageDailyUse(facilityId, medicineId, days) {
  const { total } = db
    .prepare(
      `SELECT COALESCE(SUM(qty_used), 0) AS total FROM usage_history
       WHERE facility_id = ? AND medicine_id = ? AND date >= date('now', ?)`
    )
    .get(facilityId, medicineId, `-${days - 1} days`);
  const { covered_days: coveredDays } = db
    .prepare(
      `SELECT julianday(date('now')) - julianday(MIN(date)) + 1 AS covered_days
       FROM usage_history WHERE facility_id = ? AND medicine_id = ?`
    )
    .get(facilityId, medicineId);
  if (!coveredDays) return 0;
  return total / Math.max(1, Math.min(days, coveredDays));
}

export function getUsageStats(facilityId, medicineId) {
  const avg90 = averageDailyUse(facilityId, medicineId, 90);
  const avg7 = averageDailyUse(facilityId, medicineId, 7);
  const surgeFlag = avg90 > 0 && avg7 > 1.5 * avg90;
  return { avg90, avg7, surgeFlag };
}

export function getSettings(facilityId, medicineId) {
  const row = db
    .prepare('SELECT * FROM medicine_facility_settings WHERE facility_id = ? AND medicine_id = ?')
    .get(facilityId, medicineId);
  if (!row) {
    return { seasonal_multiplier: 1, surge_months: [], lead_time_days: 3, safety_stock_days: 3, cycle_days: 30 };
  }
  return { ...row, surge_months: JSON.parse(row.surge_months || '[]') };
}

export function getCurrentStock(facilityId, medicineId) {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(stock_qty), 0) AS qty FROM inventory
         WHERE facility_id = ? AND medicine_id = ? AND expiry_date >= date('now')`
      )
      .get(facilityId, medicineId)?.qty || 0
  );
}

export function getBatches(facilityId, medicineId) {
  return db
    .prepare('SELECT * FROM inventory WHERE facility_id = ? AND medicine_id = ? ORDER BY expiry_date ASC')
    .all(facilityId, medicineId);
}

/**
 * Compute the full reorder picture for one medicine at one facility:
 *  - daily use = max(7-day avg, 90-day avg), so a surge is picked up fast
 *  - adjusted daily use = daily use × seasonal multiplier (only in the MO's configured months)
 *  - reorder point = adjusted daily use × lead time + safety stock
 *  - indent quantity = adjusted daily use × cycle days − current stock
 */
export function computeReorder(facilityId, medicineId) {
  const { avg90, avg7, surgeFlag } = getUsageStats(facilityId, medicineId);
  const settings = getSettings(facilityId, medicineId);
  const dailyUse = Math.max(avg7, avg90);
  const inSurgeMonth = settings.surge_months.includes(currentMonthNumber());
  const multiplier = inSurgeMonth ? settings.seasonal_multiplier : 1;
  const adjustedDailyUse = dailyUse * multiplier;

  const safetyStockQty = adjustedDailyUse * settings.safety_stock_days;
  const reorderPoint = adjustedDailyUse * settings.lead_time_days + safetyStockQty;
  const currentStock = getCurrentStock(facilityId, medicineId);
  const daysOfStockLeft = adjustedDailyUse > 0 ? currentStock / adjustedDailyUse : Infinity;

  const cycleTarget = adjustedDailyUse * settings.cycle_days;
  const indentQty = Math.max(0, Math.round(cycleTarget - currentStock));

  const batches = getBatches(facilityId, medicineId);
  const nearExpiryDays = 30;
  const nearExpiryBatches = batches.filter((b) => {
    const days = (new Date(b.expiry_date) - new Date()) / 86400000;
    return days >= 0 && days <= nearExpiryDays;
  });

  // Stock status: Reorder (at/under the reorder point) < Low (within a 50%
  // buffer above it) < OK. Near-expiry is a separate, independent flag —
  // a facility can be well-stocked overall but still carry a batch about to expire.
  let stockStatus = 'OK';
  if (currentStock <= 0 || currentStock <= reorderPoint) stockStatus = 'Reorder';
  else if (currentStock <= reorderPoint * 1.5) stockStatus = 'Low';

  const hasNearExpiry = nearExpiryBatches.length > 0;
  const status = stockStatus === 'OK' && hasNearExpiry ? 'Near expiry' : stockStatus;

  return {
    facilityId,
    medicineId,
    avg7,
    avg90,
    dailyUse,
    seasonalMultiplier: multiplier,
    inSurgeMonth,
    adjustedDailyUse,
    safetyStockQty,
    reorderPoint,
    currentStock,
    daysOfStockLeft,
    indentQty,
    surgeFlag,
    status,
    stockStatus,
    hasNearExpiry,
    nearExpiryBatches,
    settings,
  };
}

export function listInventory(facilityId) {
  const medicines = db.prepare('SELECT * FROM medicines ORDER BY generic_name').all();
  return medicines.map((med) => {
    const reorder = computeReorder(facilityId, med.id);
    const batches = getBatches(facilityId, med.id);
    return {
      medicine: med,
      batches,
      ...reorder,
    };
  });
}
