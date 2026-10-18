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

const driveNamingSource = sliceBlock(backend, '// Nama file di Drive = nama asli', '\n// =====');

function loadClientCore() {
  const context = vm.createContext({});
  vm.runInContext(`${sliceBlock(html, '// ==== FILE UPLOAD CORE START ====', '// ==== FILE UPLOAD CORE END ====')}
    globalThis.api = { FILE_UPLOAD_LIMITS, formatUploadSize, getUploadFileProblem, chooseFileUploadMethod, getUploadChunkRange, isUnsupportedUploadActionError, getFileTypeGroup, canPreviewProjectFile, getUploadMimeType };`, context);
  return context.api;
}

const MB = 1024 * 1024;

test('client groups file types and only previews PDF', () => {
  const { getFileTypeGroup, canPreviewProjectFile, getUploadMimeType } = loadClientCore();
  assert.equal(getFileTypeGroup('Denah.PDF'), 'pdf');
  assert.equal(getFileTypeGroup('BOQ.xlsm'), 'excel');
  assert.equal(getFileTypeGroup('data.ods'), 'excel');
  assert.equal(getFileTypeGroup('layout.dwg'), 'cad');
  assert.equal(getFileTypeGroup('layout.dxf'), 'cad');
  assert.equal(getFileTypeGroup('rapat.ppt'), 'ppt');
  assert.equal(getFileTypeGroup('foto.jpg'), '');
  assert.equal(canPreviewProjectFile('a.pdf'), true);
  for (const name of ['a.xlsx', 'a.dwg', 'a.pptx', 'a.csv']) assert.equal(canPreviewProjectFile(name), false);
  assert.equal(getUploadMimeType('BOQ.xlsx', ''), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(getUploadMimeType('layout.dwg', ''), 'application/acad');
  assert.equal(getUploadMimeType('x.unknown', ''), 'application/octet-stream');
});

test('client rejects wrong formats, empty files and files above 200 MB', () => {
  const { getUploadFileProblem } = loadClientCore();
  assert.equal(getUploadFileProblem({ name: 'Denah.PDF', size: 5 * MB }), '');
  assert.equal(getUploadFileProblem({ name: 'site.dxf', size: 1 }), '');
  assert.equal(getUploadFileProblem({ name: 'site.DWG', size: MB }), '');
  assert.equal(getUploadFileProblem({ name: 'BOQ.xlsx', size: MB }), '');
  assert.equal(getUploadFileProblem({ name: 'rekap.csv', size: MB }), '');
  assert.equal(getUploadFileProblem({ name: 'Presentasi.pptx', size: MB }), '');
  assert.match(getUploadFileProblem({ name: 'virus.exe', size: MB }), /format/);
  assert.match(getUploadFileProblem({ name: 'catatan.docx', size: MB }), /format/);
  assert.match(getUploadFileProblem({ name: 'tanpa-ekstensi', size: MB }), /format/);
  assert.match(getUploadFileProblem({ name: 'kosong.pdf', size: 0 }), /kosong/);
  assert.equal(getUploadFileProblem({ name: 'pas.pdf', size: 200 * MB }), '');
  assert.match(getUploadFileProblem({ name: 'besar.pdf', size: 200 * MB + 1 }), /melebihi batas 200 MB/);
});

test('client sends small files at once and large files in chunks', () => {
  const { chooseFileUploadMethod, getUploadChunkRange } = loadClientCore();
  assert.equal(chooseFileUploadMethod(4 * MB), 'direct');
  assert.equal(chooseFileUploadMethod(4 * MB + 1), 'resumable');
  assert.deepEqual({ ...getUploadChunkRange(0, 10 * MB) }, { start: 0, end: 4 * MB });
  assert.deepEqual({ ...getUploadChunkRange(8 * MB, 10 * MB) }, { start: 8 * MB, end: 10 * MB });
});

test('client formats sizes and detects an outdated Code.gs', () => {
  const { formatUploadSize, isUnsupportedUploadActionError } = loadClientCore();
  assert.equal(formatUploadSize(512), '512 B');
  assert.equal(formatUploadSize(2048), '2 KB');
  assert.equal(formatUploadSize(1.5 * MB), '1,5 MB');
  assert.equal(isUnsupportedUploadActionError(new Error('Payload penyimpanan tidak valid.')), true);
  assert.equal(isUnsupportedUploadActionError(new Error('Token Google tidak valid')), false);
});

function createBackend() {
  const cache = new Map();
  const drive = { committed: 0, size: 0, deleted: false, trashed: false, putCount: 0 };
  const registered = [];
  const response = (code, headers = {}, body = '') => ({
    getResponseCode: () => code,
    getAllHeaders: () => headers,
    getContentText: () => body
  });
  const context = vm.createContext({
    FOLDER_ID: 'folder-root',
    CacheService: {
      getScriptCache: () => ({
        put: (key, value) => cache.set(key, value),
        get: (key) => cache.get(key) || null,
        remove: (key) => cache.delete(key)
      })
    },
    ScriptApp: { getOAuthToken: () => 'token' },
    Utilities: {
      getUuid: () => '12345678-1234-1234-1234-123456789abc',
      base64Decode: (text) => Array.from(Buffer.from(text, 'base64'))
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
          drive.size = Number(options.headers['X-Upload-Content-Length']);
          drive.metadata = JSON.parse(options.payload);
          return response(200, { Location: 'https://drive.example/session-1' });
        }
        if (options.method === 'delete') {
          drive.deleted = true;
          return response(499);
        }
        drive.putCount++;
        const range = options.headers['Content-Range'];
        const match = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (match) drive.committed = Number(match[2]) + 1;
        if (drive.committed >= drive.size) return response(200, {}, JSON.stringify({ id: 'drive-file-1' }));
        return response(308, drive.committed ? { Range: `bytes=0-${drive.committed - 1}` } : {});
      }
    },
    DriveApp: {
      getFileById: (id) => ({
        getParents: () => {
          const parents = [{ getId: () => 'folder-root' }];
          return { hasNext: () => parents.length > 0, next: () => parents.shift() };
        },
        setTrashed: (value) => { drive.trashed = value; },
        id
      })
    },
    safeFileName_: (value) => String(value).replace(/[^\w.-]+/g, '_'),
    registerDriveFile_: (project, driveFile, meta, email) => {
      const file = { id: driveFile.id, projectId: project.projectId, name: meta.name, folderId: meta.folderId, email };
      registered.push(file);
      return file;
    }
  });
  vm.runInContext(`${driveNamingSource}
    ${sliceBlock(backend, '// ==== RESUMABLE UPLOAD START ====', '// ==== RESUMABLE UPLOAD END ====')}
    globalThis.api = { startResumableUpload_, uploadResumableChunk_, getResumableUploadStatus_, finishResumableUpload_, cancelResumableUpload_, parseDriveUploadRange_, UPLOAD_CHUNK_BYTES };`, context);
  return { api: context.api, drive, registered, cache };
}

