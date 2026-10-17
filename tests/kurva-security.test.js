const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function frontendNormalizer() {
  const start = html.indexOf('function normalizeProjectSchedule(value)');
  const end = html.indexOf('function getKurvaRevisionMeta', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = vm.createContext({});
  vm.runInContext(`${html.slice(start, end)}\nglobalThis.normalizeProjectSchedule = normalizeProjectSchedule;`, context);
  return context.normalizeProjectSchedule;
}

function backendRevisionValidator() {
  const start = backend.indexOf('function validateKurvaRevisionHistory_(snapshot)');
  const end = backend.indexOf('function createProjectForUser_', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = vm.createContext({});
  vm.runInContext(`${backend.slice(start, end)}\nglobalThis.validateKurvaRevisionHistory_ = validateKurvaRevisionHistory_;`, context);
  return context.validateKurvaRevisionHistory_;
}

test('Kurva S normalization drops non-numeric revision values and normalizes valid revisions', () => {
  const normalize = frontendNormalizer();
  const schedule = normalize({
    weekCount: 2,
    items: [{ id: 'item-1', plan: [50, 50], weight: 100 }],
    revisions: [
      { revision: 0, note: 'Jadwal awal' },
      { revision: '2', note: 'Revisi valid' },
      { revision: '<img src=x onerror=alert(1)>', note: 'Tidak valid' },
      { revision: null, note: 'Tidak valid' }
    ]
  });

  assert.deepEqual(Array.from(schedule.revisions, (entry) => [entry.revision, entry.note]), [
    [0, 'Jadwal awal'],
    [2, 'Revisi valid']
  ]);
  assert.match(html, /Revisi ke-\$\{escapeHtml\(entry\.revision\)\}/);
});

test('Apps Script rejects malicious revision values and preserves numeric revision history', () => {
  const validate = backendRevisionValidator();
  const safe = validate({
    projectSchedule: {
      revisions: [
        { revision: 0, note: 'Jadwal awal' },
        { revision: '2', note: 'Revisi valid' }
      ]
    }
  });
  assert.deepEqual(Array.from(safe.projectSchedule.revisions, (entry) => entry.revision), [0, 2]);

  assert.throws(() => validate({
    projectSchedule: {
      revisions: [{ revision: '<img src=x onerror=alert(1)>' }]
    }
  }), /Nomor revisi Kurva S/);
});
