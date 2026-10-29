const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({ TextDecoder, Blob, Response, DecompressionStream });
vm.runInContext(html.match(/<script id="kurva-s-core">([\s\S]*?)<\/script>/)[1] + '\nglobalThis.api = kurvaSCore;', context);
const api = context.api;
const plain = (value) => JSON.parse(JSON.stringify(value));
const schedule = () => ({
  startDate: '2026-10-19', weekCount: 4, holidays: [],
  items: [
    { id: 'pipe', name: 'Pipa', group: 'MEP', weight: 60, plan: [15, 15, 15, 15], startWeek: 1 },
    { id: 'pump', name: 'Pompa', group: 'MEP', weight: 40, plan: [10, 10, 10, 10], startWeek: 1 }
  ],
  progress: { 1: { values: { pipe: 20, pump: 10 }, updatedAt: '2026-10-19', updatedBy: 'Admin' } }
});
const report = (values, detailVolumes) => ({ values, ...(detailVolumes ? { detailVolumes } : {}) });

test('adding up to ten unique subcontractors preserves legacy curve and reports', () => {
  const original = schedule();
  const before = JSON.stringify(original);
  let next = original;
  for (let index = 1; index <= 10; index += 1) next = api.addSubcontractor(next, ` Sub ${index} `);
  assert.equal(next.subcontractors.length, 10);
  assert.equal(new Set(next.subcontractors.map((entry) => entry.id)).size, 10);
  assert.equal(next.subcontractors[0].name, 'Sub 1');
  assert.deepEqual(plain(next.progress), original.progress);
  assert.deepEqual(plain(api.computeCurve(next)), plain(api.computeCurve(original)));
  assert.deepEqual(plain(next.subcontractorMainProgress), original.progress);
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => api.addSubcontractor(next, 'Eleven'), /Maksimal 10/);
  assert.throws(() => api.addSubcontractor(original, ''), /wajib/);
  assert.throws(() => api.addSubcontractor(original, 'a'.repeat(101)), /100 karakter/);
  assert.throws(() => api.addSubcontractor(api.addSubcontractor(original, 'A'), ' a '), /sudah terdaftar/);
});

test('legacy saves still use the same progress shape and leave the original immutable', () => {
  const original = schedule();
  const entry = report({ pipe: 40, pump: 25 });
  const next = api.setSourceProgress(original, '', 2, entry);
  assert.deepEqual(plain(next.progress), { ...original.progress, 2: entry });
  assert.equal(original.progress[2], undefined);
  assert.equal(next.subcontractors, undefined);
  assert.throws(() => api.setSourceProgress(original, 'unknown', 2, entry), /tidak ditemukan/);
});

test('subcontractors contribute additively, carry forward independently and do not double count on resave', () => {
  let next = api.addSubcontractor(schedule(), 'A');
  next = api.addSubcontractor(next, 'B');
  next = api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: 10, pump: 5 }));
  next = api.setSourceProgress(next, 'subcont-2', 3, report({ pipe: 15, pump: 10 }));
  assert.deepEqual(plain(api.getItemProgressAt(next, 3)), { pipe: 45, pump: 25 });
  assert.deepEqual(Array.from(api.computeCurve(next).actualCumulative), [16, 24, 37, null]);
  assert.deepEqual(plain(next.progress[1]), schedule().progress[1]);
  const before = plain(api.computeCurve(next));
  next = api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: 10, pump: 5 }));
  assert.deepEqual(plain(api.computeCurve(next)), before);
  assert.deepEqual(plain(api.getItemProgressAt(api.getProgressSource(next), 3)), { pipe: 20, pump: 10 });
  next = api.setSourceProgress(next, '', 4, report({ pipe: 25, pump: 15 }));
  assert.deepEqual(plain(api.getItemProgressAt(next, 4)), { pipe: 50, pump: 30 });
  assert.equal(api.computeCurve(next).actualCumulative[3], 42);
});

