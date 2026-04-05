'use strict';
const express = require('express');
const http = require('http');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50kb' }));

const PORT = Number(process.env.PORT) || 3000;
const CHECKOUT_URL = process.env.CHECKOUT_URL || 'http://checkout-svc/checkout';
const BACKEND_TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS) || 5000;
const ARCH_LABEL = process.env.ARCH_LABEL || 'nanoservices-kubernetes';

function getReqId(req) {
  return req.header('x-request-id') || crypto.randomUUID();
}

// Middleware: attach + propagate request ID
app.use((req, res, next) => {
  const rid = getReqId(req);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  console.log(JSON.stringify({ rid, method: req.method, path: req.path, svc: 'gateway' }));
  next();
});

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, svc: 'gateway' }));

// Architecture label
app.get('/api/arch', (_req, res) => res.json({ arch: ARCH_LABEL }));

// Ping / timing sanity check
app.get('/api/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

// Simple UI
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Checkout Demo</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 20px}
button{background:#0070f3;color:#fff;border:none;padding:10px 20px;cursor:pointer;border-radius:4px}
pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow:auto}</style>
</head>
<body>
<h1>🛒 Checkout Service</h1>
<p>Arch: <strong id="arch">loading…</strong></p>
<h2>Test Checkout</h2>
<button onclick="runCheckout()">POST /api/checkout</button>
<pre id="out">—</pre>
<script>
fetch('/api/arch').then(r=>r.json()).then(d=>document.getElementById('arch').textContent=d.arch);
async function runCheckout(){
  const rid='ui-'+Math.random().toString(36).slice(2);
  const r=await fetch('/api/checkout',{method:'POST',
    headers:{'Content-Type':'application/json','X-Request-Id':rid},
    body:JSON.stringify({sku:'SKU-001',qty:2,subtotal:100})});
  const d=await r.json();
  document.getElementById('out').textContent='X-Request-Id: '+rid+'\\n\\n'+JSON.stringify(d,null,2);
}
</script>
</body></html>`);
});

// Checkout proxy
app.post('/api/checkout', async (req, res) => {
  const rid = req.requestId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const upRes = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': rid,
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await upRes.json();
    console.log(JSON.stringify({ rid, upstream_status: upRes.status, svc: 'gateway' }));
    return res.status(upRes.status).json(data);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    console.error(JSON.stringify({ rid, error: err.message, timeout: isTimeout, svc: 'gateway' }));
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'checkout timeout' : 'checkout unavailable',
      rid,
    });
  }
});

app.listen(PORT, () => console.log(JSON.stringify({ event: 'start', port: PORT, svc: 'gateway' })));
