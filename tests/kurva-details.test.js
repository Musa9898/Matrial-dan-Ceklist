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

test('unique group name and total weight match ambiguous Tower heading without merging it into Podium', () => {
  const tower = [{ sheet: 'ARCHITECTURE-TOWER', section: 'SANITAIR', weight: 0.2 },
    { sheet: 'ARCHITECTURE-TOWER', section: 'SANITAIR', weight: 0.294312 }];
  const parents = [
    { id: 'podium', group: 'ARCHITECTURE WORKS', subgroup: 'PODIUM ARCHITECTURE WORKS', name: 'SANITAIR', weight: 0.325498 },
    { id: 'tower', group: 'ARCHITECTURE WORKS', subgroup: 'STRUCTURE RETROFITTING', name: 'SANITAIR', weight: 0.494312 }
  ];
  assert.equal(api.matchDetailGroup(tower, parents), 'tower');
  assert.equal(api.detailBuildingConflict(tower[0], parents[0]), true);
  assert.equal(api.detailBuildingConflict(tower[0], parents[1]), false);
  assert.equal(api.matchDetailGroup(tower, [parents[0]]), '');
  assert.equal(api.matchDetailGroup(tower, [...parents, { ...parents[1], id: 'ambiguous' }]), '');
  assert.equal(api.matchDetailGroup(tower, [{ ...parents[0], weight: 0.494312 }]), '', 'same weight does not override known building conflict');
  assert.equal(api.matchDetailGroup(tower.map((item) => ({ ...item, weight: 1 })), parents), '', 'do not infer Tower from arbitrary weight');
  const podium = tower.map((item) => ({ ...item, sheet: 'ARCHITECTURE-PODIUM' }));
  assert.equal(api.detailBuildingConflict(podium[0], { subgroup: 'TOWER ARCHITECTURE WORKS' }), true);
  assert.equal(api.detailBuildingConflict({ sheet: 'ARCHITECTURE-SB' }, { subgroup: 'SERVICE BUILDING' }), false);
});

test('mapping corrections reject explicit Tower to Podium conflicts without mutating saved data', () => {
  const detail = { id: 'tower|row-1', sheet: 'ARCHITECTURE-TOWER', section: 'SANITAIR',
    parentId: 'tower', name: 'Basin', qty: 10, unit: 'pcs', weight: 0.494312 };
  const schedule = { weekCount: 2, detailStartWeek: 1, detailItems: [detail], progress: {},
    items: [
      { id: 'podium', group: 'ARCHITECTURE WORKS', subgroup: 'PODIUM ARCHITECTURE WORKS', weight: 0.325498, plan: [0.325498, 0] },
      { id: 'tower', group: 'ARCHITECTURE WORKS', subgroup: 'STRUCTURE RETROFITTING', weight: 0.494312, plan: [0.494312, 0] }
    ] };
  const before = JSON.stringify(schedule);
  assert.throws(() => api.reviseDetailMapping(schedule, [{ ...detail, parentId: 'podium' }], 'Fix', 'PM', {}), /Gedung rincian berbeda/);
  assert.equal(JSON.stringify(schedule), before);
  assert.equal(api.reviseDetailMapping(schedule, [detail], 'Confirm Tower', 'PM', {})[0].items[0].parentId, 'tower');
});

test('rematching proposes checked groups only and invalidates confirmation without persisting', () => {
  const elements = {
    kurvaInclude0: { checked: true }, kurvaMap0: { value: 'old' },
    kurvaInclude1: { checked: false }, kurvaMap1: { value: 'excluded' },
    kurvaMappingConfirmed: { checked: true }
  };
  let updates = 0;
  let saves = 0;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    kurvaDetailsDraft: { schedule: { items: [] }, groups: [['a', [{}]], ['b', [{}]]] },
    requireAccess: () => true, kurvaSCore: { matchDetailGroup: () => 'proposed' },
    updateKurvaMappingSelection: () => { updates += 1; elements.kurvaMappingConfirmed.checked = false; },
    showAppNotice() {}, persistActiveProjectData: () => { saves += 1; }
  });
  const start = html.indexOf('    function matchKurvaDetailGroups()');
  vm.runInContext(html.slice(start, html.indexOf('    async function saveKurvaDetailsImport()', start)), sandbox);
  sandbox.matchKurvaDetailGroups();
  assert.equal(elements.kurvaMap0.value, 'proposed');
  assert.equal(elements.kurvaMap1.value, 'excluded');
  assert.equal(elements.kurvaMappingConfirmed.checked, false);
  assert.equal(updates, 1);
  assert.equal(saves, 0);
});

