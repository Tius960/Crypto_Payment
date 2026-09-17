const { query, pool } = require('./db');
const config = require('./config');
const { canTransition } = require('./state');
const { createQrisCharge, createCryptoInvoice } = require('./providers');

function makeOrderNumber() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function getPaymentQuote(amountIdr, paymentMethod) {
  const amount = Number(amountIdr);
  const minimumIdr = paymentMethod === 'crypto' ? config.cryptoMinimumIdr : config.qrisMinimumIdr;
  const gatewayFeeIdr = paymentMethod === 'crypto'
    ? Math.round(amount * config.cryptoFeeRate + config.cryptoFeeFlatIdr)
    : Math.round(amount * config.qrisFeeRate);
  const networkFeeIdr = paymentMethod === 'crypto' ? config.cryptoNetworkFeeIdr : 0;
  const quoteCreatedAt = new Date();
  const amountUsd = amount / config.usdIdrRate;
  return {
    amountIdr: amount,
    amountUsd: Number(amountUsd.toFixed(2)),
    paymentMethod,
    exchangeRate: config.usdIdrRate,
    gatewayFeeIdr,
    networkFeeIdr,
    feeIdr: gatewayFeeIdr + networkFeeIdr,
    cryptoNetwork: paymentMethod === 'crypto' ? config.cryptoNetwork : null,
    quoteCreatedAt: quoteCreatedAt.toISOString(),
    networkFeeSource: paymentMethod === 'crypto' ? config.cryptoNetworkFeeSource : null,
    minimumIdr,
    isValid: Number.isFinite(amount) && amount >= minimumIdr,
  };
}

async function createOrder({ amountIdr, paymentMethod }) {
  const quote = getPaymentQuote(amountIdr, paymentMethod);
  if (!quote.isValid) {
    const error = new Error('amount_below_minimum');
    error.quote = quote;
    throw error;
  }
  const orderNumber = makeOrderNumber();
  const expiresAt = new Date(Date.now() + config.expiryMinutes * 60 * 1000);
  const amountUsd = Number(amountIdr) / config.usdIdrRate;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `INSERT INTO orders (order_number, amount_idr, amount_usd, fee_idr, gateway_fee_idr, network_fee_idr, crypto_exchange_rate, crypto_exchange_rate_at, payment_method, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [orderNumber, amountIdr, amountUsd.toFixed(2), quote.feeIdr, quote.gatewayFeeIdr, quote.networkFeeIdr, quote.exchangeRate, quote.quoteCreatedAt, paymentMethod, expiresAt]
    );
    const order = orderResult.rows[0];
    const payment = paymentMethod === 'qris' ? await createQrisCharge(order) : await createCryptoInvoice(order);
    await client.query(
      `INSERT INTO payments (order_id, provider, provider_ref, qr_url, invoice_url, crypto_currency, crypto_network, crypto_address, crypto_amount, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [order.id, paymentMethod === 'qris' ? 'midtrans' : 'plisio', payment.providerRef, payment.qrUrl || null, payment.invoiceUrl || null, payment.cryptoCurrency || null, payment.cryptoNetwork || null, payment.cryptoAddress || null, payment.cryptoAmount || null, payment.raw]
    );
    await client.query('COMMIT');
    return getOrder(orderNumber);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getOrder(orderNumber) {
  const result = await query(`SELECT o.*, p.provider, p.provider_ref, p.qr_url, p.invoice_url, p.crypto_currency, p.crypto_network, p.crypto_address, p.crypto_amount
    FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.order_number = $1`, [orderNumber]);
  return result.rows[0] || null;
}

async function logWebhook(provider, providerRef, payload, verified) {
  await query('INSERT INTO webhook_logs (provider, provider_ref, payload, verified) VALUES ($1, $2, $3, $4)', [provider, providerRef || null, payload, verified]);
}

async function applyProviderUpdate(provider, providerRef, nextStatus) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT o.* FROM orders o JOIN payments p ON p.order_id = o.id
      WHERE p.provider = $1 AND p.provider_ref = $2 FOR UPDATE`, [provider, providerRef]);
    const order = result.rows[0];
    if (!order) throw new Error('payment_not_found');
    if (order.status !== nextStatus && !canTransition(order.status, nextStatus)) {
      await client.query('COMMIT');
      return { order, changed: false };
    }
    if (order.status !== nextStatus) {
      await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [nextStatus, order.id]);
    }
    await client.query('COMMIT');
    return { order: { ...order, status: nextStatus }, changed: order.status !== nextStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function expireOrders() {
  await query(`UPDATE orders SET status = 'expired', updated_at = now()
    WHERE status = 'pending' AND expires_at <= now()`);
}

module.exports = { createOrder, getOrder, getPaymentQuote, logWebhook, applyProviderUpdate, expireOrders };
