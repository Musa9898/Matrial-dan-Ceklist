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
- `Tests`: laporan pengetesan (jenis tes, sistem, area, hasil Lulus/Gagal, penguji, saksi, ringkasan, URL foto pertama). Tab dibuat otomatis dan hanya berupa cermin dari snapshot; menghapus baris di tab ini tidak menghapus data di aplikasi.
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

## Kurva S (schedule proyek)

Tab **Kurva S** di menu bawah menampilkan kurva rencana vs realisasi per proyek.

**Ketentuan import:** file `.xlsx`, header ITEM/Pekerjaan/Uraian dan Bobot, serta minggu mulai/selesai berupa angka. Nomor minggu berupa angka berurutan mulai 1, minimal 3 minggu, pada baris header atau maksimal 5 baris setelahnya. Item harus bernama dan berbobot angka > 0. Jika seluruh rencana mingguan item kosong/nol, bobot dibagi merata dari minggu mulai sampai selesai. Letakkan ringkasan Rencana/Realisasi/Deviasi setelah semua item; pembacaan berhenti pada ringkasan. Hanya sheet pertama yang berhasil dikenali yang digunakan. Belum ada batas maksimum baris/kolom/minggu/ukuran khusus import atau kapasitas aman teruji; file besar tetap dapat membebani perangkat. Batas 200 MB tab File bukan batas import jadwal. Rincian tersedia pada panduan buka/tutup di tab Kurva S dan ringkasannya di form Import/Reschedule.

1. **Import Excel** (Admin/Engineering, izin Upload File): pilih file master schedule `.xlsx`. Aplikasi membaca kolom `ITEM`, `Bobot`, `MINGGU KE` (mulai–selesai), dan baris nomor minggu 1, 2, 3, … beserta rencana bobot per minggu. Grup (I, II, III …) dan sub-grup (a., b. …) dibaca otomatis; minggu tanpa rencana ditandai libur. Cek tanggal mulai minggu ke-1, lalu **Simpan Jadwal**. Import ulang mengganti jadwal, progres item dengan nama yang sama tetap dipertahankan.
2. **+ Input Progres** (Admin/Engineering/SPV, izin Laporan Harian): pilih minggu, isi progres kumulatif tiap pekerjaan (0–100% dari item itu). Nilai tidak boleh turun dari minggu sebelumnya.
3. Realisasi mingguan, realisasi kumulatif, dan deviasi dihitung otomatis dari bobot (`bobot × progres%`). Minggu berjalan dihitung dari tanggal hari ini.

Data tersimpan di snapshot proyek sebagai `projectSchedule` (ikut tersinkron ke Spreadsheet). Karena `SNAPSHOT_SECTIONS` di `Code.gs` berubah (`projectSchedule` masuk izin `daily_report`), `Code.gs` harus di-paste ulang dan di-deploy sebagai New version.

Warning kapasitas Import/Reschedule muncul bila salah satu ambang terlewati: ukuran file **> 20 MB**, pekerjaan terbaca **> 200 item**, atau durasi **> 100 minggu**. Nilai tepat pada ambang tidak memunculkan warning. Ini peringatan performa, bukan larangan import atau kapasitas aman terjamin. Pembatas lama 10 MB sudah diganti warning; file tetap harus berhasil dibaca dan lolos validasi sebelum disimpan.

## Petunjuk Penggunaan dalam Aplikasi

### Peninjauan / Attention Kurva S

Badge Attention pada header menghitung induk pekerjaan yang tertinggal pada minggu laporan terakhir, termasuk ketika deviasi total proyek positif. Urutan berdasarkan kekurangan kontribusi proyek: rencana kumulatif item (maksimal bobot induk) dikurangi bobot induk × persen aktual / 100, dalam poin persentase. Minggu tanpa laporan tidak dianggap progres nol. Ini bukan analisis critical path atau prediksi tanggal selesai; penyebab tidak disimpulkan dari angka.

