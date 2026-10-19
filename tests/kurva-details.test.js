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

test('saving includes every item only in checked groups and rejects incomplete selections', async () => {
  const schedule = { items: [{ id: 'parent' }], weekCount: 10 };
  const elements = {
    kurvaMappingConfirmed: { checked: true },
    kurvaInclude0: { checked: true },
    kurvaInclude1: { checked: false },
    kurvaMap0: { value: 'parent', focus() { this.focused = true; } },
    kurvaMap1: { value: '' },
    kurvaDetailsSave: {}
  };
  const notices = [];
  let saved = 0;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    projectSchedule: schedule, activeProjectId: 'project',
    kurvaDetailsDraft: { schedule, projectId: 'project', fileName: 'boq.xlsx',
      items: [1, 2, 3], skipped: [],
      groups: [['one', [{ id: 'a' }, { id: 'b' }]], ['two', [{ id: 'c' }]]] },
    requireAccess: () => true, showAppNotice: (message) => notices.push(message),
    kurvaSCore: { computeCurve: () => ({ lastReportedWeek: 0 }) },
    getSignedInName: () => 'Tester',
    persistActiveProjectData: async () => { saved += 1; return true; },
    closeKurvaDetailsImport() {}, renderKurvaS() {}
  });
  const start = html.indexOf('    async function saveKurvaDetailsImport()');
  const end = html.indexOf('    function isKurvaDetailWeek(', start);
  vm.runInContext(html.slice(start, end), sandbox);
  elements.kurvaInclude0.checked = false;
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saved, 0);
  assert.match(notices.at(-1), /Minimal satu item/);
  elements.kurvaInclude0.checked = true;
  elements.kurvaMap0.value = '';
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saved, 0);
  assert.equal(elements.kurvaMap0.focused, true);
  assert.match(notices.at(-1), /belum memiliki induk/);
  elements.kurvaMap0.value = 'parent';
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saved, 1);
  assert.deepEqual(plain(sandbox.projectSchedule.detailItems), [
    { id: 'a', parentId: 'parent' }, { id: 'b', parentId: 'parent' }
  ]);
  assert.equal(sandbox.projectSchedule.detailSource.excludedCount, 1);
});

test('group checklist updates status, disables excluded mappings and resets confirmation', () => {
  const elements = {};
  for (let index = 0; index < 3; index += 1) {
    elements[`kurvaInclude${index}`] = { checked: index !== 2 };
    elements[`kurvaMap${index}`] = { value: index === 1 ? '' : 'parent', setAttribute(key, value) { this[key] = value; } };
    elements[`kurvaMapStatus${index}`] = {};
  }
  elements.kurvaMappingConfirmed = { checked: true };
  elements.kurvaMappingSummary = {};
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    kurvaDetailsDraft: { schedule: { items: [{ id: 'parent' }] },
      groups: [['a', [1, 2]], ['b', [3]], ['c', [4]]] }
  });
  const start = html.indexOf('    function updateKurvaMappingSelection()');
  const end = html.indexOf('    async function saveKurvaDetailsImport()', start);
  vm.runInContext(html.slice(start, end) + '\nupdateKurvaMappingSelection();', sandbox);
  assert.match(elements.kurvaMapStatus0.textContent, /^Siap/);
  assert.match(elements.kurvaMapStatus1.textContent, /^Belum pilih induk/);
  assert.match(elements.kurvaMapStatus2.textContent, /^Tidak diikutkan/);
  assert.equal(elements.kurvaMap2.disabled, true);
  assert.equal(elements.kurvaMap2.value, 'parent');
  assert.equal(elements.kurvaMappingConfirmed.checked, false);
  assert.match(elements.kurvaMappingSummary.textContent, /2 kelompok dicentang \(3 item\) · 1 belum pilih induk · 1 kelompok tidak diikutkan/);
  elements.kurvaInclude2.checked = true;
  sandbox.updateKurvaMappingSelection();
  assert.equal(elements.kurvaMap2.disabled, false);
  assert.match(elements.kurvaMapStatus2.textContent, /^Siap/);
});

function detailGrid() {
  return {
    4: { 1: 'NO', 3: 'UNIT', 4: ' QTY ', 5: ' BOBOT ' },
    7: { 1: 'A', 2: 'WATERPROOFING' },
    8: { 1: 1, 2: 'Waterproof floor', 3: 'm2', 4: 100, 5: 2 },
    9: { 1: 2, 2: 'Waterproof wall', 3: 'm2', 4: 50, 5: 6 },
    10: { 2: 'WATERPROOFING', 5: 8 },
    11: { 1: 3, 2: 'Included item', 3: 'ls', 4: 1, 5: 'Incl.' },
    12: { 1: 4, 2: 'Missing quantity', 3: 'm', 5: 1 },
    13: { 2: 'TOTAL', 5: 9 }
  };
}

