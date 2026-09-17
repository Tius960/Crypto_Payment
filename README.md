# Unified Payment Service

Backend Node.js + Express yang menyatukan dua jalur pembayaran — **QRIS (via Midtrans)** dan **Crypto/USDT (via Plisio)** — ke dalam satu *order ledger* yang konsisten. Satu order, satu status, terlepas dari metode pembayaran yang dipilih pelanggan.

> Status proyek: **sandbox / development**. Lihat [Checklist Go-Live](#checklist-go-live) sebelum dipakai di produksi.

## Daftar Isi

- [Fitur](#fitur)
- [Tech Stack](#tech-stack)
- [Arsitektur & Alur Order](#arsitektur--alur-order)
- [Struktur Proyek](#struktur-proyek)
- [Menjalankan Secara Lokal](#menjalankan-secara-lokal)
- [Environment Variables](#environment-variables)
- [Skema Database](#skema-database)
- [API Reference](#api-reference)
- [Webhook & Verifikasi Signature](#webhook--verifikasi-signature)
- [State Machine Status Order](#state-machine-status-order)
- [Testing](#testing)
- [Checklist Go-Live](#checklist-go-live)
- [Lisensi](#lisensi)

## Fitur

- **Satu order, dua metode pembayaran** — checkout QRIS dan Crypto ditulis ke tabel `orders` yang sama, dengan detail spesifik provider di tabel `payments`.
- **Quote biaya transparan** — endpoint `payment-quote` menghitung estimasi kurs, gateway fee, dan network fee sebelum order dibuat.
- **Mode mock/sandbox** — `MOCK_PROVIDERS=true` menghasilkan QR code dan invoice simulasi tanpa memanggil API Midtrans/Plisio, cocok untuk demo dan pengembangan lokal.
- **Verifikasi webhook aman** — signature Midtrans (SHA-512) dan Plisio (HMAC-SHA1) diverifikasi dengan `crypto.timingSafeEqual` untuk mencegah timing attack, dan setiap payload webhook dicatat di `webhook_logs` (termasuk yang gagal verifikasi) untuk audit.
- **State machine anti-regresi** — transisi status order (`pending → paid → settled`, atau `pending → expired/failed`) divalidasi agar status tidak bisa mundur.
- **Auto-expiry** — job interval otomatis mengubah order `pending` yang sudah melewati `expires_at` menjadi `expired`.
- **Frontend checkout minimalis** — halaman statis (`public/`) untuk mendemokan alur checkout end-to-end.

## Tech Stack

| Layer      | Teknologi                                   |
|------------|----------------------------------------------|
| Runtime    | Node.js 20+ (native `--watch`, native `node:test`) |
| Framework  | Express 4                                   |
| Database   | PostgreSQL (driver `pg`)                    |
| HTTP client| axios (integrasi ke Midtrans & Plisio)      |
| Lainnya    | `dotenv`, `qrcode`                          |
| Frontend   | HTML/CSS/JS statis tanpa build step         |

## Arsitektur & Alur Order

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant S as Express Server
    participant P as Provider (Midtrans/Plisio)
    participant DB as PostgreSQL

    U->>S: GET /api/payment-quote?amountIdr&paymentMethod
    S-->>U: Estimasi kurs, fee, minimum

    U->>S: POST /api/orders {amountIdr, paymentMethod}
    S->>DB: BEGIN, INSERT orders (status=pending)
    S->>P: Buat charge QRIS / invoice crypto
    P-->>S: providerRef, qrUrl/invoiceUrl
    S->>DB: INSERT payments, COMMIT
    S-->>U: 201 Created (order + instruksi bayar)

    P->>S: POST /webhooks/midtrans | /webhooks/plisio
    S->>S: Verifikasi signature (timing-safe)
    S->>DB: INSERT webhook_logs (verified=true/false)
    alt signature valid
        S->>DB: UPDATE orders SET status (jika transisi valid)
        S-->>P: 200 {received: true}
    else signature tidak valid
        S-->>P: 401 invalid_signature
    end

    loop setiap 60 detik
        S->>DB: UPDATE orders SET status='expired' WHERE pending & expires_at lewat
    end
```

Order selalu dibuat dalam satu transaksi database (`orders` + `payments`) agar tidak ada order yang "menggantung" tanpa data pembayaran, dan sebaliknya.

## Struktur Proyek

```
Crypto Payment/
├── public/                # Frontend statis (checkout form)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── src/
│   ├── server.js          # Express app, routing, webhook handler, job expiry
│   ├── config.js          # Semua konfigurasi dari environment variables
│   ├── db.js               # PostgreSQL connection pool
│   ├── orders.js          # Business logic: quote, create order, apply provider update
│   ├── providers.js       # Integrasi Midtrans (QRIS) & Plisio (crypto) + verifikasi signature
│   └── state.js           # State machine status order & mapping status provider
├── test/
│   └── state.test.js      # Unit test state machine (node:test)
├── schema.sql              # DDL PostgreSQL (idempotent, aman dijalankan ulang)
├── .env.example
└── package.json
```

## Menjalankan Secara Lokal

**Prasyarat:** Node.js 20+ dan PostgreSQL berjalan lokal (atau via Docker).

1. Install dependencies:
   ```bash
   npm install
   ```
2. Salin file environment:
   ```bash
   cp .env.example .env
   ```
   Lalu sesuaikan `DATABASE_URL` dengan kredensial PostgreSQL Anda.
3. Buat database (jika belum ada) dan jalankan schema:
   ```bash
   psql "$DATABASE_URL" -f schema.sql
   ```
   *(Di PowerShell: `psql "$env:DATABASE_URL" -f schema.sql`)*
4. Jalankan server:
   ```bash
   npm start        # atau: npm run dev  (auto-restart saat file berubah)
   ```
5. Buka [http://localhost:3000](http://localhost:3000) untuk mencoba form checkout.

> Secara default `MOCK_PROVIDERS=true`, jadi Anda bisa langsung mencoba alur checkout QRIS/crypto tanpa API key provider apapun — server akan mengembalikan QR code dan invoice simulasi.

## Environment Variables

| Variable                     | Default                                                    | Keterangan                                                        |
|-------------------------------|--------------------------------------------------------------|---------------------------------------------------------------------|
| `PORT`                        | `3000`                                                        | Port HTTP server                                                    |
| `DATABASE_URL`                 | `postgres://postgres:postgres@localhost:5432/crypto_payment` | Connection string PostgreSQL                                       |
| `PUBLIC_BASE_URL`              | `http://localhost:3000`                                       | Base URL publik, dipakai sebagai `callback_url` Plisio             |
| `MIDTRANS_SERVER_KEY`          | *(kosong)*                                                     | Server key Midtrans (sandbox/production)                            |
| `PLISIO_API_KEY`               | *(kosong)*                                                     | API key Plisio                                                     |
| `MOCK_PROVIDERS`               | `true`                                                        | Set `false` untuk memanggil API Midtrans/Plisio sungguhan            |
| `PAYMENT_EXPIRY_MINUTES`       | `15`                                                           | Batas waktu order sebelum otomatis `expired`                         |
| `USD_IDR_RATE`                 | `16000`                                                       | Kurs manual USD → IDR untuk konversi ke crypto                      |
| `CRYPTO_MINIMUM_IDR`           | `50000`                                                       | Nominal minimum order untuk metode crypto                           |
| `QRIS_MINIMUM_IDR`             | `1000`                                                        | Nominal minimum order untuk metode QRIS                             |
| `CRYPTO_GATEWAY_FEE_RATE`      | `0.01`                                                        | Fee gateway crypto (persentase)                                     |
| `CRYPTO_GATEWAY_FEE_FLAT_IDR`  | `2500`                                                        | Fee gateway crypto (flat, IDR)                                      |
| `QRIS_MDR_RATE`                | `0.007`                                                       | Merchant Discount Rate QRIS (persentase)                            |
| `CRYPTO_NETWORK`               | `TRC20`                                                       | Network crypto default (mis. TRC20 untuk USDT)                      |
| `CRYPTO_NETWORK_FEE_IDR`       | `1500`                                                        | Estimasi network fee crypto                                         |
| `CRYPTO_NETWORK_FEE_SOURCE`    | `sandbox estimate`                                            | Label sumber estimasi network fee (ditampilkan di quote)            |
| `WEBHOOK_SECRET`               | *(kosong)*                                                     | Disediakan untuk pengamanan tambahan endpoint webhook (opsional)     |

**Jangan** commit file `.env` ke git — sudah dimasukkan ke `.gitignore` secara default.

## Skema Database

Tiga tabel utama (lihat `schema.sql` untuk DDL lengkap):

- **`orders`** — satu baris per order: nominal (IDR & USD), fee, metode pembayaran, `status`, dan `expires_at`. Kolom `status` dibatasi `CHECK` ke salah satu dari `pending | paid | settled | expired | failed`.
- **`payments`** — detail spesifik provider per order (1:1 via `UNIQUE (order_id)`): `qr_url`/`invoice_url`, data wallet crypto, dan `raw_response` (JSONB) dari provider. Kombinasi `(provider, provider_ref)` bersifat unik agar tidak ada duplikasi referensi pembayaran.
- **`webhook_logs`** — audit trail setiap callback masuk (verified maupun tidak), untuk investigasi dan rekonsiliasi.

Script `schema.sql` idempotent (aman dijalankan berulang kali) — memakai `CREATE TABLE IF NOT EXISTS` dan `ADD COLUMN IF NOT EXISTS`, sehingga bisa dipakai juga sebagai migrasi ringan.

## API Reference

### `GET /health`
Health check sederhana.
```json
{ "ok": true, "service": "unified-payment-service" }
```

### `GET /api/payment-quote`
Menghitung estimasi biaya **tanpa** membuat order.

Query params: `amountIdr` (number), `paymentMethod` (`qris` | `crypto`)

```
GET /api/payment-quote?amountIdr=50000&paymentMethod=crypto
```
```json
{
  "amountIdr": 50000,
  "amountUsd": 3.13,
  "paymentMethod": "crypto",
  "exchangeRate": 16000,
  "gatewayFeeIdr": 3000,
  "networkFeeIdr": 1500,
  "feeIdr": 4500,
  "cryptoNetwork": "TRC20",
  "minimumIdr": 50000,
  "isValid": true
}
```

### `POST /api/orders`
Membuat order baru dan instruksi pembayaran (QR code / invoice).

Body:
```json
{ "amountIdr": 50000, "paymentMethod": "qris" }
```

Respons `201 Created` berisi data order tergabung dengan detail pembayaran (`qr_url`, `invoice_url`, dll — lihat query di `getOrder`).

Kode error yang mungkin muncul:

| Status | Body                                              | Sebab                                             |
|--------|----------------------------------------------------|----------------------------------------------------|
| `400`  | `{ "error": "amountIdr positif dan paymentMethod qris/crypto wajib diisi" }` | Input tidak valid              |
| `400`  | `{ "error": "amount_below_minimum", ... }`         | Nominal di bawah minimum metode terkait            |
| `502`  | `{ "error": "payment_provider_unavailable" }`      | Gagal memanggil Midtrans/Plisio                    |
| `503`  | `{ "error": "database_unavailable" }`              | Koneksi database gagal                             |
| `500`  | `{ "error": "database_schema_outdated" }`          | Skema database belum sesuai (jalankan `schema.sql`)|

### `GET /api/orders/:orderNumber`
Mengambil status order + detail pembayaran berdasarkan `order_number` (format `ORD-...`). Mengembalikan `404 { "error": "order_not_found" }` jika tidak ditemukan.

### `POST /webhooks/midtrans`
Menerima callback status transaksi dari Midtrans. Signature diverifikasi (`signature_key`) sebelum status order diproses.

### `POST /webhooks/plisio`
Menerima callback status invoice dari Plisio. Signature diverifikasi (`verify_hash`) sebelum status order diproses.

## Webhook & Verifikasi Signature

- **Midtrans**: `SHA-512(order_id + status_code + gross_amount + server_key)`, dibandingkan dengan `signature_key` pada payload menggunakan `crypto.timingSafeEqual`.
- **Plisio**: `HMAC-SHA1` atas payload (tanpa field `verify_hash`, keys diurutkan) menggunakan `PLISIO_API_KEY` sebagai secret, dibandingkan dengan `verify_hash`.
- Semua payload webhook — valid maupun tidak — dicatat ke `webhook_logs` sebelum diproses lebih lanjut, sehingga setiap percobaan callback (termasuk yang mencurigakan) tetap tersimpan untuk audit.
- Webhook yang gagal verifikasi akan direspons `401` dan **tidak** mengubah status order apa pun.

## State Machine Status Order

```
pending ──► paid ──► settled
   │
   ├──► expired
   └──► failed
```

Aturan didefinisikan di `src/state.js` (`canTransition`) — transisi yang tidak terdaftar (misalnya `paid → pending`, atau dari status akhir seperti `settled`/`expired`/`failed` ke status lain) akan ditolak secara diam-diam (update di-skip, bukan error), untuk mencegah race condition antar webhook membuat status order mundur.

Mapping status mentah dari provider ke status internal (`providerStatusToOrderStatus`):

| Status Provider                                   | Status Internal |
|-----------------------------------------------------|-------------------|
| `settlement`, `capture`, `paid`, `completed`, `confirmed` | `paid`      |
| `expire`, `expired`, `cancel`, `cancelled`             | `expired`     |
| `deny`, `failure`, `failed`, `cancelled_by_user`       | `failed`      |
| Lainnya                                               | `pending`     |

## Testing

```bash
npm test
```

Menjalankan unit test bawaan Node.js (`node --test`) untuk `src/state.js` — memastikan aturan transisi status dan mapping status provider berjalan sesuai ekspektasi.

## Checklist Go-Live

- [ ] Jalankan `schema.sql` dan seluruh alur end-to-end di sandbox masing-masing provider.
- [ ] Gunakan HTTPS, simpan secret (server key, API key) di secret manager, dan pasang rate limiting di reverse proxy.
- [ ] Pastikan signature webhook selalu diverifikasi sebelum status order diubah (sudah diimplementasikan — jangan dilonggarkan).
- [ ] Pastikan unique constraint `(provider, provider_ref)` pada tabel `payments` tetap aktif untuk mencegah duplikasi.
- [ ] Jalankan rekonsiliasi berkala antara data payment provider dan tabel `orders`.
- [ ] Review kewajiban KYC/AML, screening wallet address, retensi data, dan regulasi terkait di Indonesia.
- [ ] Set `MOCK_PROVIDERS=false`, isi `MIDTRANS_SERVER_KEY`/`PLISIO_API_KEY` produksi, dan gunakan `PUBLIC_BASE_URL` HTTPS.
- [ ] Lakukan pilot dengan volume kecil terlebih dahulu, plus alerting untuk callback yang gagal atau order yang expired secara tidak wajar.

## Lisensi

Belum ditentukan — tambahkan file `LICENSE` sesuai kebutuhan sebelum dipublikasikan sebagai open source.