test('correction versions preserve historical parents, volumes and curve while previewing affected parents', () => {
  const a = { id: 'a', parentId: 'old', name: 'Pipe', qty: 10, unit: 'm', weight: 2, mappingKey: 'pipes' };
  const b = { id: 'b', parentId: 'old', name: 'Valve', qty: 5, unit: 'unit', weight: 1, mappingKey: 'valves' };
  const schedule = { weekCount: 4, detailStartWeek: 1, detailItems: [a, b],
    items: [{ id: 'old', name: 'Old', weight: 60, plan: [10, 20, 20, 10] },
      { id: 'new', name: 'New', weight: 40, plan: [10, 10, 10, 10] }],
    progress: { 1: { values: { old: 40, new: 0 }, detailVolumes: { a: 5, b: 1 } } } };
  const saved = JSON.stringify(schedule.progress);
  const curve = plain(api.computeCurve(schedule));
  const moved = [{ ...a, parentId: 'new' }];
  const impact = api.compareDetailMapping(schedule, moved);
  assert.equal(impact.moved, 1);
  assert.equal(impact.removed, 1);
  assert.equal(impact.parents.find((p) => p.id === 'old').next, null);
  assert.equal(impact.parents.find((p) => p.id === 'new').next, 50);
  schedule.detailMappingVersions = api.reviseDetailMapping(schedule, moved, 'Wrong parent', 'PM', {});
  schedule.detailItems = moved;
  assert.equal(schedule.detailMappingVersions[1].fromWeek, 2);
  assert.deepEqual(plain(api.getDetailItemsAt(schedule, 1)), [a, b]);
  assert.deepEqual(plain(api.getDetailItemsAt(schedule, 2)), moved);
  assert.equal(api.getDetailVolumesAt(schedule, 2).a, 5);
  assert.equal(api.getDetailVolumesAt(schedule, 2).b, 1, 'excluded detail keeps its historical volume');
  assert.equal(JSON.stringify(schedule.progress), saved);
  assert.deepEqual(plain(api.computeCurve(schedule)), curve);
  schedule.progress[2] = { values: { old: 40, new: 50 }, detailVolumes: { a: 5 } };
  const restored = [a, b];
  schedule.detailMappingVersions = api.reviseDetailMapping(schedule, restored, 'Restore group', 'PM', {});
  schedule.detailItems = restored;
  assert.equal(api.getDetailItemsAt(schedule, 2)[0].parentId, 'new');
  assert.equal(api.getDetailItemsAt(schedule, 3)[0].parentId, 'old');
  assert.equal(api.getDetailVolumesAt(schedule, 3).b, 1);
  assert.equal(api.getDetailVolumeLimit(schedule, 1, a), 5);
});

test('catalog merge retains omitted items, deduplicates reuploads and rejects changes to item identity or quantities', () => {
  const item = { id: 's|row-1', name: 'Pipe', sheet: 's', row: 1, qty: 10, unit: 'm', weight: 5, mappingKey: 's|pipe' };
  const extra = { ...item, id: 's|row-2', row: 2, name: 'Valve' };
  const schedule = { detailItems: [item], detailCatalog: [item, extra] };
  assert.equal(api.mergeDetailCatalog(schedule, [item]).length, 2);
  assert.equal(api.mergeDetailCatalog(schedule, [item, extra]).length, 2);
  for (const change of [{ qty: 20 }, { unit: 'unit' }, { weight: 2 }, { name: 'Different' }, { mappingKey: 'other' }]) {
    assert.throws(() => api.mergeDetailCatalog(schedule, [{ ...item, ...change }]), /berbeda dari data tersimpan/);
  }
});

