const form = document.querySelector('#checkout-form');
const result = document.querySelector('#result');
const amountInput = document.querySelector('#amount');
const quote = document.querySelector('#quote');
const submitButton = document.querySelector('#submit-button');
const resetButton = document.querySelector('#reset-button');
const formError = document.querySelector('#form-error');
let quoteRequest;
let countdownTimer;
let statusTimer;
const savedOrderKey = 'unified-pay-active-order';

const formatIdr = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
const formatUsdt = (value) => `${Number(value).toFixed(2)} USDT`;
const formatDateTime = (value) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const friendlyError = (code) => ({
  database_unavailable: 'Database sedang tidak tersedia. Coba lagi sebentar.',
  database_schema_outdated: 'Database belum diperbarui. Jalankan schema terbaru lalu restart server.',
  payment_provider_unavailable: 'Gateway pembayaran tidak merespons. Order belum dibuat, silakan coba lagi.',
  amount_below_minimum: 'Nominal berada di bawah minimum metode pembayaran ini.',
}[code] || 'Instruksi pembayaran gagal dibuat. Silakan coba lagi.');

function selectedMethod() {
  return form.elements.paymentMethod.value;
}

async function refreshQuote() {
  const amountIdr = Number(amountInput.value);
  const paymentMethod = selectedMethod();
  if (!amountIdr) return;
  if (quoteRequest) quoteRequest.abort();
  quoteRequest = new AbortController();
  const response = await fetch(`/api/payment-quote?amountIdr=${amountIdr}&paymentMethod=${paymentMethod}`, { signal: quoteRequest.signal });
  const data = await response.json();
  quote.dataset.valid = data.isValid;
  quote.innerHTML = paymentMethod === 'crypto'
    ? `<strong>≈ ${formatUsdt(data.amountUsd)} · network ${data.cryptoNetwork}</strong><small>Kurs 1 USD = ${formatIdr(data.exchangeRate)} · diambil ${formatDateTime(data.quoteCreatedAt)}</small><small>Fee estimasi gateway ${formatIdr(data.gatewayFeeIdr)} · fee network ${formatIdr(data.networkFeeIdr)} (${data.networkFeeSource})</small>${data.isValid ? '' : `<b>Minimum crypto ${formatIdr(data.minimumIdr)}.</b>`}`
    : `<strong>Fee MDR estimasi ${formatIdr(data.feeIdr)}</strong><small>Minimum QRIS ${formatIdr(data.minimumIdr)} · fee dapat mengikuti provider</small>`;
}

function startCountdown(expiresAt) {
  clearInterval(countdownTimer);
  const update = () => {
    const seconds = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
    const target = document.querySelector('#countdown');
    if (!target) return clearInterval(countdownTimer);
    target.textContent = seconds > 0 ? `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')} tersisa` : 'Kedaluwarsa';
    if (!seconds) document.querySelector('#expiry-note').textContent = 'Order otomatis expired. Buat order baru untuk mencoba lagi.';
    if (!seconds) clearInterval(countdownTimer);
  };
  update();
  countdownTimer = setInterval(update, 1000);
}

function copyOrderNumber(orderNumber) {
  navigator.clipboard.writeText(orderNumber).then(() => {
    const button = document.querySelector('#copy-order');
    if (button) button.textContent = 'Tersalin';
  });
}

