const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/\/\/ ==== PDF EXPORT CORE START ====([\s\S]*?)\/\/ ==== PDF EXPORT CORE END ====/)[1];
const context = vm.createContext({});
vm.runInContext(`${core}\nglobalThis.api = { getPdfExportRoleKey, canRoleExportPdf, isPdfDateInRange, isPdfWeekInRange };`, context);
const { getPdfExportRoleKey, canRoleExportPdf, isPdfDateInRange, isPdfWeekInRange } = context.api;

const ALL = ['create_project', 'kurva_s', 'checklist', 'daily_report', 'material', 'asset', 'files'];
const TABS = ['material', 'assets', 'ceklist', 'suratjalan', 'kurvas', 'calculator'];
const allowedTabs = (role, permissions) => TABS.filter((tab) => canRoleExportPdf(role, permissions, tab));

test('role aliases map to export roles', () => {
  assert.equal(getPdfExportRoleKey('Enginering'), 'engineering');
  assert.equal(getPdfExportRoleKey('SPV (Pelaksana)'), 'supervisor');
  assert.equal(getPdfExportRoleKey('(QS)'), 'quantity_surveyor');
  assert.equal(getPdfExportRoleKey('Project Manager'), 'project_manager');
  assert.equal(getPdfExportRoleKey('Magician Developer'), 'developer');
  assert.equal(getPdfExportRoleKey('Site Manager'), '');
  assert.equal(getPdfExportRoleKey('Logistik'), '');
});

test('export follows edit permissions per role', () => {
  assert.deepEqual(allowedTabs('Developer', ALL), TABS);
  assert.deepEqual(allowedTabs('SPV', ['checklist', 'daily_report']), ['ceklist', 'suratjalan', 'calculator']);
  assert.deepEqual(allowedTabs('Engineering', ['kurva_s', 'daily_report', 'files']), ['suratjalan', 'kurvas', 'calculator']);
  assert.deepEqual(allowedTabs('QS', ['kurva_s', 'checklist', 'daily_report', 'files']), ['ceklist', 'suratjalan', 'kurvas', 'calculator']);
  assert.deepEqual(allowedTabs('PM', ['create_project', 'kurva_s', 'checklist', 'daily_report', 'files']), ['ceklist', 'suratjalan', 'kurvas', 'calculator']);
});

test('roles outside the export list get nothing', () => {
  for (const role of ['Site Manager', 'QC', 'Admin Project', 'Logistik', 'Business Owner', 'Tamu', '']) {
    assert.deepEqual(allowedTabs(role, ALL), [], role);
  }
  assert.equal(canRoleExportPdf('Developer', ALL, 'unknown'), false);
});

test('date range filter is inclusive', () => {
  assert.equal(isPdfDateInRange('2026-05-01', '', ''), true);
  assert.equal(isPdfDateInRange('', '', ''), true);
  assert.equal(isPdfDateInRange('', '2026-05-01', ''), false);
  assert.equal(isPdfDateInRange('2026-05-01', '2026-05-01', '2026-05-01'), true);
  assert.equal(isPdfDateInRange('2026-04-30', '2026-05-01', ''), false);
  assert.equal(isPdfDateInRange('2026-05-02', '', '2026-05-01'), false);
});

test('kurva week overlaps the date range', () => {
  // Week runs 2026-05-04 .. 2026-05-10
  assert.equal(isPdfWeekInRange('2026-05-04', '2026-05-11', '', ''), true);
  assert.equal(isPdfWeekInRange('2026-05-04', '2026-05-11', '2026-05-10', ''), true);
  assert.equal(isPdfWeekInRange('2026-05-04', '2026-05-11', '2026-05-11', ''), false);
  assert.equal(isPdfWeekInRange('2026-05-04', '2026-05-11', '', '2026-05-04'), true);
  assert.equal(isPdfWeekInRange('2026-05-04', '2026-05-11', '', '2026-05-03'), false);
  assert.equal(isPdfWeekInRange('', '2026-05-11', '', ''), false);
});

function getFunction(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = html.slice(start);
  const next = rest.slice(1).search(/\n    (?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function dailyPdfContext() {
  const sandbox = vm.createContext({
    dailyWorkPlans: [
      { id: 'first', date: '2026-10-18', title: 'Laporan pertama', supervisor: 'SPV A',
        tasks: [{ discipline: 'Plumbing', title: 'Pasang pipa', area: 'Lantai 1', workers: 3 }] },
      { id: 'same-day', date: '2026-10-18', title: 'Laporan lain tanggal sama', supervisor: 'SPV B',
        tasks: [{ discipline: 'Elektrikal', title: 'Pasang kabel', area: 'Lantai 2', workers: 5 }] },
      { id: 'next-day', date: '2026-10-19', title: 'Laporan hari berikutnya', supervisor: 'SPV C', tasks: [] }
    ],
    escapeHtml: (value) => String(value),
    formatChecklistDate: (value) => value,
    formatPdfNumber: (value) => String(value),
    pdfSummary: (rows) => JSON.stringify(rows),
    pdfTable: (headers, rows) => JSON.stringify(rows),
    getSignedInName: () => 'Tester',
    getActiveProjectName: () => 'Proyek Uji',
    PDF_TAB_TITLES: { suratjalan: 'Laporan Harian MEP' }
  });
  vm.runInContext([
    core, getFunction('getDailyWorkStats'), getFunction('buildPdfDailyReport'),
    getFunction('formatPdfPeriod'), getFunction('buildPdfDocument'),
    'globalThis.buildReport = buildPdfDailyReport; globalThis.buildDocument = buildPdfDocument;'
  ].join('\n'), sandbox);
  return sandbox;
}

test('daily PDF exports only the selected report, not other reports on the same date', () => {
  const sandbox = dailyPdfContext();
  const result = sandbox.buildDocument('suratjalan', {
    reportIds: ['first'], from: '2099-01-01', to: '2099-01-02', maker: 'Tester'
  });
  assert.match(result.html, /Laporan pertama/);
  assert.match(result.html, /Pasang pipa/);
  assert.match(result.html, /SPV A/);
  assert.match(result.html, /"Jumlah Laporan","1"/);
  assert.match(result.html, /"Total Pekerja","3"/);
  assert.match(result.html, /Periode: <strong>2026-10-18 s.d. 2026-10-18/);
  assert.doesNotMatch(result.html, /Laporan lain|Laporan hari berikutnya|Pasang kabel|2099/);
});

test('daily cumulative PDF keeps its inclusive date filter and resets with no selection', () => {
  const sandbox = dailyPdfContext();
  const result = sandbox.buildReport({ from: '2026-10-18', to: '2026-10-18', reportIds: [] });
  assert.match(result, /Laporan pertama/);
  assert.match(result, /Laporan lain tanggal sama/);
  assert.match(result, /"Jumlah Laporan","2"/);
  assert.match(result, /"Total Pekerja","8"/);
  assert.doesNotMatch(result, /Laporan hari berikutnya/);
  assert.match(sandbox.buildReport({}), /"Jumlah Laporan","3"/);
});

test('missing selected daily report surfaces an error instead of exporting all reports', () => {
  const sandbox = dailyPdfContext();
  assert.throws(() => sandbox.buildDocument('suratjalan', { reportIds: ['missing'] }), /Laporan harian tidak ditemukan/);
  assert.throws(() => sandbox.buildDocument('suratjalan', { reportIds: ['first', 'missing'] }), /Laporan harian tidak ditemukan/);
});