const project = { projectId: 'p1' };
const email = 'user@example.com';
const chunk = (bytes) => Buffer.alloc(bytes, 1).toString('base64');

test('backend uploads a large file chunk by chunk and registers it once', () => {
  const { api, drive, registered } = createBackend();
  const size = 9 * MB;
  const session = api.startResumableUpload_(project, { name: 'Shop Drawing.pdf', size, folderId: 'f1', folderName: 'Gambar' }, email);
  assert.equal(session.chunkSize, 4 * MB);
  assert.deepEqual(drive.metadata.parents, ['folder-root']);
  assert.equal(drive.metadata.mimeType, 'application/pdf');
  assert.equal(drive.metadata.name, 'Shop Drawing.pdf');

  let result = api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 0, data: chunk(4 * MB) }, email);
  assert.deepEqual({ ...result }, { done: false, received: 4 * MB });
  result = api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 4 * MB, data: chunk(4 * MB) }, email);
  assert.equal(result.received, 8 * MB);
  result = api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 8 * MB, data: chunk(MB) }, email);
  assert.deepEqual({ ...result }, { done: true, received: size });

  const first = api.finishResumableUpload_(project, { uploadId: session.uploadId }, email);
  const second = api.finishResumableUpload_(project, { uploadId: session.uploadId }, email);
  assert.equal(first.id, 'drive-file-1');
  assert.equal(second.id, 'drive-file-1');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].folderId, 'f1');
});

test('backend validates uploads and protects sessions', () => {
  const { api } = createBackend();
  assert.throws(() => api.startResumableUpload_(project, { name: 'a.exe', size: MB }, email), /Jenis file/);
  for (const name of ['BOQ.xlsx', 'Layout.DWG', 'Rapat.pptx', 'rekap.csv']) {
    createBackend().api.startResumableUpload_(project, { name, size: MB }, email);
  }
  const office = createBackend();
  office.api.startResumableUpload_(project, { name: 'BOQ.xlsx', size: MB }, email);
  assert.equal(office.drive.metadata.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.throws(() => api.startResumableUpload_(project, { name: 'a.pdf', size: 201 * MB }, email), /200 MB/);
  assert.throws(() => api.startResumableUpload_(project, { name: 'a.pdf', size: 0 }, email), /Ukuran file/);

  const session = api.startResumableUpload_(project, { name: 'a.pdf', size: 9 * MB }, email);
  assert.throws(() => api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 0, data: chunk(4 * MB) }, 'other@example.com'), /bukan milik/);
  assert.throws(() => api.uploadResumableChunk_('p2', { uploadId: session.uploadId, offset: 0, data: chunk(4 * MB) }, email), /bukan milik/);
  assert.throws(() => api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 0, data: chunk(100) }, email), /potongan/);
  assert.throws(() => api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 0, data: chunk(4 * MB + 1) }, email), /potongan/);
  assert.throws(() => api.uploadResumableChunk_('p1', { uploadId: '../hack', offset: 0, data: chunk(10) }, email), /ID unggahan/);
  assert.throws(() => api.finishResumableUpload_(project, { uploadId: session.uploadId }, email), /belum selesai/);
});

