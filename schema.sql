CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(64) UNIQUE NOT NULL,
  amount_idr NUMERIC(14, 2) NOT NULL CHECK (amount_idr > 0),
  amount_usd NUMERIC(14, 2),
  fee_idr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gateway_fee_idr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  network_fee_idr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  crypto_exchange_rate NUMERIC(14, 2),
  crypto_exchange_rate_at TIMESTAMPTZ,
  payment_method VARCHAR(16) NOT NULL CHECK (payment_method IN ('qris', 'crypto')),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'settled', 'expired', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  provider VARCHAR(32) NOT NULL,
  provider_ref VARCHAR(128) NOT NULL,
  qr_url TEXT,
  invoice_url TEXT,
  crypto_currency VARCHAR(16),
  crypto_network VARCHAR(16),
  crypto_address TEXT,
  crypto_amount NUMERIC(30, 12),
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref),
  UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(32) NOT NULL,
  provider_ref VARCHAR(128),
  payload JSONB NOT NULL,
  verified BOOLEAN NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_status_expiry_idx ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS webhook_logs_provider_ref_idx ON webhook_logs(provider, provider_ref);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fee_idr NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS crypto_exchange_rate NUMERIC(14, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_fee_idr NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS network_fee_idr NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS crypto_exchange_rate_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_network VARCHAR(16);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_address TEXT;
