const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function backend() {
  const properties = new Map();
  const cache = new Map();
  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: (key) => properties.delete(key),
        getProperties: () => Object.fromEntries(properties)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) || null,
        put: (key, value) => cache.set(key, value),
        putAll: (values) => Object.entries(values).forEach(([key, value]) => cache.set(key, value)),
        getAll: (keys) => Object.fromEntries(keys.filter((key) => cache.has(key)).map((key) => [key, cache.get(key)]))
      })
    },
    SpreadsheetApp: { flush: () => {} },
    LockService: {
      getScriptLock: () => {
        let held = false;
        return { tryLock: () => { held = true; return true; }, waitLock: () => { held = true; }, hasLock: () => held, releaseLock: () => { held = false; } };
      }
    }
  });
  vm.runInContext(source, context);
  return { context, properties, cache };
}

function sheet(headers, rows) {
  const data = [headers, ...rows].map((row) => [...row]);
  const writes = [];
  const clears = [];
  return {
    data, writes, clears,
    getName: () => 'Test',
    getLastColumn: () => headers.length,
    getLastRow: () => {
      let last = data.length;
      while (last > 1 && data[last - 1].every((value) => value === '')) last--;
      return last;
    },
    getRange: (row, column, height, width) => {
      const read = () => Array.from({ length: height }, (_, offset) =>
        Array.from({ length: width }, (_, cell) => data[row - 1 + offset]?.[column - 1 + cell] ?? ''));
      return {
        getValues: read,
        getDisplayValues: () => read().map((values) => values.map(String)),
        setValues: (values) => {
          writes.push({ row, height });
          values.forEach((valuesRow, offset) => {
            data[row - 1 + offset] ||= Array(headers.length).fill('');
            valuesRow.forEach((value, cell) => { data[row - 1 + offset][column - 1 + cell] = value; });
          });
        },
        clearContent: () => {
          clears.push({ row, height });
          for (let offset = 0; offset < height; offset++) {
            for (let cell = 0; cell < width; cell++) data[row - 1 + offset][column - 1 + cell] = '';
          }
        }
      };
    },
    deleteRow: () => { throw new Error('Rows must not be deleted or shifted'); }
  };
}

const headers = ['record_id', 'project_id', 'asset_name', 'payload_json', 'updated_at', 'email', 'reporter'];
const row = (id, name = id) => [id, 'project-a', name, JSON.stringify({ id, name }), 'old-date', 'old-user', 'old-user'];
const ignored = ['updated_at', 'email', 'reporter'];

test('adding one asset to 27 assets writes exactly one row and preserves all existing metadata', () => {
  const { context } = backend();
  const existing = Array.from({ length: 27 }, (_, index) => row(`asset-${index}`));
  const otherProject = ['other', 'project-b', 'Other asset', '{}', 'old-date', 'other-user', 'other-user'];
  const book = sheet(headers, [...existing, otherProject]);
  const next = [...existing.map((values) => [...values.slice(0, 4), 'new-date', 'new-user', 'new-user']), row('new-asset')];
  context.replaceProjectRows_(book, 'project-a', next, 'project_id', ignored);
  assert.deepEqual(book.writes, [{ row: 30, height: 1 }]);
  assert.deepEqual(book.clears, []);
  assert.deepEqual(book.data.slice(1, 28), existing);
  assert.deepEqual(book.data[28], otherProject);
});

test('unchanged snapshot and reordered payload keys perform zero writes', () => {
  const { context } = backend();
  const previous = row('asset-a');
  const book = sheet(headers, [previous]);
  const next = [...previous];
  next[3] = JSON.stringify({ name: 'asset-a', id: 'asset-a' });
  next[4] = 'new-date';
  context.replaceProjectRows_(book, 'project-a', [next], 'project_id', ignored);
  assert.equal(book.writes.length, 0);
  assert.equal(book.clears.length, 0);
});

test('editing one record updates only that row', () => {
  const { context } = backend();
  const first = row('first');
  const second = row('second');
  const book = sheet(headers, [first, second]);
  context.replaceProjectRows_(book, 'project-a', [row('first', 'Updated asset'), second], 'project_id', ignored);
  assert.deepEqual(book.writes, [{ row: 2, height: 1 }]);
  assert.deepEqual(book.data[2], second);
});

