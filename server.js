// LabelProof — landing page + pilot registration backend.
// Zero dependencies: requires Node.js 18+. Run with `npm start`.
//
// Registrations are validated, then appended to data/pilot-registrations.jsonl
// (one JSON object per line). Optionally, set PILOT_WEBHOOK_URL to also forward
// each registration as JSON to a webhook (e.g. Zapier, Make, Slack workflow,
// Google Apps Script). The visitor only sees a success message after the
// registration has been written to disk (and accepted by the webhook, if set).

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pilot-registrations.jsonl');
const WEBHOOK_URL = process.env.PILOT_WEBHOOK_URL || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const BUSINESS_TYPES = [
  'Imported food brand',
  'Food importer or distributor',
  'Packaging or design agency',
  'Arabic food-label linguist',
  'Food regulatory professional',
  'Other',
];
const SKU_RANGES = ['None yet', '1–5', '6–20', '21–50', '50+', 'Not applicable'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",
};

// --- simple in-memory rate limit: 5 submissions / 10 min per IP ---
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max) : '');

function validate(input) {
  const errors = {};
  const out = {
    fullName: clean(input.fullName, 120),
    email: clean(input.email, 200).toLowerCase(),
    company: clean(input.company, 160),
    businessType: clean(input.businessType, 80),
    skuCount: clean(input.skuCount, 40),
    message: clean(input.message, 2000),
    consent: input.consent === true || input.consent === 'on',
  };
  if (out.fullName.length < 2) errors.fullName = 'Full name is required.';
  if (!EMAIL_RE.test(out.email)) errors.email = 'A valid business email is required.';
  if (out.company.length < 2) errors.company = 'Company name is required.';
  if (!BUSINESS_TYPES.includes(out.businessType)) errors.businessType = 'Choose a business type.';
  if (!SKU_RANGES.includes(out.skuCount)) errors.skuCount = 'Choose a SKU range.';
  if (!out.consent) errors.consent = 'Consent is required.';
  return { out, errors };
}

async function handlePilot(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!/application\/json/i.test(req.headers['content-type'] || '')) {
    return send(res, 415, { ok: false, error: 'Unsupported content type.' });
  }
  if (rateLimited(ip)) {
    return send(res, 429, { ok: false, error: 'Too many submissions. Please try again in a few minutes.' });
  }

  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, e.status || 400, { ok: false, error: e.status === 413 ? 'Submission is too large.' : 'Invalid request.' });
  }

  // Honeypot: bots fill the hidden "website" field. Reject without storing.
  if (clean(input.website, 200)) {
    return send(res, 400, { ok: false, error: 'Submission rejected.' });
  }

  const { out, errors } = validate(input || {});
  if (Object.keys(errors).length) {
    return send(res, 422, { ok: false, error: 'Please check the highlighted fields.', fields: errors });
  }

  const record = {
    id: 'LP-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    receivedAt: new Date().toISOString(),
    ...out,
    userAgent: clean(req.headers['user-agent'] || '', 300),
  };

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.appendFile(DATA_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('[pilot] failed to store registration:', err);
    return send(res, 500, { ok: false, error: 'Sorry — we could not save your registration. Please try again later.' });
  }

  if (WEBHOOK_URL) {
    try {
      const r = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'labelproof-pilot', ...record }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('Webhook HTTP ' + r.status);
    } catch (err) {
      // Stored locally already; log the forwarding failure for follow-up.
      console.error(`[pilot] stored ${record.id} but webhook forwarding failed:`, err.message);
    }
  }

  console.log(`[pilot] new registration ${record.id} — ${record.company} (${record.businessType})`);
  return send(res, 201, { ok: true, id: record.id });
}

async function handleExport(req, res, url) {
  // Read-only admin export. Disabled unless ADMIN_TOKEN is set.
  if (!ADMIN_TOKEN) return send(res, 404, 'Not found');
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(token), b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { ok: false, error: 'Unauthorized' });
  let rows = [];
  try {
    rows = (await fsp.readFile(DATA_FILE, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (url.searchParams.get('format') === 'csv') {
    const cols = ['id', 'receivedAt', 'fullName', 'email', 'company', 'businessType', 'skuCount', 'message'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    return send(res, 200, '﻿' + csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pilot-registrations.csv"' });
  }
  return send(res, 200, { ok: true, count: rows.length, registrations: rows });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw Object.assign(new Error(), { code: 'ENOENT' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/pilot') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'POST' });
      return await handlePilot(req, res);
    }
    if (url.pathname === '/api/pilot/export' && req.method === 'GET') return await handleExport(req, res, url);
    if (url.pathname === '/api/health') return send(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`LabelProof running at http://localhost:${PORT}`);
  console.log(`Pilot registrations → ${DATA_FILE}`);
  if (!WEBHOOK_URL) console.log('PILOT_WEBHOOK_URL not set — registrations are stored locally only.');
});