Klik badge, buka pekerjaan dan isi penyebab terverifikasi, tindakan/recovery plan, PIC dan tanggal target. Simpan per pekerjaan; izin edit mengikuti `kurva_s`, akun lain hanya membaca. Catatan disimpan dalam `projectSchedule.attentionReviews` berdasarkan revisi, tanggal awal dan minggu laporan, lalu ID induk. Snapshot yang sama menyimpan data ini tanpa perubahan Apps Script. Catatan tidak menonaktifkan Attention; progres yang sudah mengejar rencana menghilangkan item dari daftar aktif. Catatan minggu/revisi lama tetap tersimpan, namun daftar aktif hanya menampilkan peninjauan minggu/revisi saat ini.

### Rincian Item & Volume Kurva S

Pemetaan kelompok mengutamakan kecocokan nama jenis pekerjaan dan total bobot BOQ terhadap satu induk yang unik (toleransi 0,000001 poin persentase); bila tidak cocok, gunakan usulan nama yang sudah ada. Pada koreksi tersedia **Usulkan ulang induk berdasarkan nama & bobot kelompok** untuk memperbaiki pilihan dengan pratinjau, bukan menyimpan otomatis. Konflik gedung eksplisit (Tower/Podium/Service Building) ditolak. Header sumber yang ambigu tetap diperiksa manusia; jangan menghapus induk hanya karena nama pekerjaannya berulang di gedung berbeda. Contoh EHJ: delapan total kelompok ARCHITECTURE-TOWER cocok dengan delapan bobot master di bawah header STRUCTURE RETROFITTING pada kelompok ARCHITECTURE WORKS. ID dan label master asli tidak diganti otomatis.

Setup proyek baru dimulai dari **1. Import Rincian Bobot**: unggah BOQ, centang kelompok dan konfirmasi, lalu lanjut **2. Import Kurva S**. Jadwal dan tanggal diperiksa sebelum **Lanjut Pemetaan Induk**; konfirmasi pasangan kelompok ke induk dan pilih **Simpan Bobot & Jadwal** untuk menyimpan keduanya dalam satu snapshot. Sebelum langkah akhir, data hanya draft di memori: Batal menutup form tanpa menyimpan, pilihan tahap sebelumnya dapat dibuka kembali, tetapi refresh halaman atau pergantian proyek membuang draft. Induk tanpa rincian tetap memakai input persen manual dengan label eksplisit. Total bobot master tidak dinormalisasi mengikuti BOQ.

Proyek yang sudah berjalan tidak dipaksa mengulang setup. Jadwal, progres dan rincian yang ada dipertahankan; alur Import Excel/Reschedule tetap berlaku. Jika belum memiliki rincian, proyek lama dapat memakai **Import Rincian Bobot** untuk menambahkannya seperti sebelumnya.

Workbook `.xlsx` bobot/BOQ dibaca multi-sheet. Sheet rincian memerlukan UNIT/Satuan, QTY/Quantity/Volume dan BOBOT; uraian berada tepat sebelum UNIT. Header kosong BOBOT dapat dikenali dari TOTAL tepat setelah QTY pada baris berikutnya dan selalu ditandai catatan. Item yang diikutkan harus memiliki satuan, QTY dan bobot positif; subtotal, sheet non-rincian dan baris invalid tidak menjadi input, dengan daftar pengecualian pada pratinjau.

Aplikasi mengusulkan induk berdasarkan nama sheet/kelompok. Setiap kelompok mempunyai checkbox **Ikutkan kelompok ini** (awalnya dicentang), pilihan induk yang langsung terlihat, dan status **Siap / Belum pilih induk / Tidak diikutkan**. Hilangkan centang untuk melewati seluruh kelompok; pilihan induk dinonaktifkan tetapi nilainya dipertahankan jika dicentang kembali. Kelompok yang dicentang wajib memiliki induk valid. Ringkasan menunjukkan jumlah kelompok/item terpilih dan kelompok belum dipetakan. Buka **Lihat rincian** untuk memeriksa item, lalu centang konfirmasi sebelum menyimpan; perubahan pilihan membatalkan konfirmasi sebelumnya. Semua item pada satu kelompok memakai induk yang sama; tidak ada checklist per item.

