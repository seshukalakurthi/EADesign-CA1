'use strict';
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50kb' }));

const PORT = Number(process.env.PORT) || 3003;

// Simple in-memory stock catalogue
const STOCK = {
  'SKU-001': { name: 'Widget A', qty: 100, inStock: true },
  'SKU-002': { name: 'Widget B', qty: 0,   inStock: false },
  'SKU-003': { name: 'Widget C', qty: 25,  inStock: true },
};

function getReqId(req) {
  return req.header('x-request-id') || crypto.randomUUID();
}

app.use((req, res, next) => {
  const rid = getReqId(req);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  console.log(JSON.stringify({ rid, method: req.method, path: req.path, svc: 'inventory' }));
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, svc: 'inventory' }));

// GET /stock/:sku
app.get('/stock/:sku', (req, res) => {
  const rid = req.requestId;
  const { sku } = req.params;
  const item = STOCK[sku];

  if (!item) {
    console.log(JSON.stringify({ rid, sku, found: false, svc: 'inventory' }));
    return res.status(404).json({ error: 'sku not found', sku, rid });
  }

  console.log(JSON.stringify({ rid, sku, inStock: item.inStock, qty: item.qty, svc: 'inventory' }));
  return res.json({ sku, ...item, rid });
});

app.listen(PORT, () => console.log(JSON.stringify({ event: 'start', port: PORT, svc: 'inventory' })));
