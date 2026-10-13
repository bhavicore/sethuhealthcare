import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OctagonAlert, AlertTriangle, Hourglass } from 'lucide-react';
import { careApi, parseDbDate } from '../lib/careApi';

// Clinic dashboard for the Medical Officer. One filter row scopes everything
// below it; every chart value is also readable without hovering (direct
// labels on bar lists, a table view under the visits chart).

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const fmt = new Intl.NumberFormat('en-IN');
const shortDate = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function DashboardView({ me }) {
  // Which dashboards this login may open, and at what level, comes from the
  // server: 'full' where you work, 'totals' for facilities below you.
  const [facilityId, setFacilityId] = useState(me.dashboards[0]?.id);
  const view = me.dashboards.find((d) => d.id === facilityId);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    careApi
      .dashboard(facilityId, days)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [facilityId, days]);

  const rangeLabel = RANGES.find((r) => r.days === days)?.label.toLowerCase();

  return (
    <div className="view view--wide">
      <header className="view__header">
        <h1>{view?.type === 'district' ? 'District Dashboard' : 'Dashboard'}</h1>
      </header>

      <div className="dash-filters" role="group" aria-label="Dashboard filters">
        <div className="dash-segmented" role="radiogroup" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="radio"
              aria-checked={days === r.days}
              className={days === r.days ? 'dash-segmented__btn dash-segmented__btn--on' : 'dash-segmented__btn'}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} aria-label="Facility">
          {me.dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.type === 'district' ? ' (all facilities)' : ''}{d.mode === 'totals' ? ' — totals only' : ''}
            </option>
          ))}
        </select>
        {data && <span className="muted small">{shortDate(data.range.from)} – {shortDate(data.range.to)} · IST</span>}
      </div>

      {error && <p className="form-error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <div className={loading ? 'dash dash--refreshing' : 'dash'}>
          <DataNote data={data} />
          {!data.identifiable && (
            <p className="dash-note dash-note--access">
              <strong>Totals only:</strong> you can see numbers for {view?.name || 'this facility'} but not individual patients.
              {me.active.facilityType !== 'district' && <> Patients referred to {me.active.facilityName} appear in its own records.</>}
              {data.combinedFacilities && <> Combined here: {data.combinedFacilities.join(', ')}.</>}
            </p>
          )}

          <section className="dash-kpis">
            <StatTile
              hero
              label={`Visits · ${rangeLabel}`}
              value={fmt.format(data.kpis.visits)}
              delta={deltaText(data.kpis.visits, data.kpis.prevVisits, days)}
            />
            <StatTile label="Patients seen" value={fmt.format(data.kpis.uniquePatients)} note={`${fmt.format(data.kpis.registeredTotal)} registered in total`} />
            <StatTile label="New registrations" value={fmt.format(data.kpis.newPatients)} note="first visit in this range" />
            <StatTile
              label={days === 1 ? 'Visits so far today' : 'Average visits per day'}
              value={fmt.format(data.kpis.avgPerDay)}
              note={days > 1 && data.kpis.coverageDays < days ? `over the ${data.kpis.coverageDays} days on record` : null}
            />
            <StatTile
              label="Visits with a safety flag"
              value={fmt.format(data.kpis.visitsWithWarnings)}
              note={`${fmt.format(data.kpis.majorOverridden)} major warning${data.kpis.majorOverridden === 1 ? '' : 's'} overridden with a reason`}
            />
          </section>

          <section className="card">
            <h2>{data.series.granularity === 'hour' ? 'OPD Visits by Hour (Today)' : 'OPD Visits per Day'}</h2>
            <VisitsChart points={data.series.points} granularity={data.series.granularity} />
          </section>

          <div className="dash-grid">
            <section className="card">
              <h2>Common Diagnoses</h2>
              <p className="muted small dash-card-note">Free text as the doctor recorded it, grouped by exact wording — not coded to ICD-10 yet.</p>
              <BarList items={data.topDiagnoses} />
              {data.noDiagnosis > 0 && <p className="muted small">{fmt.format(data.noDiagnosis)} visit(s) with no diagnosis recorded.</p>}
            </section>
            <section className="card">
              <h2>Medicines Prescribed</h2>
              <p className="muted small dash-card-note">Number of prescriptions, one per medicine per visit.</p>
              <BarList items={data.topMedicines} />
            </section>
          </div>

          <div className="dash-grid">
            <section className="card">
              <h2>Safety Warnings</h2>
              <p className="muted small dash-card-note">Warnings shown to the doctor before approval. They inform, never block.</p>
              {data.safety.length ? <BarList items={data.safety} /> : <p className="muted">No warnings in this range.</p>}
              <p className="muted small" style={{ marginTop: '0.75rem' }}>
                WhatsApp voice notes queued: {fmt.format(data.messaging.voiceNotesQueued)} · skipped (24-hour window closed): {fmt.format(data.messaging.skippedWindowClosed)}
              </p>
            </section>
            <section className="card">
              <h2>Patient Profile</h2>
              <p className="muted small dash-card-note">Each patient counted once in this range.</p>
              <h3 className="dash-subhead">Age Group</h3>
              <BarList items={data.patientMix.ageBands} />
              <h3 className="dash-subhead">Language</h3>
              <BarList items={data.patientMix.language} />
              <h3 className="dash-subhead">Advice Given By</h3>
              <BarList items={data.patientMix.messageFormat} />
              <h3 className="dash-subhead">Sex</h3>
              <BarList items={data.patientMix.gender} />
            </section>
          </div>

          <section className="card">
            <h2>Stock Alerts</h2>
            <StockAlerts stock={data.stock} />
          </section>

          {data.identifiable && (
            <section className="card">
              <h2>Recent OPD Visits</h2>
              <RecentVisits visits={data.recentVisits} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// No delta for "Today": today-so-far vs all of yesterday would always look like a drop.
function deltaText(current, previous, days) {
  if (!previous || days === 1) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? '+' : ''}${pct}% vs previous ${days} days (${fmt.format(previous)})`;
}

function DataNote({ data }) {
  const { syntheticVisits, liveVisits } = data.dataNotes;
  const total = syntheticVisits + liveVisits;
  if (!total) return <p className="dash-note">No visits recorded in this range yet.</p>;
  return (
    <p className="dash-note">
      <strong>Demo data:</strong> {fmt.format(syntheticVisits)} of {fmt.format(total)} visits in this range are seeded synthetic history;{' '}
      {fmt.format(liveVisits)} {liveVisits === 1 ? 'was' : 'were'} recorded live in this app. Nothing here is real patient data.
    </p>
  );
}

function StatTile({ label, value, delta, note, hero }) {
  return (
    <div className={hero ? 'stat-tile stat-tile--hero' : 'stat-tile'}>
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
      {delta && <div className="stat-tile__delta">{delta}</div>}
      {note && <div className="stat-tile__note">{note}</div>}
    </div>
  );
}

/** Horizontal bars, one series (one color), value printed at each bar's tip. */
function BarList({ items }) {
  const rows = items;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label} className="bar-list__row" title={`${r.label}: ${fmt.format(r.count)} (${total ? Math.round((r.count / total) * 100) : 0}%)`}>
          <span className="bar-list__label">{r.label}</span>
          <span className="bar-list__track">
            <span className={r.other ? 'bar-list__bar bar-list__bar--other' : 'bar-list__bar'} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="bar-list__value">{fmt.format(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v) {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => v / s <= 5) || pow * 10;
  return Math.ceil(v / step) * step;
}

/** Column chart: one series, hover/focus tooltip per column, table view below. */
function VisitsChart({ points, granularity }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 200;
  const pad = { top: 22, right: 8, bottom: 26, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxV = niceMax(Math.max(...points.map((p) => p.visits), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxV * f));
  const band = plotW / points.length;
  const barW = Math.max(2, Math.min(24, band - 2)); // <=24px, 2px surface gap between neighbours
  const y = (v) => pad.top + plotH - (v / maxV) * plotH;
  const labelEvery = Math.ceil(points.length / Math.max(2, Math.floor(plotW / 56)));
  const peak = points.reduce((best, p, i) => (p.visits > points[best].visits ? i : best), 0);
  const last = points.length - 1;
  const keyLabel = (p) => (granularity === 'hour' ? p.key : shortDate(p.key));

  const column = (v, i) => {
    const x = pad.left + i * band + (band - barW) / 2;
    const top = y(v);
    const h = pad.top + plotH - top;
    if (h <= 0) return null;
    const r = 0; // square columns, matching the app's square-cornered style
    return `M${x},${pad.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + plotH} Z`;
  };

  return (
    <div className="visits-chart" ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label={`Visits per ${granularity}; peak ${points[peak].visits} on ${keyLabel(points[peak])}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="chart-tick">{t}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const d = column(p.visits, i);
          const isHover = hover === i;
          return (
            <g key={p.key}>
              {d && <path d={d} className={isHover ? 'chart-col chart-col--hover' : 'chart-col'} />}
              {/* The whole band is the hit target, not just the painted bar. */}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
                aria-label={`${keyLabel(p)}: ${p.visits} visits`}
              />
              {i % labelEvery === 0 && (
                <text x={pad.left + i * band + band / 2} y={height - 8} textAnchor="middle" className="chart-tick">{keyLabel(p)}</text>
              )}
            </g>
          );
        })}
        {/* Selective direct labels: the peak and the latest value only. */}
        {[...new Set([peak, last])].map((i) => points[i].visits > 0 && (
          <text key={`lbl-${i}`} x={pad.left + i * band + band / 2} y={y(points[i].visits) - 6} textAnchor="middle" className="chart-value">
            {points[i].visits}
          </text>
        ))}
      </svg>
      {hover != null && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(Math.max(pad.left + hover * band + band / 2, 60), width - 60), top: y(points[hover].visits) - 8 }}
        >
          <strong>{fmt.format(points[hover].visits)} visits</strong>
          <span>{keyLabel(points[hover])}</span>
        </div>
      )}
      <details className="chart-table">
        <summary className="muted small">Show as table</summary>
        <table className="report-table">
          <thead><tr><th>{granularity === 'hour' ? 'Hour (IST)' : 'Date'}</th><th>Visits</th></tr></thead>
          <tbody>
            {points.map((p) => <tr key={p.key}><td>{keyLabel(p)}</td><td className="num">{p.visits}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const STATUS = {
  Reorder: { Icon: OctagonAlert, className: 'status status--critical', text: 'Reorder now' },
  Low: { Icon: AlertTriangle, className: 'status status--warning', text: 'Low stock' },
  'Near expiry': { Icon: Hourglass, className: 'status status--warning', text: 'Near expiry' },
};

function StockAlerts({ stock }) {
  const pending = (stock.indents.sent || 0) + (stock.indents.approved || 0);
  // key includes the facility: a combined district view can list ORS twice.
  if (!stock.alerts.length) return <p className="muted">All medicines above their reorder point. {pending ? `${pending} indent(s) with the CHC.` : ''}</p>;
  return (
    <>
      <ul className="visit-list">
        {stock.alerts.map((a) => {
          const s = STATUS[a.status] || STATUS.Low;
          return (
            <li key={`${a.facility || ''}-${a.medicine}`} className="visit-list__item">
              <div>
                <strong>{a.medicine}</strong>{a.facility && <span className="muted small"> · {a.facility}</span>}
                <div className="muted small">
                  {fmt.format(a.stock)} in stock{a.daysLeft != null ? ` · ~${a.daysLeft} days left` : ''}
                  {a.surge ? ' · usage surging this week' : ''}
                  {a.nearExpiry && a.status !== 'Near expiry' ? ' · a batch is near expiry' : ''}
                </div>
              </div>
              <span className={s.className}><s.Icon size={15} aria-hidden="true" /> {s.text}</span>
            </li>
          );
        })}
      </ul>
      <p className="muted small" style={{ marginTop: '0.5rem' }}>
        {pending ? `${pending} indent(s) already sent to the CHC. ` : 'No indents sent yet. '}Open Inventory to draft an indent.
      </p>
    </>
  );
}

function RecentVisits({ visits }) {
  if (!visits.length) return <p className="muted">No visits in this range.</p>;
  return (
    <div className="table-scroll">
      <table className="report-table">
        <thead>
          <tr><th>Time</th><th>Patient</th><th>Diagnosis</th><th>Medicines</th><th className="num">Flags</th><th>Source</th></tr>
        </thead>
        <tbody>
          {visits.map((v) => (
            <tr key={v.id}>
              <td className="num nowrap">
                {parseDbDate(v.at)?.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
              </td>
              <td>{v.patient} <span className="muted small">{v.age}{v.gender}</span></td>
              <td>{v.diagnosis || '—'}</td>
              <td className="small">{v.medicines || '—'}</td>
              <td className="num">{v.warnings || '—'}</td>
              <td className="muted small">{v.origin === 'synthetic' ? 'synthetic' : 'live'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