**Koreksi Pemetaan Bobot** tersedia setelah rincian dipasang. Pengguna dengan izin `kurva_s` dapat mengubah induk atau pilihan kelompok, dengan alasan wajib dan pratinjau jumlah item ditambah/pindah/dikecualikan serta simulasi persen induk memakai volume terakhir. BOQ tambahan digabung berdasarkan ID sheet/baris, bukan mengganti seluruh data. Konflik nama, konteks, QTY, satuan atau bobot item lama ditolak; pengguna harus mempertahankan identitas/baris sumber. `detailCatalog` menyimpan seluruh item termasuk kelompok yang sebelumnya tidak dipilih; data lama yang belum punya katalog dapat mengunggah kembali workbook asal untuk melengkapinya.

Koreksi berlaku pada minggu setelah laporan terakhir (minggu 1 bila belum ada laporan). `detailMappingVersions` menyimpan snapshot rincian per minggu berlaku; form historis membaca versi saat itu. `detailMappingAudit` menyimpan alasan, pelaku, waktu dan ringkasan dampak setiap koreksi, termasuk beberapa koreksi sebelum ada laporan baru. Pemetaan aktif pada minggu yang sama dapat diganti tanpa menulis ulang laporan. `detailItems` tetap memuat versi terbaru untuk kompatibilitas snapshot. Volume dibawa menurut ID yang sama, termasuk jika sempat dikecualikan; volume item baru dimulai dari 0. Persen induk laporan lama tidak dihitung ulang dan angka simulasi bukan laporan baru. Induk tanpa rincian menjadi manual; laporan berikutnya tetap wajib memenuhi batas progres/volume sebelum dan sesudahnya. Koreksi tidak menaikkan volume otomatis dan mungkin membutuhkan progres fisik tambahan untuk memenuhi batas tersebut.

Semua minggu telah dilaporkan: koreksi diblokir karena tidak ada minggu berlaku baru. Jadwal harus diperpanjang melalui Reschedule yang disetujui bila relevan. Reschedule mempertahankan katalog, versi dan audit koreksi serta semua ID induk yang digunakan versi lama/baru. Gagal simpan mengembalikan schedule sebelumnya. Riwayat koreksi ditampilkan di ringkasan Kurva S; tidak diperlukan perubahan Apps Script karena memakai snapshot schedule yang sama.

`persen item = volume kumulatif / QTY kontrak × 100`. `persen induk = Σ(bobot detail × persen item) / Σ(bobot detail)`. Kontribusi proyek tetap memakai bobot induk dari master schedule; bobot sumber tidak dikoreksi/disamakan otomatis. Induk yang tidak dipetakan tetap memakai input persen.

Rincian aktif mulai minggu setelah laporan terakhir; progres historis tidak diubah dan volume historis tidak ditebak. Pada laporan volume pertama, pengguna harus memasukkan volume aktual yang menghasilkan persen induk minimal sebesar progres lama. Batas volume: tidak turun dari minggu sebelumnya, tidak melebihi QTY atau volume laporan berikutnya. Persen induk juga tunduk pada batas progres minggu sebelum/sesudahnya. Cari item/area melalui pencarian; kelompok rincian dapat dibuka/tutup.

Rincian disimpan bersama `projectSchedule.detailItems`, metadata `detailSource`/`detailStartWeek` dan `progress[week].detailVolumes`, menggunakan jalur snapshot dan izin `kurva_s` yang sudah ada; tidak perlu perubahan/deploy ulang Apps Script. Reschedule/import ulang dengan rincian wajib mempertahankan ID induk, tanggal mulai dan tidak memperpendek durasi. Grafik, rekap dan PDF Kurva S tetap menggunakan progres induk terhitung, bukan menambahkan bobot detail dua kali.

