# GitHub Pages + Apps Script

Website tetap statis di GitHub Pages. `index.html` memakai Google Identity Services untuk login; saat URL Apps Script diisi, seluruh snapshot proyek dikirim ke Web App dan foto Base64 diubah menjadi file Drive.

## Konfigurasi

1. Buat OAuth Client ID bertipe **Web application**. Tambahkan origin GitHub Pages dan origin localhost ke **Authorized JavaScript origins**.
2. Di `google-config.js`, isi `CLIENT_ID` dan `WEB_APP_URL` dengan ID klien dan URL deployment Apps Script yang berakhiran `/exec`.
3. Buka **Extensions > Apps Script** dari spreadsheet, tempel `Code.gs`, lalu ganti `SPREADSHEET_ID`, `FOLDER_ID`, dan `GOOGLE_CLIENT_ID` di bagian atas file. Apps Script perlu izin Sheets, Drive, dan UrlFetchApp saat pertama dijalankan.
4. Buat tab `Access` dengan header `email`, `project_id`, `project_name`, `role`, `active`. Tambahkan satu baris per user dan proyek; `active` harus `TRUE`. Nilai `project_id` harus cocok dengan ID proyek aplikasi, misalnya `sentral-tower`. Kode akan membuat tab `Monitoring` beserta header-nya otomatis.
5. Deploy Apps Script sebagai Web App, **Execute as: Me**, akses **Anyone**, lalu salin URL `/exec` ke `google-config.js`. Endpoint publik tetap memverifikasi Google ID token dan daftar `Access`; jangan membagikan spreadsheet ke pengguna aplikasi.

Contoh baris `Access`:

```text
user@gmail.com | sentral-tower | Proyek Sentral Tower | Logistik | TRUE
```

Tab `Monitoring` menyimpan snapshot proyek serta baris checklist/material untuk pencarian. Lampiran diubah menjadi URL Drive dan disimpan pada kolom `drive_url` serta payload.

## Catatan Keamanan dan CORS

Frontend mengirim ID token ke Apps Script; Apps Script memverifikasi token ke Google dan mengecek email/proyek aktif di tab `Access`. Token login tidak disimpan di `localStorage`; hanya profil tampilan `mep_user` yang disimpan. Jangan gunakan Preview Dashboard untuk akses data produksi karena Preview Mode memang melewati login.

`ContentService.TextOutput` tidak menyediakan API untuk menetapkan header `Access-Control-Allow-Origin`. POST memakai `text/plain;charset=utf-8` agar tidak memicu preflight, tetapi ini tidak menjamin browser mengizinkan JavaScript membaca respons. Karena itu, uji URL deployment dari domain GitHub Pages sebelum mengandalkan integrasi ini; jika CORS ditolak oleh browser, Apps Script `fetch()` lintas-origin tidak dapat diperbaiki hanya dengan menambah header dari `Code.gs`. Jangan menambahkan `mode: 'no-cors'`: respons menjadi opaque dan frontend tidak dapat memastikan apakah penyimpanan berhasil. GET mengirim ID token sebagai parameter URL, jadi gunakan token berumur pendek dan jangan mencatat URL request.

Script membagikan foto sebagai **Anyone with the link – Viewer**, sesuai permintaan tautan Drive yang dapat dibuka. Artinya siapa pun yang memperoleh URL foto dapat melihatnya; jangan unggah foto sensitif. Snapshot lama yang sudah tersimpan di browser tidak otomatis dimigrasikan sampai pengguna membuka proyek dan menyimpannya kembali.
