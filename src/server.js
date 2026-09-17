const express = require('express');
const path = require('path');
const config = require('./config');
const { createOrder, getOrder, getPaymentQuote, logWebhook, applyProviderUpdate, expireOrders } = require('./orders');
const { verifyMidtransSignature, verifyPlisioCallback } = require('./providers');
const { providerStatusToOrderStatus } = require('./state');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'unified-payment-service' }));

app.get('/api/payment-quote', (req, res) => {
  const amountIdr = Number(req.query.amountIdr);
  const paymentMethod = req.query.paymentMethod;
  if (!Number.isFinite(amountIdr) || !['qris', 'crypto'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'amountIdr dan paymentMethod wajib diisi' });
  }
  return res.json(getPaymentQuote(amountIdr, paymentMethod));
});

app.post('/api/orders', async (req, res) => {
  try {
    const amountIdr = Number(req.body.amountIdr);
    const paymentMethod = req.body.paymentMethod;
    if (!Number.isFinite(amountIdr) || amountIdr <= 0 || !['qris', 'crypto'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'amountIdr positif dan paymentMethod qris/crypto wajib diisi' });
    }
    const order = await createOrder({ amountIdr, paymentMethod });
    return res.status(201).json(order);
  } catch (error) {
    if (error.message === 'amount_below_minimum') {
      return res.status(400).json({ error: error.message, ...error.quote });
    }
    console.error('create_order_failed', error);
    if (error.code === 'ECONNREFUSED' || error.code === '57P01') {
      return res.status(503).json({ error: 'database_unavailable' });
    }
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(500).json({ error: 'database_schema_outdated' });
    }
    return res.status(502).json({ error: 'payment_provider_unavailable' });
  }
});

app.get('/api/orders/:orderNumber', async (req, res) => {
  const order = await getOrder(req.params.orderNumber);
  return order ? res.json(order) : res.status(404).json({ error: 'order_not_found' });
});

async function webhook(provider, req, res) {
  const payload = req.body;
  const verified = provider === 'midtrans' ? verifyMidtransSignature(payload) : verifyPlisioCallback(payload);
  const providerRef = provider === 'midtrans' ? (payload.transaction_id || payload.order_id) : payload.txn_id;
  await logWebhook(provider, providerRef, payload, verified);
  if (!verified) return res.status(401).json({ error: 'invalid_signature' });
  const nextStatus = providerStatusToOrderStatus(provider === 'midtrans' ? payload.transaction_status : payload.status);
  if (!providerRef) return res.status(400).json({ error: 'missing_provider_reference' });
  try {
    await applyProviderUpdate(provider, providerRef, nextStatus);
    return res.json({ received: true });
  } catch (error) {
    if (error.message === 'payment_not_found') return res.status(404).json({ error: error.message });
    console.error('webhook_processing_failed', error);
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
}

app.post('/webhooks/midtrans', (req, res) => webhook('midtrans', req, res));
app.post('/webhooks/plisio', (req, res) => webhook('plisio', req, res));

setInterval(() => expireOrders().catch((error) => console.error('expiry_job_failed', error)), 60_000).unref();

if (require.main === module) {
  const server = app.listen(config.port, () => console.log(`payment service listening on ${config.port}`));
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} sudah digunakan. Matikan proses Node yang lama atau jalankan dengan PORT=3001.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}
module.exports = app;