test('deleted records are cleared in batches and free rows reused without moving another project', () => {
  const { context } = backend();
  const otherProject = ['other', 'project-b', 'Other', '{}', '', '', ''];
  const book = sheet(headers, [row('a'), row('b'), row('c'), otherProject]);
  context.replaceProjectRows_(book, 'project-a', [row('c'), row('new')], 'project_id', ignored);
  assert.deepEqual(book.clears, [{ row: 2, height: 2 }]);
  assert.deepEqual(book.writes, [{ row: 2, height: 1 }]);
  assert.deepEqual(book.data[4], otherProject);
  assert.equal(book.data[2].every((cell) => cell === ''), true);
});

test('snapshot chunk IDs preserve unchanged chunks and clear obsolete ones', () => {
  const { context } = backend();
  const chunkHeaders = ['Project ID', 'Snapshot JSON', 'Updated By', 'Updated At', 'Chunk Index'];
  const book = sheet(chunkHeaders, [['project-a', 'first', 'old', 'old-date', 0], ['project-a', 'second', 'old', 'old-date', 1]]);
  context.replaceProjectRows_(book, 'project-a', [['project-a', 'first', 'new', 'new-date', 0]], 'Project ID', ['updated by', 'updated at']);
  assert.equal(book.writes.length, 0);
  assert.deepEqual(book.clears, [{ row: 3, height: 1 }]);
});

test('duplicate incoming IDs fail before modifying the sheet', () => {
  const { context } = backend();
  const book = sheet(headers, [row('a')]);
  assert.throws(() => context.replaceProjectRows_(book, 'project-a', [row('a'), row('a')], 'project_id'), /duplikat/);
  assert.equal(book.writes.length, 0);
  assert.equal(book.clears.length, 0);
});

test('full snapshot saving adds one asset without rewriting materials, old assets, files, or other projects', () => {
  const { context } = backend();
  const sheets = new Map();
  context.getSpreadsheet_ = () => ({});
  context.getSchemaSheet_ = (spreadsheet, name, columns) => {
    if (!sheets.has(name)) sheets.set(name, sheet([...columns], []));
    return sheets.get(name);
  };
  const project = { projectId: 'project-a' };
  const snapshot = {
    assetItems: Array.from({ length: 27 }, (_, index) => ({
      id: `asset-${index}`, name: `Asset ${index}`, code: `CODE-${index}`, quantity: 1,
      category: 'ALAT KERJA', status: 'Tersedia', location: 'Gudang', updatedAt: '2026-10-01T00:00:00Z'
    })),
    materialItems: [{ name: 'Pipa', unit: 'Pcs', received: 5, issued: 0, target: 5 }],
    checklistItems: [], dailyWorkPlans: [], deliveryHistory: {}, usageHistory: {}
  };
  context.replaceProjectRecords_('project-a', context.buildMonitoringRecords_(project, snapshot, 'old@example.test', []));
  const oldAssets = sheets.get('Assets').data.slice(1).map((values) => [...values]);
  const oldMaterials = sheets.get('Materials').data.slice(1).map((values) => [...values]);
  for (const book of sheets.values()) { book.writes.length = 0; book.clears.length = 0; }
  snapshot.assetItems.push({
    id: 'new-asset', name: 'New asset', code: 'NEW', quantity: 1,
    category: 'ALAT KERJA', status: 'Tersedia', updatedAt: '2026-10-14T00:00:00Z'
  });
  context.replaceProjectRecords_('project-a', context.buildMonitoringRecords_(project, snapshot, 'new@example.test', []));
  assert.deepEqual(sheets.get('Assets').writes, [{ row: 29, height: 1 }]);
  assert.deepEqual(sheets.get('Assets').data.slice(1, 28), oldAssets);
  assert.deepEqual(sheets.get('Materials').data.slice(1), oldMaterials);
  for (const name of ['Materials', 'Checklists', 'DailyReports', 'ProjectFiles', 'Monitoring']) {
    assert.equal(sheets.get(name).writes.length, 0, name);
    assert.equal(sheets.get(name).clears.length, 0, name);
  }
});