Setiap tab utama (Material, Aset, Ceklist, Pengetesan, Laporan, Kurva S, File), form input/detail, pengaturan, bantuan, kalkulator dan dialog PDF dilengkapi **Petunjuk Penggunaan** yang dapat dibuka/tutup. Panduan tertutup saat halaman dimuat; klik judul atau fokuskan judul lalu tekan Enter/Spasi untuk membacanya. Isinya mencakup urutan pengisian, arti pilihan, penyimpanan, cakupan PDF dan peringatan yang relevan. Panduan unggah File yang sudah ada tetap tersedia dengan rincian format dan batas ukuran. Panduan tidak mengubah izin akun atau cara penyimpanan data; tidak perlu deploy ulang Apps Script.

## PDF Laporan Harian per Laporan

Buka detail salah satu laporan lalu pilih **PDF Laporan Ini** untuk mencetak hanya laporan tersebut beserta penugasan, jumlah pekerja, SPV, dan tanda tangan. Laporan lain pada tanggal yang sama tidak ikut dicetak. Tombol **PDF** di daftar laporan tetap untuk ekspor akumulatif sesuai rentang tanggal. Keduanya mengikuti izin ekspor PDF akun; tidak perlu deploy ulang Apps Script.

## Pengetesan & Commissioning

Di tab **Ceklist** ada pilihan **📋 Ceklist | 🧪 Pengetesan**. Tampilan Pengetesan dipakai untuk Tes Pipa, Megger, Grounding, Tes Tata Udara (HVAC), Uji Fungsi/Commissioning, dan Lainnya. Pada Tes Pipa, metode mengikuti sistem pipa: Air Bersih, Air Panas, Hydrant, dan Sprinkler memakai **Hydrotest** (isi tekanan uji, awal, akhir); Air Kotor, Air Bekas, dan Air Hujan memakai **Tes Glontor** (kondisi aliran + kebocoran) atau **Tes Rendam** (durasi rendam, muka air, kebocoran) tanpa isian tekanan.

**Tes Tata Udara (HVAC)** menggantikan Flushing (data Flushing lama tetap bisa dibuka). Pilih item yang diuji, lalu metodenya:

| Item | Metode | Lulus bila |
|---|---|---|
| Ducting | Duct Leakage Test (SMACNA) | Kebocoran terukur ≤ kebocoran diizinkan (L/s) |
| Ducting | Smoke Test (Asap) | Tidak ada asap keluar dari sambungan |
| Ducting / Unit / Fan | Air Balancing (Debit Udara) | Deviasi debit terukur vs rencana ≤ toleransi (default 10%) |
| Pipa Refrigerant | Tes Tekanan Nitrogen | Tekanan awal ≥ tekanan uji dan penurunan ≤ toleransi (default 0 psi, tahan 24 jam) |
| Pipa Refrigerant | Tes Vakum | Vakum tercapai ≤ target (default 500 micron) dan setelah ditahan ≤ batas (default 1000 micron) |
| Pipa Drain AC | Tes Aliran Drain | Aliran lancar, kemiringan sesuai, tidak bocor/rembes |
| Unit AC / FCU / AHU | Uji Performa Unit | ΔT (return − supply) ≥ minimum (default 8 °C), arus ≤ FLA, suara/getaran normal |