test('all ten subcontractors can report against a single master without changing weights or plans', () => {
  let next = schedule();
  for (let index = 1; index <= 10; index += 1) {
    next = api.addSubcontractor(next, `Sub ${index}`);
    next = api.setSourceProgress(next, `subcont-${index}`, 2, report({ pipe: 5, pump: 2 }));
  }
  assert.deepEqual(plain(api.getItemProgressAt(next, 2)), { pipe: 70, pump: 30 });
  assert.equal(api.computeCurve(next).actualCumulative[1], 54);
  assert.deepEqual(plain(next.items), schedule().items);
  assert.deepEqual(Array.from(api.computeCurve(next).planCumulative), [25, 50, 75, 100]);
});

test('rejects source regressions and aggregate overflow, including conflicts with future reports', () => {
  let next = api.addSubcontractor(schedule(), 'A');
  next = api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: 20 }));
  next = api.setSourceProgress(next, '', 4, report({ pipe: 80 }));
  const before = JSON.stringify(next);
  assert.throws(() => api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: 30 })), /Minggu 4.*100%/);
  assert.throws(() => api.setSourceProgress(next, 'subcont-1', 3, report({ pipe: 10 })), /kumulatif/);
  assert.throws(() => api.setSourceProgress(next, '', 1, report({ pipe: 90 })), /kumulatif/);
  for (const value of [-1, 101, NaN, Infinity]) {
    assert.throws(() => api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: value })));
  }
  assert.throws(() => api.setSourceProgress(next, '', 0, report({ pipe: 20 })), /Minggu/);
  assert.throws(() => api.setSourceProgress(next, '', 5, report({ pipe: 20 })), /Minggu/);
  assert.equal(JSON.stringify(next), before);
});

function detailedSchedule() {
  const next = schedule();
  next.detailStartWeek = 1;
  next.detailItems = [
    { id: 'd1', parentId: 'pipe', name: 'Pipa A', qty: 100, unit: 'm', weight: 30 },
    { id: 'd2', parentId: 'pipe', name: 'Pipa B', qty: 200, unit: 'm', weight: 30 }
  ];
  next.progress[1] = report({ pipe: 20, pump: 10 }, { d1: 20, d2: 40 });
  return next;
}

test('BOQ volumes are summed per detail and existing weighted recaps feed the unchanged curve', () => {
  let next = api.addSubcontractor(detailedSchedule(), 'A');
  next = api.addSubcontractor(next, 'B');
  const volumesA = { d1: 10, d2: 40 };
  const volumesB = { d1: 20, d2: 10 };
  next = api.setSourceProgress(next, 'subcont-1', 2,
    report({ ...api.aggregateDetailProgress(next.detailItems, volumesA), pump: 0 }, volumesA));
  next = api.setSourceProgress(next, 'subcont-2', 2,
    report({ ...api.aggregateDetailProgress(next.detailItems, volumesB), pump: 0 }, volumesB));
  assert.deepEqual(plain(api.getDetailVolumesAt(next, 2)), { d1: 50, d2: 90 });
  assert.deepEqual(plain(api.getItemProgressAt(next, 2)), { pipe: 47.5, pump: 10 });
  assert.equal(api.computeCurve(next).actualCumulative[1], 32.5);
  assert.deepEqual(plain(api.getDetailVolumesAt(api.getProgressSource(next, 'subcont-1'), 2)), volumesA);
  const before = JSON.stringify(next);
  assert.throws(() => api.setSourceProgress(next, 'subcont-1', 2,
    report({ pipe: 50 }, { d1: 90, d2: 0 })), /total volume.*QTY/);
  assert.equal(JSON.stringify(next), before);
});

test('detail source corrections respect future volume limits', () => {
  let next = api.addSubcontractor(detailedSchedule(), 'A');
  next = api.setSourceProgress(next, 'subcont-1', 3, report({ pipe: 10 }, { d1: 10, d2: 20 }));
  assert.throws(() => api.setSourceProgress(next, 'subcont-1', 2,
    report({ pipe: 5 }, { d1: 15, d2: 0 })), /Volume sumber/);
});

