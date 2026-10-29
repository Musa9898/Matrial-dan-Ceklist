const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({ TextDecoder, Blob, Response, DecompressionStream });
vm.runInContext(html.match(/<script id="kurva-s-core">([\s\S]*?)<\/script>/)[1], context);
vm.runInContext(html.match(/<script id="kurva-excel-core">([\s\S]*?)<\/script>/)[1], context);
const api = vm.runInContext('kurvaSCore', context);
const excel = vm.runInContext('kurvaExcelCore', context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function fixture() {
  let schedule = {
    title: 'Master', startDate: '2026-10-05', weekCount: 4, holidays: [],
    items: [{ id: 'work', name: 'Work', weight: 100, plan: [10, 20, 30, 40], startWeek: 1, endWeek: 4 }],
    progress: {}
  };
  for (const name of ['Subcont A', 'Subcont B', 'Subcont C']) schedule = api.addSubcontractor(schedule, name);
  schedule = api.setMasterWeights(schedule, { 'subcont-1': 30, 'subcont-2': 40, 'subcont-3': 30 });
  schedule = api.setSourceProgress(schedule, 'subcont-1', 1, { values: { work: 10 } });
  schedule = api.setSourceProgress(schedule, 'subcont-1', 3, { values: { work: 20 } });
  schedule = api.setSourceProgress(schedule, 'subcont-2', 2, { values: { work: 15 } });
  schedule = api.setSourceProgress(schedule, 'subcont-3', 3, { values: { work: 10 } });
  return schedule;
}

test('30/40/30 source plans reconcile to Maincont 100%, with carried actual and no double counting', () => {
  const schedule = fixture();
  const before = JSON.stringify(schedule);
  const master = api.computeMasterSchedule(schedule);
  assert.equal(master.configured, true);
  assert.deepEqual(Array.from(master.sources, (source) => source.weight), [0, 30, 40, 30]);
  assert.deepEqual(Array.from(master.sources[1].planCumulative), [3, 9, 18, 30]);
  assert.deepEqual(Array.from(master.sources[2].planCumulative), [4, 12, 24, 40]);
  assert.deepEqual(Array.from(master.total.actualCumulative), [10, 25, 45, null]);
  assert.deepEqual(Array.from(master.sources[1].actualCumulative), [10, 10, 20, null]);
  for (let week = 0; week < 4; week += 1) {
    const plan = master.sources.reduce((sum, source) => sum + source.planCumulative[week], 0);
    assert.ok(Math.abs(plan - master.total.planCumulative[week]) < 0.000001);
    if (week < 3) assert.equal(master.sources.reduce((sum, source) => sum + source.actualCumulative[week], 0), master.total.actualCumulative[week]);
    else assert.ok(master.sources.every((source) => source.actualCumulative[week] === null));
  }
  assert.equal(JSON.stringify(schedule), before);
});

test('remaining plan share belongs to direct Maincont, not the combined total counted twice', () => {
  let schedule = fixture();
  schedule = api.setMasterWeights(schedule, { 'subcont-1': 20, 'subcont-2': 30, 'subcont-3': 30 });
  schedule = api.setSourceProgress(schedule, '', 3, { values: { work: 5 } });
  const master = api.computeMasterSchedule(schedule);
  assert.equal(master.sources[0].weight, 20);
  assert.equal(master.sources[0].planCumulative[3], 20);
  assert.equal(master.sources[0].actualCumulative[2], 5);
  assert.equal(master.total.actualCumulative[2], 50);
});

test('weight validation rejects missing, nonfinite, negative and overallocated values without altering saved data', () => {
  const schedule = fixture();
  const before = JSON.stringify(schedule);
  for (const value of [-1, 101, NaN, Infinity, '30', null, undefined]) {
    assert.throws(() => api.setMasterWeights(schedule, { 'subcont-1': value, 'subcont-2': 40, 'subcont-3': 30 }), /Bobot/);
  }
  assert.throws(() => api.setMasterWeights(schedule, { 'subcont-1': 31, 'subcont-2': 40, 'subcont-3': 30 }), /melebihi 100/);
  const invalidTotal = { ...schedule, items: [{ ...schedule.items[0], weight: 90 }] };
  assert.throws(() => api.setMasterWeights(invalidTotal, { 'subcont-1': 30, 'subcont-2': 40, 'subcont-3': 30 }), /total bobot jadwal 100/);
  assert.equal(JSON.stringify(schedule), before);
});

test('legacy source data retains actual and explicitly lacks plan until all shares are configured', () => {
  const schedule = fixture();
  delete schedule.subcontractors[1].weight;
  const master = api.computeMasterSchedule(schedule);
  assert.equal(master.configured, false);
  assert.ok(master.sources.every((source) => source.planCumulative === null && source.weight === null));
  assert.equal(master.total.actualCumulative[2], 45);
  assert.equal(api.getMasterChartData(master).datasets.length, 6);
});

test('ten subcontractors produce independently styled plan/actual datasets and preserve unreported nulls', () => {
  let schedule = fixture();
  for (let index = 4; index <= 10; index += 1) schedule = api.addSubcontractor(schedule, `Subcont ${index}`);
  schedule = api.setMasterWeights(schedule, Object.fromEntries(schedule.subcontractors.map((source) => [source.id, 10])));
  const datasets = api.getMasterChartData(api.computeMasterSchedule(schedule)).datasets;
  assert.equal(datasets.length, 24);
  assert.equal(datasets[0].borderWidth, 3.5);
  assert.equal(datasets[1].borderWidth, 3.5);
  const subPlans = datasets.filter((entry) => entry.sourceId.startsWith('subcont-') && entry.kind === 'plan');
  assert.equal(new Set(subPlans.map((entry) => entry.borderColor)).size, 10);
  assert.ok(subPlans.every((entry) => entry.borderWidth < 3.5 && entry.borderDash.length));
  assert.ok(datasets.filter((entry) => entry.kind === 'actual').every((entry) => entry.data[3] === null && entry.spanGaps === false));
});

test('Chart.js legend toggles exactly one dataset and tooltip always includes full source breakdown', () => {
  const config = api.createMasterChartConfig(fixture());
  assert.equal(config.type, 'line');
  assert.equal(config.options.interaction.mode, 'index');
  assert.equal(config.options.interaction.intersect, false);
  let toggled;
  let updates = 0;
  config.options.plugins.legend.onClick({}, { datasetIndex: 4 }, { chart: {
    isDatasetVisible: (index) => { assert.equal(index, 4); return true; },
    setDatasetVisibility: (index, visible) => { toggled = [index, visible]; },
    update: () => { updates += 1; }
  } });
  assert.deepEqual(toggled, [4, false]);
  assert.equal(updates, 1);
  const lines = config.options.plugins.tooltip.callbacks.afterBody([{ dataIndex: 2 }]);
  assert.ok(lines.some((line) => line.includes('Maincont (total)') && line.includes('45.000%')));
  for (const name of ['Subcont A', 'Subcont B', 'Subcont C']) assert.ok(lines.some((line) => line.includes(name) && line.includes('Plan') && line.includes('Actual')));
  assert.deepEqual(Array.from(config.options.plugins.tooltip.callbacks.afterBody([])), []);
});

test('weekly HTML table and SVG share datasets, escape names, and distinguish plan from actual', () => {
  const schedule = fixture();
  schedule.subcontractors[0].name = '<img src=x onerror=alert(1)>';
  const sandbox = vm.createContext({
    projectSchedule: schedule, kurvaSCore: api, escapeHtml,
    formatKurvaPercent: (value) => `${Number(value).toFixed(3)}%`
  });
  const start = html.indexOf('    function buildKurvaChart(');
  vm.runInContext(html.slice(start, html.indexOf('    let kurvaAttentionDraft', start)), sandbox);
  const master = api.computeMasterSchedule(schedule);
  const table = sandbox.buildKurvaMasterTable(master);
  assert.match(table, /<caption>/);
  assert.match(table, /Rencana Maincont/);
  assert.match(table, /Deviasi Maincont/);
  assert.match(table, /Bobot|30.000%/);
  assert.match(table, /&lt;img/);
  assert.doesNotMatch(table, /<img/);
  assert.equal((table.match(/<th scope="row">/g) || []).length, 4);
  assert.match(table, /Belum ada laporan/);
  const chart = sandbox.buildKurvaChart(master.total, 3, 900, master);
  assert.match(chart, /stroke-dasharray="8 4"/);
  assert.match(chart, /stroke-dasharray="2 3"/);
  assert.match(chart, /stroke-width:3.5/);
  assert.match(chart, /tabindex="0" role="button"/);
  assert.doesNotMatch(chart, /<img/);
  const legend = sandbox.buildKurvaMasterLegend(master);
  assert.equal((legend.match(/data-master-toggle=/g) || []).length, 10);
  assert.match(legend, /aria-pressed="true"/);
});

test('weight save keeps the legacy role gate and restores original schedule on persistence failure', async () => {
  const original = fixture();
  const controls = original.subcontractors.map((source) => ({
    dataset: { subcontractorWeight: source.id }, value: '30',
    checkValidity: () => true, focus() {}
  }));
  let allowed = false;
  let success = false;
  let writes = 0;
  let renders = 0;
  const sandbox = vm.createContext({
    projectSchedule: original, kurvaSCore: api, requireAccess: () => allowed,
    document: { querySelectorAll: () => controls }, showAppNotice() {},
    persistActiveProjectData: async () => { writes += 1; return success; },
    renderKurvaS: () => { renders += 1; }
  });
  const start = html.indexOf('    async function saveKurvaMasterWeights()');
  vm.runInContext(html.slice(start, html.indexOf('    async function addKurvaSubcontractor()', start)), sandbox);
  await sandbox.saveKurvaMasterWeights();
  assert.equal(writes, 0);
  allowed = true;
  await sandbox.saveKurvaMasterWeights();
  assert.equal(sandbox.projectSchedule, original);
  assert.equal(renders, 0);
  success = true;
  await sandbox.saveKurvaMasterWeights();
  assert.deepEqual(Array.from(sandbox.projectSchedule.subcontractors, (source) => source.weight), [30, 30, 30]);
  assert.equal(renders, 1);
  assert.deepEqual(plain(sandbox.projectSchedule.progress), plain(original.progress));
});

test('Excel appends the same master/source values without mutating source rows or inventing future actuals', () => {
  const schedule = fixture();
  const rows = excel.buildRows(schedule, 'schedule', 4);
  const marker = rows.findIndex((row) => row[0] === 'MASTER SCHEDULE');
  assert.ok(marker > 0);
  const headers = rows[marker + 1];
  assert.deepEqual(Array.from(headers.slice(0, 4)), ['Minggu', 'Rencana Maincont', 'Realisasi Maincont', 'Deviasi Maincont']);
  const week3 = rows[marker + 4];
  assert.deepEqual(Array.from(week3), [3, 60, 45, -15, 0, 0, 18, 20, 24, 15, 18, 10]);
  assert.equal(rows[marker + 5][2], null);
});

test('master weights survive snapshot normalization and reschedule with all source histories intact', async () => {
  const schedule = fixture();
  const backend = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const normalize = html.slice(html.indexOf('function normalizeProjectSchedule(value)'), html.indexOf('function getKurvaRevisionMeta'));
  const validate = backend.slice(backend.indexOf('function validateKurvaRevisionHistory_(snapshot)'), backend.indexOf('function createProjectForUser_'));
  const sandbox = vm.createContext({
    projectSchedule: schedule, kurvaSCore: api, requireAccess: () => true,
    activeProjectId: 'p', kurvaImportMode: 'reschedule',
    kurvaImportDraft: { weekCount: 5, holidays: [], items: [{ ...schedule.items[0], plan: [10, 20, 20, 30, 20] }] },
    document: { getElementById: (id) => ({
      kurvaImportStart: { value: schedule.startDate }, kurvaImportName: { value: 'Master revised' },
      kurvaRevisionNote: { value: 'Duration extended' }
    })[id] },
    showAppNotice: assert.fail, getSignedInName: () => 'PM',
    getKurvaRevisionMeta: (value, revision) => ({ revision }),
    persistActiveProjectData: async () => true, closeKurvaImportModal() {}, renderKurvaS() {}
  });
  vm.runInContext(`${normalize}\n${validate}`, sandbox);
  const restored = sandbox.normalizeProjectSchedule(sandbox.validateKurvaRevisionHistory_({ projectSchedule: plain(schedule) }).projectSchedule);
  assert.deepEqual(Array.from(restored.subcontractors, (source) => source.weight), [30, 40, 30]);
  const start = html.indexOf('    async function saveKurvaImport()');
  vm.runInContext(html.slice(start, html.indexOf('    function openKurvaProgressModal()', start)), sandbox);
  await sandbox.saveKurvaImport();
  assert.deepEqual(Array.from(sandbox.projectSchedule.subcontractors, (source) => source.weight), [30, 40, 30]);
  assert.deepEqual(plain(sandbox.projectSchedule.progress), plain(schedule.progress));
  assert.deepEqual(plain(sandbox.projectSchedule.subcontractors[0].progress), plain(schedule.subcontractors[0].progress));
  const master = api.computeMasterSchedule(sandbox.projectSchedule);
  assert.equal(master.sources[1].planCumulative[4], 30);
  assert.equal(master.total.actualCumulative[2], 45);
  assert.equal(master.total.actualCumulative[4], null);
});

test('PDF includes filtered source rows and ignores browser visibility state', () => {
  const schedule = fixture();
  const sandbox = vm.createContext({
    projectSchedule: schedule, kurvaSCore: api, getKurvaCurrentWeek: () => 3,
    getKurvaGroups: (items) => [['Master', items]],
    getKurvaItemPlanAt: (item, week) => item.plan.slice(0, week).reduce((sum, value) => sum + value, 0),
    escapeHtml, formatKurvaPercent: (value) => `${Number(value).toFixed(3)}%`,
    formatKurvaDate: String, getKurvaWeekRange: (week) => `Minggu ${week}`,
    isPdfWeekInRange: (start) => start === '2026-10-19',
    pdfSummary: () => '', pdfTable: (headers, rows) => JSON.stringify({ headers, rows })
  });
  const start = html.indexOf('    function buildPdfKurvaReport(');
  vm.runInContext(html.slice(start, html.indexOf('    function buildPdfCalculatorReport()', start)), sandbox);
  const chartStart = html.indexOf('    function buildKurvaChart(');
  vm.runInContext(html.slice(chartStart, html.indexOf('    let kurvaAttentionDraft', chartStart)), sandbox);
  const result = sandbox.buildPdfKurvaReport({ from: '2026-10-19', to: '2026-10-25' });
  assert.match(result, /Master Schedule/);
  assert.match(result, /Subcont A/);
  assert.match(result, /Subcont B/);
  assert.match(result, /Subcont C/);
  assert.match(result, /\[3,"Subcont A","30.000","18.000","20.000"\]/);
  assert.doesNotMatch(result, /\[2,"Subcont A"/);
  assert.match(result, /kurva-source-line/);
});

test('own subcontractor schedule replaces the master-shaped plan, aligned by start date', () => {
  const parsed = { fileName: 'a.xlsx', startDate: '2026-10-12', weekCount: 2,
    items: [{ id: 'x', name: 'X', weight: 100, plan: [50, 50], startWeek: 1, endWeek: 2 }] };
  const base = fixture();
  const next = api.setSourcePlan(base, 'subcont-1', parsed);
  const master = api.computeMasterSchedule(next);
  assert.deepEqual(Array.from(master.sources[1].planCumulative), [0, 15, 30, 30]);
  assert.deepEqual(Array.from(master.sources[2].planCumulative), [4, 12, 24, 40]);
  assert.equal(base.subcontractors[0].plan, undefined);
  assert.throws(() => api.setSourcePlan(base, 'nope', parsed), /tidak ditemukan/);
});
