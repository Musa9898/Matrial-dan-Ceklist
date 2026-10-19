const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const zlib = require('node:zlib');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script id="kurva-s-core">([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({ TextDecoder, Blob, Response, DecompressionStream });
vm.runInContext(`${script}\nglobalThis.kurva = kurvaSCore;`, context);
const kurva = context.kurva;
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// Columns: F=6 No, G=7 ITEM, H=8 sub name, I=9 Bobot, J=10 start, K=11 end, N=14.. weeks 1..6
function sampleGrid() {
  const weeks = (values) => Object.fromEntries(values.map((value, index) => [14 + index, value]));
  return {
    9: { 66: 46314 },
    18: { 5: 'MASTER SCHEDULE' },
    19: { 5: 'PROYEK UJI' },
    22: { 6: 'No.', 7: 'ITEM', 9: 'Bobot', 10: 'MINGGU KE', 12: 'DURASI', 14: 2026 },
    24: weeks([1, 2, 3, 4, 5, 6]),
    25: { 6: 'I', 7: 'PRELIM', 9: 20 },
    26: { 7: 'MAIN PRELIM', 9: 20, 10: 1, 11: 6, ...weeks([4, 4, 0, 4, 4, 4]) },
    28: { 6: 'II', 7: 'ARCHITECTURE', 9: 80 },
    29: { 7: 'a.', 8: 'PODIUM', 9: 50 },
    30: { 8: 'WATERPROOFING', 9: 30, 10: 1, 11: 2, ...weeks([15, 15]) },
    31: { 8: 'FLOOR', 9: 20, 10: 4, 11: 5, ...weeks([0, 0, 0, 10, 10]) },
    32: { 7: 'b.', 8: 'SERVICE', 9: 30 },
    33: { 8: 'WATERPROOFING', 9: 30, 10: 4, 11: 6 },
    35: { 7: 'RENCANA MINGGUAN', 14: 19 }
  };
}

test('parses grouped master schedule rows, weeks, holidays and start date', () => {
  const schedule = kurva.parseScheduleGrid(sampleGrid());
  assert.equal(schedule.startDate, '2026-10-19');
  assert.equal(schedule.weekCount, 6);
  assert.equal(schedule.title, 'PROYEK UJI');
  assert.deepEqual(Array.from(schedule.holidays), [3]);
  assert.equal(schedule.items.length, 4);
  const [prelim, podiumWp, floor, serviceWp] = schedule.items;
  assert.equal(prelim.group, 'PRELIM');
  assert.equal(podiumWp.group, 'ARCHITECTURE');
  assert.equal(podiumWp.subgroup, 'PODIUM');
  assert.equal(serviceWp.subgroup, 'SERVICE');
  assert.notEqual(podiumWp.id, serviceWp.id);
  assert.deepEqual(Array.from(floor.plan), [0, 0, 0, 10, 10, 0]);
  near(serviceWp.plan[3], 10);
  assert.equal(schedule.totalWeight, 100);
});

test('rejects files without a schedule header', () => {
  assert.throws(() => kurva.parseScheduleGrid({ 1: { 1: 'Hello' } }), /Header jadwal/);
});

test('schedule header at row 51, No in A and Bobot in J preserves schedule values', () => {
  const grid = {
    1: { 1: 'PROYEK LAIN' },
    2: { 1: 46314 },
    51: { 1: 'No.', 2: 'ITEM', 10: 'Bobot', 11: 'Mulai', 12: 'Selesai' },
    53: { 14: 1, 15: 2, 16: 3 },
    54: { 1: 'I', 2: 'PLUMBING', 10: 100 },
    55: { 1: 1, 2: 'Pipa air bersih', 10: 100, 11: 1, 12: 3, 14: 20, 15: 30, 16: 50 }
  };
  const schedule = kurva.parseScheduleGrid(grid);
  assert.equal(schedule.items.length, 1);
  assert.equal(schedule.items[0].name, 'Pipa air bersih');
  assert.equal(schedule.items[0].group, 'PLUMBING');
  assert.equal(schedule.items[0].weight, 100);
  assert.equal(schedule.startDate, '2026-10-19');
  assert.equal(schedule.weekCount, 3);
  assert.deepEqual(Array.from(kurva.computeCurve(schedule).planCumulative), [20, 50, 100]);
  // ITEM may itself be in A when a separate No column is absent.
  delete grid[51][1];
  grid[51][1] = 'ITEM';
  delete grid[51][2];
  delete grid[54];
  grid[55][1] = grid[55][2];
  delete grid[55][2];
  assert.equal(kurva.parseScheduleGrid(grid).items[0].name, 'Pipa air bersih');
});

test('week header must remain within five rows of the detected schedule header', () => {
  const grid = sampleGrid();
  grid[27] = grid[24];
  delete grid[24];
  assert.equal(kurva.parseScheduleGrid(grid).weekCount, 6);
  grid[28] = grid[27];
  delete grid[27];
  assert.throws(() => kurva.parseScheduleGrid(grid), /Baris nomor minggu/);
});

test('nonempty metadata between ITEM and Bobot is currently included in the work name', () => {
  const grid = sampleGrid();
  grid[22][8] = 'PIC';
  grid[26][8] = 'Mandor A';
  assert.equal(kurva.parseScheduleGrid(grid).items[0].name, 'MAIN PRELIM Mandor A');
});

test('computes plan, carried-forward actual progress and deviation', () => {
  const schedule = kurva.parseScheduleGrid(sampleGrid());
  const [prelim, podiumWp] = schedule.items;
  schedule.progress = {
    1: { values: { [prelim.id]: 20, [podiumWp.id]: 40 } },
    2: { values: { [podiumWp.id]: 100 } }
  };
  const curve = kurva.computeCurve(schedule);
  assert.deepEqual(Array.from(curve.planCumulative), [19, 38, 38, 62, 86, 100]);
  assert.equal(curve.lastReportedWeek, 2);
  near(curve.actualCumulative[0], 20 * 0.2 + 30 * 0.4);
  near(curve.actualCumulative[1], 20 * 0.2 + 30);
  near(curve.actualWeekly[1], 30 * 0.6);
  near(curve.deviation[1], 34 - 38);
  assert.equal(curve.actualCumulative[2], null);

  const atWeek3 = kurva.getItemProgressAt(schedule, 3);
  assert.equal(atWeek3[prelim.id], 20);
  assert.equal(atWeek3[podiumWp.id], 100);
  assert.equal(kurva.getItemProgressLimit(schedule, 1, podiumWp.id), 100);
  assert.equal(kurva.getItemProgressLimit(schedule, 0, prelim.id), 20);
});

test('maps dates to schedule weeks', () => {
  assert.equal(kurva.getWeekForDate('2026-10-19', '2026-10-19', 52), 1);
  assert.equal(kurva.getWeekForDate('2026-10-19', '2026-10-25', 52), 1);
  assert.equal(kurva.getWeekForDate('2026-10-19', '2026-10-26', 52), 2);
  assert.equal(kurva.getWeekForDate('2026-10-19', '2026-10-01', 52), 0);
  assert.equal(kurva.getWeekForDate('2026-10-19', '2030-01-01', 52), 52);
  assert.equal(kurva.getWeekStartDate('2026-10-19', 3), '2026-11-02');
  assert.equal(kurva.excelSerialToISO(46314), '2026-10-19');
});

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const raw = Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  });
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, ...centrals, end]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