1. **+ Tes Baru** (izin Checklist): pilih jenis tes, isi area, data hasil uji, **Diuji oleh (SPV)**, saksi, dan foto bukti (kamera/galeri, maksimal 8 foto). Khusus **Tes Pipa** (Hydrotest/Glontor/Rendam) ada kolom **Foto Sebelum (Open)** dan **Foto Sesudah (Close)**, masing-masing maksimal 4 foto, dengan watermark tahap.
2. Hasil **Lulus/Gagal** dihitung otomatis dari data uji (misalnya penurunan tekanan ≤ toleransi, tahanan isolasi ≥ batas minimum, tahanan grounding ≤ batas maksimum). Hasil bisa diganti manual; laporan mencatat hasil otomatis aslinya.
3. Laporan bisa dicari/difilter (jenis, hasil, tanggal) dan diekspor ke PDF lengkap dengan foto (dikelompokkan Sebelum/Sesudah/Lainnya).
4. **Berita Acara (BA) Pengetesan**: PDF Pengetesan punya pilihan format **Berita Acara per tes (kop proyek)** atau **Rekap & detail semua tes**. Format BA mengikuti dokumen BA lapangan: kop 3 kolom (owner kiri, judul BA tengah, kontraktor kanan) dengan judul proyek di atas, info PROYEK/PEKERJAAN/PAKET/LOKASI + NOMOR/TANGGAL/LAMPIRAN, narasi "Pada hari ini … telah diadakan pengetesan bersama …", poin teknis bernomor, hasil **BERHASIL/GAGAL**, 4 kolom tanda tangan, lalu halaman lampiran foto Sebelum/Sesudah berdampingan. Satu tes juga bisa dicetak langsung dari detail tes (tombol **📄 BA**). Isi **Nomor Berita Acara** di form tes.
5. **🧾 Kop & TTD** (izin Checklist): atur per proyek judul proyek, nama + logo owner, judul/sub judul dokumen, nama + logo + alamat kontraktor, paket, keterangan lampiran, dan maksimal 4 kolom tanda tangan (jabatan, nama, perusahaan). Nama kosong pada kolom "Dibuat oleh" otomatis diisi SPV penguji.

Data tersimpan di snapshot proyek sebagai `testReports` (izin `checklist`, foto tahap di `photosBefore`/`photosAfter`) dan dicerminkan ke tab `Tests`. Pengaturan kop & tanda tangan BA tersimpan di snapshot proyek sebagai `testDocSettings` (logo dikecilkan otomatis); tidak perlu deploy ulang `Code.gs`. `Code.gs` versi `2026-10-21-test-reports-hvac` harus di-paste ulang dan di-deploy sebagai New version.

## Laporan Masalah (Bug Report) dan Ping Sinyal

- **Ping sinyal**: chip kecil di header (di bawah nama akun) menampilkan ping ke `https://www.google.com/generate_204` setiap 30 detik: hijau < 150 ms (Bagus), kuning < 400 ms (Sedang), merah ≥ 400 ms/timeout (Lemah), hitam saat offline. Ping dijeda saat tab tidak aktif atau saat sinkron/upload berjalan. Ketuk chip untuk detail, termasuk waktu respons Apps Script terakhir.
- **Laporkan Masalah**: menu Pengaturan → **🐞 Laporkan Masalah** (jenis, tingkat, deskripsi, maks. 3 screenshot). Info teknis (proyek, tab, perangkat, sinyal, 10 error/pesan terakhir) ikut terkirim otomatis; token login tidak ikut.
- Laporan disimpan ke tab `BugReports` (dibuat otomatis) dan screenshot ke subfolder Drive `Bug Reports` di dalam `FOLDER_ID`. Teks yang diawali `= + - @` diberi awalan `'` agar tidak dieksekusi sebagai rumus.
- Hanya email aktif di tab `Access` yang bisa mengirim laporan, maksimal 5 laporan per jam per akun. **Laporan Saya** menampilkan laporan milik sendiri; role Developer melihat semua laporan dan dapat mengubah status (`Baru`, `Diproses`, `Selesai`, `Ditolak`) beserta catatan untuk pelapor.
- Laporan tidak mengubah data proyek dan tidak memicu sinkronisasi Supabase. Pengujian: `node --test tests\bug-report.test.js`.

## Nama File di Google Drive

- File proyek disimpan di Drive dengan **nama asli** saat diunggah, jadi hasil **Unduh** memakai nama yang sama dengan yang tampil di aplikasi. Karakter `\ / : * ? " < > |` diganti `_` dan nama dibatasi 200 karakter (ekstensi tetap).
- File lama yang masih bernama `mep_<proyek>_<waktu>_...` bisa dirapikan sekali: buka editor Apps Script, pilih fungsi `renameLegacyProjectFiles`, klik **Run**, lalu lihat hasil di **Execution log** (`renamed`, `skipped`, `failed`, `remaining`). Jika `remaining` > 0, jalankan lagi. Fungsi ini aman dijalankan ulang dan tidak mengubah link/ID file.