test('JSON project round-trip preserves named sources and recombined results', () => {
  let next = api.addSubcontractor(schedule(), 'A');
  next = api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: 10, pump: 5 }));
  const restored = plain(next);
  assert.equal(restored.subcontractors[0].name, 'A');
  assert.deepEqual(plain(api.combineSubcontractorProgress(restored)), restored.progress);
  assert.deepEqual(plain(api.computeCurve(restored)), plain(api.computeCurve(next)));
  const backend = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const normalize = html.slice(html.indexOf('function normalizeProjectSchedule(value)'), html.indexOf('function getKurvaRevisionMeta'));
  const validate = backend.slice(backend.indexOf('function validateKurvaRevisionHistory_(snapshot)'), backend.indexOf('function createProjectForUser_'));
  const sandbox = vm.createContext({});
  vm.runInContext(`${normalize}\n${validate}`, sandbox);
  restored.revisions = [{ revision: 0 }];
  const roundtrip = sandbox.normalizeProjectSchedule(sandbox.validateKurvaRevisionHistory_({ projectSchedule: restored }).projectSchedule);
  assert.deepEqual(plain(roundtrip.subcontractors), restored.subcontractors);
  assert.deepEqual(plain(roundtrip.subcontractorMainProgress), restored.subcontractorMainProgress);
  assert.deepEqual(plain(roundtrip.progress), restored.progress);
});

test('reschedule preserves and remaps independent subcontractor histories with the master', async () => {
  let original = api.addSubcontractor(schedule(), 'A');
  original = api.setSourceProgress(original, 'subcont-1', 2, report({ pipe: 10, pump: 5 }));
  const elements = {
    kurvaImportStart: { value: '2026-10-19' }, kurvaImportName: { value: 'Revision' },
    kurvaRevisionNote: { value: 'Extend duration' }
  };
  let succeeds = true;
  const sandbox = vm.createContext({
    projectSchedule: original, activeProjectId: 'p', kurvaImportDraft: {
      ...schedule(), weekCount: 5,
      items: schedule().items.map((item) => ({ ...item, plan: [...item.plan, 0] }))
    },
    kurvaImportMode: 'reschedule', kurvaSCore: api,
    requireAccess: () => true, document: { getElementById: (id) => elements[id] },
    getSignedInName: () => 'Admin', showAppNotice: assert.fail,
    getKurvaRevisionMeta: (value, revision) => ({ revision }),
    persistActiveProjectData: async () => succeeds,
    closeKurvaImportModal() {}, renderKurvaS() {}
  });
  const start = html.indexOf('    async function saveKurvaImport()');
  vm.runInContext(html.slice(start, html.indexOf('    function openKurvaProgressModal()', start)), sandbox);
  await sandbox.saveKurvaImport();
  assert.equal(sandbox.projectSchedule.weekCount, 5);
  assert.deepEqual(plain(sandbox.projectSchedule.subcontractors), plain(original.subcontractors));
  assert.deepEqual(plain(sandbox.projectSchedule.progress), plain(original.progress));
  assert.deepEqual(plain(sandbox.projectSchedule.subcontractorMainProgress), original.subcontractorMainProgress);
  assert.equal(sandbox.projectSchedule.revision, 1);
  const revised = sandbox.projectSchedule;
  elements.kurvaImportStart.value = '2026-10-12';
  await sandbox.saveKurvaImport();
  assert.equal(sandbox.projectSchedule.subcontractorMainProgress[2].values.pipe, 20);
  assert.equal(sandbox.projectSchedule.subcontractors[0].progress[3].values.pipe, 10);
  assert.deepEqual(plain(api.getItemProgressAt(sandbox.projectSchedule, 3)), { pipe: 30, pump: 15 });
  sandbox.projectSchedule = revised;
  succeeds = false;
  await sandbox.saveKurvaImport();
  assert.equal(sandbox.projectSchedule, revised);
});

