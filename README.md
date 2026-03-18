# Asisten Keuangan WhatsApp Cerdas

Project ini adalah bot WhatsApp yang berfungsi sebagai asisten keuangan pribadi. Dibangun dengan Node.js, bot ini mampu memahami input bahasa natural, membaca teks dari gambar struk (OCR dengan preprocessing gambar), dan secara otomatis mencatat transaksi ke dalam database MySQL. Dilengkapi dengan fitur pencarian dan edit transaksi, dukungan multi-mata uang, serta caching respons AI untuk mengurangi biaya API.

## 🛠️ Stack Teknologi

- **Backend**: Node.js + ExpressJS
- **WhatsApp API**: `whatsapp-web.js`
- **QR Code**: `qrcode-terminal`
- **OCR**: `EasyOCR` (Python) dengan dukungan bahasa Indonesia & Inggris
- **Image Preprocessing**: `jimp` (grayscale, contrast, resizing)
- **AI (NLP)**: DeepSeek AI via `openai` library
- **Caching**: `lru-cache` untuk mengurangi API calls dan meningkatkan kecepatan
- **Database**: `mysql2`
- **Environment**: `dotenv`

## 📋 Prasyarat

- [Node.js](https://nodejs.org/) (v16 atau lebih baru)
- Server [MySQL](https://www.mysql.com/)

## 🚀 Instalasi & Konfigurasi

1.  **Clone atau Unduh Kode**
    ```bash
    git clone https://github.com/your-username/wa-finance-bot.git
    cd wa-finance-bot
    ```

2.  **Install Dependencies**
    Jalankan perintah berikut di terminal:
    ```bash
    npm install
    ```

3.  **Setup Database**
    - Buat sebuah database baru di server MySQL Anda (contoh: `wa_finance`).
    - Impor skema tabel dengan menjalankan isi dari file `setup.sql` di database Anda. Skema akan membuat tabel `transactions`, `transaction_items`, `user_settings`, `accounts`/`account_members`, `account_invites`, `audit_logs`, `budgets`, dan `recurring_rules`.

4.  **Konfigurasi Environment**
    - Salin file `.env.example` menjadi file baru bernama `.env`.
      ```bash
      # Di Windows
      copy .env.example .env
      
      # Di macOS/Linux
      cp .env.example .env
      ```
    - Buka file `.env` dan isi semua nilai yang diperlukan:
      - `DB_HOST`: Alamat host database Anda.
      - `DB_USER`: Username untuk koneksi database.
      - `DB_PASSWORD`: Password untuk koneksi database.
      - `DB_NAME`: Nama database yang Anda buat.
      - `DEEPSEEK_API_KEY`: API key Anda dari DeepSeek AI.

## ▶️ Menjalankan Aplikasi

Setelah semua konfigurasi selesai, jalankan bot dengan perintah:
```bash
npm start
```

Tunggu beberapa saat, sebuah QR code akan muncul di terminal. Pindai (scan) QR code tersebut menggunakan aplikasi WhatsApp di ponsel Anda (dari menu Perangkat Tertaut / Linked Devices).

Setelah berhasil, Anda akan melihat pesan "Client is ready!" di terminal.

### Menjalankan dengan Docker

```bash
docker compose up --build
```

### Menjalankan dengan PM2

```bash
npm install -g pm2
npm run start:pm2
```

### HTTP Server (Express)

- Default berjalan di port `3000` (bisa diubah dengan env `PORT`)
- Endpoint healthcheck: `GET /health`
- Endpoint metrics: `GET /metrics`
- Endpoint `/api/*` bisa diaktifkan dengan env `HTTP_API_KEY` (request harus membawa header `x-api-key`)
- Import statement CSV: `POST /api/import/statement`

### API Dashboard (Web)

- Summary: `GET /api/dashboard/summary?accountId=1&start=2026-03-01&end=2026-03-31&currency=IDR`
- Timeseries: `GET /api/dashboard/timeseries?accountId=1&start=2026-03-01&end=2026-03-31&bucket=day&currency=IDR`
- Breakdown kategori: `GET /api/dashboard/by-category?accountId=1&start=2026-03-01&end=2026-03-31&type=OUT&limit=20&currency=IDR`
- Breakdown merchant: `GET /api/dashboard/by-merchant?accountId=1&start=2026-03-01&end=2026-03-31&type=OUT&limit=20&currency=IDR`
- Budget status: `GET /api/dashboard/budget-status?accountId=1&month=2026-03&currency=IDR`

API transaksi:
- List/pagination: `GET /api/transactions?accountId=1&start=2026-03-01&end=2026-03-31&type=OUT&limit=20&offset=0`
- Search: `GET /api/transactions?accountId=1&q=parkir&limit=20&offset=0`
- Detail: `GET /api/transactions/123?accountId=1`

Audit log:
- `GET /api/audit?accountId=1&limit=50&offset=0`

Catatan Docker:
- Di Docker, gunakan env `PYTHON_BIN=python3` jika command `python` tidak tersedia.

Contoh request import:
```bash
curl -X POST http://localhost:3000/api/import/statement ^
  -H "content-type: application/json" ^
  -H "x-api-key: change-me" ^
  -d "{\"accountId\":1,\"dryRun\":true,\"csv\":\"date,amount,description\\n2026-03-01,12000,Grab Food\\n\"}"
```

## 🤖 Cara Menggunakan Bot

Anda bisa berinteraksi dengan bot melalui beberapa cara:

- **Pesan Teks Langsung**: Kirim pesan dalam bahasa sehari-hari.
  - > *tadi bayar parkir 5000*
  - > *dapet transferan 1.5 juta dari klien*

- **Kirim Gambar Struk**: Kirim foto struk atau bukti transfer tanpa teks tambahan. Bot akan memindai gambar tersebut.

- **Kirim Gambar + Teks**: Kirim foto bukti pembayaran beserta caption untuk memberikan konteks tambahan.
  - > *(Gambar struk bensin)* > *Isi Pertamax 250rb*

- **Perintah Tambahan**:
  - `cari <keyword>` – Mencari transaksi berdasarkan kata kunci.
  - `cari <keyword> page <n>` – Pagination hasil pencarian.
  - `laporan` – Menampilkan menu periode laporan.
  - `export ringkas <periode>` – Export CSV ringkas (contoh: `export ringkas bulan ini`).
  - `export detail <periode>` – Export CSV per-item (contoh: `export detail bulan ini`).
  - `export 2026-03-01 2026-03-31` – Export range custom.
  - `struk terakhir` – Mengirim file struk terakhir yang tersimpan.
  - `undo` / `batal` – Membatalkan transaksi terakhir.
  - `undo kembali` – Mengembalikan transaksi terakhir yang dibatalkan.
  - `edit transaksi terakhir jumlah <jumlah>` – Mengubah nominal transaksi terakhir.
  - `edit transaksi <id> jumlah <jumlah>` – Mengubah nominal transaksi berdasarkan ID.
  - `hapus transaksi <id>` – Menghapus transaksi berdasarkan ID (bisa di-undo dengan `undo kembali`).
  - `set currency <kode>` – Mengubah preferensi mata uang (IDR, USD, EUR).
  - `help` / `menu` – Menampilkan daftar perintah.
  - `budget set <kategori> <jumlah>` – Set budget kategori bulan ini.
  - `budget list` – Melihat status budget bulan ini.
  - `ulang list` – List transaksi berulang.
  - `ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>` – Tambah transaksi berulang.
  - `ulang hapus <id>` – Menonaktifkan transaksi berulang.
  - `token` – Menampilkan token akun aktif (khusus owner).
  - `token reset` – Reset token akun aktif (khusus owner).
  - `pakai token <token>` – Masuk ke akun orang lain untuk monitoring (read-only).
  - `monitor off` – Kembali ke akun kamu sendiri.
  - `akun` – Menampilkan daftar akun yang kamu punya akses.
  - `akun pilih <nomor>` – Mengganti akun aktif.
  - `akun baru` – Membuat akun baru (pencatatan terpisah).
  - `invite` – Membuat token invite viewer (single-use, 30 hari).
  - `invite editor` – Membuat token invite editor (bisa mencatat).
  - `invite list` – Melihat daftar invite.
  - `invite cabut <id>` – Mencabut invite tertentu.
  - `akses list` – Melihat member yang punya akses ke akun aktif.
  - `akses cabut <user_id>` – Mencabut akses user tertentu (khusus owner).
  - `kategori list` – Menampilkan daftar kategori akun.
  - `kategori tambah <nama>` – Menambah kategori baru.
  - `kategori map <keyword> => <kategori>` – Mapping keyword merchant ke kategori.
  - `kategori rules` – Menampilkan daftar mapping.
  - `merchant map <keyword> => <merchant>` – Normalisasi nama merchant.
  - `merchant rules` – Menampilkan daftar mapping merchant.

Bot akan membalas dengan konfirmasi jika data berhasil dicatat di database.

Catatan:
- Beberapa perintah sensitif (token/invite/akses/export/struk) hanya bisa dipakai lewat chat pribadi (bukan grup).

## ✨ Fitur Baru

Berikut adalah fitur-fitur baru yang telah ditambahkan untuk meningkatkan kemampuan bot:

### 🔍 Pencarian Transaksi
- Gunakan perintah `cari <keyword>` untuk mencari transaksi berdasarkan kata kunci dalam deskripsi atau nama item.
- Contoh: `cari parkir` akan menampilkan semua transaksi yang mengandung kata "parkir".

### 💬 Interactive Messages (List/Buttons)
- Pada beberapa flow (contoh: `laporan`, preview transaksi, dan pilih kategori), bot akan mengirim List/Buttons agar lebih enak ditap.
- Jika perangkat tidak mendukung, bot otomatis fallback ke perintah teks biasa.

### ✏️ Edit Transaksi Terakhir
- Gunakan perintah `edit transaksi terakhir jumlah <jumlah baru>` untuk mengubah nominal transaksi terakhir.
- Contoh: `edit transaksi terakhir jumlah 75000` akan mengubah nominal transaksi terakhir menjadi 75.000.

### 🌐 Dukungan Multi-Mata Uang
- Setiap transaksi dapat dicatat dalam mata uang yang berbeda (IDR, USD, EUR).
- Gunakan perintah `set currency <kode>` untuk mengubah preferensi mata uang Anda (contoh: `set currency USD`).
- Laporan otomatis akan dikonversi ke mata uang yang Anda pilih.

### 🖼️ Optimasi OCR dengan Preprocessing Gambar
- Gambar struk akan diproses terlebih dahulu menggunakan `jimp` (grayscale, normalize, kontras, denoise ringan) sebelum dikenali oleh EasyOCR.
- Meningkatkan akurasi pengenalan teks pada gambar dengan pencahayaan buruk atau noise.
- EasyOCR mencoba auto-rotate (0/90/180/270) dan akan fallback ke gambar mentah jika hasil preprocessing kosong.
- Ada post-processing untuk memperbaiki karakter yang sering tertukar (contoh: `01G` → `BIG`, `7OOGR` → `700GR`).

Env terkait OCR:
- `OCR_TIMEOUT_MS` (default 120000)
- `PYTHON_BIN` (default `python`)
- `OCR_LEXICON_EXTRA` (opsional, daftar kata dipisah koma untuk koreksi OCR, contoh: `OCR_LEXICON_EXTRA=INDOMARET,NISSIN,TANGO`)
- `OCR_DEBUG_SAVE` (opsional, simpan output OCR mentah & postprocess)

Evaluasi OCR batch:
```bash
node scripts/ocr_eval.js path\to\folder\images
```

### ⚡ Caching Respons AI
- Hasil pemrosesan AI untuk teks yang sama akan disimpan dalam cache menggunakan `lru-cache`.
- Mengurangi jumlah panggilan API dan mempercepat respons untuk permintaan yang berulang.

### 🗃️ Skema Database yang Diperluas
- Tabel `transactions` sekarang memiliki kolom `currency` (CHAR(3)) untuk menyimpan mata uang transaksi.
- Tabel `user_settings` untuk menyimpan preferensi mata uang per pengguna.

### 🔑 Token Monitoring (Sharing Akses)
- Setiap pencatatan berada di dalam sebuah akun (`accounts`).
- Owner bisa membagikan token agar orang lain bisa melihat laporan/pencarian (mode monitoring/read-only).
- Aksi yang mengubah data (mencatat, edit, batal) akan ditolak saat sedang mode monitoring.
- Untuk sharing yang lebih aman per orang, owner bisa pakai `invite` (token single-use) dan mencabut akses dengan `akses cabut`.

Contoh:
- Kamu kirim: `token` → dapat token
- Pacar kamu kirim: `pakai token <token-kamu>` → bisa lihat `laporan` dan `cari ...`

### ✅ Preview & Konfirmasi Sebelum Simpan
- Setelah kamu kirim transaksi (teks/foto struk), bot akan mengirim preview dulu.
- Balas `ok` untuk menyimpan atau `batal` untuk membatalkan.
- Jika ada validasi yang gagal, bot akan minta diperbaiki (atau gunakan `ok paksa`).
- Bot juga mendukung Interactive Messages (List/Buttons) untuk aksi cepat (OK/Batal/Lihat) dan pilih kategori/periode (jika client mendukung).
- Bisa koreksi sebelum simpan:
  - `ubah transaksi <n> jumlah <angka>`
  - `ubah transaksi <n> kategori <teks>`
  - `ubah transaksi <n> keterangan <teks>`
  - `ubah transaksi <n> tanggal YYYY-MM-DD`
  - `ubah transaksi <n> item tambah <nama> <qty> <harga>`
  - `ubah transaksi <n> item ubah <no> <qty> <harga>`
  - `ubah transaksi <n> item hapus <no>`

### 📄 Export CSV
- Export transaksi jadi CSV untuk periode tertentu.
- Mode ringkas: `export ringkas bulan ini`
- Mode detail per-item: `export detail bulan ini`
- Range custom: `export 2026-03-01 2026-03-31`
- Secara default kolom `receipt_path` tidak ditampilkan. Aktifkan dengan env `EXPORT_INCLUDE_RECEIPT_PATH=true`.

### ⏳ Retention Struk
- Fitur retention bersifat opsional (default nonaktif) agar struk tetap tersedia untuk kebutuhan audit.
- Aktifkan dengan env `RECEIPT_RETENTION_DAYS` (mis. `RECEIPT_RETENTION_DAYS=30`) untuk menghapus struk lama setelah N hari.

### 📎 Ambil Struk Terakhir
- Kirim `struk terakhir` untuk mendapatkan file struk terakhir yang tersimpan.

### 🎯 Budget Bulanan per Kategori
- Set budget: `budget set <kategori> <jumlah>`
- Lihat status: `budget list`
- Notifikasi otomatis saat pemakaian budget melewati 80% dan 100% (dikirim saat transaksi tersimpan).

### 🧾 Ringkasan Otomatis
- Ringkasan harian otomatis (sekitar jam 21:00).
- Ringkasan mingguan otomatis (Senin sekitar jam 09:00, untuk minggu sebelumnya).

### 🔁 Transaksi Berulang
- Tambah: `ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>`
- Lihat: `ulang list`
- Nonaktif: `ulang hapus <id>`

### 🧾 Deteksi Duplikat Struk
- Jika struk yang sama terkirim lagi, bot akan memberi peringatan “kemungkinan duplikat” di preview.
- Deteksi menggunakan kombinasi hash gambar, hash teks OCR, dan fingerprint transaksi.

### 🧾 Audit Log
- Perubahan penting (buat invite, join token, insert/edit/hapus transaksi) dicatat di tabel `audit_logs`.

## 🧰 Troubleshooting

- `/health` status 503
  - Cek `schema.missingTables/missingColumns` di response.
  - Cek Python EasyOCR (`python -c "import easyocr; print(1)"`) dan pastikan `PYTHON_BIN` sesuai.
- OCR lambat/timeout
  - Naikkan `OCR_TIMEOUT_MS` (contoh `180000`) dan coba lagi.
  - Aktifkan `OCR_DEBUG_SAVE=true` untuk menyimpan hasil OCR mentah & postprocess di `public/uploads/ocr_debug`.
- Error “Unknown column …”
  - Restart aplikasi supaya `ensureSchema()` menjalankan migrasi kolom yang missing.

## 🗄️ Backup & Restore (Audit)

- Backup (contoh MySQL):
  - `mysqldump -u <user> -p <db_name> > backup.sql`
- Restore:
  - `mysql -u <user> -p <db_name> < backup.sql`

## 🗺️ Catatan Roadmap

- Poin 2 (WhatsApp Cloud API) dan poin 3 (Dashboard admin) disimpan sebagai milestone berikutnya untuk stabilitas dan UX admin.