test('reads an xlsx workbook with shared strings and picks the schedule sheet', async () => {
  const strings = ['ITEM', 'Bobot', 'MINGGU KE', 'Pekerjaan A &amp; B', 'RENCANA MINGGUAN'];
  const sharedXml = `<sst>${strings.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`;
  const cell = (ref, value, type) => (type ? `<c r="${ref}" t="${type}"><v>${value}</v></c>` : `<c r="${ref}"><v>${value}</v></c>`);
  const sheet2 = `<worksheet><sheetData>
    <row r="1">${cell('A1', 46314)}</row>
    <row r="3">${cell('B3', 0, 's')}${cell('C3', 1, 's')}${cell('D3', 2, 's')}</row>
    <row r="4">${cell('F4', 1)}${cell('G4', 2)}${cell('H4', 3)}</row>
    <row r="5">${cell('B5', 3, 's')}${cell('C5', 100)}${cell('D5', 1)}${cell('E5', 3)}${cell('F5', 30)}${cell('G5', 30)}${cell('H5', 40)}</row>
    <row r="6">${cell('B6', 4, 's')}</row>
  </sheetData></worksheet>`;
  const buffer = buildZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="Schedule" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': sharedXml,
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Cover</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': sheet2
  });
  const schedule = await kurva.parseScheduleFile(buffer);
  assert.equal(schedule.sheetName, 'Schedule');
  assert.equal(schedule.startDate, '2026-10-19');
  assert.equal(schedule.items.length, 1);
  assert.equal(schedule.items[0].name, 'Pekerjaan A & B');
  assert.deepEqual(Array.from(schedule.items[0].plan), [30, 30, 40]);
});

