# Google Sign-In: Tahap Pertama

Aplikasi tetap statis di GitHub Pages. Tombol resmi Google dibuat oleh Google Identity Services. Setelah callback, profil dasar disimpan di `localStorage` dengan key `mep_user`; ID token dan sandi tidak disimpan.

## Set Client ID

1. Di Google Cloud Console, buat OAuth Client ID bertipe **Web application**.
2. Tambahkan origin website GitHub Pages ke **Authorized JavaScript origins**. Tambahkan origin localhost untuk preview lokal.
3. Ganti `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` di `google-config.js` dengan Client ID tersebut.
4. Siapkan consent screen dan test user di Google Cloud sesuai akun yang akan dipakai.

`WEB_APP_URL` masih kosong dan belum digunakan pada tahap login ini. Tanpa Client ID, tombol Google tidak dapat dirender; tombol **Preview Mode / Bypass** tetap membuka dashboard untuk uji tampilan.

## Batas Keamanan

Frontend hanya mendekode klaim credential untuk menampilkan nama, email, Google ID, dan foto. Ia tidak memverifikasi tanda tangan token atau mengecek daftar undangan di server. `localStorage('mep_user')` dapat diedit, dan Preview Mode terlihat oleh semua pengunjung website. Karena itu, login ini **belum boleh dianggap sebagai kontrol akses data produksi**.

Data dashboard juga masih memakai penyimpanan lokal browser. Pada tahap integrasi Apps Script berikutnya, token dan email undangan harus diverifikasi sebelum Sheets/Drive dibaca atau diubah. Apps Script `TextOutput` tidak menyediakan API untuk menambahkan header CORS kustom; cara pemanggilan dari GitHub Pages harus dirancang sesuai batas tersebut sebelum `fetch()` lintas-origin digunakan.
