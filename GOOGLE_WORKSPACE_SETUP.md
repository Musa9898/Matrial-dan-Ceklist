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

## Akun Google pemilik website

Seluruh identitas website memakai satu akun Google: **karyavictoryutama@gmail.com**. Akun itu harus memiliki semua aset berikut agar `CLIENT_ID` di `google-config.js` dan `GOOGLE_CLIENT_ID` di `Code.gs` tetap valid.

| Aset | Nilai | Yang harus dipastikan |
|---|---|---|
| OAuth Client ID | `441116312261-fd5ofvrlm4dmad44o38n6c1sms31vq65.apps.googleusercontent.com` | Dibuat di Google Cloud project milik akun tersebut |
| Spreadsheet | `SPREADSHEET_ID` di `Code.gs` | Akun tersebut Owner atau Editor |
| Folder Drive | `FOLDER_ID` di `Code.gs` | Akun tersebut Owner atau Editor |
| Proyek Apps Script | deployment `/exec` di `google-config.js` | Deploy **Execute as: Me** dijalankan dari akun tersebut |
| Tab `Access` | baris `karyavictoryutama@gmail.com` | `role` = `admin`, `active` = `TRUE` |

Langkah verifikasi di [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (login sebagai akun tersebut):

1. **APIs & Services > Credentials**: Client ID di atas harus muncul di daftar. Jika tidak muncul, berarti Client ID dibuat di akun lain dan harus dipindah atau dibuat ulang.
2. Buka Client ID itu, lalu pastikan **Authorized JavaScript origins** berisi persis nilai `FRONTEND_ORIGINS` di `Code.gs`:
   - `https://musa9898.github.io`
   - `http://localhost:8000`
   - `http://127.0.0.1:8000`
3. **Authorized redirect URIs** berisi callback Supabase: `https://ktmbunxnmdmrhpffjbxg.supabase.co/auth/v1/callback`.
4. **OAuth consent screen**: isi *User support email* dan *Developer contact* dengan `karyavictoryutama@gmail.com`. Jika status masih **Testing**, tambahkan semua email yang ada di tab `Access` sebagai **Test users**, atau ubah status ke **In production** agar siapa pun di tab `Access` bisa login.

Setelah selesai, buka website dan login. Jika tombol Google menolak dengan `invalid_client` atau `origin_mismatch`, artinya langkah 1–3 belum cocok.

## Menghubungkan Google ke Supabase

Frontend menukar Google ID token menjadi sesi Supabase lewat `grant_type=id_token`, jadi Supabase harus mengenali Client ID yang sama.

1. Supabase Dashboard > **Authentication > Sign In / Providers > Google** > aktifkan.
2. **Client IDs**: isi `441116312261-fd5ofvrlm4dmad44o38n6c1sms31vq65.apps.googleusercontent.com`.
3. **Client Secret**: ambil dari Client ID yang sama di Google Cloud Console.
4. Aktifkan **Skip nonce check** karena token berasal dari Google Identity Services di browser, bukan dari alur redirect Supabase.
5. Simpan, lalu hard refresh website (Ctrl+Shift+R).

Client Secret hanya disimpan di dashboard Supabase dan Script Properties Apps Script; jangan pernah ditulis di `google-config.js`, `index.html`, atau file lain di repositori ini.

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
Saat aplikasi memuat proyek, keberadaan record pada tab `Materials`, `Assets`, `Checklists`, dan `DailyReports` menjadi acuan untuk item terkait di snapshot. Hapus seluruh baris data (atau kosongkan kolom `record_id`, `project_id`, dan kolom nama/pekerjaan/judul) untuk menghapus item dari aplikasi pada pemuatan berikutnya. Jangan menghapus baris header. Perubahan kode Apps Script perlu dideploy sebagai versi baru.

## Bridge Apps Script dan Keamanan

Frontend mengirim ID token ke Apps Script; Apps Script memverifikasi token ke Google dan mengecek email/proyek aktif di tab `Access`. Token login tidak disimpan di `localStorage`; hanya profil tampilan `mep_user` yang disimpan. Jangan gunakan Preview Dashboard untuk akses data produksi karena Preview Mode memang melewati login.

Browser tidak memakai `fetch()` langsung ke URL Apps Script. `index.html` membuat iframe tersembunyi ke mode `bridge=1`, lalu mengirim request lewat `postMessage`; iframe meneruskan pemanggilan ke `google.script.run`. Karena itu, request tidak muncul di Fetch/XHR browser. Periksa **Apps Script > Executions** untuk melihat pemanggilan server. Bridge hanya menerima origin yang tercantum di `FRONTEND_ORIGINS` pada `Code.gs`; pastikan origin GitHub Pages tepat, simpan script, dan deploy versi baru.

Pola ini menghindari CORS `ContentService` karena pemanggilan Sheets/Drive terjadi di dalam Apps Script, bukan `fetch()` cross-origin dari halaman. `TextOutput` memang tidak menyediakan API untuk menambahkan header `Access-Control-Allow-Origin` kustom.

Script membagikan foto sebagai **Anyone with the link – Viewer**, sesuai permintaan tautan Drive yang dapat dibuka. Artinya siapa pun yang memperoleh URL foto dapat melihatnya; jangan unggah foto sensitif. Snapshot lama yang sudah tersimpan di browser tidak otomatis dimigrasikan sampai pengguna membuka proyek dan menyimpannya kembali.

## Hak akses per role

Kolom `role` pada tab `Access` menentukan apa yang boleh dilakukan pengguna di proyeknya:

| Role | Material | Aset | Ceklis | Laporan Harian | Upload File/Folder | Buat Proyek |
|---|---|---|---|---|---|---|
| admin / owner | ya | ya | ya | ya | ya | ya |
| Engineering | ya | ya | ya | ya | ya | ya |
| SPV | ya | ya | ya | ya | tidak | tidak |
| Logistik | ya | ya | tidak | tidak | tidak | tidak |

Semua pengguna yang punya baris Access aktif juga dapat melihat proyek lain di sheet Access, tetapi hanya lihat saja (tidak bisa edit/upload). Aturan ini dicek di server (`Code.gs`), jadi `Code.gs` harus di-paste ulang dan di-deploy sebagai New version.
