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
    const cable = calculator.cables.find(c => c.size === v.cable);
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

test('cable table covers requested sizes and breaker warns when coordination is unsafe', () => {
  assert.deepEqual(Array.from(calculator.cables, c => c.size), [2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150]);
  assert.ok(calculator.cables.every(c => c.r > 0 && c.x > 0 && c.kha > 0));
  const small = calculate('electric', { kw: 50, cable: 2.5 });
  assert.equal(item(small, 'KHA kabel minimum (1,25 × In)').level, 'danger');
  assert.equal(item(small, 'Rating breaker (>1,2 × In)').level, 'danger');
  const huge = calculate('electric', { kw: 1000 });
  assert.equal(item(huge, 'Rating breaker (>1,2 × In)').value, 'Di atas rentang tabel');
  const current20 = 20 * Math.sqrt(3) * 380 * 0.85 / 1000;
  assert.equal(item(calculate('electric', { kw: current20 }), 'Rating breaker (>1,2 × In)').value, 25);
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
  near(item(results, 'Kecepatan aliran air').value, q / (Math.PI * 0.05 ** 2 / 4));
  near(item(results, 'Head loss gesek').value, hf);
  near(item(results, 'Head loss + fitting 20%').value, hf * 1.2);
  near(item(results, 'Total head pompa', 'mka').value, head);
  near(item(results, 'Total head pompa', 'bar').value, head * 0.0981);
  const kw = 1000 * 9.81 * q * head / (1000 * 0.65);
  near(item(results, 'Daya motor pompa (η 65%)').value, kw);
  near(item(results, 'Daya motor pompa').value, kw / 0.746);
  near(item(results, 'Debit air hujan atap').value, 15);
  assert.equal(item(results, 'Roof drain / pipa tegak 4 inci').value, 2);
  const steel = calculate('water', { c: 100 });
  assert.ok(item(steel, 'Head loss gesek').value > hf);
});

test('water velocity badges cover safe, tolerance and risk', () => {
  for (const [velocity, level] of [[2, 'safe'], [2.001, 'warn'], [2.5, 'warn'], [2.501, 'danger']]) {
    const flow = velocity * (Math.PI * 0.05 ** 2 / 4) * 1000;
    assert.equal(item(calculate('water', { flow }), 'Kecepatan aliran air').level, level);
  }
});

test('HVAC calculates load, ventilation, sensible heat, equivalent diameter and velocity', () => {
  const results = calculate('hvac');
  near(item(results, 'Kapasitas pendinginan').value, 60000);
  near(item(results, 'Ton refrigerasi').value, 5);
  near(item(results, 'Ukuran AC pendekatan').value, 60000 / 9000);
  near(item(results, 'Debit air dingin chiller').value, 12);
  near(item(results, 'Udara ventilasi', 'CMH').value, 1800);
  near(item(results, 'Udara ventilasi', 'CFM').value, 1800 / 1.699);
  near(item(results, 'Beban panas sensibel Qs').value, 1.08 * 1800 / 1.699 * 18);
  near(item(results, 'Diameter ekivalen duct bulat').value, 1.3 * (500 * 300) ** 0.625 / 800 ** 0.25);
  near(item(results, 'Kecepatan udara duct').value, 0.5 / 0.15);
});

test('duct velocity badges cover 5.5 and 8.5 m/s bands', () => {
  for (const [velocity, level] of [[5.499, 'safe'], [5.501, 'warn'], [8.499, 'warn'], [8.501, 'danger']]) {
    assert.equal(item(calculate('hvac', { volume: velocity * 0.15 * 3600 / 6 }), 'Kecepatan udara duct').level, level);
  }
});

test('lumen method rounds fixtures up and uses installed power for density', () => {
  const results = calculate('lighting');
  near(item(results, 'Fluks per armatur').value, 2000);
  assert.equal(item(results, 'Jumlah titik lampu ideal').value, 37);
  near(item(results, 'Total daya penerangan').value, 740);
  near(item(results, 'Densitas daya').value, 7.4);
  assert.equal(item(results, 'Densitas daya').level, 'safe');
  const boundary = calculate('lighting', { area: 10, lux: 100, watt: 100, efficacy: 100, uf: 1, llf: 1 });
  assert.equal(item(boundary, 'Densitas daya').value, 10);
  assert.equal(item(boundary, 'Densitas daya').level, 'safe');
  assert.equal(item(calculate('lighting', { area: 1, watt: 20 }), 'Densitas daya').level, 'danger');
});

test('fire estimates round sprinklers and return explicitly non-certified ranges and tank volume', () => {
  for (const coverage of [12, 9, 6]) {
    assert.equal(item(calculate('fire', { coverage }), 'Jumlah kepala sprinkler').value, Math.ceil(1000 / coverage));
  }
  const results = calculate('fire');
  assert.equal(item(results, 'Debit sprinkler · 6 titik × 20').value, 120);
  assert.equal(item(results, 'Debit sprinkler · 12 titik × 20').value, 240);
  assert.equal(item(results, 'Jockey pump · 5% main').value, 25);
  assert.equal(item(results, 'Jockey pump · 10% main').value, 50);
  near(item(results, 'Fire reserve tank · main pump saja').value, 85.1625);
  assert.ok(results.every(result => result.level === 'warn'));
});

test('utility calculates power, tanks, daily water and gravity slopes', () => {
  const results = calculate('utility');
  near(item(results, 'Beban puncak listrik').value, 375);
  for (const label of ['Kapasitas minimum trafo', 'Kapasitas minimum genset']) {
    near(item(results, label).value, 375 / (0.85 * 0.8));
  }
  near(item(results, 'Kebutuhan air bersih harian Qd').value, 10);
  near(item(results, 'Ground Water Tank (GWT)').value, 10);
  near(item(results, 'Roof tank · 30% Qd').value, 3);
  near(item(results, 'Turunan pipa ≥4 inci · slope 1%').value, 0.2);
  near(item(results, 'Turunan pipa ≤3 inci · slope 2%').value, 0.4);
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
