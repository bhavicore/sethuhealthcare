import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { careApi } from '../lib/careApi';

const STATUS_BADGE = { OK: 'synced', Low: 'pending', Reorder: 'pending', 'Near expiry': 'pending' };

export default function InventoryView({ me, facilities }) {
  // Facilities come from the server's view of this login: a PHC sees its own
  // stock, a CHC in-charge or District Health Officer can pick any clinic below them.
  const [facilityId, setFacilityId] = useState(
    facilities.find((f) => f.id === me.active.facilityId)?.id ?? facilities[0]?.id
  );
  const facility = facilities.find((f) => f.id === facilityId);
  const [inventory, setInventory] = useState([]);
  const [drafting, setDrafting] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editedQty, setEditedQty] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function refresh() {
    if (!facilityId) return;
    try {
      const { inventory: rows } = await careApi.inventory(facilityId);
      setInventory(rows);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { refresh(); }, [facilityId]);

  async function openDraft(medicineId) {
    setError(null);
    setDrafting(medicineId);
    setDraft(null);
    try {
      const d = await careApi.draftIndent(facilityId, medicineId);
      setDraft(d);
      setEditedQty(String(d.qty));
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendIndent() {
    setError(null);
    try {
      const { indent } = await careApi.createIndent({
        fromFacility: draft.fromFacility,
        toFacility: draft.toFacility,
        medicineId: draft.medicineId,
        qty: Number(editedQty),
        justification: draft.justification,
        surgeFlag: draft.surgeFlag,
      });
      await careApi.approveIndent(indent.id, { qty: Number(editedQty) });
      setNotice(`Indent for ${draft.medicineId} sent to ${draft.toFacility}.`);
      setDraft(null);
      setDrafting(null);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="view">
      <header className="view__header">
        <h1>Stock Register: {facility?.name || facilityId}</h1>
        <p className="muted">Reorder levels are calculated from recent daily use.</p>
      </header>

      {facilities.length > 1 && (
        <div className="dash-filters">
          <select value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setDraft(null); setDrafting(null); }} aria-label="Facility">
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {!facility?.canIndent && <span className="muted small">View only — indents are raised by that facility's in-charge.</span>}
        </div>
      )}
      {notice && <p className="form-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      <section className="card">
        <table className="report-table">
          <thead>
            <tr>
              <th>Medicine</th><th>Stock</th><th>Days left</th><th>Status</th><th>Surge</th><th>Near expiry</th><th></th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((row) => (
              <tr key={row.medicine.id}>
                <td>{row.medicine.generic_name}<div className="muted small">{row.medicine.unit_label}</div></td>
                <td>{row.currentStock}</td>
                <td>{Number.isFinite(row.daysOfStockLeft) ? row.daysOfStockLeft.toFixed(1) : '—'}</td>
                <td><span className={`badge badge--${STATUS_BADGE[row.status] || 'synced'}`}>{row.status}</span></td>
                <td>{row.surgeFlag ? <span className="badge badge--pending"><AlertTriangle size={12} /> Surge</span> : '—'}</td>
                <td>{row.hasNearExpiry ? `${row.nearExpiryBatches.length} batch(es)` : '—'}</td>
                <td>
                  {facility?.canIndent && (row.status === 'Reorder' || row.status === 'Low') && (
                    <button className="btn btn--secondary btn--sm" onClick={() => openDraft(row.medicine.id)}>Draft indent</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {drafting && draft && (
        <section className="card">
          <h2>Indent draft — {draft.medicineId}</h2>
          <p className="small">{draft.justification}{draft.justificationMock && <span className="muted"> (template note — set GEMINI_API_KEY for a model-written note)</span>}</p>
          <div className="field field--small">
            <label>Quantity (editable before approval)</label>
            <input value={editedQty} onChange={(e) => setEditedQty(e.target.value)} />
          </div>
          <p className="muted small">Approving as <strong>{me.user.name}</strong> — from your login.</p>
          <div className="form-actions">
            <button className="btn btn--primary" onClick={sendIndent}>Approve &amp; send to {draft.toFacility}</button>
            <button className="btn btn--secondary" onClick={() => { setDraft(null); setDrafting(null); }}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