test('mapping corrections keep historical source contributions without rewriting earlier recaps', () => {
  let next = api.addSubcontractor(detailedSchedule(), 'A');
  next = api.setSourceProgress(next, 'subcont-1', 2, report({ pipe: 10 }, { d1: 10, d2: 20 }));
  const history = plain(next.progress);
  const oldDetails = next.detailItems;
  const moved = next.detailItems.map((item) => ({ ...item, parentId: 'pump' }));
  next.detailMappingVersions = [
    { fromWeek: 1, items: oldDetails }, { fromWeek: 3, items: moved }
  ];
  next.detailItems = moved;
  next = api.setSourceProgress(next, 'subcont-1', 3,
    report({ pipe: 10, pump: 20 }, { d1: 20, d2: 40 }));
  assert.deepEqual(plain(next.progress[1]), history[1]);
  assert.deepEqual(plain(next.progress[2]), history[2]);
  assert.deepEqual(plain(api.getDetailVolumesAt(next, 3)), { d1: 40, d2: 80 });
  assert.deepEqual(plain(api.getItemProgressAt(next, 3)), { pipe: 30, pump: 30 });
});

test('adding a subcontractor requires access, rolls back failures and escapes names in the selector', async () => {
  const original = schedule();
  let allowed = true;
  let succeeds = false;
  let selected = '';
  const elements = { kurvaSubcontractorName: { value: 'A' } };
  const sandbox = vm.createContext({
    projectSchedule: original, kurvaSCore: api,
    document: { getElementById: (id) => elements[id] },
    requireAccess: () => allowed, showAppNotice: assert.fail,
    persistActiveProjectData: async () => succeeds,
    renderKurvaProgressSources: (id) => { selected = id; }, renderKurvaProgressForm() {}
  });
  const start = html.indexOf('    async function addKurvaSubcontractor()');
  vm.runInContext(html.slice(start, html.indexOf('    function renderKurvaProgressForm()', start)), sandbox);
  await sandbox.addKurvaSubcontractor();
  assert.equal(sandbox.projectSchedule, original);
  allowed = false;
  succeeds = true;
  await sandbox.addKurvaSubcontractor();
  assert.equal(sandbox.projectSchedule, original);
  allowed = true;
  await sandbox.addKurvaSubcontractor();
  assert.equal(sandbox.projectSchedule.subcontractors.length, 1);
  assert.equal(selected, 'subcont-1');
  const controlIds = ['kurvaProgressSource', 'kurvaSubcontractorName', 'kurvaSubcontractorAdd', 'kurvaSubcontractorForm', 'kurvaSubcontractorCount', 'kurvaMasterWeights'];
  const controls = Object.fromEntries(controlIds.map((id) => [id, {}]));
  controls.kurvaSubcontractorAdd.setAttribute = (name, value) => { controls.kurvaSubcontractorAdd[name] = value; };
  const renderSandbox = vm.createContext({
    projectSchedule: api.addSubcontractor(original, '<img src=x onerror=alert(1)>'),
    document: { getElementById: (id) => controls[id] },
    escapeHtml: (text) => String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  });
  const renderStart = html.indexOf('    function renderKurvaProgressSources(');
  vm.runInContext(html.slice(renderStart, html.indexOf('    async function addKurvaSubcontractor()', renderStart)), renderSandbox);
  renderSandbox.renderKurvaProgressSources();
  assert.equal(controls.kurvaSubcontractorForm.hidden, true);
  assert.equal(controls.kurvaSubcontractorAdd['aria-expanded'], 'false');
  assert.match(controls.kurvaProgressSource.innerHTML, /&lt;img/);
  assert.doesNotMatch(controls.kurvaProgressSource.innerHTML, /<img/);
  assert.equal(controls.kurvaSubcontractorAdd.disabled, false);
  for (let index = 2; index <= 10; index += 1) {
    renderSandbox.projectSchedule = api.addSubcontractor(renderSandbox.projectSchedule, `Sub ${index}`);
  }
  renderSandbox.renderKurvaProgressSources();
  assert.equal(controls.kurvaSubcontractorAdd.disabled, true);
});

