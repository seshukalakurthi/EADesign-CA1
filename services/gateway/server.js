'use strict';
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50kb' }));

const PORT = Number(process.env.PORT) || 3000;
const CHECKOUT_URL = process.env.CHECKOUT_URL || 'http://checkout-svc/checkout';
const BACKEND_TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS) || 30000;
const ARCH_LABEL = process.env.ARCH_LABEL || 'nanoservices-kubernetes-keda';

function getReqId(req) {
  return req.header('x-request-id') || crypto.randomUUID();
}

app.use((req, res, next) => {
  const rid = getReqId(req);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  console.log(JSON.stringify({ rid, method: req.method, path: req.path, svc: 'gateway' }));
  next();
});

app.get('/health',   (_req, res) => res.json({ ok: true, svc: 'gateway' }));
app.get('/api/arch', (_req, res) => res.json({ arch: ARCH_LABEL }));
app.get('/api/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

app.get('/api/products', (_req, res) => res.json([
  { id: 'SKU-001', name: 'Laptop', price: 799 },
  { id: 'SKU-002', name: 'Mouse (Out of Stock)', price: 99 },
  { id: 'SKU-003', name: 'Keyboard', price: 159 },
]));

const orders = [];
app.get('/api/orders', (_req, res) => res.json(orders));

app.post('/api/orders', async (req, res) => {
  const rid = req.requestId;
  const { productId, quantity = 1 } = req.body;
  const products = {
    'SKU-001': { name: 'Laptop',   price: 799 },
    'SKU-002': { name: 'Mouse',    price: 99  },
    'SKU-003': { name: 'Keyboard', price: 159 },
  };
  const product = products[productId];
  if (!product) return res.status(404).json({ error: 'product not found', rid });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const upRes = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': rid },
      body: JSON.stringify({ sku: productId, qty: quantity, subtotal: product.price }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await upRes.json();
    if (!upRes.ok) return res.status(upRes.status).json(data);
    const order = {
      id: rid,
      productId,
      productName: product.name,
      quantity,
      subtotal: product.price,
      total: data.total,
      status: data.status,
    };
    orders.unshift(order);
    if (orders.length > 20) orders.pop();
    console.log(JSON.stringify({ rid, event: 'order_placed', sku: productId, total: data.total, svc: 'gateway' }));
    return res.status(201).json(order);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    console.error(JSON.stringify({ rid, error: err.message, timeout: isTimeout, svc: 'gateway' }));
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'checkout timeout' : 'checkout unavailable', rid,
    });
  }
});

app.post('/api/checkout', async (req, res) => {
  const rid = req.requestId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const upRes = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': rid },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await upRes.json();
    return res.status(upRes.status).json(data);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'checkout timeout' : 'checkout unavailable', rid,
    });
  }
});

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Nanoservices Shop</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
<body class="bg-light">
<div class="container py-5" x-data="shop()" x-init="init()">
  <h1 class="mb-3">Nanoservices</h1>

  <div class="card mb-4">
    <div class="card-body">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <h5 class="card-title mb-1">Architecture</h5>
          <div class="small text-muted">What this UI is talking to right now</div>
          <div class="mt-2">
            <span class="badge text-bg-secondary" x-text="archLabel || 'unknown'"></span>
          </div>
        </div>
        <div class="text-end">
          <h5 class="card-title mb-1">Last request</h5>
          <div class="small text-muted" x-text="lastReq.label || '—'"></div>
          <div class="fw-semibold" x-text="lastReq.ms != null ? lastReq.ms.toFixed(1) + ' ms' : '—'"></div>
        </div>
      </div>
      <hr/>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" @click="clearTimings()">Clear timings</button>
        <button class="btn btn-sm btn-outline-primary" @click="refreshProducts()">Refresh catalog</button>
        <button class="btn btn-sm btn-outline-primary" @click="refreshOrders()">Refresh orders</button>
      </div>
      <div class="table-responsive mt-3">
        <table class="table table-sm mb-0">
          <thead>
            <tr>
              <th>Method</th><th>Path</th><th>Status</th><th class="text-end">Time (ms)</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="r in timings" :key="r.id">
              <tr>
                <td x-text="r.method"></td>
                <td x-text="r.path"></td>
                <td>
                  <span :class="r.ok ? 'badge text-bg-success' : 'badge text-bg-danger'" x-text="r.status"></span>
                </td>
                <td class="text-end" x-text="r.ms.toFixed(1)"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div x-show="msg" :class="'alert alert-' + msgType" x-text="msg"></div>

  <div class="row">
    <div class="col-md-7">
      <h3>Catalog</h3>
      <div class="row g-3">
        <template x-for="p in products" :key="p.id">
          <div class="col-6">
            <div class="card p-3 shadow-sm">
              <h5 x-text="p.name"></h5>
              <p>&euro;<span x-text="p.price"></span></p>
              <button @click="buy(p.id)" class="btn btn-primary">Buy</button>
            </div>
          </div>
        </template>
      </div>
    </div>
    <div class="col-md-5">
      <h3>Orders</h3>
      <ul class="list-group">
        <template x-for="o in orders" :key="o.id">
          <li class="list-group-item">
            <span x-text="o.productName"></span>
            - &euro;<span x-text="o.total"></span>
          </li>
        </template>
        <li class="list-group-item text-muted" x-show="orders.length === 0">No orders yet</li>
      </ul>
    </div>
  </div>
</div>

<script>
function shop() {
  return {
    products: [], orders: [], msg: '', msgType: 'info',
    archLabel: '', timings: [], lastReq: {},

    clearTimings() { this.timings = []; this.lastReq = {}; },

    recordTiming(method, path, res, ms, ok) {
      const id = Date.now() + '-' + Math.random().toString(16).slice(2);
      this.lastReq = { label: method + ' ' + path, ms };
      this.timings.unshift({ id, method, path, ok, status: res ? res.status : 'ERR', ms });
      this.timings = this.timings.slice(0, 10);
    },

    async timedJson(method, path, options = {}) {
      const rid = 'ui-' + Math.random().toString(36).slice(2);
      const start = performance.now();
      let res = null;
      try {
        res = await fetch(path, { method, ...options,
          headers: { ...(options.headers||{}), 'X-Request-Id': rid }
        });
        const data = await res.json().catch(() => ({}));
        const ms = performance.now() - start;
        this.recordTiming(method, path, res, ms, res.ok);
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
        return data;
      } catch(err) {
        const ms = performance.now() - start;
        this.recordTiming(method, path, res, ms, false);
        throw err;
      }
    },

    async init() {
      try {
        const info = await this.timedJson('GET', '/api/arch');
        this.archLabel = info.arch || 'unknown';
        document.title = 'Shop (' + this.archLabel + ')';
        await this.refreshProducts();
        await this.refreshOrders();
      } catch(e) { this.msg = e.message; this.msgType = 'danger'; }
    },

    async refreshProducts() {
      this.products = await this.timedJson('GET', '/api/products');
    },

    async refreshOrders() {
      this.orders = await this.timedJson('GET', '/api/orders');
    },

    async buy(id) {
      this.msg = 'Processing... (may take ~10s on cold start)';
      this.msgType = 'info';
      try {
        await this.timedJson('POST', '/api/orders', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: id, quantity: 1 }),
        });
        this.msg = 'Order placed!';
        this.msgType = 'success';
        await this.refreshOrders();
      } catch(e) { this.msg = e.message; this.msgType = 'danger'; }
    },
  };
}
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log(JSON.stringify({ event: 'start', port: PORT, svc: 'gateway' })));