test('backend reports resume position and cancels unfinished uploads', () => {
  const { api, drive, cache } = createBackend();
  const session = api.startResumableUpload_(project, { name: 'a.dxf', size: 9 * MB }, email);
  api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 0, data: chunk(4 * MB) }, email);
  const status = api.getResumableUploadStatus_('p1', { uploadId: session.uploadId }, email);
  assert.deepEqual({ ...status }, { done: false, received: 4 * MB });
  assert.equal(api.parseDriveUploadRange_('bytes=0-1023'), 1024);
  assert.equal(api.parseDriveUploadRange_(''), 0);

  api.cancelResumableUpload_('p1', { uploadId: session.uploadId }, email);
  assert.equal(drive.deleted, true);
  assert.equal(cache.size, 0);
  assert.throws(() => api.uploadResumableChunk_('p1', { uploadId: session.uploadId, offset: 0, data: chunk(4 * MB) }, email), /kedaluwarsa/);
});

test('backend keeps original file names in Drive and renames legacy files once', () => {
  const files = new Map([
    ['a', 'mep_project-eka-hospital_1792320143035_P-EH_Jda-01-22-LYD-0005-17_ELECTRICAL_LAYOUT_1___2'],
    ['b', 'Already Fine.dwg'],
    ['c', 'mep_p1_1_x.pdf']
  ]);
  const rows = [
    ['file:a', JSON.stringify({ name: 'P-EH Jda-01-22-LYD-0005-17 ELECTRICAL LAYOUT 1 & 2-R1.dwg' }), ''],
    ['b', '', 'Already Fine.dwg'],
    ['missing', '', 'Gone.pdf'],
    ['c', '', 'Rapat 1/2: final?.pdf']
  ];
  const logs = [];
  const context = vm.createContext({
    Logger: { log: (message) => logs.push(message) },
    PROJECT_FILES_SHEET_NAME: 'ProjectFiles',
    PROJECT_FILE_HEADERS: [],
    getSpreadsheet_: () => ({}),
    getSchemaSheet_: () => ({
      getLastRow: () => rows.length + 1,
      getLastColumn: () => 3,
      getRange: () => ({ getValues: () => rows })
    }),
    getSheetHeaderIndexes_: () => ['file id', 'payload json', 'file name'],
    getSheetCell_: (row, headers, name) => row[headers.indexOf(name)],
    parseJson_: (value) => { try { return JSON.parse(value || 'null'); } catch (error) { return null; } },
    DriveApp: {
      getFileById: (id) => {
        if (!files.has(id)) throw new Error('not found');
        return { getName: () => files.get(id), setName: (name) => files.set(id, name) };
      }
    }
  });
  vm.runInContext(`${driveNamingSource}
    globalThis.api = { driveFileName_, renameLegacyProjectFiles };`, context);
  const { driveFileName_, renameLegacyProjectFiles } = context.api;

  assert.equal(driveFileName_('Layout 1 & 2 (Rev.3).dwg'), 'Layout 1 & 2 (Rev.3).dwg');
  assert.equal(driveFileName_('a/b\\c:d.pdf'), 'a_b_c_d.pdf');
  assert.equal(driveFileName_('   '), 'file');
  const longName = driveFileName_(`${'x'.repeat(300)}.xlsx`);
  assert.equal(longName.length, 200);
  assert.ok(longName.endsWith('.xlsx'));

  const summary = renameLegacyProjectFiles();
  assert.deepEqual({ ...summary }, { renamed: 2, skipped: 1, failed: 1, remaining: 0 });
  assert.equal(files.get('a'), 'P-EH Jda-01-22-LYD-0005-17 ELECTRICAL LAYOUT 1 & 2-R1.dwg');
  assert.equal(files.get('b'), 'Already Fine.dwg');
  assert.equal(files.get('c'), 'Rapat 1_2_ final_.pdf');
  assert.deepEqual({ ...renameLegacyProjectFiles() }, { renamed: 0, skipped: 3, failed: 1, remaining: 0 });
});