function renderOrder(order) {
  const isQris = order.payment_method === 'qris';
  const cryptoAddress = order.crypto_address ? `<p><span>Alamat tujuan</span><strong class="wallet-address">${order.crypto_address} <button id="copy-wallet" class="copy-button" type="button">Salin</button></strong></p>` : `<p class="notice">Alamat wallet final ditampilkan di invoice provider. Pastikan network dan alamat di invoice cocok sebelum membayar.</p>`;
  const cryptoDetails = !isQris ? `<p><span>Jumlah bayar</span><strong>${formatUsdt(order.crypto_amount || order.amount_usd)}</strong></p><p><span>Network</span><strong>${order.crypto_network || 'TRC20'}</strong></p>${cryptoAddress}<p><span>Kurs dikunci</span><strong>${formatIdr(order.crypto_exchange_rate)}<small class="subtle"> · ${formatDateTime(order.crypto_exchange_rate_at)}</small></strong></p><p class="notice">Kirim USDT hanya melalui network ${order.crypto_network || 'TRC20'}. Network lain dapat menyebabkan dana hilang.</p>` : '';
  form.hidden = true;
  result.hidden = false;
  result.className = `result ${order.status === 'failed' || order.status === 'expired' ? 'result-failed' : ''}`;
  result.innerHTML = `<p class="success"><strong>${order.status === 'failed' ? 'Pembayaran gagal' : order.status === 'expired' ? 'Order sudah expired' : isQris ? 'QRIS siap dipindai' : 'Invoice crypto siap dibayar'}</strong></p>${order.status === 'pending' ? (isQris ? `<img src="${order.qr_url}" alt="QR pembayaran ${order.order_number}">` : `<p><a class="invoice-link" href="${order.invoice_url}" target="_blank" rel="noreferrer">Buka invoice crypto →</a></p>`) : ''}<div class="order-summary"><p><span>Order</span><strong><code>${order.order_number}</code> <button id="copy-order" class="copy-button" type="button">Salin</button></strong></p><p><span>Nominal</span><strong>${formatIdr(order.amount_idr)}</strong></p>${cryptoDetails}<p><span>Fee gateway</span><strong>${formatIdr(order.gateway_fee_idr || 0)}</strong></p><p><span>Fee network</span><strong>${formatIdr(order.network_fee_idr || 0)}</strong></p><p><span>Status</span><strong>${order.status}</strong></p><p><span>Kedaluwarsa</span><strong id="countdown">--:-- tersisa</strong></p></div><p id="expiry-note" class="note">Setelah waktu habis, order otomatis expired dan invoice tidak boleh dibayar.</p>`;
  resetButton.hidden = false;
  document.querySelector('#copy-order').addEventListener('click', () => copyOrderNumber(order.order_number));
  const copyWallet = document.querySelector('#copy-wallet');
  if (copyWallet) copyWallet.addEventListener('click', () => navigator.clipboard.writeText(order.crypto_address).then(() => { copyWallet.textContent = 'Tersalin'; }));
  if (order.status === 'pending') startCountdown(order.expires_at);
}

function monitorOrder(order) {
  clearInterval(statusTimer);
  statusTimer = setInterval(async () => {
    const response = await fetch(`/api/orders/${encodeURIComponent(order.order_number)}`);
    if (!response.ok) return;
    const latest = await response.json();
    if (latest.status !== order.status) {
      order = latest;
      localStorage.setItem(savedOrderKey, JSON.stringify(order));
      renderOrder(order);
    }
    if (['paid', 'settled', 'expired', 'failed'].includes(latest.status)) clearInterval(statusTimer);
  }, 15000);
}

function restoreOrder() {
  const saved = localStorage.getItem(savedOrderKey);
  if (!saved) return;
  try {
    const order = JSON.parse(saved);
    if (new Date(order.expires_at) > Date.now() && order.status === 'pending') {
      renderOrder(order);
      monitorOrder(order);
    } else {
      localStorage.removeItem(savedOrderKey);
    }
  } catch {
    localStorage.removeItem(savedOrderKey);
  }
}

amountInput.addEventListener('input', () => refreshQuote().catch(() => {}));
form.querySelectorAll('input[name="paymentMethod"]').forEach((input) => input.addEventListener('change', () => refreshQuote().catch(() => {})));
refreshQuote().catch(() => {});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  submitButton.disabled = true;
  submitButton.innerHTML = 'Membuat instruksi pembayaran...';
  result.hidden = false;
  result.className = 'result';
  result.textContent = 'Membuat instruksi pembayaran...';
  const data = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountIdr: Number(data.amountIdr), paymentMethod: data.paymentMethod }) });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error === 'amount_below_minimum' ? `Minimum crypto adalah ${formatIdr(order.minimumIdr)}.` : friendlyError(order.error));
    localStorage.setItem(savedOrderKey, JSON.stringify(order));
    renderOrder(order);
    monitorOrder(order);
  } catch (error) {
    result.hidden = true;
    formError.hidden = false;
    formError.textContent = error.message;
    submitButton.disabled = false;
    submitButton.innerHTML = 'Buat instruksi pembayaran <span>→</span>';
  }
});

resetButton.addEventListener('click', () => {
  clearInterval(countdownTimer);
  form.reset();
  form.hidden = false;
  result.hidden = true;
  resetButton.hidden = true;
  submitButton.disabled = false;
  submitButton.innerHTML = 'Buat instruksi pembayaran <span>→</span>';
  localStorage.removeItem(savedOrderKey);
  clearInterval(statusTimer);
  refreshQuote().catch(() => {});
});

restoreOrder();
