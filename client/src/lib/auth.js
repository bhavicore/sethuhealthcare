// Login session for this browser tab. Kept in sessionStorage (not
// localStorage) so closing the browser on a shared clinic computer logs the
// user out. The server is the real gate — this only decides which menus to
// show; every request is re-checked server-side.

const KEY = 'sethu.session';
const listeners = new Set();

function read() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

let session = read(); // { token, me } | null

function write(next) {
  session = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked (private mode) — the in-memory session still works for this page
  }
  listeners.forEach((fn) => fn(session));
}

export const getSession = () => session;
export const authToken = () => session?.token || null;
export const setSession = (token, me) => write({ token, me });
export const updateMe = (me) => session && write({ ...session, me });
export const clearSession = () => write(null);

export function subscribeAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
