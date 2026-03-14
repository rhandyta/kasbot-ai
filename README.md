# Asisten Keuangan WhatsApp Cerdas

Project ini adalah bot WhatsApp yang berfungsi sebagai asisten keuangan pribadi. Dibangun dengan Node.js, bot ini mampu memahami input bahasa natural, membaca teks dari gambar struk (OCR), dan secara otomatis mencatat transaksi ke dalam database MySQL.

## 🛠️ Stack Teknologi

- **Backend**: Node.js
- **WhatsApp API**: `whatsapp-web.js`
- **QR Code**: `qrcode-terminal`
- **OCR**: `tesseract.js`
- **AI (NLP)**: DeepSeek AI via `openai` library
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
    - Impor skema tabel dengan menjalankan isi dari file `setup.sql` di database Anda. Ini akan membuat tabel `transactions`.

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

Bot akan membalas dengan konfirmasi jika data berhasil dicatat di database.
