# Sethu — client

React + Vite PWA. Five views, reached from the landing page. See the
[root README](../README.md) for the full picture.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

The app calls the API on its own origin (`/api/...`). In development, Vite
proxies `/api` to the server at `http://localhost:4000` (override with
`SETHU_API_URL`); in production the server hosts the built app itself (`npm
run build` → `dist/`). Set `VITE_API_BASE` only if the server runs on a
different host — see `.env.example`. `VITE_WHATSAPP_DEMO_NUMBER`
optionally sets the phone number encoded in the desk's WhatsApp opt-in QR
code (defaults to a placeholder, since this build has no real WhatsApp
Business number).

## Views

- **Desk** (`views/DeskView.jsx`) — look up a returning patient by phone or
  register a new one; generates the WhatsApp opt-in QR for voice-preference
  patients.
- **Doctor Console** (`views/DoctorConsoleView.jsx`) — history panel,
  one-tap templates, dictation (with optional Sarvam mic buttons), the
  drafted warnings review, and Approve → `components/PrintableReport.jsx`.
- **Inventory** (`views/InventoryView.jsx`) — stock/status table per
  facility, with a "Draft indent" action for Low/Reorder rows.
- **CHC** (`views/ChcView.jsx`) — three tabs: the original QR-scan referral
  view, an Indent Inbox, and the CHC's own inventory (reuses
  `InventoryView`).
- **Referral (legacy)** (`views/PhcView.jsx`) — the original offline-first
  visit log + QR referral card generator.

## Library code

- `lib/careApi.js` — fetch wrapper for the `/api/care/*` endpoints
- `lib/recorder.js`, `components/MicButton.jsx` — short MediaRecorder clip →
  Sarvam STT, hidden entirely when the server reports Sarvam isn't configured
- `lib/db.js` — IndexedDB-backed local store for the referral-bridge offline queue
- `lib/qr.js` — referral-card payload encode/decode (camera + image upload)
- `lib/sync.js` — background sync engine for the referral bridge
