# Asisten Keuangan WhatsApp Cerdas

Project ini adalah bot WhatsApp yang berfungsi sebagai asisten keuangan pribadi. Dibangun dengan Node.js, bot ini mampu memahami input bahasa natural, membaca teks dari gambar struk (OCR dengan preprocessing gambar), dan secara otomatis mencatat transaksi ke dalam database MySQL. Dilengkapi dengan fitur pencarian dan edit transaksi, dukungan multi-mata uang, serta caching respons AI untuk mengurangi biaya API.

## 🛠️ Stack Teknologi

- **Backend**: Node.js
- **WhatsApp API**: `whatsapp-web.js`
- **QR Code**: `qrcode-terminal`
- **OCR**: `tesseract.js` dengan preprocessing gambar menggunakan `jimp`
- **Image Preprocessing**: `jimp` (grayscale, contrast, thresholding)
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
    - Impor skema tabel dengan menjalankan isi dari file `setup.sql` di database Anda. Skema akan membuat tabel `transactions` (dengan kolom `currency`), `transaction_items`, dan `user_settings` untuk preferensi mata uang.

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
node src/index.js
```

Tunggu beberapa saat, sebuah QR code akan muncul di terminal. Pindai (scan) QR code tersebut menggunakan aplikasi WhatsApp di ponsel Anda (dari menu Perangkat Tertaut / Linked Devices).

Setelah berhasil, Anda akan melihat pesan "Client is ready!" di terminal.

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
  - `edit transaksi terakhir jumlah <jumlah>` – Mengubah nominal transaksi terakhir.
  - `set currency <kode>` – Mengubah preferensi mata uang (IDR, USD, EUR).

Bot akan membalas dengan konfirmasi jika data berhasil dicatat di database.

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
- Gambar struk akan diproses terlebih dahulu menggunakan `jimp` (grayscale, kontras, thresholding) sebelum dikenali oleh Tesseract.
- Meningkatkan akurasi pengenalan teks pada gambar dengan pencahayaan buruk atau noise.

### ⚡ Caching Respons AI
- Hasil pemrosesan AI untuk teks yang sama akan disimpan dalam cache menggunakan `lru-cache`.
- Mengurangi jumlah panggilan API dan mempercepat respons untuk permintaan yang berulang.

### 🗃️ Skema Database yang Diperluas
- Tabel `transactions` sekarang memiliki kolom `currency` (CHAR(3)) untuk menyimpan mata uang transaksi.
- Tabel `user_settings` untuk menyimpan preferensi mata uang per pengguna.
