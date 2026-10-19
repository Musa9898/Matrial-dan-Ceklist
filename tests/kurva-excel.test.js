const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const zlib = require('node:zlib');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({ TextEncoder, TextDecoder, Blob, Response, DecompressionStream, CompressionStream });
for (const id of ['kurva-s-core', 'kurva-excel-core']) {
  vm.runInContext(html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1], context);
}
const core = vm.runInContext('kurvaSCore', context);
const excel = vm.runInContext('kurvaExcelCore', context);

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, filename, data);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralParts.reduce((sum, part) => sum + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...localParts, ...centralParts, end]);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.length);
}

function fixture(sheet, name = 'Source') {
  return {
    'xl/workbook.xml': `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="7" r:id="rId4"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId4" Target="worksheets/sheet1.xml"/></Relationships>',
    '[Content_Types].xml': '<Types><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': '<styleSheet><fonts count="1"><font><b/></font></fonts></styleSheet>',
    'xl/charts/chart1.xml': '<chartSpace><chart>Original chart</chart></chartSpace>',
    'xl/media/image1.png': Buffer.from([0, 255, 128, 12, 0, 42])
  };
}

const sourceSheet = excel.sheetXml([
  [46314], [], ['ITEM', 'Bobot', 'MINGGU KE', 'Selesai'],
  ['', '', '', '', 1, 2, 3],
  ['Pipa', 100, 1, 3, 20, 30, 50]
]);

test('master export preserves source sheets, formulas, styles and compressed binary parts; new entries have valid CRC', async () => {
  const files = fixture(sourceSheet.replace('<row r="2"></row>', '<row r="2"><c r="J2"><f>1+1</f><v>2</v></c></row>')
    .replace('</worksheet>', '<mergeCells count="1"><mergeCell ref="J1:K1"/></mergeCells><pageMargins left="0.5" right="0.5" top="1" bottom="1" header="0.3" footer="0.3"/></worksheet>'));
  const buffer = zip(files);
  const schedule = await core.parseScheduleFile(buffer);
  const id = schedule.items[0].id;
  schedule.progress = { 1: { values: { [id]: 25 } } };
  const before = JSON.stringify(schedule);
  const result = await excel.exportWorkbook(buffer, schedule, 'schedule', 3);
  assert.equal(result.sheetName, 'Realisasi Progres');
  const output = Buffer.from(await result.blob.arrayBuffer());
  const archive = await core.unzip(output);
  assert.equal(await archive.read('xl/worksheets/sheet1.xml'), files['xl/worksheets/sheet1.xml']);
  assert.equal(await archive.read('xl/styles.xml'), files['xl/styles.xml']);
  assert.equal(await archive.read('xl/charts/chart1.xml'), files['xl/charts/chart1.xml']);
  assert.match(await archive.read('xl/workbook.xml'), /sheetId="8" r:id="rId1"/);
  const data = core.parseSheetXml(await archive.read('xl/worksheets/sheet2.xml'), []);
  assert.equal(data[7][7], 25);
  assert.equal(data[7][8], 5);
  assert.equal(data[8][3], 'Belum ada laporan');
  assert.equal(data[13][9], 25, 'unreported week carries stored cumulative parent progress');
  assert.equal(JSON.stringify(schedule), before);
  const footer = output.length - 22;
  let pointer = output.readUInt32LE(footer + 16);
  const decoded = {};
  for (let index = 0; index < output.readUInt16LE(footer + 10); index += 1) {
    const size = output.readUInt32LE(pointer + 20);
    const local = output.readUInt32LE(pointer + 42);
    const start = local + 30 + output.readUInt16LE(local + 26) + output.readUInt16LE(local + 28);
    const compressed = output.subarray(start, start + size);
    const raw = output.readUInt16LE(pointer + 10) === 8 ? zlib.inflateRawSync(compressed) : compressed;
    assert.equal(crc32(raw), output.readUInt32LE(pointer + 16));
    const name = output.toString('utf8', pointer + 46, pointer + 46 + output.readUInt16LE(pointer + 28));
    decoded[name] = raw;
    pointer += 46 + output.readUInt16LE(pointer + 28) + output.readUInt16LE(pointer + 30) + output.readUInt16LE(pointer + 32);
  }
  for (const [name, content] of Object.entries(files)) {
    if (['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'].includes(name)) continue;
    assert.deepEqual(decoded[name], Buffer.from(content), `${name} remains byte-identical`);
  }
});

test('master template mismatch, invalid weeks, signed and structure-locked workbooks fail explicitly', async () => {
  const buffer = zip(fixture(sourceSheet));
  const schedule = await core.parseScheduleFile(buffer);
  await assert.rejects(excel.exportWorkbook(buffer, { ...schedule, weekCount: 4 }, 'schedule', 1), /tidak cocok/);
  await assert.rejects(excel.exportWorkbook(buffer, { ...schedule, items: [{ ...schedule.items[0], plan: [0, 50, 50] }] }, 'schedule', 1), /tidak cocok/);
  await assert.rejects(excel.exportWorkbook(buffer, schedule, 'schedule', 0), /minggu tidak valid/);
  await assert.rejects(excel.exportWorkbook(zip({ ...fixture(sourceSheet), '_xmlsignatures/sig1.xml': '<Signature/>' }), schedule, 'schedule', 1), /tanda tangan/);
  const locked = fixture(sourceSheet);
  locked['xl/workbook.xml'] = locked['xl/workbook.xml'].replace('<sheets>', '<workbookProtection lockStructure="1"/><sheets>');
  await assert.rejects(excel.exportWorkbook(zip(locked), schedule, 'schedule', 1), /terkunci/);
});

test('BOQ export respects mapping history, exclusions and relative parent weights without rewriting historical parent reports', async () => {
  const boq = excel.sheetXml([
    ['Code', 'Description', 'UNIT', 'QTY', 'BOBOT'],
    ['A', 'SANITAIR'],
    ['1', '=Basin & <test>', 'pcs', 10, 2],
    ['2', 'Tap', 'pcs', 10, 1]
  ]);
  const buffer = zip(fixture(boq, 'ARCHITECTURE-TOWER'));
  const parsed = await core.parseDetailFile(buffer);
  const [a, b] = parsed.items;
  const old = [{ ...a, parentId: 'podium' }, { ...b, parentId: 'podium' }];
  const current = [{ ...a, parentId: 'tower' }];
  const schedule = { title: 'Test', startDate: '2026-10-19', weekCount: 3,
    detailStartWeek: 1, detailItems: current, detailCatalog: parsed.items,
    detailMappingVersions: [{ fromWeek: 1, items: old }, { fromWeek: 2, items: current }],
    items: [{ id: 'podium', name: 'Podium', weight: 60, plan: [20, 20, 20] },
      { id: 'tower', name: 'Tower', weight: 40, plan: [0, 20, 20] }],
    progress: { 1: { values: { podium: 25, tower: 0 }, detailVolumes: { [a.id]: 5, [b.id]: 0 } },
      2: { values: { podium: 25, tower: 50 }, detailVolumes: { [a.id]: 5 } } } };
  const rows = excel.buildRows(schedule, 'details', 2);
  const details = rows.filter((row) => row[2] === a.id);
  assert.equal(details[0][13], 'podium');
  assert.equal(details[0][17], 20);
  assert.equal(details[1][13], 'tower');
  assert.equal(details[1][17], 20);
  assert.equal(rows.find((row) => row[0] === 2 && row[2] === b.id)[15], null);
  assert.equal(rows[6][6], 15, 'project total uses saved parent report, not reconstructed detail volumes');
  const result = await excel.exportWorkbook(buffer, schedule, 'details', 2);
  const archive = await core.unzip(await result.blob.arrayBuffer());
  const sheet = await archive.read('xl/worksheets/sheet2.xml');
  assert.match(sheet, /=Basin &amp; &lt;test&gt;/);
  assert.doesNotMatch(sheet, /<f[ >]/, 'source text cannot become an Excel formula');
  const again = await excel.exportWorkbook(await result.blob.arrayBuffer(), schedule, 'details', 2);
  assert.equal(again.sheetName, 'Realisasi Progres (2)');
  const changed = { ...schedule, detailCatalog: [{ ...a, qty: 20 }, b], detailItems: [{ ...a, qty: 20, parentId: 'tower' }],
    detailMappingVersions: [] };
  await assert.rejects(excel.exportWorkbook(buffer, changed, 'details', 1), /berbeda dari data tersimpan/);
  const inactive = excel.buildRows({ ...schedule, detailStartWeek: 2 }, 'details', 1).find((row) => row[2] === a.id);
  assert.equal(inactive[12], 'Tidak aktif pada minggu ini');
  assert.equal(inactive[15], null);
});

test('download UI rejects changed projects, blocks double exports and restores controls on failure', async () => {
  const ids = ['kurvaExcelType', 'kurvaExcelWeek', 'kurvaExcelFile', 'kurvaExcelCancel', 'kurvaExcelSave', 'kurvaExcelStatus'];
  const elements = Object.fromEntries(ids.map((id) => [id, {}]));
  elements.kurvaExcelFile.files = [{ name: 'master.xlsx', arrayBuffer: async () => new ArrayBuffer(1) }];
  elements.kurvaExcelType.value = 'schedule';
  elements.kurvaExcelWeek.value = '1';
  const schedule = {};
  let calls = 0;
  let rejectExport;
  let allowed = false;
  let lastNotice = '';
  const sandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    requireAccess: () => allowed, showAppNotice: (message) => { lastNotice = message; }, console: { error() {} },
    projectSchedule: schedule, activeProjectId: 'p',
    kurvaExcelExportContext: { schedule, projectId: 'old', busy: false },
    kurvaExcelCore: { exportWorkbook: async () => { calls += 1; return new Promise((resolve, reject) => { rejectExport = reject; }); } }
  });
  const start = html.indexOf('    async function downloadKurvaExcel()');
  vm.runInContext(html.slice(start, html.indexOf('    function renderKurvaS(', start)), sandbox);
  await sandbox.downloadKurvaExcel();
  assert.equal(calls, 0);
  allowed = true;
  await sandbox.downloadKurvaExcel();
  assert.match(lastNotice, /Proyek\/jadwal berubah/);
  sandbox.kurvaExcelExportContext.projectId = 'p';
  const pending = sandbox.downloadKurvaExcel();
  await Promise.resolve();
  assert.equal(elements.kurvaExcelSave.disabled, true);
  await sandbox.downloadKurvaExcel();
  assert.equal(calls, 1);
  rejectExport(new Error('Invalid template'));
  await pending;
  assert.equal(elements.kurvaExcelSave.disabled, false);
  assert.equal(sandbox.kurvaExcelExportContext.busy, false);
  assert.match(elements.kurvaExcelStatus.textContent, /Ekspor gagal: Invalid template/);
  let finishExport;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  sandbox.kurvaExcelCore.exportWorkbook = async () => new Promise((resolve) => {
    finishExport = resolve;
    signalStarted();
  });
  const changedProject = sandbox.downloadKurvaExcel();
  await started;
  sandbox.activeProjectId = 'other-project';
  finishExport({ blob: new Blob(['not for other project']), sheetName: 'Realisasi Progres' });
  await changedProject;
  assert.match(elements.kurvaExcelStatus.textContent, /Proyek, jadwal atau akses berubah/);
  assert.equal(elements.kurvaExcelSave.disabled, false);
});