test('xlsx import reads A51 ITEM and J51 Bobot without fixed row or column positions', async () => {
  const cell = (ref, value) => typeof value === 'string'
    ? `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
    : `<c r="${ref}"><v>${value}</v></c>`;
  const buffer = buildZip({
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1">${cell('A1', 46314)}</row>
      <row r="51">${cell('A51', 'ITEM')}${cell('J51', 'Bobot')}${cell('K51', 'Mulai')}${cell('L51', 'Selesai')}</row>
      <row r="52">${cell('N52', 1)}${cell('O52', 2)}${cell('P52', 3)}</row>
      <row r="53">${cell('A53', 'Pipa')}${cell('J53', 100)}${cell('K53', 1)}${cell('L53', 3)}${cell('N53', 20)}${cell('O53', 30)}${cell('P53', 50)}</row>
    </sheetData></worksheet>`
  });
  const schedule = await kurva.parseScheduleFile(buffer);
  assert.equal(schedule.items[0].name, 'Pipa');
  assert.equal(schedule.items[0].weight, 100);
  assert.deepEqual(Array.from(kurva.computeCurve(schedule).planCumulative), [20, 50, 100]);
});

test('aligns the baseline curve to the revised schedule and reports finish shift', () => {
  const schedule = kurva.parseScheduleGrid(sampleGrid());
  schedule.baseline = { startDate: '2026-10-19', weekCount: 4, planCumulative: [25, 50, 75, 100] };
  assert.deepEqual(Array.from(kurva.computeCurve(schedule).baselineCumulative), [25, 50, 75, 100, 100, 100]);
  schedule.startDate = '2026-10-26';
  assert.deepEqual(Array.from(kurva.getBaselineCumulative(schedule)), [50, 75, 100, 100, 100, 100]);
  schedule.startDate = '2026-10-12';
  assert.deepEqual(Array.from(kurva.getBaselineCumulative(schedule)), [0, 25, 50, 75, 100, 100]);
  delete schedule.baseline;
  assert.equal(kurva.computeCurve(schedule).baselineCumulative, null);
  assert.equal(kurva.getFinishWeek([10, 50, 100, 100]), 3);
  assert.equal(kurva.getWeekOffset('2026-10-19', '2026-11-16'), 4);
});

test('remaps progress weeks on reschedule and drops removed items', () => {
  const progress = {
    1: { values: { a: 10, gone: 50 }, updatedBy: 'spv' },
    2: { values: { a: 20 } },
    5: { values: { a: 60 } }
  };
  const same = kurva.remapProgress(progress, '2026-10-19', '2026-10-19', 4, new Set(['a']));
  assert.deepEqual(Object.keys(same), ['1', '2']);
  assert.deepEqual({ ...same[1].values }, { a: 10 });
  assert.equal(same[1].updatedBy, 'spv');
  const shifted = kurva.remapProgress(progress, '2026-10-19', '2026-10-26', 10, new Set(['a']));
  assert.deepEqual(Object.keys(shifted), ['1', '4']);
  assert.equal(shifted[1].values.a, 20);
});
