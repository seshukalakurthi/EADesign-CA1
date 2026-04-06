'use strict';
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50kb' }));

const PORT = Number(process.env.PORT) || 3002;
const TAX_RATE = Number(process.env.TAX_RATE) || 0.23;

function getReqId(req) {
  return req.header('x-request-id') || crypto.randomUUID();
}

app.use((req, res, next) => {
  const rid = getReqId(req);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  console.log(JSON.stringify({ rid, method: req.method, path: req.path, svc: 'pricing' }));
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, svc: 'pricing' }));

app.post('/price', (req, res) => {
  const rid = req.requestId;
  const { subtotal } = req.body;
  const s = Number(subtotal);
  if (!Number.isFinite(s) || s < 0) {
    return res.status(400).json({ error: 'subtotal must be a non-negative number', rid });
  }
  const tax = Number((s * TAX_RATE).toFixed(2));
  const total = Number((s + tax).toFixed(2));
  console.log(JSON.stringify({ rid, subtotal: s, tax, total, svc: 'pricing' }));
  return res.json({ subtotal: s, taxRate: TAX_RATE, tax, total, rid });
});

app.listen(PORT, () => console.log(JSON.stringify({ event: 'start', port: PORT, svc: 'pricing' })));