import { useEffect, useState } from 'react';
import {
  LayoutDashboard, ClipboardList, Stethoscope, Package, Building2, QrCode, ShieldCheck, Info, LogOut,
} from 'lucide-react';
import './App.css';
import PhcView from './views/PhcView';
import ChcView from './views/ChcView';
import DeskView from './views/DeskView';
import DoctorConsoleView from './views/DoctorConsoleView';
import InventoryView from './views/InventoryView';
import DashboardView from './views/DashboardView';
import AccessView from './views/AccessView';
import LoginView from './views/LoginView';
import SyncStatusBar from './components/SyncStatusBar';
import AboutDemo from './components/AboutDemo';
import { initSyncEngine } from './lib/sync';
import { authApi } from './lib/careApi';
import { clearSession, getSession, subscribeAuth, updateMe } from './lib/auth';

// Each item appears only if the server says this session can use it (me.can).
// Hiding an item is convenience; the server re-checks every request.
const NAV_ITEMS = [
  { role: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, allowed: (c) => c.dashboard },
  { role: 'desk', label: 'Patient Registration', icon: ClipboardList, allowed: (c) => c.desk },
  { role: 'doctor', label: 'OPD Consultation', icon: Stethoscope, allowed: (c) => c.doctor },
  { role: 'inventory', label: 'Stock Register', icon: Package, allowed: (c) => c.inventory },
  { role: 'chc', label: 'Referrals & Indents', icon: Building2, allowed: (c) => c.indentInbox },
  { role: 'phc', label: 'Referral Slips', icon: QrCode, allowed: (c) => c.referralLegacy },
  { role: 'access', label: 'Staff Access', icon: ShieldCheck, allowed: (c) => c.access },
];

const WIDE_VIEWS = ['dashboard', 'access', 'doctor'];

export default function App() {
  const [session, setSessionState] = useState(getSession());
  const [role, setRole] = useState(null);
  const [activePatientId, setActivePatientId] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => subscribeAuth(setSessionState), []);
  useEffect(() => initSyncEngine(), []);

  // Re-validate a stored session on load (it may have expired or been revoked).
  useEffect(() => {
    if (getSession()?.token) authApi.me().then(updateMe).catch(() => {});
  }, []);

  const me = session?.me;
  const navItems = me ? NAV_ITEMS.filter((item) => item.allowed(me.can)) : [];

  // After login or a facility switch, open the first screen this role can use.
  useEffect(() => {
    if (me && !navItems.some((n) => n.role === role)) setRole(navItems[0]?.role ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.active?.assignmentId]);

  if (!session?.token) return <LoginView />;
  if (!me) return <p className="muted" style={{ padding: '2rem' }}>Loading…</p>;

  function sendToDoctor(patientId) {
    setActivePatientId(patientId);
    setRole('doctor');
  }

  async function switchFacility(assignmentId) {
    await authApi.switchAssignment(assignmentId);
    updateMe(await authApi.me());
    setActivePatientId(null);
  }

  async function logout() {
    await authApi.logout().catch(() => {});
    clearSession();
    setRole(null);
    setActivePatientId(null);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__mark" aria-hidden="true">
            {/* A bridge — "sethu" */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M1.5 11.5h13M3.5 11.5V8.5M12.5 11.5V8.5M2 8.5c2.5-4 9.5-4 12 0" />
            </svg>
          </span>
          <div>
            <div className="sidebar__name">Sethu</div>
            <div className="sidebar__facility">{me.active.facilityName}</div>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Main">
          {navItems.map(({ role: r, label, icon: Icon }) => (
            <button
              key={r}
              type="button"
              className={role === r ? 'nav-item nav-item--active' : 'nav-item'}
              aria-current={role === r ? 'page' : undefined}
              onClick={() => setRole(r)}
            >
              <Icon size={17} strokeWidth={1.9} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <SyncStatusBar />
          <div className="sidebar__user">
            <strong>{me.user.name}</strong>
            <span className="muted">{me.active.roleLabel}</span>
          </div>
          {me.assignments.length > 1 && (
            <select aria-label="Switch facility" value={me.active.assignmentId} onChange={(e) => switchFacility(Number(e.target.value))}>
              {me.assignments.map((a) => <option key={a.id} value={a.id}>{a.facilityName}</option>)}
            </select>
          )}
          <div className="sidebar__links">
            <button type="button" className="link-button" onClick={() => setAboutOpen(true)}>
              <Info size={14} /> About this demo
            </button>
            <button type="button" className="link-button" onClick={logout}>
              <LogOut size={14} /> Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Remount everything when the active facility changes, so no screen keeps another facility's data. */}
      <main key={me.active.assignmentId} className={WIDE_VIEWS.includes(role) ? 'app__main app__main--wide' : 'app__main'}>
        {role === 'dashboard' && <DashboardView me={me} />}
        {role === 'desk' && <DeskView me={me} onSendToDoctor={sendToDoctor} />}
        {role === 'doctor' && <DoctorConsoleView me={me} activePatientId={activePatientId} onPatientLoaded={setActivePatientId} />}
        {role === 'inventory' && <InventoryView me={me} facilities={me.inventoryFacilities} />}
        {role === 'chc' && <ChcView me={me} />}
        {role === 'phc' && <PhcView />}
        {role === 'access' && <AccessView />}
      </main>

      <AboutDemo open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
