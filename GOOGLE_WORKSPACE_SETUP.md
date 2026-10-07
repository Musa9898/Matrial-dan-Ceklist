# GitHub Pages + Apps Script

Website tetap statis di GitHub Pages. `index.html` memakai Google Identity Services untuk login; saat URL Apps Script diisi, seluruh snapshot proyek dikirim ke Web App dan foto Base64 diubah menjadi file Drive.

## Konfigurasi

1. Buat OAuth Client ID bertipe **Web application**. Tambahkan origin GitHub Pages dan origin localhost ke **Authorized JavaScript origins**.
2. Di `google-config.js`, isi `CLIENT_ID` dan `WEB_APP_URL` dengan ID klien dan URL deployment Apps Script yang berakhiran `/exec`.
3. Buka **Extensions > Apps Script** dari spreadsheet, tempel `Code.gs`, lalu ganti `SPREADSHEET_ID`, `FOLDER_ID`, dan `GOOGLE_CLIENT_ID` di bagian atas file. Apps Script perlu izin Sheets, Drive, dan UrlFetchApp saat pertama dijalankan.
4. Buat tab `Access` dengan header `email`, `project_id`, `project_name`, `role`, `active`. Tambahkan satu baris per user dan proyek; `active` harus `TRUE`. Nilai `project_id` harus cocok dengan ID proyek aplikasi, misalnya `sentral-tower`. Tab data lain dibuat otomatis oleh script.
5. Deploy Apps Script sebagai Web App, **Execute as: Me**, akses **Anyone**, lalu salin URL `/exec` ke `google-config.js`. Setiap kali `Code.gs` berubah, pilih **Deploy > Manage deployments > Edit > New version > Deploy** agar URL `/exec` menjalankan kode terbaru. Endpoint publik tetap memverifikasi Google ID token dan daftar `Access`; jangan membagikan spreadsheet ke pengguna aplikasi.

Contoh baris `Access`:

```text
user@gmail.com | sentral-tower | Proyek Sentral Tower | Logistik | TRUE
```

Data operasional dipisah ke tab agar mudah difilter dan dianalisis:

- `ProjectData`: snapshot JSON per proyek, termasuk chunk untuk snapshot besar.
- `Materials`: stok, satuan, jumlah masuk/keluar, status, dan URL foto kedatangan.
- `Assets`: identitas alat, kondisi, lokasi, dan URL foto.
- `Checklists`: tanggal, area, pekerjaan, status, progres, PIC, dan URL foto.
- `DailyReports`: judul, tanggal, SPV, jumlah tugas/orang, dan ringkasan tugas.
- `ProjectFiles`: metadata file Drive, folder, URL, ukuran, dan tipe file.
- `ProjectFolders`: ID dan nama folder logis tiap proyek, sehingga struktur folder tampil lintas perangkat.
- Jika metadata folder lama belum ada, aplikasi memulihkan nama dari cache/snapshot. Jika hanya `Folder ID` yang tersisa di `ProjectFiles`, aplikasi menampilkan folder bernama `Folder <ID>` agar file tetap bisa diakses; nama itu dapat diubah dari tampilan folder.
- `Monitoring`: dipertahankan sebagai sumber legacy. Saat snapshot proyek berhasil disimpan, record lama proyek tersebut dipindah ke tab masing-masing; proyek lain tidak ikut diubah.

Record operasional menyertakan kolom terstruktur dan `payload_json` untuk mempertahankan data lengkap aplikasi. Foto Base64 diubah menjadi URL Drive sebelum disimpan.

## Bridge Apps Script dan Keamanan

Frontend mengirim ID token ke Apps Script; Apps Script memverifikasi token ke Google dan mengecek email/proyek aktif di tab `Access`. Token login tidak disimpan di `localStorage`; hanya profil tampilan `mep_user` yang disimpan. Jangan gunakan Preview Dashboard untuk akses data produksi karena Preview Mode memang melewati login.

Browser tidak memakai `fetch()` langsung ke URL Apps Script. `index.html` membuat iframe tersembunyi ke mode `bridge=1`, lalu mengirim request lewat `postMessage`; iframe meneruskan pemanggilan ke `google.script.run`. Karena itu, request tidak muncul di Fetch/XHR browser. Periksa **Apps Script > Executions** untuk melihat pemanggilan server. Bridge hanya menerima origin yang tercantum di `FRONTEND_ORIGINS` pada `Code.gs`; pastikan origin GitHub Pages tepat, simpan script, dan deploy versi baru.

Pola ini menghindari CORS `ContentService` karena pemanggilan Sheets/Drive terjadi di dalam Apps Script, bukan `fetch()` cross-origin dari halaman. `TextOutput` memang tidak menyediakan API untuk menambahkan header `Access-Control-Allow-Origin` kustom.

Script membagikan foto sebagai **Anyone with the link – Viewer**, sesuai permintaan tautan Drive yang dapat dibuka. Artinya siapa pun yang memperoleh URL foto dapat melihatnya; jangan unggah foto sensitif. Snapshot lama yang sudah tersimpan di browser tidak otomatis dimigrasikan sampai pengguna membuka proyek dan menyimpannya kembali.
