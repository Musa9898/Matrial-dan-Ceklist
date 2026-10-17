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

## Kalkulator Master MEP

Tombol **Kalkulator MEP** di header, sebelah pengaturan, membuka enam tab kalkulasi lokal: listrik/kapasitor, pipa/pompa/hujan, HVAC/ducting, pencahayaan, fire fighting, dan utilitas. Perubahan input langsung menghitung ulang tanpa Apps Script, Supabase, jaringan, atau penyimpanan lokal; nilai hanya bertahan selama halaman terbuka. Modal dapat ditutup dengan X, backdrop, atau Escape; tab mendukung panah kiri/kanan dan Home/End.

Hasil adalah estimasi awal, bukan sertifikasi PUIL/SNI atau desain final. Tab Listrik mendukung beban LVMDP hingga 4000 A: pilihan konduktor CU (tembaga, 2,5–300 mm²) atau AL (aluminium, 16–300 mm²) dengan KHA IEC 60364-5-52 Tabel B.52.4 (PVC 70°C, metode B2, tiga konduktor berbeban, udara 30°C, tanpa derating kelompok). Ukuran 400/500/630 mm² hanya punya data R, sehingga wajib mengisi "KHA 1 kabel dari datasheet pabrik" (isi 0 = pakai tabel standar), kecuali kabel CU di cable tray yang memakai tabel F trefoil. Dropdown "Cara pemasangan kabel" memilih kolom KHA: conduit/pipa di dinding = B2 (default), klem langsung di dinding = C, cable tray/ladder = E untuk multi-core atau F trefoil untuk single-core ≥240 mm², tanam tanah dalam duct = D (tanah 20°C, 2,5 K·m/W); KHA AL untuk metode selain B2 diestimasi dari rasio CU; isian ini juga dapat menggantikan nilai tabel untuk ukuran lain. R20 IEC 60228 dikoreksi ke 70°C (α CU 0,00393, AL 0,00403) dan X diasumsikan 0,08 Ω/km. Untuk 1–12 tarikan paralel per fasa, KHA total = KHA per kabel × jumlah tarikan, sedangkan R dan X efektif dibagi jumlah tarikan pada voltage drop; faktor koreksi pengelompokan kabel paralel harus diverifikasi terpisah. Rating breaker standar 6–4000 A (630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000 A); rating di atas KHA total ditandai merah dan kebutuhan di atas 4000 A meminta pemilihan manual. Ambang indikator mengikuti parameter kalkulator, termasuk voltage drop 4%/5%, aliran air 2/2,5 m/s, duct 5,5/8,5 m/s, dan pencahayaan 10 W/m².

Tambahan rumus lapangan: Listrik menampilkan daya semu kVA (kW ÷ cos phi), estimasi kasar arus hubung singkat (Isc) di terminal trafo dan di ujung kabel dari kapasitas trafo (kVA) dan impedansi Uk%, serta rekomendasi breaking capacity (Icu) MCCB 6–150 kA. Pipa & Pompa dapat memakai asumsi fitting 20% atau rincian minor loss ΣK × v²/2g (elbow 90°/45°, tee, gate/ball valve, check valve) dan menghitung tekanan kerja minimum booster = head statis + losses + sisa fixture terjauh minimal 1,5 bar. HVAC menjumlahkan beban area, penghuni (450 BTU/h per orang) dan lampu (W × 3,412) ke total BTU/h dan TR; isi 0 bila angka BTU/m² sudah mencakup beban tersebut. Fire fighting menghitung waktu kuras tangki (volume ÷ debit main pump) terhadap acuan hydrant NFPA 45–60 menit.

Fire fighting selalu berstatus perhatian: asumsi 6–12 sprinkler × 20 GPM dan tangki berdasarkan debit pompa utama saja tidak membuktikan kecukupan desain kebakaran. Asumsi/konversi lainnya ditampilkan pada setiap tab. Input kosong, tidak valid, atau di luar rentang menampilkan pesan kesalahan dan menghapus hasil lama agar tidak terbaca sebagai hasil baru.

Validasi: `node --test tests\spreadsheet-sync.test.js tests\mep-calculator.test.js`.

## Pilihan proyek dan loading sinkronisasi

Halaman login menggunakan panel identitas proyek dan form dua langkah; dua kolom di desktop dan susunan vertikal yang dapat digulir di ponsel. Hover/fokus tombol, mode gelap, serta preferensi reduced-motion didukung. Perubahan tampilan tidak mengubah autentikasi, hak akses, pilihan proyek, atau penguncian sinkronisasi.

Animasi login memakai CSS/SVG lokal: garis grafik tergambar saat dimuat, pendaran titik dan watermark, gedung bernapas, cahaya latar bergerak, badge mengambang, serta shimmer dan hover tombol. Animasi dekoratif dinonaktifkan saat `prefers-reduced-motion: reduce`; shimmer tidak menangkap klik dan disembunyikan saat login dikunci untuk sinkronisasi. Tombol Google asli di dalam iframe tidak diubah.