test('corrections require a reason, valid parents, unique IDs and a future unreported week', () => {
  const detail = { id: 'a', parentId: 'p', name: 'Pipe', qty: 10, weight: 1 };
  const schedule = { weekCount: 2, detailStartWeek: 1, detailItems: [detail],
    items: [{ id: 'p', weight: 100, plan: [50, 50] }], progress: {} };
  assert.throws(() => api.reviseDetailMapping(schedule, [detail], '', 'PM', {}), /Alasan/);
  assert.throws(() => api.reviseDetailMapping(schedule, [detail, detail], 'Fix', 'PM', {}), /duplikat/);
  assert.throws(() => api.reviseDetailMapping(schedule, [{ ...detail, parentId: 'missing' }], 'Fix', 'PM', {}), /induk tidak valid/);
  const version = api.reviseDetailMapping(schedule, [detail], 'Fix', 'PM', {});
  assert.equal(version.length, 1);
  assert.equal(version[0].fromWeek, 1);
  assert.equal(api.getDetailItemsAt({ ...schedule, detailStartWeek: 2 }, 1).length, 0);
  schedule.progress[2] = { values: {} };
  assert.throws(() => api.reviseDetailMapping(schedule, [detail], 'Fix', 'PM', {}), /Tidak ada minggu/);
});

test('correction save requires reason, preserves catalog and restores original schedule on failure', async () => {
  const detail = { id: 'a', parentId: 'old', name: 'Pipe', qty: 10, weight: 1, mappingKey: 'g' };
  const schedule = { weekCount: 3, detailStartWeek: 1, detailItems: [detail],
    items: [{ id: 'old', name: 'Old', weight: 50, plan: [10, 20, 20] },
      { id: 'new', name: 'New', weight: 50, plan: [10, 20, 20] }],
    progress: { 1: { values: { old: 50 }, detailVolumes: { a: 5 } } } };
  const elements = { kurvaMappingConfirmed: { checked: true }, kurvaInclude0: { checked: true },
    kurvaMap0: { value: 'new' }, kurvaCorrectionReason: { value: '', focus() {} }, kurvaDetailsSave: {} };
  let saves = 0;
  let succeeds = false;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    kurvaDetailsDraft: { correction: true, schedule, projectId: 'p', items: [detail], groups: [['g', [detail]]], skipped: [] },
    projectSchedule: schedule, activeProjectId: 'p', requireAccess: () => true, showAppNotice() {},
    kurvaSCore: api, getSignedInName: () => 'PM', closeKurvaDetailsImport() {}, renderKurvaS() {},
    persistActiveProjectData: async () => { saves += 1; return succeeds; }
  });
  const start = html.indexOf('    async function saveKurvaDetailsImport()');
  const end = html.indexOf('    function isKurvaDetailWeek(', start);
  vm.runInContext(html.slice(start, end), sandbox);
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saves, 0);
  elements.kurvaCorrectionReason.value = 'Wrong building';
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saves, 1);
  assert.equal(sandbox.projectSchedule, schedule);
  assert.equal(schedule.detailMappingVersions, undefined);
  succeeds = true;
  await sandbox.saveKurvaDetailsImport();
  const result = sandbox.projectSchedule;
  assert.equal(saves, 2);
  assert.equal(result.detailStartWeek, 1);
  assert.equal(result.detailMappingVersions[1].fromWeek, 2);
  assert.equal(result.detailMappingAudit[0].reason, 'Wrong building');
  assert.equal(result.detailMappingAudit[0].changes.moved, 1);
  assert.equal(result.progress, schedule.progress);
  assert.equal(result.detailCatalog[0].id, 'a');
});

