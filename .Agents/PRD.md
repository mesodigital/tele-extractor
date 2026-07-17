Berikut adalah *Product Requirements Document* (PRD) komprehensif yang dirancang dengan arsitektur *scalable*, terstruktur rapi, dan mencakup standar pengelolaan dependensi serta sistem *logging* yang aman untuk perangkat dengan memori terbatas.

# PRD: Telegram Image-to-Sheets AI Extractor (Modular Architecture)

## 1. Ringkasan Proyek

Aplikasi *backend* berbasis Node.js yang bertugas menerima gambar dari Telegram, mengekstrak informasi spesifik dari gambar menggunakan model AI (dengan kompatibilitas OpenAI API), dan mencatat hasil ekstraksi ke Google Sheets. Arsitektur aplikasi dirancang modular agar fitur-fitur baru dapat ditambahkan dengan mudah (*scalable*) tanpa merusak kode utama, sekaligus menjaga efisiensi RAM dan CPU agar tetap optimal di *environment* berdaya rendah.

## 2. Spesifikasi Teknologi

* **Runtime:** Node.js
* **Process & Log Manager:** PM2 (dengan modul `pm2-logrotate`)
* **Package/Library Utama:**
* `node-telegram-bot-api`: Interaksi Telegram API (*Long Polling*).
* `openai`: *Client* universal untuk AI (mendukung OpenAI, Groq, Ollama, dll).
* `googleapis` atau `google-spreadsheet`: Interaksi dengan Google Sheets API.
* `dotenv`: Manajemen variabel lingkungan.
* `winston`: Sistem *logging* berjenjang (Info, Warn, Error).



## 3. Kebutuhan Fungsional (Functional Requirements)

1. **Penerimaan Pesan:** Bot memvalidasi `chat_id` pengirim. Pesan di luar ID yang diizinkan akan diabaikan secara diam-diam (*silent drop*) untuk menghemat *resource*.
2. **Pengolahan File Terisolasi:** File gambar diunduh ke direktori temporer (`/tmp`).
3. **Ekstraksi Fleksibel:** Sistem mengirim gambar dan instruksi ke *endpoint* AI yang dikonfigurasi secara dinamis melalui `.env`.
4. **Pencatatan Data:** Hasil ekstraksi (berupa JSON) diparsing dan ditambahkan ke baris baru di Google Sheets.
5. **Pembersihan Instan (Garbage Collection):** File lokal di `/tmp` harus langsung dihapus menggunakan perintah *unlink* sistem segera setelah proses AI selesai (baik statusnya berhasil maupun gagal/error) untuk mencegah penumpukan *storage*.
6. **Notifikasi Telegram:** Bot memberikan *feedback* sukses atau pesan *error* teknis kepada pengguna.

## 4. Kebutuhan Non-Fungsional (Non-Functional Requirements)

1. **Modularitas (Scalability):** Logika Telegram, AI, dan Google Sheets harus dipisah ke dalam *file/module* berbeda (Service Pattern).
2. **Manajemen Dependensi:** Semua *library* harus tercatat di `package.json` dan terisolasi di dalam `node_modules/`. Instalasi cukup menggunakan `npm install`.
3. **Keamanan Kredensial:** Seluruh konfigurasi rahasia wajib menggunakan `.env` dan diabaikan oleh Git (`.gitignore`).
4. **Sistem Logging Berjenjang:**
* **Console/Stdout:** Digunakan untuk *debug* dan *info* aktivitas (ditangkap oleh PM2).
* **File Log:** Hanya log berstatus `ERROR` yang disimpan ke *storage* internal untuk meminimalisir siklus tulis (*write cycle*) yang dapat merusak eMMC STB.


5. **Memory Footprint:** Harus berjalan stabil di bawah 50MB RAM saat *idle*.

## 5. Struktur Direktori (Scalable File Structure)

Struktur ini memisahkan konfigurasi, logika bisnis (*services*), dan utilitas pendukung agar kode tetap rapi saat proyek membesar.

```text
telegram-extractor/
├── .env                  # Variabel lingkungan rahasia (API Keys, Base URL)
├── .gitignore            # Mengabaikan node_modules, .env, dan file log lokal
├── package.json          # Definisi nama proyek, script npm, dan versi dependensi
├── package-lock.json     # Kunci versi dependensi yang pasti
├── ecosystem.config.js   # Konfigurasi PM2 (nama aplikasi, env vars, log paths)
└── src/
    ├── index.js          # Entry point utama (inisialisasi service dan listener)
    ├── config/
    │   └── config.js     # Validasi dan ekspor variabel dari .env secara terpusat
    ├── services/
    │   ├── telegram.js   # Logika bot (menerima pesan, download file, kirim balasan)
    │   ├── ai.js         # Logika instansiasi client OpenAI dan fungsi image-to-text
    │   └── sheets.js     # Logika otentikasi Google Service Account dan appendRow
    └── utils/
        ├── logger.js     # Konfigurasi Winston untuk debugging dan error logging
        └── fileHelper.js # Fungsi helper (misal: membersihkan file di /tmp)

```

## 6. Konfigurasi Lingkungan (`.env`)

```env
# Konfigurasi App & Log
NODE_ENV="production" # Ganti "development" untuk memunculkan log debug

# Konfigurasi Telegram
TELEGRAM_BOT_TOKEN="isi_dengan_token"
ALLOWED_CHAT_ID="isi_dengan_id_telegram"

# Konfigurasi AI (OpenAI Compatible)
AI_BASE_URL="https://api.openai.com/v1" 
AI_API_KEY="isi_dengan_api_key_provider"
AI_MODEL="gpt-4o-mini" 

# Konfigurasi Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL="email_service_account@developer.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID="id_spreadsheet"

```

## 7. Strategi Logging dan Debugging

Karena aplikasi berjalan di perangkat dengan penyimpanan rentan (*flash storage*), *logging* harus diatur secara strategis:

1. **Implementasi `winston` (di `src/utils/logger.js`):**
* Saat `NODE_ENV=development`: Tampilkan semua log (`debug`, `info`, `error`) ke layar terminal.
* Saat `NODE_ENV=production`: Tampilkan log `info` ke layar terminal (ditangani PM2), namun tulis log `error` ke dalam *file* (misalnya `logs/error.log`).


2. **Rotasi Log (PM2 Logrotate):**
* Wajib menginstal modul rotasi log PM2 untuk mencegah *file* log membengkak dan menghabiskan memori STB.
* Perintah setup: `pm2 install pm2-logrotate`
* Set maksimal ukuran file log ke 10MB: `pm2 set pm2-logrotate:max_size 10M`



## 8. Alur Eksekusi *Deployment*

1. **Persiapan Proyek:**
```bash
mkdir telegram-extractor
cd telegram-extractor
npm init -y

```


2. **Instalasi Dependensi:**
```bash
npm install node-telegram-bot-api openai google-spreadsheet dotenv winston

```


3. **Konfigurasi PM2:**
Jalankan `pm2 init simple` untuk membuat `ecosystem.config.js`. Konfigurasikan *file* tersebut untuk merujuk ke `src/index.js`.
4. **Menjalankan & Debugging:**
* Uji coba manual: `node src/index.js`
* Menjalankan di *background*: `pm2 start ecosystem.config.js`
* Memantau log *real-time*: `pm2 logs telegram-extractor`


5. **Autostart:**
```bash
pm2 save
pm2 startup

```
