require('dotenv').config();

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  port: numberEnv('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/crypto_payment',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  midtransServerKey: process.env.MIDTRANS_SERVER_KEY || '',
  plisioApiKey: process.env.PLISIO_API_KEY || '',
  mockProviders: process.env.MOCK_PROVIDERS !== 'false',
  expiryMinutes: numberEnv('PAYMENT_EXPIRY_MINUTES', 15),
  usdIdrRate: numberEnv('USD_IDR_RATE', 16000),
  cryptoMinimumIdr: numberEnv('CRYPTO_MINIMUM_IDR', 50000),
  qrisMinimumIdr: numberEnv('QRIS_MINIMUM_IDR', 1000),
  cryptoFeeRate: numberEnv('CRYPTO_GATEWAY_FEE_RATE', 0.01),
  cryptoFeeFlatIdr: numberEnv('CRYPTO_GATEWAY_FEE_FLAT_IDR', 2500),
  qrisFeeRate: numberEnv('QRIS_MDR_RATE', 0.007),
  cryptoNetwork: process.env.CRYPTO_NETWORK || 'TRC20',
  cryptoNetworkFeeIdr: numberEnv('CRYPTO_NETWORK_FEE_IDR', 1500),
  cryptoNetworkFeeSource: process.env.CRYPTO_NETWORK_FEE_SOURCE || 'sandbox estimate',
};
