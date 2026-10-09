const GOOGLE_CONFIG = Object.freeze({
  CLIENT_ID: '441116312261-fd5ofvrlm4dmad44o38n6c1sms31vq65.apps.googleusercontent.com',
  // Satu-satunya tempat mengganti URL Web App (harus berakhiran /exec).
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwGUCPjvrniCirFXt87JIqAClirDFiLMKPnAXA_Wx2duZV1o8NuO1L9EKMPBLnhcrnr/exec',
  // Cermin baca cepat. Data aslinya tetap di Sheets/Drive; Supabase hanya salinan
  // yang ditulis oleh Apps Script. Kunci di bawah aman di browser karena RLS aktif.
  SUPABASE_URL: 'https://ktmbunxnmdmrhpffjbxg.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_3YfoTq54yicdJkqGCPBpmA_dMLBNlQF',
  SUPABASE_TIMEOUT_MS: 8000,
  // Batas waktu permintaan (milidetik).
  REQUEST_TIMEOUT_MS: 25000,
  UPLOAD_TIMEOUT_MS: 120000,
  PING_TIMEOUT_MS: 30000
});

window.GOOGLE_CONFIG = GOOGLE_CONFIG;