1. Di halaman login, masuk dengan Google terlebih dahulu untuk memverifikasi akun dan mengambil daftar proyek dari `Access`.
2. Pilih **Proyek yang akan dibuka**, lalu tekan **Masuk ke Proyek**. Proyek dengan akses baca saja diberi label **Lihat saja**. Daftar proyek tidak ditampilkan sebelum akun diverifikasi.
3. Dashboard dibuka hanya setelah data proyek yang dipilih selesai dimuat. Jika gagal, halaman login tetap terbuka dan tombol **Masuk ke Proyek** dapat digunakan untuk mencoba lagi.
4. Selama membaca, menyimpan, mengunggah, mengganti, atau membuat proyek, overlay loading mengunci klik dan input keyboard pada login/dashboard, termasuk modal. Kunci tetap aktif selama jeda percobaan ulang dan dilepas setelah berhasil atau gagal; pesan kesalahan tetap ditampilkan.
5. Proyek yang tidak tersedia untuk akun tidak dialihkan otomatis ke proyek lain. Perbarui deployment `Code.gs` sebagai **New version** agar validasi pilihan proyek terbaru berlaku.

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
- `Checklists`: tanggal, area, bidang (`discipline`: MEP / Sipil Struktur / Sipil Arsitektur), pekerjaan, status, progres, PIC, dan URL foto.
- `DailyReports`: judul, tanggal, SPV, jumlah tugas/orang, dan ringkasan tugas.
- `ProjectFiles`: metadata file Drive, folder, URL, ukuran, dan tipe file.
- `ProjectFolders`: ID dan nama folder logis tiap proyek, sehingga struktur folder tampil lintas perangkat.
- Jika metadata folder lama belum ada, aplikasi memulihkan nama dari cache/snapshot. Jika hanya `Folder ID` yang tersisa di `ProjectFiles`, aplikasi menampilkan folder bernama `Folder <ID>` agar file tetap bisa diakses; nama itu dapat diubah dari tampilan folder.
- `Monitoring`: dipertahankan sebagai sumber legacy. Saat snapshot proyek berhasil disimpan, record lama proyek tersebut dipindah ke tab masing-masing; proyek lain tidak ikut diubah.

Record operasional menyertakan kolom terstruktur dan `payload_json` untuk mempertahankan data lengkap aplikasi. Foto Base64 diubah menjadi URL Drive sebelum disimpan.
Penyimpanan snapshot memperbarui baris berdasarkan ID record: hanya item baru/berubah yang ditulis, dan item yang dihapus dikosongkan tanpa menggeser baris proyek lain. Baris yang tidak berubah mempertahankan metadata email/waktu pembaruannya. Login dan pemuatan data tidak menjalankan penyimpanan snapshot; tidak perlu mengirim ulang seluruh aset setelah masuk kembali.
Render kartu material hanya membaca data, tidak mengubah stok/payload. Penggabungan hanya dilakukan untuk material yang benar-benar duplikat saat data diterapkan atau sebelum disimpan; material tunggal mempertahankan tipe angka dan field historisnya agar pemuatan ulang tidak dianggap sebagai perubahan. Menambah kedatangan/pengeluaran tetap memperbarui stok material terkait, tanpa menulis ulang material lain yang tidak berubah.
Input satuan material menyediakan Pcs, Batang, Meter, Roll, Kotak, Unit, dan Pack. Unit dan Pack juga tersedia pada filter satuan; jumlahnya berupa bilangan bulat seperti satuan non-Meter lainnya.
Setiap simpan dari frontend membawa `mutationId` yang sama saat request dicoba ulang atau dialihkan ke bridge. Backend menyimpan bukti keberhasilan untuk maksimal 30 request terakhir per proyek selama 6 jam, sehingga pengulangan request yang sudah berhasil tidak menulis ulang baris atau mengunggah foto lagi. Jika respons tetap terputus, frontend memeriksa `saveStatus`. Jika hasil belum bisa dipastikan, input diblokir sampai data server berhasil dimuat lewat **Coba Lagi**, bukan mengirim ulang snapshot lokal yang sudah dibatalkan.
Batas waktu simpan (`SAVE_TIMEOUT_MS`) adalah 90 detik, terpisah dari baca biasa. Cache browser yang penuh setelah Sheets berhasil menyimpan ditampilkan sebagai peringatan cache, bukan kegagalan penyimpanan Sheets.
Saat aplikasi memuat proyek, keberadaan record pada tab `Materials`, `Assets`, `Checklists`, dan `DailyReports` menjadi acuan untuk item terkait di snapshot. Hapus seluruh baris data (atau kosongkan kolom `record_id`, `project_id`, dan kolom nama/pekerjaan/judul) untuk menghapus item dari aplikasi pada pemuatan berikutnya. Jangan menghapus baris header. Perubahan kode Apps Script perlu dideploy sebagai versi baru.

