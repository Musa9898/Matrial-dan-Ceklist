const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function sliceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} not found`);
  assert.notEqual(end, -1, `${endMarker} not found`);
  return source.slice(start, end);
}

const DEVELOPER = { permissions: [], allProjects: true };
const GUEST = { permissions: [] };

function createBackend({ accessRows }) {
  const sheetRows = [];
  const cache = new Map();
  const createdFiles = [];
  const sheet = {
    getMaxRows: () => 1000,
    getLastRow: () => sheetRows.length,
    appendRow: (row) => sheetRows.push(row.slice()),
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => sheetRows.map((row) => row.slice()) })
  };
  sheet.getRange = (row, column) => ({
    setNumberFormat() {},
    setValue(value) { sheetRows[row - 1][column - 1] = value; }
  });
  let sheetCreated = false;
  const context = {
    FOLDER_ID: 'root',
    ROLE_DEFINITIONS: { developer: DEVELOPER, guest: GUEST },
    getRoleDefinition_: (role) => (role === 'Developer' ? DEVELOPER : GUEST),
    readActiveAccessRows_: () => accessRows,
    getAuthorizedProjects_: (email) => accessRows
      .filter((row) => row.email === email)
      .map((row) => ({ projectId: row.projectId, projectName: row.projectName, role: row.role })),
    getSpreadsheet_: () => ({
      getSheetByName: () => (sheetCreated ? sheet : null),
      insertSheet: () => { sheetCreated = true; return sheet; }
    }),
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => cache.set(key, value)
      })
    },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Utilities: {
      formatDate: () => '20261019',
      getUuid: () => 'abcdef12-3456',
      base64Decode: (text) => Buffer.from(text, 'base64'),
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name })
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'link' },
      Permission: { VIEW: 'view' },
      getFolderById: () => ({
        getFoldersByName: () => ({ hasNext: () => false }),
        createFolder: () => ({
          createFile: (blob) => {
            createdFiles.push(blob);
            return { setSharing() {}, getUrl: () => `https://drive.google.com/file/${blob.name}` };
          }
        })
      })
    }
  };
  vm.createContext(context);
  vm.runInContext(
    sliceBlock(backend, '// ==== BUG REPORT START ====', '// ==== BUG REPORT END ====')
      + '\nthis.api = { sanitizeBugText_, submitBugReport_, listBugReports_, updateBugReport_ };',
    context
  );
  return { api: context.api, sheetRows, createdFiles };
}

const ACCESS_ROWS = [
  { email: 'dev@x.com', projectId: 'P1', projectName: 'Proyek Satu', role: 'Developer' },
  { email: 'spv@x.com', projectId: 'P1', projectName: 'Proyek Satu', role: 'SPV' },
  { email: 'qs@x.com', projectId: 'P1', projectName: 'Proyek Satu', role: 'QS' }
];

test('sanitizeBugText_ menetralkan rumus spreadsheet dan memotong panjang', () => {
  const { api } = createBackend({ accessRows: ACCESS_ROWS });
  assert.equal(api.sanitizeBugText_('=IMPORTXML("x")', 100), '\'=IMPORTXML("x")');
  assert.equal(api.sanitizeBugText_('+62 812', 100), "'+62 812");
  assert.equal(api.sanitizeBugText_('-langkah 1', 100), "'-langkah 1");
  assert.equal(api.sanitizeBugText_('@user', 100), "'@user");
  assert.equal(api.sanitizeBugText_('Normal text', 100), 'Normal text');
  assert.equal(api.sanitizeBugText_('abcdef', 3), 'abc');
  assert.equal(api.sanitizeBugText_(null, 10), '');
});

