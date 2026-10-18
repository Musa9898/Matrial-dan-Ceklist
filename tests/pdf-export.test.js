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