test('manual add button opens an empty name field; cancel, permission and capacity never create sources', () => {
  const original = schedule();
  let allowed = true;
  let focused = 0;
  const notices = [];
  const controls = {
    kurvaSubcontractorForm: { hidden: true },
    kurvaSubcontractorName: { value: 'old', focus: () => { focused += 1; } },
    kurvaSubcontractorAdd: { setAttribute(name, value) { this[name] = value; } }
  };
  const sandbox = vm.createContext({
    projectSchedule: original,
    requireAccess: () => allowed,
    showAppNotice: (message) => notices.push(message),
    document: { getElementById: (id) => controls[id] }
  });
  const start = html.indexOf('    function toggleKurvaSubcontractorForm(');
  vm.runInContext(html.slice(start, html.indexOf('    function renderKurvaProgressSources(', start)), sandbox);
  sandbox.toggleKurvaSubcontractorForm(true);
  assert.equal(controls.kurvaSubcontractorForm.hidden, false);
  assert.equal(controls.kurvaSubcontractorName.value, '');
  assert.equal(controls.kurvaSubcontractorAdd['aria-expanded'], 'true');
  assert.equal(focused, 1);
  controls.kurvaSubcontractorName.value = 'PT Mitra Konstruksi';
  sandbox.toggleKurvaSubcontractorForm(false);
  assert.equal(controls.kurvaSubcontractorForm.hidden, true);
  assert.equal(controls.kurvaSubcontractorName.value, '');
  assert.equal(sandbox.projectSchedule, original);
  allowed = false;
  sandbox.toggleKurvaSubcontractorForm(true);
  assert.equal(controls.kurvaSubcontractorForm.hidden, true);
  allowed = true;
  let full = original;
  for (let index = 1; index <= 10; index += 1) full = api.addSubcontractor(full, `PT Mitra ${index}`);
  sandbox.projectSchedule = full;
  sandbox.toggleKurvaSubcontractorForm(true);
  assert.equal(controls.kurvaSubcontractorForm.hidden, true);
  assert.match(notices[0], /Maksimal 10/);
  assert.equal(original.subcontractors, undefined);
  assert.doesNotMatch(html, /Subcont [ABC] - (Struktur|MEP|Finishing)/);
});

test('failed saves roll back source and combined progress; permission denial writes nothing', async () => {
  const original = api.addSubcontractor(schedule(), 'A');
  const input = { dataset: { itemId: 'pipe' }, value: '10', min: '0', max: '100', readOnly: false };
  const elements = { kurvaProgressWeek: { value: '2' }, kurvaProgressSource: { value: 'subcont-1' } };
  let allowed = true;
  let persisted = 0;
  let succeeds = false;
  let closed = 0;
  const sandbox = vm.createContext({
    projectSchedule: original, kurvaSCore: api,
    document: { getElementById: (id) => elements[id], querySelectorAll: () => [input] },
    requireAccess: () => allowed, isKurvaDetailWeek: () => false,
    getSignedInName: () => 'Admin', showAppNotice: assert.fail,
    persistActiveProjectData: async () => { persisted += 1; return succeeds; },
    closeKurvaProgressModal: () => { closed += 1; }, renderKurvaS() {}
  });
  const start = html.indexOf('    async function saveKurvaProgress()');
  vm.runInContext(html.slice(start, html.indexOf('    // ==== NETWORK', start)), sandbox);
  await sandbox.saveKurvaProgress();
  assert.equal(sandbox.projectSchedule, original);
  assert.equal(original.subcontractors[0].progress[2], undefined);
  assert.equal(closed, 0);
  allowed = false;
  await sandbox.saveKurvaProgress();
  assert.equal(persisted, 1);
  allowed = true;
  succeeds = true;
  await sandbox.saveKurvaProgress();
  assert.equal(closed, 1);
  assert.equal(sandbox.projectSchedule.progress[2].values.pipe, 30);
  assert.equal(sandbox.projectSchedule.subcontractors[0].progress[2].values.pipe, 10);
});