function prepareSaveBackend() {
  const result = backend();
  vm.runInContext(`
    var writes = 0, uploads = 0, mirrorNetworkCalls = 0;
    var stored = {};
    verifyGoogleIdToken_ = () => ({ email: 'test@example.test' });
    getAuthorizedProjects_ = () => [{ projectId: 'project-a', permissions: ['asset'] }];
    jsonOutput_ = value => value;
    mergeSnapshotByPermissions_ = (project, snapshot) => snapshot;
    replaceBase64Images_ = snapshot => { uploads++; return snapshot; };
    buildMonitoringRecords_ = (project, snapshot) => [{ snapshot }];
    replaceProjectRecords_ = (id, records) => { writes++; stored = records[0].snapshot; };
    getSpreadsheet_ = () => ({});
    readProjectDataRecords_ = () => [{ status: '0', payload: JSON.stringify(stored) }];
    getSupabaseKey_ = () => 'configured';
    syncSupabaseSafely_ = () => { mirrorNetworkCalls++; };
  `, result.context);
  return result;
}

test('retrying a successful save writes/uploads once, returns receipt, and queues mirror without networking', () => {
  const { context, cache, properties } = prepareSaveBackend();
  const request = { action: 'saveSnapshot', idToken: 'test', projectId: 'project-a', mutationId: 'save-test', snapshot: { assetItems: [{ id: 'a' }] } };
  const post = () => context.doPost({ postData: { contents: JSON.stringify(request) } });
  assert.equal(post().saved, true);
  assert.equal(post().saved, true);
  assert.equal(context.writes, 1);
  assert.equal(context.uploads, 1);
  assert.equal(context.mirrorNetworkCalls, 0);
  assert.equal(properties.has('supabase-pending:project-a'), true);
  cache.clear();
  assert.equal(post().snapshot.assetItems[0].id, 'a');
  assert.equal(context.writes, 1);
  const status = context.doPost({ postData: { contents: JSON.stringify({ ...request, action: 'saveStatus' }) } });
  assert.equal(status.saved, true);
  assert.equal(context.writes, 1);
  const missing = context.doPost({ postData: { contents: JSON.stringify({ ...request, action: 'saveStatus', mutationId: 'missing' }) } });
  assert.equal(missing.saved, false);
});

test('login/load through doPost do not write records, invalidate cache, or queue mirror', () => {
  const { context, properties, cache } = prepareSaveBackend();
  vm.runInContext("doGet = () => ({ status: 'success', projects: [] });", context);
  for (const action of ['login', 'load']) {
    assert.equal(context.doPost({ postData: { contents: JSON.stringify({ action, idToken: 'test' }) } }).status, 'success');
  }
  assert.equal(context.writes, 0);
  assert.equal(properties.size, 0);
  assert.equal(cache.size, 0);
});

test('unauthorized or invalid saves do not mutate or enqueue synchronization', () => {
  const { context, properties } = prepareSaveBackend();
  const request = { action: 'saveSnapshot', idToken: 'test', projectId: 'project-a', mutationId: 'invalid/id', snapshot: {} };
  assert.equal(context.doPost({ postData: { contents: JSON.stringify(request) } }).status, 'error');
  assert.equal(context.writes, 0);
  assert.equal(context.uploads, 0);
  assert.equal(properties.size, 0);
});

test('busy server reports a retryable code without mutating data', () => {
  const { context, properties } = prepareSaveBackend();
  context.LockService.getScriptLock = () => ({ tryLock: () => false, hasLock: () => false });
  const request = { action: 'saveSnapshot', idToken: 'test', projectId: 'project-a', mutationId: 'busy-save', snapshot: {} };
  const result = context.doPost({ postData: { contents: JSON.stringify(request) } });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'busy');
  assert.equal(context.writes, 0);
  assert.equal(context.uploads, 0);
  assert.equal(properties.size, 0);
});
