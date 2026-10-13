import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { upsertVisit, findVisitsByAbha, listRecentVisits } from './db.js';
import { ensureSeeded } from './seed.js';
import { careRouter } from './routes/care.js';
import { authRouter } from './routes/auth.js';
import { authenticate, requirePermission } from './auth/access.js';

ensureSeeded();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRouter);
app.use('/api/care', careRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'sethu-central-store' });
});

// The original referral-bridge endpoints hold patient data too: clinical staff only.
const clinicalOnly = [authenticate, requirePermission('patient:read')];

// Central Data Store: PHC and CHC clients push their local queue here once online.
// Idempotent by localId so retried syncs never create duplicates.
app.post('/api/sync', ...clinicalOnly, (req, res) => {
  const { visits } = req.body || {};
  if (!Array.isArray(visits)) {
    return res.status(400).json({ error: 'Expected { visits: [...] }' });
  }

  const accepted = [];
  for (const visit of visits) {
    if (!visit.localId) continue;
    const serverId = upsertVisit(visit);
    accepted.push({ localId: visit.localId, serverId });
  }

  res.json({ accepted });
});

// Mock ABDM/ABHA linkage check. Real ABDM sandbox credentials are out of scope here;
// this simulates the "auto-linked when ABHA ID present" behaviour from the architecture.
app.get('/api/abha/:abhaId/link', ...clinicalOnly, (req, res) => {
  const { abhaId } = req.params;
  const looksValid = /^\d{2}-?\d{4}-?\d{4}-?\d{4}$|^\d{14}$/.test(abhaId);
  res.json({
    abhaId,
    linked: looksValid,
    mock: true,
    note: 'Simulated ABDM linkage — no live ABDM sandbox connection in this build.',
  });
});

// Fallback lookup for a CHC that IS online and wants to cross-check the central store
// by ABHA ID, in addition to reading the self-contained QR payload.
app.get('/api/patients/:abhaId', ...clinicalOnly, (req, res) => {
  const visits = findVisitsByAbha(req.params.abhaId);
  res.json({ abhaId: req.params.abhaId, visits });
});

app.get('/api/visits', ...clinicalOnly, (req, res) => {
  res.json({ visits: listRecentVisits(Number(req.query.limit) || 100) });
});

// Unknown /api routes get a JSON 404, not the app's HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve the built client (client/dist) so one process hosts both the app and
// the API on the same origin. In development, Vite serves the app instead.
const CLIENT_DIST =
  process.env.SETHU_CLIENT_DIST ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));
  // Single-page app: any other GET returns index.html.
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Sethu central store listening on http://localhost:${PORT}`);
});
