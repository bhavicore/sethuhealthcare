import { useEffect, useState } from 'react';
import { authApi } from '../lib/careApi';
import { setSession } from '../lib/auth';

/**
 * Clinic-device login: pick your name, enter your 4–6 digit PIN. Access is
 * decided by the server from your assignments, not by anything on this screen.
 */
export default function LoginView() {
  const [staff, setStaff] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi.staff().then((r) => setStaff(r.staff)).catch((err) => setError(`Can't reach the server: ${err.message}`));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await authApi.login(selected.id, pin);
      const me = await authApi.me(token);
      setSession(token, me);
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__brand">
        <h1>SETHU</h1>
        <p className="muted">Staff Login</p>
      </div>

      {!selected ? (
        <section className="card login__card">
          <h2>Select Your Name</h2>
          {!staff && !error && <p className="muted">Loading staff…</p>}
          <ul className="login__staff">
            {staff?.map((s) => (
              <li key={s.id}>
                <button type="button" className="login__person" onClick={() => { setSelected(s); setError(null); }}>
                  <span className="login__name">{s.name}</span>
                  {s.roles.map((r) => <span key={r} className="muted small">{r}</span>)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <form className="card login__card" onSubmit={submit}>
          <h2>{selected.name}</h2>
          <p className="muted small" style={{ marginBottom: '1rem' }}>{selected.roles.join(' · ')}</p>
          <div className="field">
            <label htmlFor="pin">PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              pattern="\d{4,6}"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="login__pin"
            />
          </div>
          <div className="form-actions">
            <button className="btn btn--primary" type="submit" disabled={busy || pin.length < 4}>{busy ? 'Checking…' : 'Log In'}</button>
            <button className="btn btn--secondary" type="button" onClick={() => { setSelected(null); setPin(''); setError(null); }}>Back</button>
          </div>
          <p className="muted small" style={{ marginTop: '1rem' }}>
            Fingerprint sign-in is planned; for now it's a personal PIN. 5 wrong tries lock the account for 5 minutes.
          </p>
        </form>
      )}

      {error && <p className="form-error" style={{ textAlign: 'center' }}>{error}</p>}
      <p className="landing__footnote">Demo accounts with made-up names — PINs are listed in the README.</p>
    </div>
  );
}
