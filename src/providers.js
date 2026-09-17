const axios = require('axios');
const crypto = require('crypto');
const config = require('./config');

function signMidtrans(body) {
  const raw = `${body.order_id}${body.status_code}${body.gross_amount}${config.midtransServerKey}`;
  return crypto.createHash('sha512').update(raw).digest('hex');
}

function verifyMidtransSignature(body) {
  if (!body.signature_key || !config.midtransServerKey) return false;
  const expected = Buffer.from(signMidtrans(body));
  const received = Buffer.from(body.signature_key);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function verifyPlisioCallback(payload) {
  if (!payload.verify_hash || !config.plisioApiKey) return false;
  const rest = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'verify_hash').sort(([a], [b]) => a.localeCompare(b)));
  const hash = crypto.createHmac('sha1', config.plisioApiKey).update(JSON.stringify(rest)).digest('hex');
  const expected = Buffer.from(hash);
  const received = Buffer.from(payload.verify_hash);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function createQrisCharge(order) {
  if (config.mockProviders) {
    return {
      providerRef: `mock-qris-${order.order_number}`,
      qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=MOCK-QRIS-${encodeURIComponent(order.order_number)}`,
      raw: { transaction_status: 'pending', mock: true },
    };
  }
  const response = await axios.post('https://api.sandbox.midtrans.com/v2/charge', {
    payment_type: 'qris',
    transaction_details: { order_id: order.order_number, gross_amount: Number(order.amount_idr) },
  }, { auth: { username: config.midtransServerKey, password: '' }, timeout: 10000 });
  const action = response.data.actions?.find((item) => item.name === 'generate-qr-code') || response.data.actions?.[0];
  return { providerRef: response.data.transaction_id || order.order_number, qrUrl: action?.url, raw: response.data };
}

async function createCryptoInvoice(order) {
  const amountUsd = Number(order.amount_idr) / config.usdIdrRate;
  if (config.mockProviders) {
    return {
      providerRef: `mock-crypto-${order.order_number}`,
      invoiceUrl: `https://plisio.net/invoice/mock-${encodeURIComponent(order.order_number)}`,
      cryptoCurrency: 'USDT',
      cryptoNetwork: config.cryptoNetwork,
      cryptoAddress: `MOCK_WALLET_${order.order_number}`,
      cryptoAmount: amountUsd.toFixed(2),
      raw: { status: 'new', mock: true, source_amount: amountUsd, currency: 'USDT', network: config.cryptoNetwork },
    };
  }
  const response = await axios.get('https://api.plisio.net/api/v1/invoices/new', {
    params: {
      api_key: config.plisioApiKey,
      source_currency: 'USD', source_amount: amountUsd.toFixed(2),
      order_number: order.order_number, currency: 'USDT', network: config.cryptoNetwork,
      callback_url: `${config.publicBaseUrl}/webhooks/plisio`,
      order_name: `Order ${order.order_number}`,
      expire_min: config.expiryMinutes,
    }, timeout: 10000,
  });
  const invoice = response.data.data;
  return { providerRef: invoice.txn_id, invoiceUrl: invoice.invoice_url, cryptoCurrency: invoice.currency, cryptoNetwork: invoice.network || config.cryptoNetwork, cryptoAddress: invoice.wallet_hash || invoice.wallet_address || null, cryptoAmount: invoice.invoice_total_sum, raw: response.data };
}

module.exports = { createQrisCharge, createCryptoInvoice, verifyMidtransSignature, verifyPlisioCallback };