test('multi-sheet BOQ extracts leaf volume items, not subtotals or invalid weights', () => {
  const result = api.parseDetailGrids([
    { name: 'SUMMARY', grid: { 4: { 1: 'NO', 2: 'DESCRIPTION', 4: 'BOBOT TOTAL' } } },
    { name: 'ARCHITECTURE-PODIUM', grid: detailGrid() },
    { name: 'ARCHITECTURE-TOWER', grid: detailGrid() }
  ]);
  assert.equal(result.items.length, 4);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 4);
  assert.equal(result.skipped.length, 5);
  assert.equal(result.items[0].section, 'WATERPROOFING');
  assert.equal(result.items[0].qty, 100);
  assert.equal(result.items[0].weight, 2);
  assert.equal(result.items[0].unit, 'm2');
  assert.equal(result.items[0].row, 8);
});

test('offset columns, nested area and parent context are preserved', () => {
  const result = api.parseDetailGrids([{ name: 'PLUMBING INST', grid: {
    4: { 3: 'NO', 5: 'UNIT', 6: 'QTY', 7: 'BOBOT' },
    18: { 3: 'A', 4: 'LANTAI 1' },
    20: { 3: 'A.1', 4: 'COLD WATER' },
    21: { 4: 'GIP pipe including fittings' },
    23: { 3: 1, 4: 'Pipa 160 mm', 5: 'm', 6: 27, 7: 0.019 }
  } }]);
  assert.equal(result.items[0].section, 'LANTAI 1');
  assert.equal(result.items[0].location, 'COLD WATER');
  assert.equal(result.items[0].context, 'GIP pipe including fittings');
  assert.equal(result.items[0].name, 'Pipa 160 mm');
});

test('BOQ header at row 51 and separated Bobot column J are detected', () => {
  const result = api.parseDetailGrids([{ name: 'PLUMBING', grid: {
    51: { 1: 'NO', 2: 'DESCRIPTION', 3: 'UNIT', 4: 'QTY', 10: 'BOBOT' },
    52: { 1: 'A', 2: 'PIPA' },
    53: { 1: 1, 2: 'Pipa air bersih', 3: 'm', 4: 27, 10: 2 }
  } }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Pipa air bersih');
  assert.equal(result.items[0].row, 53);
  assert.equal(result.items[0].qty, 27);
  assert.equal(result.items[0].weight, 2);
});

test('merged description headers and unlabeled TOTAL weights are recognized with explicit note', () => {
  const result = api.parseDetailGrids([{ name: 'PRELIM', grid: {
    4: { 2: 'DESCRIPTION', 4: 'UNIT', 5: 'QTY', 6: 'BOBOT' },
    7: { 2: 'B', 3: 'PRELIMINARIES' },
    8: { 2: 1, 3: 'Temporary works', 4: 'ls', 5: 1, 6: 2 }
  } }, { name: 'CONTRACTOR ADD', grid: {
    4: { 1: 'NO', 3: 'UNIT', 4: 'QTY' }, 5: { 5: 'TOTAL' },
    10: { 1: 'A', 2: 'STEEL' }, 11: { 2: 'Steel fence', 3: 'm', 4: 5, 5: 1 }
  } }]);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'Temporary works');
  assert.equal(result.items[1].weight, 1);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /header BOBOT kosong/);
});

test('unreadable BOQ fails explicitly', () => {
  assert.throws(() => api.parseDetailGrids([{ name: 'Notes', grid: {} }]), /Tidak ada rincian item/);
});

