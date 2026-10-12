# 🚀 WhatsApp Blast Indonesia (Aman & Anti-Blokir)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/idangkehed-commits/wa-blast-app)

Aplikasi WhatsApp Blast mandiri, ringan, dan aman yang dirancang khusus untuk nomor telepon seluler di Indonesia (`08...` / `628...`).

---

## 🌟 Fitur Utama

1. **Import Kontak Otomatis & Cerdas**:
   - **Excel & CSV (.xlsx, .xls, .csv)**: Otomatis mendeteksi kolom `Nomor`, `No HP`, `WhatsApp`, `Nama`, dll.
   - **Input Manual**: Bisa paste nomor langsung per baris atau format `08123456789, Nama`.
   - **Normalisasi Nomor Indonesia**: Mengubah otomatis `08...`, `+62...`, atau `8...` menjadi `628...`.
   - **Auto-Deduplikasi**: Menghapus nomor ganda secara otomatis untuk menghindari spam berulang.
   - **Kolom Dinamis**: Kolom apapun di Excel (seperti `Kota`, `Produk`, `Tagihan`) otomatis bisa dijadikan tag pesan `{kota}`, `{produk}`.

2. **Dukungan Media Lengkap**:
   - Mendukung kirim **Foto** (JPG, PNG, WebP) dan **Video** (MP4) dengan caption otomatis.

3. **Kreativitas Proteksi Anti-Blokir (Penggunaan Jangka Panjang)**:
   - 🎲 **Jeda Acak (Random Interval Jitter)**: Menghindari deteksi bot ritme statis dengan variasi jeda acak (default: 10–25 detik).
   - ✍️ **Simulasi "Sedang Mengetik..."**: Bot memicu status *typing presence* selama 2-4 detik sebelum pesan dikirim.
   - ☕ **Istirahat Berkala (Batch Cooldown)**: Tiap pengiriman sejumlah pesan (misal 20 pesan), bot otomatis istirahat (misal 3 menit) seperti kebiasaan manusia.
   - 🔄 **Fitur Spintax**: Gunakan format `{Halo|Hai|Selamat {panggilan}} {nama}!`, setiap pesan yang dikirim memiliki susunan kata berbeda sehingga terhindar dari filter duplikasi teks massal WhatsApp.
   - 🔍 **Validasi Nomor Terdaftar**: Mengecek ke server WhatsApp apakah nomor aktif sebelum dikirim.

4. **Jadwal Pengiriman (Terjadwal)**:
   - Pilihan kirim langsung atau jadwalkan pada tanggal & jam tertentu.

5. **Kontrol Siaga & Laporan**:
   - Tombol **Jeda**, **Lanjutkan**, dan **Hentikan** kapan saja.
   - Live monitoring progress bar & log aktivitas.
   - Unduh hasil laporan pengiriman ke format Excel (.xlsx).

---

## ⚡ Cara Menjalankan Aplikasi

### Cara 1: Menggunakan File Pintasan (Paling Mudah di Windows)
Cukup **klik ganda (double click)** file:
```
jalankan_wa_blast.bat
```
Browser Anda akan otomatis terbuka ke alamat `http://localhost:3000`.

### Cara 2: Lewat Terminal / Command Prompt
1. Buka folder `whatsapp-blast`
2. Jalankan perintah:
   ```bash
   node server.js
   ```
3. Buka browser dan akses: `http://localhost:3000`

---

## 📁 Struktur File
```
whatsapp-blast/
├── auth_info_baileys/    # Penyimpanan sesi login WhatsApp (tidak perlu scan ulang setiap buka)
├── public/
│   ├── index.html        # Tampilan dashboard (sangat mudah diedit/direvisi)
│   ├── style.css         # Styling sederhana & bersih (CSS native)
│   └── app.js            # Logika interaktif frontend & SSE real-time
├── services/
│   ├── waService.js      # Koneksi WhatsApp Multi-Device (Baileys)
│   ├── contactService.js # Normalisasi nomor 08... & parser Excel
│   ├── blastWorker.js    # Pengatur antrean, jeda acak, batch break, & scheduler
│   └── spintax.js        # Mesin Spintax variasi kata
├── uploads/              # Folder penyimpanan sementara media foto/video
├── contoh_kontak.xlsx    # Contoh template Excel untuk uji coba
├── jalankan_wa_blast.bat # Script jalan cepat di Windows
├── server.js             # Express backend server
└── package.json
```

---

## ☁️ Panduan Deploy ke Render.com (Dengan Persistent Disk)

Aplikasi ini sudah dilengkapi dengan file `render.yaml` agar folder `sessions/` (sesi login WhatsApp) dan `uploads/` (file media) **tidak hilang saat server restart**.

### Cara 1: Menggunakan Render Blueprint (Otomatis 1-Klik)
1. Upload folder `whatsapp-blast` ke akun **GitHub** Anda (buat repository baru, misalnya `wa-blast-app`).
2. Masuk ke dashboard [Render.com](https://dashboard.render.com).
3. Klik **New +** &rarr; pilih **Blueprint**.
4. Hubungkan repository GitHub Anda. Render akan otomatis mendeteksi file `render.yaml` dan mengonfigurasi:
   - **Region**: Singapore (paling cepat untuk Indonesia).
   - **Persistent Disk**: 1 GB di `/var/data` (otomatis menampung `sessions/` dan `uploads/`).
5. Klik **Apply**. Tunggu 2-3 menit hingga proses deploy selesai!

### Cara 2: Pengaturan Manual di Web Service Render
Jika Anda membuat Web Service secara manual di dashboard Render:
1. **Name**: `whatsapp-blast-id`
2. **Region**: `Singapore`
3. **Runtime**: `Node`
4. **Build Command**: `npm install`
5. **Start Command**: `node server.js`
6. **Environment Variables**:
   - `DATA_DIR` = `/var/data`
   - `NODE_VERSION` = `20.18.0`
7. **Disks (Di bagian Advanced &rarr; Add Disk)**:
   - **Name**: `wa-blast-storage`
   - **Mount Path**: `/var/data`
   - **Size**: `1 GB`
8. Klik **Create Web Service**.

> [!NOTE]
> Render Persistent Disk memerlukan plan **Starter ($7/bulan)**. Dengan Persistent Disk, semua sesi login WhatsApp pengguna akan tetap aktif dan tersimpan permanen meskipun server Render melakukan redeploy atau restart.

---

## 💡 Tips Aman Agar Nomor Tidak Terkena Banned
1. Gunakan nomor WhatsApp yang sudah berusia di atas 1 bulan dan sering digunakan untuk chat aktif normal.
2. Jika nomor baru: batasi pengiriman 20–50 pesan per hari di minggu-minggu awal.
3. Selalu aktifkan fitur **Spintax** agar isi pesan bervariasi.
4. Gunakan jeda acak minimal 10–25 detik.