Jika cermin Supabase digunakan, penulisan Sheets hanya mengantrekan sinkronisasi cermin agar respons simpan tidak menunggu panggilan jaringan Supabase. Setelah memperbarui Apps Script, jalankan `installSupabaseSyncTrigger()` sekali untuk memasang worker `processSupabaseSyncQueue` setiap menit (menggantikan trigger akses lama). Jalankan `fullSyncToSupabase()` untuk pengisian awal. Jika Supabase tidak digunakan/tidak memiliki service key, antrean tidak dibuat. Cermin dapat tertinggal sampai worker selesai; gunakan `SUPABASE_ENABLED: false` untuk membaca langsung dari Sheets.

Pengujian regresi backend lokal (Node.js, tanpa mengakses Sheets/Drive produksi): `node --test tests\spreadsheet-sync.test.js`. Pengujian mencakup jumlah baris yang ditulis, pemeliharaan metadata, penghapusan tanpa menggeser proyek lain, request simpan duplikat, login tanpa penulisan, dan server sibuk.

## Bridge Apps Script dan Keamanan

Frontend mengirim ID token ke Apps Script; Apps Script memverifikasi token ke Google dan mengecek email/proyek aktif di tab `Access`. Token login tidak disimpan di `localStorage`; hanya profil tampilan `mep_user` yang disimpan. Jangan gunakan Preview Dashboard untuk akses data produksi karena Preview Mode memang melewati login.

Browser tidak memakai `fetch()` langsung ke URL Apps Script. `index.html` membuat iframe tersembunyi ke mode `bridge=1`, lalu mengirim request lewat `postMessage`; iframe meneruskan pemanggilan ke `google.script.run`. Karena itu, request tidak muncul di Fetch/XHR browser. Periksa **Apps Script > Executions** untuk melihat pemanggilan server. Bridge hanya menerima origin yang tercantum di `FRONTEND_ORIGINS` pada `Code.gs`; pastikan origin GitHub Pages tepat, simpan script, dan deploy versi baru.

Pola ini menghindari CORS `ContentService` karena pemanggilan Sheets/Drive terjadi di dalam Apps Script, bukan `fetch()` cross-origin dari halaman. `TextOutput` memang tidak menyediakan API untuk menambahkan header `Access-Control-Allow-Origin` kustom.

Script membagikan foto sebagai **Anyone with the link – Viewer**, sesuai permintaan tautan Drive yang dapat dibuka. Artinya siapa pun yang memperoleh URL foto dapat melihatnya; jangan unggah foto sensitif. Snapshot lama yang sudah tersimpan di browser tidak otomatis dimigrasikan sampai pengguna membuka proyek dan menyimpannya kembali.

## Hak akses per role

Daftar aset menggunakan kartu ringkas seperti material (kategori, kondisi, nama, kode, jumlah, lokasi/pemegang). Klik kartu atau tekan Enter/Spasi untuk membuka detail aset, termasuk foto dan waktu pembaruan. Tombol Ubah/Hapus berada di detail dan tetap mengikuti izin role. Klik foto aset, foto surat jalan material, atau foto ceklist untuk membuka preview ukuran besar; tutup dengan tombol silang, Escape, atau klik di luar preview. Preview tidak mengubah data/foto yang tersimpan.

Input foto (ceklist, surat jalan material, aset) punya tombol **📷 Kamera** dan **🖼️ Galeri / File**. Foto yang diambil lewat tombol Kamera otomatis diberi watermark di bagian bawah: Victory Construction + nama proyek, hari/tanggal/jam foto, lalu detail form (ceklist: area, bidang–pekerjaan, SPV; material: nama, jumlah, surat jalan, user; aset: nama/kode, lokasi, user). Foto dari Galeri / File disimpan tanpa watermark.

Kolom `role` pada tab `Access` menentukan apa yang boleh dilakukan pengguna di proyeknya:

| Role | Material | Aset | Ceklis | Laporan Harian | Upload File/Folder | Buat Proyek |
|---|---|---|---|---|---|---|
| admin / owner | ya | ya | ya | ya | ya | ya |
| Engineering | ya | ya | ya | ya | ya | ya |
| SPV | ya | ya | ya | ya | tidak | tidak |
| Logistik | ya | ya | tidak | tidak | tidak | tidak |

Semua pengguna yang punya baris Access aktif juga dapat melihat proyek lain di sheet Access, tetapi hanya lihat saja (tidak bisa edit/upload). Aturan ini dicek di server (`Code.gs`), jadi `Code.gs` harus di-paste ulang dan di-deploy sebagai New version.