test('BOQ-first setup keeps selected groups as a draft and saves schedule and mappings together only at confirmation', async () => {
  const elements = {
    kurvaMappingConfirmed: { checked: true },
    kurvaInclude0: { checked: true }, kurvaInclude1: { checked: false },
    kurvaMap0: { value: 'parent', focus() {} }, kurvaDetailsSave: {}
  };
  const notices = [];
  let saves = 0;
  let imports = 0;
  let succeeds = false;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    projectSchedule: null, activeProjectId: 'project', kurvaSetupDraft: null,
    kurvaDetailsDraft: { setup: true, schedule: null, projectId: 'project',
      fileName: 'boq.xlsx', items: [{ id: 'a' }, { id: 'b' }], skipped: [],
      groups: [['one', [{ id: 'a' }]], ['two', [{ id: 'b' }]]] },
    requireAccess: () => true, showAppNotice: (message) => notices.push(message),
    closeKurvaDetailsImport() {}, renderKurvaS() {},
    openKurvaImportModal: () => { imports += 1; },
    kurvaSCore: api, getSignedInName: () => 'Tester',
    persistActiveProjectData: async () => { saves += 1; return succeeds; }
  });
  const start = html.indexOf('    async function saveKurvaDetailsImport()');
  const end = html.indexOf('    function isKurvaDetailWeek(', start);
  vm.runInContext(html.slice(start, end), sandbox);
  elements.kurvaInclude0.checked = false;
  await sandbox.saveKurvaDetailsImport();
  assert.equal(imports, 0);
  assert.match(notices.at(-1), /minimal satu kelompok/);
  elements.kurvaInclude0.checked = true;
  await sandbox.saveKurvaDetailsImport();
  assert.equal(imports, 1);
  assert.equal(saves, 0);
  assert.equal(sandbox.projectSchedule, null);
  assert.deepEqual(plain(sandbox.kurvaSetupDraft.boq.included), [0]);
  const schedule = { weekCount: 2, items: [{ id: 'parent', weight: 100, plan: [50, 50] }], progress: {} };
  sandbox.kurvaSetupDraft.schedule = schedule;
  sandbox.kurvaDetailsDraft = { ...sandbox.kurvaSetupDraft.boq, schedule };
  elements.kurvaMappingConfirmed.checked = false;
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saves, 0);
  elements.kurvaMappingConfirmed.checked = true;
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saves, 1);
  assert.equal(sandbox.projectSchedule, null, 'failed save restores empty project');
  assert.ok(sandbox.kurvaSetupDraft, 'draft is retained for retry');
  succeeds = true;
  await sandbox.saveKurvaDetailsImport();
  assert.equal(saves, 2);
  assert.deepEqual(plain(sandbox.projectSchedule.detailItems), [{ id: 'a', parentId: 'parent' }]);
  assert.equal(sandbox.projectSchedule.detailStartWeek, 1);
  assert.equal(sandbox.projectSchedule.detailSource.excludedCount, 1);
  assert.equal(sandbox.kurvaSetupDraft, null);
});

test('new schedule import opens mapping without persisting and rejects drafts from other projects', async () => {
  const elements = {
    kurvaImportStart: { value: '2026-10-19' }, kurvaImportName: { value: 'Project' },
    modalKurvaDetails: { style: {} }
  };
  let persisted = 0;
  let rendered = 0;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    projectSchedule: null, activeProjectId: 'project', kurvaDetailsDraft: null,
    kurvaSetupDraft: { projectId: 'other', boq: { included: [0] } },
    kurvaImportDraft: { weekCount: 2, items: [{ id: 'parent' }], holidays: [] },
    kurvaImportMode: 'import', requireAccess: () => true, showAppNotice() {},
    getSignedInName: () => 'Tester', kurvaSCore: api,
    getKurvaRevisionMeta: () => ({ revision: 0 }),
    closeKurvaImportModal() {}, renderKurvaDetailsPreview: () => { rendered += 1; },
    persistActiveProjectData: async () => { persisted += 1; return true; }
  });
  const start = html.indexOf('    async function saveKurvaImport()');
  const end = html.indexOf('    function openKurvaProgressModal()', start);
  vm.runInContext(html.slice(start, end), sandbox);
  await sandbox.saveKurvaImport();
  assert.equal(rendered, 0);
  sandbox.kurvaSetupDraft.projectId = 'project';
  await sandbox.saveKurvaImport();
  assert.equal(rendered, 1);
  assert.equal(persisted, 0);
  assert.equal(sandbox.projectSchedule, null);
  assert.equal(sandbox.kurvaDetailsDraft.setup, true);
  assert.equal(sandbox.kurvaDetailsDraft.schedule, sandbox.kurvaSetupDraft.schedule);
  assert.equal(sandbox.kurvaDetailsDraft.schedule.title, 'Project');
  assert.equal(elements.modalKurvaDetails.style.display, 'flex');
});

