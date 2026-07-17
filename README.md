# Tele-Extractor

Telegram bot yang menerima gambar poster lowongan pekerjaan, mengekstrak informasinya menggunakan AI (OpenAI-compatible API), lalu menyimpan hasilnya ke Google Sheets.

## Fitur

- Terima gambar poster lowongan via Telegram
- Ekstrak data terstruktur (nama perusahaan, judul lowongan, posisi, lokasi, syarat, deskripsi, dll.) menggunakan AI vision model
- Simpan hasil ke Google Sheets
- Simpan log hasil ekstraksi ke file JSON lokal
- Whitelist chat ID untuk keamanan (hanya chat tertentu yang bisa menggunakan bot)
- Health check endpoint (`GET /health`)
- Siap production dengan PM2 cluster mode

## Persyaratan

- Node.js 18+ (native `fetch` support)
- Telegram Bot Token (dari [@BotFather](https://t.me/BotFather))
- API key OpenAI-compatible (OpenAI, OpenRouter, atau local LLM)
- Google Service Account + Google Sheet

## Instalasi

```bash
# Clone repo
git clone <repo-url>
cd tele-extractor

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

Edit `.env` dan isi semua variabel yang diperlukan (lihat [Konfigurasi](#konfigurasi)).

## Konfigurasi

| Variabel | Wajib | Deskripsi |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token bot dari @BotFather |
| `ALLOWED_CHAT_ID` | ✅ | ID chat Telegram yang diizinkan (bisa angka atau string) |
| `AI_BASE_URL` | ✅ | Base URL API endpoint, contoh: `https://api.openai.com/v1` |
| `AI_API_KEY` | ✅ | API key untuk AI service |
| `AI_MODEL` | ✅ | Nama model, contoh: `gpt-4o`, `gpt-4o-mini` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | Email service account dari Google Cloud |
| `GOOGLE_PRIVATE_KEY` | ✅ | Private key service account |
| `GOOGLE_SHEET_ID` | ✅ | ID Google Sheet (string panjang di URL spreadsheet) |
| `GOOGLE_SHEET_NAME` | ❌ | Nama sheet/tab dalam spreadsheet (default: `Sheet1`). Contoh: `Loker` |
| `PORT` | ❌ | Port HTTP server (default: `4746`) |
| `NODE_ENV` | ❌ | `development` atau `production` (default: `development`) |

### Cara Mendapatkan Konfigurasi

**Google Sheets:**

1. Buka [Google Cloud Console](https://console.cloud.google.com/), buat project baru
2. Aktifkan **Google Sheets API**
3. Buat **Service Account**, download JSON key-nya
4. Copy `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY`
5. Buat Google Sheet baru, share ke email service account sebagai **Editor**
6. Copy ID spreadsheet dari URL: `https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/edit`
7. Set `GOOGLE_SHEET_NAME` di `.env` sesuai nama sheet/tab yang digunakan (default: `Sheet1`). Misal sheet bernama "Loker", set `GOOGLE_SHEET_NAME=Loker`

> **Header Sheet:** Baris pertama sheet akan dibaca sebagai header kolom. Bot akan mencocokkan key hasil ekstraksi dengan header secara otomatis. Tambahkan kolom `Time` atau `Tanggal` untuk diisi otomatis dengan timestamp.

**Google Private Key:** Jika menggunakan kutip satu baris, ganti newline dengan `\n`. Jika menggunakan multiline (kutip backtick), pastikan indentasi benar.

## Cara Pakai

**Development:**

```bash
npm run dev
```

**Production (PM2):**

```bash
npm start
# atau langsung
pm2 start ecosystem.config.js
```

PM2 service name: `tele-extractor`. Manage with:

```bash
pm2 status
pm2 logs tele-extractor
pm2 restart tele-extractor
pm2 stop tele-extractor
```

Setelah bot berjalan:

1. Buka Telegram, cari username bot Anda
2. Kirim **gambar** poster lowongan pekerjaan
3. Bot akan membalas ✅ jika berhasil, ❌ jika gagal
4. Data otomatis masuk ke Google Sheets

## Struktur Project

```
tele-extractor/
├── src/
│   ├── index.js              # Entry point, HTTP health check
│   ├── config/
│   │   └── config.js         # Validasi & ekspor env variables
│   ├── services/
│   │   ├── telegram.js       # Bot Telegram (download, kirim balasan)
│   │   ├── ai.js             # AI extraction (image-to-structured JSON)
│   │   └── sheets.js         # Google Sheets appendRow
│   └── utils/
│       ├── fileHelper.js     # Helper file system (cleanup)
│       └── logger.js         # Winston logger
├── logs/                     # Log hasil ekstraksi (JSON), di-.gitignore
├── .env.example
├── .gitignore
├── ecosystem.config.js       # PM2 cluster config
├── package.json
└── README.md
```

## Catatan

- Bot hanya memproses pesan **gambar** dari chat yang ada di `ALLOWED_CHAT_ID`
- File gambar di-download ke `/tmp`, lalu dihapus otomatis setelah diproses
- Hasil ekstraksi disimpan sebagai file JSON di `logs/` untuk audit trail
- AI prompt dirancang untuk poster lowongan kerja (mendukung Bahasa Indonesia & Inggris)
- Bot menggunakan `fetch` native (Node 18+), tidak perlu dependency `axios` atau `node-fetch`
