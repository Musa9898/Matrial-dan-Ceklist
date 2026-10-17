const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const backend = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function loadRoleFunctions(accessRows) {
  const start = backend.indexOf('// Matriks role mengikuti tabel');
  const end = backend.indexOf('function requireProjectPermission_', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = vm.createContext({});
  vm.runInContext(`${backend.slice(start, end)}
    readActiveAccessRows_ = () => globalThis.accessRows;
    globalThis.api = { getRolePermissions_, getAccessibleProjects_, getAuthorizedProjects_, SNAPSHOT_SECTIONS };`, context);
  context.accessRows = accessRows || [];
  return context.api;
}

const sorted = (list) => Array.from(list).sort();

test('role matrix matches the Orion Team role table', () => {
  const { getRolePermissions_ } = loadRoleFunctions();
  const expected = {
    developer: ['asset', 'checklist', 'create_project', 'daily_report', 'files', 'kurva_s', 'material'],
    'Magician / Developer': ['asset', 'checklist', 'create_project', 'daily_report', 'files', 'kurva_s', 'material'],
    'Business Owner': ['files'],
    'Project Manager': ['checklist', 'create_project', 'daily_report', 'files', 'kurva_s'],
    'Site Manager': ['checklist', 'daily_report', 'files', 'kurva_s'],
    'Admin project': ['daily_report', 'files', 'kurva_s'],
    admin: ['daily_report', 'files', 'kurva_s'],
    Engineering: ['daily_report', 'files', 'kurva_s'],
    Drafter: ['files'],
    'QS ( Quantity Surveyor )': ['checklist', 'daily_report', 'files', 'kurva_s'],
    'QC ( Quality Control )': ['checklist', 'daily_report', 'files', 'kurva_s'],
    SPV: ['checklist', 'daily_report'],
    Logistik: ['asset', 'material'],
    'Owner project / tamu': [],
    owner: [],
    'role-tidak-dikenal': []
  };
  Object.entries(expected).forEach(([role, permissions]) => {
    assert.deepEqual(sorted(getRolePermissions_(role)), permissions, role);
  });
});

test('Kurva S is protected by its own kurva_s section, separate from Laporan Harian', () => {
  const { SNAPSHOT_SECTIONS } = loadRoleFunctions();
  assert.deepEqual(Array.from(SNAPSHOT_SECTIONS.kurva_s), ['projectSchedule']);
  assert.deepEqual(Array.from(SNAPSHOT_SECTIONS.daily_report), ['dailyWorkPlans']);
  assert.match(html, /toggle\('#kurvaImportButton', 'kurva_s'\)/);
  assert.match(html, /toggle\('#kurvaRescheduleButton', 'kurva_s'\)/);
  assert.match(html, /toggle\('#kurvaProgressButton', 'kurva_s'\)/);
});

test('Developer and Business Owner see every project; other roles only see assigned projects', () => {
  const rows = [
    { email: 'dev@x.com', projectId: 'a', projectName: 'A', role: 'developer' },
    { email: 'bo@x.com', projectId: 'a', projectName: 'A', role: 'Business Owner' },
    { email: 'pm@x.com', projectId: 'a', projectName: 'A', role: 'Project Manager' },
    { email: 'spv@x.com', projectId: 'b', projectName: 'B', role: 'spv' },
    { email: 'tamu@x.com', projectId: 'c', projectName: 'C', role: 'tamu' }
  ];
  const { getAccessibleProjects_, getAuthorizedProjects_ } = loadRoleFunctions(rows);
  const byId = (projects) => Object.fromEntries(projects.map((project) => [project.projectId, project]));

  const dev = byId(getAccessibleProjects_('dev@x.com'));
  assert.deepEqual(sorted(Object.keys(dev)), ['a', 'b', 'c']);
  assert.ok(Object.values(dev).every((project) => project.permissions.length === 7 && !project.readOnly));

  const bo = byId(getAccessibleProjects_('bo@x.com'));
  assert.deepEqual(sorted(Object.keys(bo)), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(bo.a.permissions), ['files']);
  assert.equal(bo.a.readOnly, false);
  assert.equal(bo.b.permissions.length, 0);
  assert.equal(bo.b.readOnly, true);

  const pm = getAccessibleProjects_('pm@x.com');
  assert.deepEqual(sorted(pm.map((project) => project.projectId)), ['a']);
  assert.ok(pm[0].permissions.includes('create_project'));

  const spvProjects = getAuthorizedProjects_('spv@x.com');
  assert.deepEqual(sorted(spvProjects.map((project) => project.projectId)), ['b']);
  assert.equal(spvProjects[0].readOnly, false);

  const guestProjects = getAccessibleProjects_('tamu@x.com');
  assert.deepEqual(sorted(guestProjects.map((project) => project.projectId)), ['c']);
  assert.equal(guestProjects[0].readOnly, true);

  assert.equal(getAccessibleProjects_('unknown@x.com').length, 0);
});