test('existing project reschedule still preserves reports, BOQ and Attention without a setup draft', async () => {
  const oldSchedule = { startDate: '2026-10-19', weekCount: 2, revision: 0,
    items: [{ id: 'parent', weight: 100, plan: [50, 50] }],
    detailItems: [{ id: 'detail', parentId: 'parent' }], detailStartWeek: 2,
    progress: { 1: { values: { parent: 10 } } }, attentionReviews: { old: { parent: { cause: 'Delay' } } }
  };
  oldSchedule.detailCatalog = oldSchedule.detailItems;
  oldSchedule.detailMappingVersions = [{ fromWeek: 1, items: oldSchedule.detailItems }];
  oldSchedule.detailMappingAudit = [{ fromWeek: 1, reason: 'Correct parent' }];
  const elements = {
    kurvaImportStart: { value: '2026-10-19' }, kurvaImportName: { value: 'Revised' },
    kurvaRevisionNote: { value: 'Updated plan' }
  };
  let saves = 0;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    projectSchedule: oldSchedule, activeProjectId: 'project', kurvaSetupDraft: null,
    kurvaImportDraft: { weekCount: 3, items: [{ id: 'parent', weight: 100, plan: [25, 25, 50] }], holidays: [] },
    kurvaImportMode: 'reschedule', requireAccess: () => true, showAppNotice() {},
    getSignedInName: () => 'Tester', kurvaSCore: api, getKurvaRevisionMeta: () => ({ revision: 0 }),
    closeKurvaImportModal() {}, renderKurvaS() {},
    persistActiveProjectData: async () => { saves += 1; return true; }
  });
  const start = html.indexOf('    async function saveKurvaImport()');
  const end = html.indexOf('    function openKurvaProgressModal()', start);
  vm.runInContext(html.slice(start, end), sandbox);
  await sandbox.saveKurvaImport();
  assert.equal(saves, 1);
  assert.equal(sandbox.projectSchedule.revision, 1);
  assert.equal(sandbox.projectSchedule.detailItems, oldSchedule.detailItems);
  assert.deepEqual(plain(sandbox.projectSchedule.progress), oldSchedule.progress);
  assert.equal(sandbox.projectSchedule.attentionReviews, oldSchedule.attentionReviews);
  assert.equal(sandbox.projectSchedule.detailMappingVersions, oldSchedule.detailMappingVersions);
  assert.equal(sandbox.projectSchedule.detailCatalog, oldSchedule.detailCatalog);
  assert.equal(sandbox.projectSchedule.detailMappingAudit, oldSchedule.detailMappingAudit);
  assert.equal(sandbox.kurvaSetupDraft, null);
});

test('progress form distinguishes automatic parent recaps, unmapped manual inputs and historical weeks', () => {
  const elements = { kurvaProgressWeek: { value: '2' }, kurvaProgressItems: {} };
  const schedule = { weekCount: 3, detailStartWeek: 2,
    items: [
      { id: 'mapped', name: 'Pipa', weight: 50, startWeek: 1, plan: [10, 20, 20] },
      { id: 'manual', name: 'Pompa', weight: 50, startWeek: 3, plan: [0, 0, 50] }
    ], detailItems: [{ id: 'pipe', parentId: 'mapped', name: 'Pipa detail', qty: 10, weight: 50, unit: 'm' }],
    progress: {} };
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] }, projectSchedule: schedule,
    kurvaSCore: api, isKurvaDetailWeek: (week) => week >= 2,
    getKurvaGroups: (items) => [['PLUMBING', items]],
    getKurvaItemPlanAt: () => 0, formatKurvaPercent: String, formatPdfNumber: String,
    escapeHtml: String, updateKurvaProgressSummary() {}, filterKurvaProgressItems() {}
  });
  const start = html.indexOf('    function renderKurvaProgressForm()');
  const end = html.indexOf('    function updateKurvaProgressSummary()', start);
  vm.runInContext(html.slice(start, end), sandbox);
  sandbox.renderKurvaProgressForm();
  let result = elements.kurvaProgressItems.innerHTML;
  assert.match(result, /Rekap induk — otomatis dari 1 item rincian/);
  assert.match(result, /Input persen manual — belum ada rincian terpetakan/);
  assert.match(result, /data-item-id="mapped" readonly/);
  assert.doesNotMatch(result, /data-item-id="manual" readonly/);
  assert.match(result, /kurva-input-row is-muted/);
  elements.kurvaProgressWeek.value = '1';
  sandbox.renderKurvaProgressForm();
  result = elements.kurvaProgressItems.innerHTML;
  assert.match(result, /Input persen manual — minggu sebelum aktivasi rincian/);
  assert.doesNotMatch(result, /Rekap induk — otomatis/);
});

