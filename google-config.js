const GOOGLE_CONFIG = Object.freeze({
  CLIENT_ID: '441116312261-fd5ofvrlm4dmad44o38n6c1sms31vq65.apps.googleusercontent.com',
  // Satu-satunya tempat mengganti URL Web App (harus berakhiran /exec).
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwGUCPjvrniCirFXt87JIqAClirDFiLMKPnAXA_Wx2duZV1o8NuO1L9EKMPBLnhcrnr/exec',
  // Batas waktu permintaan (milidetik).
  REQUEST_TIMEOUT_MS: 45000,
  UPLOAD_TIMEOUT_MS: 120000,
  PING_TIMEOUT_MS: 12000
});

window.GOOGLE_CONFIG = GOOGLE_CONFIG;