test('submitBugReport_ menyimpan laporan beserta screenshot dan konteks', () => {
  const { api, sheetRows, createdFiles } = createBackend({ accessRows: ACCESS_ROWS });
  const png = 'data:image/jpeg;base64,' + Buffer.from('fake-image').toString('base64');
  const result = api.submitBugReport_({
    report: {
      type: 'Tampilan',
      severity: 'Tinggi',
      description: 'Tombol simpan tidak merespons di tab ceklist',
      projectId: 'P1',
      screenshots: [png],
      context: { tab: 'Ceklist' }
    }
  }, { email: 'spv@x.com', name: 'Budi' });
  assert.match(result.reportId, /^BUG-20261019-/);
  assert.equal(sheetRows.length, 2);
  const [, row] = sheetRows;
  assert.equal(row[2], 'spv@x.com');
  assert.equal(row[4], 'SPV');
  assert.equal(row[6], 'Proyek Satu');
  assert.equal(row[7], 'Tampilan');
  assert.equal(row[8], 'Tinggi');
  assert.equal(row[10], 'Baru');
  assert.equal(createdFiles.length, 1);
  assert.match(row[14], /^https:\/\/drive\.google\.com\//);
  assert.deepEqual(JSON.parse(row[15]), { tab: 'Ceklist' });
});

test('submitBugReport_ menolak input tidak valid dan akun tanpa akses', () => {
  const { api } = createBackend({ accessRows: ACCESS_ROWS });
  assert.throws(() => api.submitBugReport_({ report: { description: 'pendek' } }, { email: 'spv@x.com' }), /minimal 10/);
  assert.throws(() => api.submitBugReport_({ report: { description: 'deskripsi cukup panjang' } }, { email: 'asing@x.com' }), /Access/);
  const shot = 'data:image/jpeg;base64,' + Buffer.from('a').toString('base64');
  assert.throws(() => api.submitBugReport_({
    report: { description: 'deskripsi cukup panjang', screenshots: [shot, shot, shot, shot] }
  }, { email: 'spv@x.com' }), /Maksimal 3/);
  assert.throws(() => api.submitBugReport_({
    report: { description: 'deskripsi cukup panjang', screenshots: ['data:text/html;base64,PGI+'] }
  }, { email: 'spv@x.com' }), /gambar/);
});

test('submitBugReport_ membatasi 5 laporan per jam per akun', () => {
  const { api } = createBackend({ accessRows: ACCESS_ROWS });
  const send = (email) => api.submitBugReport_({ report: { description: 'deskripsi cukup panjang' } }, { email });
  for (let index = 0; index < 5; index++) send('spv@x.com');
  assert.throws(() => send('spv@x.com'), (error) => error.code === 'ratelimit');
  assert.doesNotThrow(() => send('qs@x.com'));
});

test('listBugReports_ memisahkan laporan sendiri dan akses developer', () => {
  const { api } = createBackend({ accessRows: ACCESS_ROWS });
  api.submitBugReport_({ report: { description: 'laporan dari spv lapangan' } }, { email: 'spv@x.com' });
  api.submitBugReport_({ report: { description: 'laporan dari qs kantor' } }, { email: 'qs@x.com' });

  const own = api.listBugReports_({ email: 'spv@x.com' });
  assert.equal(own.isDeveloper, false);
  assert.equal(own.reports.length, 1);
  assert.equal(own.reports[0].email, 'spv@x.com');
  assert.equal(own.reports[0].context, undefined);

  const all = api.listBugReports_({ email: 'dev@x.com' });
  assert.equal(all.isDeveloper, true);
  assert.equal(all.reports.length, 2);
  assert.equal(typeof all.reports[0].context, 'string');
});

test('updateBugReport_ hanya untuk developer dan memvalidasi status', () => {
  const { api, sheetRows } = createBackend({ accessRows: ACCESS_ROWS });
  const { reportId } = api.submitBugReport_({ report: { description: 'laporan dari spv lapangan' } }, { email: 'spv@x.com' });
  assert.throws(() => api.updateBugReport_({ reportId, status: 'Selesai' }, { email: 'spv@x.com' }), (error) => error.code === 'forbidden');
  assert.throws(() => api.updateBugReport_({ reportId, status: 'Aneh' }, { email: 'dev@x.com' }), /Status/);
  assert.throws(() => api.updateBugReport_({ reportId: 'BUG-X', status: 'Selesai' }, { email: 'dev@x.com' }), /tidak ditemukan/);

  const updated = api.updateBugReport_({ reportId, status: 'Selesai', devNote: 'Sudah diperbaiki' }, { email: 'dev@x.com' });
  assert.equal(updated.status, 'Selesai');
  assert.equal(sheetRows[1][10], 'Selesai');
  assert.equal(sheetRows[1][11], 'Sudah diperbaiki');
  assert.equal(sheetRows[1][13], 'dev@x.com');
  assert.equal(sheetRows[1][9], 'laporan dari spv lapangan');
});

function createClient() {
  const listeners = {};
  const context = {
    console,
    performance,
    navigator: { onLine: true },
    document: { getElementById: () => null, addEventListener() {} },
    window: { addEventListener: (type, handler) => { listeners[type] = handler; } }
  };
  vm.createContext(context);
  vm.runInContext(
    sliceBlock(html, '// ==== NETWORK & BUG REPORT CLIENT START ====', '// ==== NETWORK & BUG REPORT CLIENT END ====')
      + '\nthis.api = { classifyNetworkLatency, recordClientLog, recordServerLatency, clientLogBuffer, networkState };',
    context
  );
  return { api: context.api, listeners };
}

test('classifyNetworkLatency memberi level sinyal yang tepat', () => {
  const { api } = createClient();
  assert.equal(api.classifyNetworkLatency(80).level, 'good');
  assert.equal(api.classifyNetworkLatency(149).level, 'good');
  assert.equal(api.classifyNetworkLatency(150).level, 'fair');
  assert.equal(api.classifyNetworkLatency(399).level, 'fair');
  assert.equal(api.classifyNetworkLatency(400).level, 'poor');
  assert.equal(api.classifyNetworkLatency(null).level, 'unknown');
  assert.equal(api.classifyNetworkLatency(null, true, true).level, 'poor');
  assert.equal(api.classifyNetworkLatency(50, false).level, 'offline');
});

test('recordClientLog menyimpan maksimal 10 entri pendek', () => {
  const { api, listeners } = createClient();
  for (let index = 0; index < 15; index++) api.recordClientLog('notice', `pesan ${index}`);
  api.recordClientLog('notice', 'x'.repeat(1000));
  assert.equal(api.clientLogBuffer.length, 10);
  assert.equal(api.clientLogBuffer[0].message, 'pesan 6');
  assert.equal(api.clientLogBuffer[9].message.length, 300);
  listeners.error({ message: 'boom', filename: 'https://a/b/index.html', lineno: 12 });
  assert.equal(api.clientLogBuffer.at(-1).message, 'boom @ index.html:12');
});

test('recordServerLatency mengabaikan aksi upload', () => {
  const { api } = createClient();
  const value = { ok: true };
  assert.equal(api.recordServerLatency('uploadChunk', performance.now() - 50, value), value);
  assert.equal(api.networkState.serverMs, null);
  api.recordServerLatency('saveSnapshot', performance.now() - 50, value);
  assert.equal(api.networkState.serverAction, 'saveSnapshot');
  assert.ok(api.networkState.serverMs >= 0);
});