test('Attention notes require permission and complete fields, persist per week and roll back failed saves', async () => {
  const schedule = { attentionReviews: { old: { a: { cause: 'Existing' } } } };
  const original = schedule.attentionReviews;
  const elements = Object.fromEntries(['cause', 'action', 'pic', 'target'].map((name) =>
    [`attention0${name}`, { value: name === 'target' ? '2026-10-26' : name,
      checkValidity: () => true, focus() {} }]));
  let allowed = true;
  let succeeds = false;
  let calls = 0;
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    projectSchedule: schedule, activeProjectId: 'p',
    kurvaAttentionDraft: { schedule, projectId: 'p', key: '0|2026-10-19|1', analysis: { items: [{ id: 'a', name: 'Pipa' }] } },
    requireAccess: () => allowed, showAppNotice() {}, renderKurvaAttentionBadge() {},
    getSignedInName: () => 'Reviewer',
    persistActiveProjectData: async () => { calls += 1; return succeeds; }
  });
  const start = html.indexOf('    async function saveKurvaAttention(');
  const end = html.indexOf('    function renderKurvaS(', start);
  vm.runInContext(html.slice(start, end), sandbox);
  const summary = {};
  const button = { closest: () => ({ querySelector: () => summary }) };
  allowed = false;
  await sandbox.saveKurvaAttention(0, button);
  assert.equal(calls, 0);
  allowed = true;
  elements.attention0cause.value = '';
  await sandbox.saveKurvaAttention(0, button);
  assert.equal(calls, 0);
  elements.attention0cause.value = 'Material belum tiba';
  await sandbox.saveKurvaAttention(0, button);
  assert.equal(calls, 1);
  assert.equal(schedule.attentionReviews, original);
  assert.equal(button.disabled, false);
  succeeds = true;
  await sandbox.saveKurvaAttention(0, button);
  assert.equal(schedule.attentionReviews['0|2026-10-19|1'].a.cause, 'Material belum tiba');
  assert.equal(schedule.attentionReviews.old.a.cause, 'Existing');
  assert.equal(schedule.attentionReviews['0|2026-10-19|1'].a.updatedBy, 'Reviewer');
  assert.match(summary.textContent, /Sudah ditinjau/);
  sandbox.activeProjectId = 'other';
  await sandbox.saveKurvaAttention(0, button);
  assert.equal(calls, 2);
});

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
    kurvaSCore: { ...api, computeCurve: () => ({ lastReportedWeek: 0 }) },
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
      groups: [['a', [1, 2]], ['b', [3]], ['c', [4]]] },
    kurvaSCore: api
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
    detailCatalog: details,
    detailMappingVersions: [{ fromWeek: 2, items: details, reason: 'Corrected group' }],
    detailMappingAudit: [{ fromWeek: 2, reason: 'Corrected group', changes: { moved: 1 } }],
    attentionReviews: { 'import|0|2026-10-19|1': { parent: { cause: 'Material terlambat', action: 'Koordinasi pengiriman', pic: 'SPV', target: '2026-10-26' } } },
    progress: { 1: { values: { parent: 20 }, updatedBy: 'Original' },
      2: { values: { parent: 25 }, detailVolumes: { a: 100, b: 0 } } },
    revisions: [{ revision: 0 }]
  };
  const restored = sandbox.roundtrip(JSON.parse(JSON.stringify({ projectSchedule: schedule })));
  assert.deepEqual(plain(restored.detailItems), details);
  assert.equal(restored.detailStartWeek, 2);
  assert.deepEqual(plain(restored.detailSource), { fileName: 'boq.xlsx' });
  assert.deepEqual(plain(restored.progress), schedule.progress);
  assert.deepEqual(plain(restored.attentionReviews), schedule.attentionReviews);
  assert.deepEqual(plain(restored.detailCatalog), schedule.detailCatalog);
  assert.deepEqual(plain(restored.detailMappingVersions), schedule.detailMappingVersions);
  assert.deepEqual(plain(restored.detailMappingAudit), schedule.detailMappingAudit);
});
