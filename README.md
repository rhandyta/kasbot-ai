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

### HTTP Server (Express)

- Default berjalan di port `3000` (bisa diubah dengan env `PORT`)
- Endpoint healthcheck: `GET /health`
- Endpoint `/api/*` bisa diaktifkan dengan env `HTTP_API_KEY` (request harus membawa header `x-api-key`)

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
  - `laporan` – Menampilkan menu periode laporan.
  - `export <periode>` – Export transaksi jadi CSV (contoh: `export bulan ini`).
  - `struk terakhir` – Mengirim file struk terakhir yang tersimpan.
  - `undo` / `batal` – Membatalkan transaksi terakhir.
  - `edit transaksi terakhir jumlah <jumlah>` – Mengubah nominal transaksi terakhir.
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

Bot akan membalas dengan konfirmasi jika data berhasil dicatat di database.

Catatan:
- Beberapa perintah sensitif (token/invite/akses/export/struk) hanya bisa dipakai lewat chat pribadi (bukan grup).

## ✨ Fitur Baru

Berikut adalah fitur-fitur baru yang telah ditambahkan untuk meningkatkan kemampuan bot:

### 🔍 Pencarian Transaksi
- Gunakan perintah `cari <keyword>` untuk mencari transaksi berdasarkan kata kunci dalam deskripsi atau nama item.
- Contoh: `cari parkir` akan menampilkan semua transaksi yang mengandung kata "parkir".

### ✏️ Edit Transaksi Terakhir
- Gunakan perintah `edit transaksi terakhir jumlah <jumlah baru>` untuk mengubah nominal transaksi terakhir.
- Contoh: `edit transaksi terakhir jumlah 75000` akan mengubah nominal transaksi terakhir menjadi 75.000.

### 🌐 Dukungan Multi-Mata Uang
- Setiap transaksi dapat dicatat dalam mata uang yang berbeda (IDR, USD, EUR).
- Gunakan perintah `set currency <kode>` untuk mengubah preferensi mata uang Anda (contoh: `set currency USD`).
- Laporan otomatis akan dikonversi ke mata uang yang Anda pilih.

### 🖼️ Optimasi OCR dengan Preprocessing Gambar
- Gambar struk akan diproses terlebih dahulu menggunakan `jimp` (grayscale, kontras, resizing) sebelum dikenali oleh EasyOCR.
- Meningkatkan akurasi pengenalan teks pada gambar dengan pencahayaan buruk atau noise.

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
- Bisa koreksi sebelum simpan:
  - `ubah transaksi <n> jumlah <angka>`
  - `ubah transaksi <n> kategori <teks>`
  - `ubah transaksi <n> keterangan <teks>`
  - `ubah transaksi <n> tanggal YYYY-MM-DD`

### 📄 Export CSV
- Export transaksi jadi CSV untuk periode tertentu.
- Contoh: `export bulan ini`, `export 3 hari terakhir`, `export tahun ini`, atau `export 10 transaksi terakhir`.

### 📎 Ambil Struk Terakhir
- Kirim `struk terakhir` untuk mendapatkan file struk terakhir yang tersimpan.

### 🎯 Budget Bulanan per Kategori
- Set budget: `budget set <kategori> <jumlah>`
- Lihat status: `budget list`

### 🔁 Transaksi Berulang
- Tambah: `ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>`
- Lihat: `ulang list`
- Nonaktif: `ulang hapus <id>`

### 🧾 Deteksi Duplikat Struk
- Jika struk yang sama terkirim lagi, bot akan memberi peringatan “kemungkinan duplikat” di preview.

### 🧾 Audit Log
- Perubahan penting (buat invite, join token, insert/edit/hapus transaksi) dicatat di tabel `audit_logs`.
