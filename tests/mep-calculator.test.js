const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script id="mep-calc-script">([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({});
vm.runInContext(script.replace('mepCalculator.initialize();', '') + '\nglobalThis.calculator = mepCalculator;', context);
const calculator = context.calculator;
const defaults = key => Object.fromEntries(calculator.tabs.find(tab => tab.key === key).fields.map(field => [field.key, field.value]));
const calculate = (key, input = {}) => calculator.calculate(key, { ...defaults(key), ...input });
const item = (results, label, unit) => {
  const found = results.find(result => result.label === label && (!unit || result.unit === unit));
  assert.ok(found, `Missing result: ${label} ${unit || ''}`);
  return found;
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${actual} != ${expected}`);

test('six calculator tabs have finite defaults and explicit status badges', () => {
  assert.equal(calculator.tabs.length, 6);
  for (const tab of calculator.tabs) {
    const results = calculate(tab.key);
    assert.ok(results.length >= 4);
    for (const result of results) {
      assert.ok(Number.isFinite(result.value));
      assert.ok(['safe', 'warn', 'danger'].includes(result.level));
      assert.ok(result.status);
    }
  }
});

test('electricity calculates both phase systems, cable drop, KHA and capacitor bank', () => {
  for (const phase of [1, 3]) {
    const v = { ...defaults('electric'), phase };
    const results = calculate('electric', v);
    const cable = calculator.cables.find(c => c.size === v.cable)[1];
    const voltage = phase === 3 ? 380 : 220;
    const current = 10000 / ((phase === 3 ? Math.sqrt(3) : 1) * voltage * 0.85);
    near(item(results, 'Arus nominal In').value, current);
    near(item(results, 'KHA kabel minimum (1,25 × In)').value, 1.25 * current);
    const drop = (phase === 3 ? Math.sqrt(3) : 2) * current * 0.03 *
      (cable.r * 0.85 + cable.x * Math.sqrt(1 - 0.85 ** 2));
    near(item(results, 'Voltage drop', 'V').value, drop);
    near(item(results, 'Voltage drop', '%').value, drop / voltage * 100);
    near(item(results, 'Kebutuhan kapasitor bank').value, 10 * (Math.tan(Math.acos(0.85)) - Math.tan(Math.acos(0.95))));
  }
  near(item(calculate('electric', { targetPf: 0.85 }), 'Kebutuhan kapasitor bank').value, 0);
});

test('cable table covers CU/AL sizes and breaker warns when coordination is unsafe', () => {
  assert.deepEqual(Array.from(calculator.cables, c => c.size),
    [2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630]);
  for (const c of calculator.cables) {
    assert.ok(c[1].r > 0 && c[1].x > 0);
    assert.equal(c[2] === null, c.size < 16);
    if (c[2]) assert.ok(c[2].r > c[1].r);
    assert.equal(c[1].kha === null, c.size > 300);
    if (c[2]) assert.equal(c[2].kha === null, c.size > 300);
    if (c[2]?.kha) assert.ok(c[2].kha < c[1].kha);
  }
  assert.equal(calculator.cables.find(c => c.size === 150)[1].kha, 225);
  assert.equal(calculator.cables.find(c => c.size === 300)[1].kha, 339);
  assert.equal(calculator.cables.find(c => c.size === 300)[2].kha, 265);
  const small = calculate('electric', { kw: 50, cable: 2.5 });
  assert.equal(item(small, 'KHA kabel minimum (1,25 × In)').level, 'danger');
  assert.equal(item(small, 'Rating breaker (>1,2 × In)').level, 'danger');
  const huge = calculate('electric', { kw: 3000, cable: 300, runs: 12 });
  assert.equal(item(huge, 'Rating breaker (>1,2 × In)').value, 'Di atas rentang tabel');
  assert.match(item(huge, 'Rating breaker (>1,2 × In)').status, />4000 A/);
  const current20 = 20 * Math.sqrt(3) * 380 * 0.85 / 1000;
  assert.equal(item(calculate('electric', { kw: current20 }), 'Rating breaker (>1,2 × In)').value, 25);
});

test('large LVMDP loads use parallel runs, CU/AL tables, datasheet KHA and breakers up to 4000 A', () => {
  const breakerAt = amps => item(calculate('electric', { kw: amps * Math.sqrt(3) * 380 * 0.85 / 1000, cable: 300, runs: 12 }),
    'Rating breaker (>1,2 × In)').value;
  for (const [amps, rating] of [[600, 800], [1000, 1250], [1500, 2000], [2500, 3200], [3300, 4000]]) {
    assert.equal(breakerAt(amps), rating);
  }

  const kw = 1000;
  const current = kw * 1000 / (Math.sqrt(3) * 380 * 0.85);
  const cu = calculate('electric', { kw, conductor: 1, cable: 300, runs: 7, length: 50 });
  const cuCable = calculator.cables.find(c => c.size === 300)[1];
  near(item(cu, 'Arus per tarikan (In ÷ n)').value, current / 7);
  assert.match(item(cu, 'KHA kabel minimum (1,25 × In)').note, /KHA total 2373 A = 339 A \(tabel B2\) × 7/);
  assert.equal(item(cu, 'KHA kabel minimum (1,25 × In)').level, 'warn');
  const cuDrop = Math.sqrt(3) * current * 0.05 * (cuCable.r / 7 * 0.85 + cuCable.x / 7 * Math.sqrt(1 - 0.85 ** 2));
  near(item(cu, 'Voltage drop', 'V').value, cuDrop);
  assert.equal(item(cu, 'Rating breaker (>1,2 × In)').value, 2500);
  assert.equal(item(cu, 'Rating breaker (>1,2 × In)').level, 'danger');

  const al = calculate('electric', { kw, conductor: 2, cable: 300, runs: 7, length: 50 });
  assert.equal(item(al, 'KHA kabel minimum (1,25 × In)').level, 'danger');
  assert.ok(item(al, 'Voltage drop', 'V').value > cuDrop);
  assert.match(item(calculate('electric', { kw, conductor: 2, cable: 300, runs: 8 }), 'KHA kabel minimum (1,25 × In)').note,
    /KHA total 2120 A = 265 A \(tabel B2\) × 8/);

  assert.throws(() => calculate('electric', { conductor: 2, cable: 10 }), /AL mulai 16/);
  assert.throws(() => calculate('electric', { cable: 400 }), /datasheet/);
  const datasheet = calculate('electric', { kw, cable: 400, runs: 4, khaDatasheet: 435 });
  assert.match(item(datasheet, 'KHA kabel minimum (1,25 × In)').note, /KHA total 1740 A = 435 A \(datasheet\) × 4/);
  const override = calculate('electric', { cable: 6, khaDatasheet: 30 });
  assert.match(item(override, 'KHA kabel minimum (1,25 × In)').note, /30 A \(datasheet\)/);
});

test('voltage drop indicators distinguish 4 and 5 percent bands', () => {
  const base = item(calculate('electric', { length: 1 }), 'Voltage drop', '%').value;
  for (const [percent, level] of [[3.999, 'safe'], [4.001, 'warn'], [4.999, 'warn'], [5.001, 'danger']]) {
    assert.equal(item(calculate('electric', { length: percent / base }), 'Voltage drop', '%').level, level);
  }
});

test('water uses SI Hazen-Williams, fitting allowance, head, power and roof drains', () => {
  const results = calculate('water');
  const q = 0.002;
  const hf = 10.67 * 50 * q ** 1.852 / (150 ** 1.852 * 0.05 ** 4.87);
  const head = 30 + hf * 1.2 + 12;
  near(item(results, 'KECEPATAN ALIRAN (Limit Aman ≤ 2 m/s)').value, q / (Math.PI * 0.05 ** 2 / 4));
  near(item(results, 'HEAD LOSS GESEK (Hitungan Kasar / Estimasi)').value, hf);
  near(item(results, 'TOTAL GESEK + FITTING 20% (Koreksi Aksesoris)').value, hf * 1.2);
  near(item(results, 'TOTAL HEAD POMPA MKA (Estimasi Lapangan)', 'mka').value, head);
  near(item(results, 'TEKANAN POMPA BAR (Konversi Head)', 'bar').value, head * 0.0981);
  const kw = 1000 * 9.81 * q * head / (1000 * 0.65);
  near(item(results, 'DAYA MOTOR KW (Efisiensi 65%)').value, kw);
  near(item(results, 'KAPASITAS MOTOR HP (Estimasi Beban)').value, kw / 0.746);
  near(item(results, 'DEBIT AIR HUJAN (Kalkulasi Runoff Atap)').value, 15);
  assert.equal(item(results, 'JUMLAH TITIK ROOF DRAIN (Asumsi 12 L/s)').value, 2);
  const steel = calculate('water', { c: 100 });
  assert.ok(item(steel, 'HEAD LOSS GESEK (Hitungan Kasar / Estimasi)').value > hf);
});

test('water velocity badges cover safe, tolerance and risk', () => {
  for (const [velocity, level] of [[2, 'safe'], [2.001, 'warn'], [2.5, 'warn'], [2.501, 'danger']]) {
    const flow = velocity * (Math.PI * 0.05 ** 2 / 4) * 1000;
    assert.equal(item(calculate('water', { flow }), 'KECEPATAN ALIRAN (Limit Aman ≤ 2 m/s)').level, level);
  }
});

test('HVAC calculates load, ventilation, sensible heat, equivalent diameter and velocity', () => {
  const results = calculate('hvac');
  near(item(results, 'KAPASITAS PK / BTU (Hitungan Kasar)').value, 60000);
  near(item(results, 'BEBAN TON REFRIGERASI (Estimasi TR)').value, 5);
  near(item(results, 'KONVERSI KAPASITAS AC (Estimasi PK)').value, 60000 / 9000);
  near(item(results, 'DEBIT WATER CHILLER (Flow GPM)').value, 12);
  near(item(results, 'VOLUME UDARA FRESH AIR (CMH)', 'CMH').value, 1800);
  near(item(results, 'VOLUME UDARA FRESH AIR (CFM)', 'CFM').value, 1800 / 1.699);
  near(item(results, 'BEBAN PANAS SENSIBEL (Qs Estimasi)').value, 1.08 * 1800 / 1.699 * 18);
  near(item(results, 'DIAMETER EKIVALEN DUCTING (Round Duct)').value, 1.3 * (500 * 300) ** 0.625 / 800 ** 0.25);
  near(item(results, 'KECEPATAN UDARA DUCT (Limit ≤ 5.5 m/s)').value, 0.5 / 0.15);
});

test('duct velocity badges cover 5.5 and 8.5 m/s bands', () => {
  for (const [velocity, level] of [[5.499, 'safe'], [5.501, 'warn'], [8.499, 'warn'], [8.501, 'danger']]) {
    assert.equal(item(calculate('hvac', { volume: velocity * 0.15 * 3600 / 6 }), 'KECEPATAN UDARA DUCT (Limit ≤ 5.5 m/s)').level, level);
  }
});

test('lumen method rounds fixtures up and uses installed power for density', () => {
  const results = calculate('lighting');
  near(item(results, 'FLUX CAHAYA / LUMEN (Hitungan Kasar)').value, 2000);
  assert.equal(item(results, 'JUMLAH TITIK LAMPU (Kebutuhan Estimasi)').value, 37);
  near(item(results, 'TOTAL DAYA LAMPU (Estimasi Watt Total)').value, 740);
  near(item(results, 'DENSITAS DAYA / WATT DENSITY (Limit ≤ 10 W/m²)').value, 7.4);
  assert.equal(item(results, 'DENSITAS DAYA / WATT DENSITY (Limit ≤ 10 W/m²)').level, 'safe');
  const boundary = calculate('lighting', { area: 10, lux: 100, watt: 100, efficacy: 100, uf: 1, llf: 1 });
  assert.equal(item(boundary, 'DENSITAS DAYA / WATT DENSITY (Limit ≤ 10 W/m²)').value, 10);
  assert.equal(item(boundary, 'DENSITAS DAYA / WATT DENSITY (Limit ≤ 10 W/m²)').level, 'safe');
  assert.equal(item(calculate('lighting', { area: 1, watt: 20 }), 'DENSITAS DAYA / WATT DENSITY (Limit ≤ 10 W/m²)').level, 'danger');
});

test('fire estimates round sprinklers and return explicitly non-certified ranges and tank volume', () => {
  for (const coverage of [12, 9, 6]) {
    assert.equal(item(calculate('fire', { coverage }), 'JUMLAH SPRINKLER (Estimasi Titik)').value, Math.ceil(1000 / coverage));
  }
  const results = calculate('fire');
  assert.equal(item(results, 'DEBIT SPRINKLER 6 TITIK (Flow GPM)').value, 120);
  assert.equal(item(results, 'DEBIT SPRINKLER 12 TITIK (Flow GPM)').value, 240);
  assert.equal(item(results, 'JOCKEY PUMP 5% MAIN (Flow GPM)').value, 25);
  assert.equal(item(results, 'JOCKEY PUMP 10% MAIN (Flow GPM)').value, 50);
  near(item(results, 'KAPASITAS TANGKI AIR PEMADAM (Estimasi Kubikasi)').value, 85.1625);
  assert.ok(results.every(result => result.level === 'warn'));
});

test('utility calculates power, tanks, daily water and gravity slopes', () => {
  const results = calculate('utility');
  near(item(results, 'BEBAN PUNCAK / PEAK LOAD (Estimasi kW)').value, 375);
  for (const label of ['KAPASITAS TRAFO MINIMUM (KVA)', 'KAPASITAS GENSET MINIMUM (KVA)']) {
    near(item(results, label).value, 375 / (0.85 * 0.8));
  }
  near(item(results, 'KONSUMSI AIR BERSIH HARIAN (Qd)').value, 10);
  near(item(results, 'KAPASITAS GWT / TANGKI BAWAH (Kubikasi)').value, 10);
  near(item(results, 'KAPASITAS ROOF TANK / TANGKI ATAS (30% Qd)').value, 3);
  near(item(results, 'SLOPE PIPA DRAINASE ≥4 INCI (Kemiringan 1%)').value, 0.2);
  near(item(results, 'SLOPE PIPA SANITER ≤3 INCI (Kemiringan 2%)').value, 0.4);
});

test('invalid, empty, non-finite and out-of-range fields fail explicitly in every tab', () => {
  for (const tab of calculator.tabs) {
    for (const field of tab.fields) {
      for (const invalid of ['', ' ', undefined, null, NaN, Infinity, -1, 'bad']) {
        assert.throws(() => calculate(tab.key, { [field.key]: invalid }), /./);
      }
      if (field.options) assert.throws(() => calculate(tab.key, { [field.key]: 999999 }), /pilih opsi/);
      else assert.throws(() => calculate(tab.key, { [field.key]: field.max + 1 }), /isi angka/);
    }
  }
  assert.throws(() => calculate('electric', { targetPf: 0.8 }), /Target cos phi/);
  assert.throws(() => calculate('utility', { people: 1.5 }), /bilangan bulat/);
  assert.throws(() => calculator.calculate('missing', {}), /tidak dikenal/);
});

test('zero demand is supported without division by zero and zero denominators are rejected', () => {
  for (const [key, input] of [
    ['electric', { kw: 0 }], ['water', { flow: 0, roof: 0 }],
    ['hvac', { area: 0, volume: 0 }], ['fire', { area: 0 }],
    ['utility', { connected: 0, people: 0, length: 0 }]
  ]) {
    assert.ok(calculate(key, input).every(result => typeof result.value !== 'number' || Number.isFinite(result.value)));
  }
  for (const field of ['area', 'watt', 'efficacy', 'uf', 'llf']) {
    assert.throws(() => calculate('lighting', { [field]: 0 }), /isi angka/);
  }
  assert.throws(() => calculate('electric', { pf: 0 }), /isi angka/);
  assert.throws(() => calculate('hvac', { a: 0 }), /isi angka/);
});

test('calculator has no persistence or network API and leaves inputs unchanged', () => {
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|supabase|performAppsScriptRequest|sendBeacon)\b/);
  for (const tab of calculator.tabs) {
    const input = Object.freeze(defaults(tab.key));
    const before = JSON.stringify(input);
    calculator.calculate(tab.key, input);
    assert.equal(JSON.stringify(input), before);
  }
});