test('mapping suggestions require unique match and account for installation/equipment aliases', () => {
  const parents = [
    { id: 'pi', group: 'PLUMBING', name: 'PLUMBING INSTALATION' },
    { id: 'pe', group: 'PLUMBING', name: 'PLUMBING EQUIPMENT' }
  ];
  assert.equal(api.suggestDetailParent({ sheet: 'PLUMBING INST', section: 'LANTAI 1' }, parents), 'pi');
  assert.equal(api.suggestDetailParent({ sheet: 'PLUMBING EQUIP', section: 'PUMP' }, parents), 'pe');
  assert.equal(api.suggestDetailParent({ sheet: 'Unrelated', section: 'Notes' }, parents), '');
  assert.equal(api.suggestDetailParent({ sheet: 'PLUMBING INST', section: '' }, [...parents, { ...parents[0], id: 'ambiguous' }]), '');
  assert.equal(api.suggestDetailParent({ sheet: 'ARCHITECTURE-TOWER', section: 'WATERPROOFING' },
    [{ id: 'podium', group: 'ARCHITECTURE WORKS', subgroup: 'PODIUM ARCHITECTURE WORKS', name: 'WATERPROOFING' }]), '',
  'never suggest another building just because the work type matches');
});

const details = [
  { id: 'a', parentId: 'parent', name: 'Pipe', qty: 100, weight: 2, unit: 'm' },
  { id: 'b', parentId: 'parent', name: 'Valve', qty: 10, weight: 6, unit: 'unit' }
];

test('volume aggregation uses relative weights and never doubles project weight', () => {
  const values = api.aggregateDetailProgress(details, { a: 100, b: 0 });
  assert.equal(values.parent, 25);
  const schedule = { items: [{ id: 'parent', weight: 20, plan: [10, 10] }], weekCount: 2,
    progress: { 1: { values } } };
  assert.equal(api.computeCurve(schedule).actualCumulative[0], 5);
  assert.equal(api.aggregateDetailProgress(details, { a: 100, b: 10 }).parent, 100);
  assert.equal(api.aggregateDetailProgress(details, { a: 0, b: 0 }).parent, 0);
  for (const bad of [-1, 101, NaN, Infinity]) {
    assert.throws(() => api.aggregateDetailProgress(details, { a: bad, b: 0 }), /Volume/);
  }
});

test('volume carry-forward and bounds respect earlier and later reports', () => {
  const schedule = {
    detailItems: details, weekCount: 4,
    progress: { 1: { values: { parent: 20 } }, 2: { values: { parent: 25 }, detailVolumes: { a: 100, b: 0 } },
      4: { values: { parent: 100 }, detailVolumes: { a: 100, b: 10 } } }
  };
  assert.deepEqual(plain(api.getDetailVolumesAt(schedule, 1)), { a: 0, b: 0 });
  assert.deepEqual(plain(api.getDetailVolumesAt(schedule, 3)), { a: 100, b: 0 });
  assert.equal(api.getDetailVolumeLimit(schedule, 3, details[1]), 10);
  assert.equal(api.getDetailVolumeLimit(schedule, 1, details[1]), 0);
  assert.equal(api.getItemProgressLimit(schedule, 1, 'parent'), 25);
  const remapped = api.remapProgress(schedule.progress, '2026-10-19', '2026-10-19', 5, new Set(['parent']));
  assert.deepEqual(plain(remapped[2].detailVolumes), { a: 100, b: 0 });
  assert.deepEqual(plain(schedule.progress[1].values), { parent: 20 }, 'history unchanged');
});

test('snapshot roundtrip preserves detail identities, activation and volume history', () => {
  const backend = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const normalize = html.slice(html.indexOf('function normalizeProjectSchedule(value)'), html.indexOf('function getKurvaRevisionMeta'));
  const validate = backend.slice(backend.indexOf('function validateKurvaRevisionHistory_(snapshot)'), backend.indexOf('function createProjectForUser_'));
  const sandbox = vm.createContext({});
  vm.runInContext(`${normalize}\n${validate}\nglobalThis.roundtrip = snapshot => normalizeProjectSchedule(validateKurvaRevisionHistory_(snapshot).projectSchedule);`, sandbox);
  const schedule = {
    weekCount: 2, items: [{ id: 'parent', weight: 20, plan: [10, 10] }],
    detailItems: details, detailStartWeek: 2, detailSource: { fileName: 'boq.xlsx' },
    progress: { 1: { values: { parent: 20 }, updatedBy: 'Original' },
      2: { values: { parent: 25 }, detailVolumes: { a: 100, b: 0 } } },
    revisions: [{ revision: 0 }]
  };
  const restored = sandbox.roundtrip(JSON.parse(JSON.stringify({ projectSchedule: schedule })));
  assert.deepEqual(plain(restored.detailItems), details);
  assert.equal(restored.detailStartWeek, 2);
  assert.deepEqual(plain(restored.detailSource), { fileName: 'boq.xlsx' });
  assert.deepEqual(plain(restored.progress), schedule.progress);
});
