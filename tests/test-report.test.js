const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

const core = html.match(/\/\/ ==== TEST REPORT CORE START ====([\s\S]*?)\/\/ ==== TEST REPORT CORE END ====/)[1];
const pdfCore = html.match(/\/\/ ==== PDF EXPORT CORE START ====([\s\S]*?)\/\/ ==== PDF EXPORT CORE END ====/)[1];
const context = vm.createContext({});
vm.runInContext(`${core}\n${pdfCore}\nglobalThis.api = { TEST_REPORT_TYPES, evaluateTestReport, resolveTestReportResult, summarizeTestReport, summarizeTestReportCounts, parseTestNumber, getTestReportLabel, getPipeTestMethod, getPipeTestMethodOptions, getHvacTestMethod, getHvacTestMethodOptions, getSelectableTestReportTypes, hasTestReportStagePhotos, getTestReportPhotoGroups, getTestReportParamRows, canRoleExportPdf };`, context);
const api = context.api;

function backendFunction(name) {
  const start = backend.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} tidak ditemukan`);
  const end = backend.indexOf('\nfunction ', start + 1);
  return backend.slice(start, end < 0 ? undefined : end);
}

function backendConst(name) {
  const match = backend.match(new RegExp(`const ${name} = [\\s\\S]*?;\\r?\\n`));
  assert.ok(match, `${name} tidak ditemukan`);
  return match[0];
}

test('tes tekanan pipa lulus bila penurunan dalam toleransi', () => {
  const params = { pipeSystem: 'Air Bersih', testPressure: '10', duration: '120', startPressure: '10', endPressure: '9,8', maxDrop: '0,5' };
  const evaluation = api.evaluateTestReport('pressure', params);
  assert.equal(evaluation.result, 'Lulus');
  assert.equal(evaluation.missing.length, 0);
  assert.match(api.summarizeTestReport('pressure', params), /Air Bersih · uji 10 bar · 120 menit · 10 → 9,8 bar/);
});

test('tes tekanan pipa gagal bila turun melebihi toleransi atau tekanan awal kurang', () => {
  const dropped = api.evaluateTestReport('pressure', { pipeSystem: 'Hydrant', testPressure: '14', duration: '60', startPressure: '14', endPressure: '13', maxDrop: '0.2' });
  assert.equal(dropped.result, 'Gagal');
  assert.match(dropped.reasons.join(), /turun 1 bar melebihi toleransi 0,2 bar/);
  const low = api.evaluateTestReport('pressure', { pipeSystem: 'Sprinkler', testPressure: '14', duration: '60', startPressure: '12', endPressure: '12' });
  assert.equal(low.result, 'Gagal');
  assert.match(low.reasons.join(), /di bawah tekanan uji/);
});

test('data wajib kosong tidak menghasilkan hasil otomatis', () => {
  const evaluation = api.evaluateTestReport('pressure', { pipeSystem: 'Air Bersih', testPressure: '10' });
  assert.equal(evaluation.result, '');
  assert.deepEqual([...evaluation.missing], ['Durasi Uji', 'Tekanan Awal', 'Tekanan Akhir']);
});

test('pipa air kotor/bekas/hujan memakai tes glontor atau rendam tanpa tekanan', () => {
  const methodOnly = api.evaluateTestReport('pressure', { pipeSystem: 'Air Kotor' });
  assert.deepEqual([...methodOnly.missing], ['Metode Tes']);
  assert.deepEqual([...api.getPipeTestMethodOptions({ pipeSystem: 'Air Hujan' })], ['Tes Glontor', 'Tes Rendam']);
  assert.deepEqual([...api.getPipeTestMethodOptions({ pipeSystem: 'Sprinkler' })], ['Hydrotest']);

  const glontor = { pipeSystem: 'Air Bekas', testMethod: 'Tes Glontor', duration: '15', flowCondition: 'Lancar', leak: 'Tidak Ada' };
  const glontorResult = api.evaluateTestReport('pressure', glontor);
  assert.equal(glontorResult.result, 'Lulus');
  assert.equal(glontorResult.missing.length, 0);
  assert.equal(api.summarizeTestReport('pressure', glontor), 'Air Bekas · Tes Glontor · 15 menit · aliran lancar · tidak bocor');
  const clogged = api.evaluateTestReport('pressure', { ...glontor, flowCondition: 'Tersumbat' });
  assert.equal(clogged.result, 'Gagal');
  assert.match(clogged.reasons.join(), /Aliran tersumbat/);

  const rendam = { pipeSystem: 'Air Hujan', testMethod: 'Tes Rendam', soakDuration: '24', waterLevel: 'Turun', leak: 'Ada Bocor' };
  const rendamResult = api.evaluateTestReport('pressure', rendam);
  assert.equal(rendamResult.result, 'Gagal');
  assert.deepEqual([...rendamResult.reasons], ['Muka air turun setelah direndam', 'Ada kebocoran']);
  assert.equal(api.evaluateTestReport('pressure', { pipeSystem: 'Air Kotor', testMethod: 'Tes Rendam', soakDuration: '24' }).missing.join(), 'Muka Air Setelah Rendam,Kebocoran');

  const hydrotestOnGravity = api.evaluateTestReport('pressure', { pipeSystem: 'Air Kotor', testMethod: 'Hydrotest', testPressure: '5' });
  assert.deepEqual([...hydrotestOnGravity.missing], ['Metode Tes']);
});

test('data tes tekanan lama tanpa metode tetap dibaca sebagai hydrotest', () => {
  const legacy = { pipeSystem: 'Air Kotor / Bekas', testPressure: '5', duration: '60', startPressure: '5', endPressure: '5' };
  assert.equal(api.getPipeTestMethod(legacy), 'Hydrotest');
  assert.equal(api.evaluateTestReport('pressure', legacy).result, 'Lulus');
});

test('megger membutuhkan minimal satu bacaan dan semua bacaan di atas batas', () => {
  const empty = api.evaluateTestReport('megger', { testVoltage: '500', minResistance: '1' });
  assert.equal(empty.result, '');
  assert.ok(empty.missing.some((label) => /hasil ukur/.test(label)));
  assert.equal(api.evaluateTestReport('megger', { testVoltage: '500', minResistance: '1', irRS: '250', irRN: '120' }).result, 'Lulus');
  const failed = api.evaluateTestReport('megger', { testVoltage: '500', minResistance: '1', irRS: '250', irTG: '0,5' });
  assert.equal(failed.result, 'Gagal');
  assert.match(failed.reasons.join(), /T-G 0,5 MΩ < 1 MΩ/);
  assert.match(api.summarizeTestReport('megger', { testVoltage: '500', minResistance: '1', irRS: '250', irTG: '0,5' }), /terendah T-G 0,5 MΩ/);
});

test('grounding membandingkan tahanan dengan batas maksimum', () => {
  assert.equal(api.evaluateTestReport('grounding', { resistance: '3,2', maxResistance: '5' }).result, 'Lulus');
  assert.equal(api.evaluateTestReport('grounding', { resistance: '5', maxResistance: '5' }).result, 'Lulus');
  assert.equal(api.evaluateTestReport('grounding', { resistance: '7', maxResistance: '5' }).result, 'Gagal');
});

test('flushing dan commissioning memakai kondisi lapangan', () => {
  const flushing = { pipeSystem: 'Air Bersih', duration: '30', waterCondition: 'Jernih', flowCondition: 'Lancar', leak: 'Tidak Ada' };
  assert.equal(api.evaluateTestReport('flushing', flushing).result, 'Lulus');
  assert.equal(api.evaluateTestReport('flushing', { ...flushing, waterCondition: 'Keruh' }).result, 'Gagal');
  assert.equal(api.evaluateTestReport('flushing', { ...flushing, leak: 'Ada Bocor' }).result, 'Gagal');

  const pump = { equipment: 'Pompa Transfer', voltage: '380', current: '12', ratedCurrent: '15', functionResult: 'Normal' };
  assert.equal(api.evaluateTestReport('commissioning', pump).result, 'Lulus');
  assert.equal(api.evaluateTestReport('commissioning', { ...pump, current: '18' }).result, 'Gagal');
  assert.equal(api.evaluateTestReport('commissioning', { ...pump, functionResult: 'Tidak Normal' }).result, 'Gagal');
  assert.equal(api.evaluateTestReport('commissioning', { equipment: 'Panel LP-2', functionResult: 'Normal' }).result, 'Lulus');
});

test('tes tata udara menggantikan flushing, flushing lama tetap terbaca', () => {
  assert.equal(api.TEST_REPORT_TYPES.flushing.hidden, true);
  assert.equal(api.getSelectableTestReportTypes().includes('flushing'), false);
  assert.equal(api.getSelectableTestReportTypes().includes('hvac'), true);
  assert.equal(api.getSelectableTestReportTypes('flushing').includes('flushing'), true);
  assert.deepEqual([...api.getHvacTestMethodOptions({ hvacItem: 'Pipa Refrigerant' })], ['Tes Tekanan Nitrogen', 'Tes Vakum']);
  assert.equal(api.getHvacTestMethod({ hvacItem: 'Pipa Drain AC' }), 'Tes Aliran Drain');
  assert.equal(api.getHvacTestMethod({ hvacItem: 'Ducting', hvacMethod: 'Tes Vakum' }), '');
  assert.deepEqual([...api.evaluateTestReport('hvac', { hvacItem: 'Ducting' }).missing], ['Metode Tes']);
});

test('tes tata udara menilai ducting, refrigerant, drain dan unit', () => {
  const evaluate = (params) => api.evaluateTestReport('hvac', params);
  const duct = { hvacItem: 'Ducting', hvacMethod: 'Duct Leakage Test', ductTestPressure: '500', ductAllowedLeak: '20', ductMeasuredLeak: '15' };
  assert.equal(evaluate(duct).result, 'Lulus');
  assert.equal(evaluate({ ...duct, ductMeasuredLeak: '25' }).result, 'Gagal');
  assert.equal(evaluate({ hvacItem: 'Ducting', hvacMethod: 'Smoke Test (Asap)', smokeLeak: 'Ada' }).result, 'Gagal');

  const balance = { hvacItem: 'Ducting', hvacMethod: 'Air Balancing (Debit Udara)', designAirflow: '1000', measuredAirflow: '920', airflowTolerance: '10' };
  assert.equal(evaluate(balance).result, 'Lulus');
  assert.equal(evaluate({ ...balance, measuredAirflow: '850' }).result, 'Gagal');

  const n2 = { hvacItem: 'Pipa Refrigerant', hvacMethod: 'Tes Tekanan Nitrogen', refrigerant: 'R32', n2TestPressure: '550', n2HoldDuration: '24', n2Start: '550', n2End: '550', n2MaxDrop: '0' };
  assert.equal(evaluate(n2).result, 'Lulus');
  assert.equal(evaluate({ ...n2, n2End: '540' }).result, 'Gagal');
  assert.equal(evaluate({ ...n2, n2Start: '400', n2End: '400' }).result, 'Gagal');
  assert.match(api.summarizeTestReport('hvac', n2), /Pipa Refrigerant · Tes Tekanan Nitrogen · R32 · uji 550 psi · 24 jam/);

  const vacuum = { hvacItem: 'Pipa Refrigerant', hvacMethod: 'Tes Vakum', refrigerant: 'R410A', vacuumTarget: '500', vacuumReached: '400', vacuumHoldTime: '15', vacuumAfterHold: '800', vacuumMaxAfterHold: '1000' };
  assert.equal(evaluate(vacuum).result, 'Lulus');
  assert.equal(evaluate({ ...vacuum, vacuumReached: '700' }).result, 'Gagal');
  assert.equal(evaluate({ ...vacuum, vacuumAfterHold: '1500' }).result, 'Gagal');

  const drain = { hvacItem: 'Pipa Drain AC', drainFlow: 'Lancar', drainSlope: 'Sesuai', drainLeak: 'Tidak Ada' };
  assert.equal(evaluate(drain).result, 'Lulus');
  assert.equal(evaluate({ ...drain, drainSlope: 'Tidak Sesuai' }).result, 'Gagal');

  const unit = { hvacItem: 'Unit AC / FCU / AHU', hvacMethod: 'Uji Performa Unit', returnTemp: '25', supplyTemp: '14', minDeltaT: '8', unitCurrent: '5', unitRatedCurrent: '6', unitCondition: 'Normal' };
  assert.equal(evaluate(unit).result, 'Lulus');
  assert.equal(evaluate({ ...unit, supplyTemp: '20' }).result, 'Gagal');
  assert.equal(evaluate({ ...unit, unitCurrent: '7' }).result, 'Gagal');
  assert.equal(evaluate({ ...unit, unitCondition: 'Tidak Normal' }).result, 'Gagal');
});

test('baris data uji hanya menampilkan field yang relevan', () => {
  const rows = api.getTestReportParamRows('hvac', { hvacItem: 'Pipa Drain AC', drainFlow: 'Lancar', ductTestPressure: '500' });
  assert.deepEqual([...rows].map((row) => row.label), ['Item Diuji', 'Metode Tes', 'Kondisi Aliran']);
  assert.equal(rows[1].value, 'Tes Aliran Drain');
});

test('foto sebelum/sesudah hanya untuk tes pipa dan dikelompokkan', () => {
  assert.equal(api.hasTestReportStagePhotos('pressure'), true);
  assert.equal(api.hasTestReportStagePhotos('hvac'), false);
  assert.deepEqual([...api.getTestReportPhotoGroups({ photos: ['a'] })].map((group) => group.label), ['Foto Bukti Tes']);
  const groups = api.getTestReportPhotoGroups({ photos: ['c'], photosBefore: ['a'], photosAfter: ['b'] });
  assert.deepEqual([...groups].map((group) => group.label), ['Sebelum (Open)', 'Sesudah (Close)', 'Foto Bukti Lainnya']);
  assert.equal(api.getTestReportPhotoGroups({}).length, 0);
});

test('tes lainnya dinilai manual dan override mengalahkan hasil otomatis', () => {
  const other = api.evaluateTestReport('other', { testName: 'Tes Kebocoran Duct' });
  assert.equal(other.result, '');
  assert.equal(other.missing.length, 0);
  assert.equal(api.resolveTestReportResult(other.result, ''), '');
  assert.equal(api.resolveTestReportResult(other.result, 'Lulus'), 'Lulus');
  assert.equal(api.resolveTestReportResult('Lulus', 'Gagal'), 'Gagal');
  assert.equal(api.resolveTestReportResult('Gagal', 'invalid'), 'Gagal');
  assert.equal(api.getTestReportLabel({ type: 'other', params: { testName: 'Tes Kebocoran Duct' } }), 'Tes Kebocoran Duct');
  assert.equal(api.getTestReportLabel({ type: 'grounding' }), 'Tahanan Pentanahan / Grounding');
});

test('angka koma dan kosong diparse dengan aman', () => {
  assert.equal(api.parseTestNumber('1,5'), 1.5);
  assert.equal(api.parseTestNumber(' 2 '), 2);
  assert.equal(api.parseTestNumber(''), null);
  assert.equal(api.parseTestNumber('abc'), null);
  assert.deepEqual({ ...api.summarizeTestReportCounts([{ result: 'Lulus' }, { result: 'Gagal' }, { result: 'Lulus' }]) }, { total: 3, passed: 2, failed: 1 });
});

test('export PDF pengetesan mengikuti izin checklist', () => {
  assert.equal(api.canRoleExportPdf('SPV', ['checklist', 'daily_report'], 'pengetesan'), true);
  assert.equal(api.canRoleExportPdf('Developer', ['material', 'asset'], 'pengetesan'), false);
});

test('backend menulis pengetesan ke tab Tests sebagai cermin', () => {
  const sandbox = vm.createContext({});
  vm.runInContext([
    backendConst('TESTS_SHEET_NAME'),
    backendConst('TEST_HEADERS'),
    backendConst('SNAPSHOT_SECTIONS'),
    backendFunction('buildMonitoringRecords_'),
    backendFunction('firstPhotoUrl_'),
    backendFunction('sheetRowFromObject_'),
    backendFunction('structuredRecordRow_'),
    'globalThis.api = { TESTS_SHEET_NAME, TEST_HEADERS, SNAPSHOT_SECTIONS, buildMonitoringRecords_, structuredRecordRow_ };'
  ].join('\n'), sandbox);
  const backendApi = sandbox.api;
  assert.equal(backendApi.TESTS_SHEET_NAME, 'Tests');
  assert.deepEqual([...backendApi.SNAPSHOT_SECTIONS.checklist], ['checklistItems', 'testReports']);

  const report = {
    id: 'abc',
    type: 'grounding',
    typeLabel: 'Tahanan Pentanahan / Grounding',
    date: '2026-10-20',
    area: 'Rooftop',
    system: 'Penangkal Petir',
    result: 'Lulus',
    summary: '3,2 Ω · maks 5 Ω',
    testedBy: 'Budi',
    witnesses: { QC: 'Sari', 'Konsultan/Owner': '' },
    photos: ['https://drive.google.com/file/d/x/view']
  };
  const records = backendApi.buildMonitoringRecords_({ projectId: 'p1' }, { testReports: [report, null] }, 'user@test', []);
  const testRecords = records.filter((record) => record.recordType === 'test');
  assert.equal(testRecords.length, 1);
  assert.equal(testRecords[0].recordId, 'test:abc');
  assert.equal(testRecords[0].driveUrl, 'https://drive.google.com/file/d/x/view');

  const headers = backendApi.TEST_HEADERS.map((header) => header.toLowerCase());
  const row = backendApi.structuredRecordRow_(null, testRecords[0], headers);
  const cell = (name) => row[headers.indexOf(name)];
  assert.equal(cell('record_id'), 'test:abc');
  assert.equal(cell('project_id'), 'p1');
  assert.equal(cell('test_type'), 'Tahanan Pentanahan / Grounding');
  assert.equal(cell('system'), 'Penangkal Petir');
  assert.equal(cell('area'), 'Rooftop');
  assert.equal(cell('result'), 'Lulus');
  assert.equal(cell('tested_by'), 'Budi');
  assert.equal(cell('witnesses'), 'QC: Sari');
  assert.equal(cell('summary'), '3,2 Ω · maks 5 Ω');
  assert.equal(JSON.parse(cell('payload_json')).id, 'abc');
});

test('rekonsiliasi backend tidak menyaring testReports', () => {
  const reconcile = backendFunction('reconcileSnapshotWithRecords_');
  assert.doesNotMatch(reconcile, /testReports/);
  assert.match(backend, /\{ type: 'test', name: TESTS_SHEET_NAME, headers: TEST_HEADERS/);
});
