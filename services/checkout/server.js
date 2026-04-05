'use strict';
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50kb' }));

const PORT = Number(process.env.PORT) || 3001;
const PRICING_URL = process.env.PRICING_URL || 'http://pricing-svc/price';
const INVENTORY_URL = process.env.INVENTORY_URL || 'http://inventory-svc/stock';
const DEP_TIMEOUT_MS = Number(process.env.DEP_TIMEOUT_MS) || 3000;
const DB_HOST = process.env.DB_HOST || 'postgres-svc';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'shop';

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'postgres',
  password: DB_PASSWORD,
  database: DB_NAME,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 3000,
});

// Initialise audit table
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS checkout_audit (
        id        SERIAL PRIMARY KEY,
        rid       TEXT NOT NULL,
        sku       TEXT,
        qty       INT,
        subtotal  NUMERIC(10,2),
        total     NUMERIC(10,2),
        status    TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.log(JSON.stringify({ event: 'db_init', svc: 'checkout' }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'db_init_fail', error: err.message, svc: 'checkout' }));
  }
}

function getReqId(req) {
  return req.header('x-request-id') || crypto.randomUUID();
}

app.use((req, res, next) => {
  const rid = getReqId(req);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  console.log(JSON.stringify({ rid, method: req.method, path: req.path, svc: 'checkout' }));
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, svc: 'checkout' }));

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return r;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

app.post('/checkout', async (req, res) => {
  const rid = req.requestId;
  const { sku = 'UNKNOWN', qty = 1, subtotal = 0 } = req.body;

  if (!Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) {
    return res.status(400).json({ error: 'subtotal must be a non-negative number', rid });
  }

  const headers = { 'Content-Type': 'application/json', 'X-Request-Id': rid };

  // Call pricing and inventory in parallel
  let pricingResult, inventoryResult;
  try {
    const [pRes, iRes] = await Promise.all([
      fetchWithTimeout(PRICING_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ subtotal }),
      }, DEP_TIMEOUT_MS),
      fetchWithTimeout(`${INVENTORY_URL}/${encodeURIComponent(sku)}`, {
        method: 'GET',
        headers,
      }, DEP_TIMEOUT_MS),
    ]);

    if (!pRes.ok) {
      const err = await pRes.json().catch(() => ({}));
      return res.status(502).json({ error: 'pricing service error', detail: err, rid });
    }
    if (!iRes.ok) {
      const err = await iRes.json().catch(() => ({}));
      return res.status(502).json({ error: 'inventory service error', detail: err, rid });
    }

    pricingResult = await pRes.json();
    inventoryResult = await iRes.json();
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.error(JSON.stringify({ rid, error: err.message, timeout: isTimeout, svc: 'checkout' }));
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'dependency timeout' : 'dependency unavailable',
      rid,
    });
  }

  if (!inventoryResult.inStock) {
    return res.status(409).json({ error: 'item out of stock', sku, rid });
  }

  const total = pricingResult.total;

  // Audit to DB (non-blocking — don't fail checkout if DB is slow)
  pool.query(
    'INSERT INTO checkout_audit(rid, sku, qty, subtotal, total, status) VALUES($1,$2,$3,$4,$5,$6)',
    [rid, sku, qty, subtotal, total, 'completed']
  ).catch(err => console.error(JSON.stringify({ rid, event: 'db_write_fail', error: err.message, svc: 'checkout' })));

  return res.json({
    rid,
    sku,
    qty,
    pricing: pricingResult,
    inventory: inventoryResult,
    total,
    status: 'completed',
  });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(JSON.stringify({ event: 'start', port: PORT, svc: 'checkout' })));
});
