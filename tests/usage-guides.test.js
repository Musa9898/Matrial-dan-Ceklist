const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/\/\/ ==== USAGE GUIDES START ====([\s\S]*?)\/\/ ==== USAGE GUIDES END ====/)[1];

function createGuideContext() {
  const inserted = [];
  const createElement = (tagName) => ({
    tagName,
    children: [],
    textContent: '',
    append(...nodes) { this.children.push(...nodes); }
  });
  const document = {
    createElement,
    querySelector(selector) {
      const id = selector.match(/^#([\w-]+)/)[1];
      if (!html.includes(`id="${id}"`)) return null;
      return {
        matches: (value) => value === '.section-header' && selector.endsWith('.section-header'),
        after(node) { inserted.push({ selector, node }); }
      };
    }
  };
  const context = vm.createContext({ document });
  vm.runInContext(`${source}\nglobalThis.guides = USAGE_GUIDES;`, context);
  return { context, inserted };
}

test('guides cover every main tab and its input/detail workflows', () => {
  const { context } = createGuideContext();
  const anchors = new Set(context.guides.map((guide) => guide.anchor));
  assert.equal(anchors.size, context.guides.length, 'one guide per location');
  for (const id of [
    'tabViewMaterial', 'tabViewAssets', 'checklistInspectionView', 'testReportView',
    'tabViewSuratJalan', 'tabViewFiles', 'tabViewKurvaS',
    'modalInput', 'modalIssue', 'modalDetail', 'modalAssetForm', 'modalAssetDetail',
    'modalChecklist', 'modalChecklistDetail', 'modalDailyWorkForm', 'modalDailyWorkDetail',
    'modalTestReport', 'modalTestReportDetail', 'modalTestDocSettings',
    'modalKurvaImport', 'modalKurvaProgress', 'modalProjectFolder',
    'modalConfirmFileDelete', 'modalProjectManager', 'modalSettings',
    'modalNetworkInfo', 'modalBugReport', 'modalBugReportList', 'mep-calc-dialog'
  ]) {
    assert.ok([...anchors].some((anchor) => anchor.startsWith(`#${id} `)), id);
  }
  assert.ok(anchors.has('#pdfExportSubtitle'));
  for (const guide of context.guides) {
    assert.ok(guide.title.length > 0);
    assert.ok(guide.sections.length > 0);
    for (const [heading, steps] of guide.sections) {
      assert.ok(heading.length > 0);
      assert.ok(steps.length >= 2);
      assert.ok(steps.every((step) => typeof step === 'string' && step.length > 20));
    }
  }
});

test('guides render collapsed native details with readable headings and numbered steps', () => {
  const { context, inserted } = createGuideContext();
  context.initializeUsageGuides();
  assert.equal(inserted.length, context.guides.length);
  for (const { node } of inserted) {
    assert.equal(node.tagName, 'details');
    assert.equal(node.open, undefined, 'no automatically expanded guide');
    assert.equal(node.className, 'file-upload-guide usage-guide');
    const [summary, body] = node.children;
    assert.equal(summary.tagName, 'summary');
    assert.match(summary.textContent, /^Petunjuk Penggunaan/);
    assert.equal(body.className, 'file-upload-guide-body');
    for (const section of body.children.filter((child) => child.tagName === 'section')) {
      assert.equal(section.children[0].tagName, 'h5');
      assert.equal(section.children[1].tagName, 'ol');
      assert.ok(section.children[1].children.every((child) => child.tagName === 'li' && child.textContent));
    }
  }
  assert.equal(inserted.filter(({ node }) => node.children[1].children.some((child) => child.tagName === 'p')).length, 7);
});

test('missing guide location is reported explicitly', () => {
  const { context } = createGuideContext();
  context.document.querySelector = () => null;
  assert.throws(() => context.initializeUsageGuides(), /Lokasi panduan tidak ditemukan/);
});

test('guidance distinguishes daily PDF selection, pipe methods and data persistence', () => {
  assert.match(source, /Laporan lain, termasuk pada tanggal sama, tidak ikut dicetak/);
  assert.match(source, /Tes Glontor[\s\S]*Tes Rendam[\s\S]*tanpa tekanan/);
  assert.match(source, /Reset Default[\s\S]*Tekan Simpan/);
  assert.match(source, /Export tidak otomatis mengunggah PDF/);
  assert.match(source, /Input kalkulator hanya di memori halaman/);
  assert.ok(html.includes('id="fileUploadGuide"'), 'original detailed upload guide remains');
});

test('Kurva S guide documents actual import structure without promising untested capacity', () => {
  const { context } = createGuideContext();
  const guide = context.guides.find((entry) => entry.anchor === '#tabViewKurvaS > .section-header');
  const text = JSON.stringify(guide.sections);
  for (const requirement of [
    /\.xlsx/, /Bobot \(%\)/, /minimal 3 minggu/, /maksimal 5 baris/,
    /bobot angka lebih dari 0/, /kolom tepat di kanan/,
    /membagi bobot item merata/, /pembacaan item berhenti/,
    /sheet pertama/, /52 kolom mingguan/, /belum ada batas maksimum/i,
    /200 MB.*bukan batas Import Kurva S/, /Belum ada angka maksimum kapasitas aman/
  ]) {
    assert.match(text, requirement);
  }
  const importGuide = context.guides.find((entry) => entry.anchor === '#modalKurvaImport h3');
  assert.match(JSON.stringify(importGuide.sections), /minimal 3 minggu/);
  assert.match(JSON.stringify(importGuide.sections), /Batas 200 MB tab File tidak berlaku/);
});

test('Kurva S capacity warnings use strict thresholds independently', () => {
  const warningSource = html.match(/\/\/ ==== KURVA IMPORT WARNINGS START ====([\s\S]*?)\/\/ ==== KURVA IMPORT WARNINGS END ====/)[1];
  const context = vm.createContext({ escapeHtml: (value) => String(value) });
  vm.runInContext(warningSource, context);
  const { getKurvaImportWarnings: warnings, renderKurvaImportWarnings: render } = context;
  assert.equal(warnings(20 * 1024 * 1024, 200, 100).length, 0);
  assert.equal(warnings(20 * 1024 * 1024 + 1, 0, 0).length, 1);
  assert.equal(warnings(0, 201, 0).length, 1);
  assert.equal(warnings(0, 0, 101).length, 1);
  assert.equal(warnings(50 * 1024 * 1024, 201, 101).length, 3);
  assert.equal(render([]), '');
  assert.match(render(warnings(0, 201, 101)), /Import tetap dapat dilanjutkan/);
  assert.match(render(warnings(0, 201, 101)), /201 item/);
  assert.match(render(warnings(0, 201, 101)), /101 minggu/);
  assert.doesNotMatch(html, /Ukuran file maksimal 10 MB/);
});
