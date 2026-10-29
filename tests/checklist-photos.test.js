const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('    async function appendChecklistDetailPhotos(');
const source = html.slice(start, html.indexOf('    function exportSelectedChecklistPdf()', start));

test('saved checklist uses the shared camera/gallery picker and clears capture for gallery', () => {
  assert.match(html, /id="checklistDetailPhotoInput"[^>]*data-photo-picker[^>]*onchange="appendChecklistDetailPhotos\(this\)"/);
  const attributes = {};
  let clicked = 0;
  const input = {
    disabled: false, dataset: {},
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: (name) => { delete attributes[name]; },
    click: () => { clicked += 1; }
  };
  const context = vm.createContext({});
  const pickerStart = html.indexOf('    function openPhotoPicker(');
  vm.runInContext(html.slice(pickerStart, html.indexOf('    const cameraPhotoFiles', pickerStart)), context);
  context.openPhotoPicker(input, true);
  assert.equal(attributes.capture, 'environment');
  assert.equal(input.dataset.source, 'camera');
  context.openPhotoPicker(input, false);
  assert.equal(attributes.capture, undefined);
  assert.equal(input.dataset.source, 'file');
  assert.equal(clicked, 2);
  input.disabled = true;
  context.openPhotoPicker(input, true);
  assert.equal(clicked, 2);
});

function fixture(options = {}) {
  const item = { id: 'inspection', work: 'Pipa', supervisor: 'Musa', status: 'Belum', progress: 0,
    note: 'Catatan lama', statusHistory: [], photos: ['old.jpg'], ...options.item };
  const input = { files: [{ name: 'new.jpg' }, { name: 'second.jpg' }], value: 'files', disabled: false };
  const statuses = [];
  const notices = [];
  let saves = 0;
  const context = vm.createContext({
    checklistItems: [item], selectedChecklistDetailId: item.id, activeProjectId: 'project',
    checklistDetailPhotoSaving: false, requireAccess: () => options.allowed !== false,
    readChecklistPhoto: async (file, watermark) => {
      assert.equal(watermark, 'watermark');
      if (options.read) return options.read(file, context);
      return `processed:${file.name}`;
    },
    buildPhotoWatermark: () => 'watermark', getChecklistArea: () => 'Lantai 1',
    persistChecklistItems: async () => { saves += 1; return options.success !== false; },
    setPhotoUploadStatus: (...args) => statuses.push(args),
    showAppNotice: (message) => notices.push(message),
    renderChecklistCards() {}, renderChecklistDetailPhotos() {}
  });
  vm.runInContext(source, context);
  return { context, item, input, statuses, notices, saves: () => saves };
}

test('adding photos appends without changing checklist status, history, notes or existing photos', async () => {
  const f = fixture();
  const before = JSON.parse(JSON.stringify(f.item));
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.deepEqual(Array.from(f.item.photos), ['old.jpg', 'processed:new.jpg', 'processed:second.jpg']);
  const { photos, ...rest } = f.item;
  const { photos: oldPhotos, ...original } = before;
  assert.deepEqual(rest, original);
  assert.equal(f.saves(), 1);
  assert.equal(f.input.value, '');
  assert.equal(f.input.disabled, false);
  assert.equal(f.context.checklistDetailPhotoSaving, false);
  assert.equal(f.statuses.at(-1)[1], 'success');
});

test('legacy single photo is retained and successful result survives JSON persistence', async () => {
  const f = fixture({ item: { photos: undefined, photo: 'legacy.jpg' } });
  await f.context.appendChecklistDetailPhotos(f.input);
  const saved = JSON.parse(JSON.stringify(f.item));
  assert.deepEqual(saved.photos, ['legacy.jpg', 'processed:new.jpg', 'processed:second.jpg']);
});

test('permission denial and empty selection do not read or save photos', async () => {
  const f = fixture({ allowed: false, read: assert.fail });
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.equal(f.saves(), 0);
  assert.deepEqual(f.item.photos, ['old.jpg']);
  f.input.files = [];
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.equal(f.saves(), 0);
});

test('failed save restores exact previous photos and reports error', async () => {
  const f = fixture({ success: false });
  const previous = f.item.photos;
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.equal(f.item.photos, previous);
  assert.equal(f.input.disabled, false);
  assert.match(f.notices[0], /gagal disimpan/);
  assert.equal(f.statuses.at(-1)[1], 'error');
});

test('bad image leaves old documentation intact, with no partial save', async () => {
  const f = fixture({ read: async (file) => {
    if (file.name === 'second.jpg') throw new Error('Foto tidak dapat dibaca.');
    return 'processed';
  } });
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.deepEqual(f.item.photos, ['old.jpg']);
  assert.equal(f.saves(), 0);
  assert.match(f.notices[0], /tidak dapat dibaca/);
  assert.equal(f.input.disabled, false);
});

test('switching projects while processing never attaches photos to another project', async () => {
  const f = fixture({ read: async (file, context) => {
    context.activeProjectId = 'other';
    return 'processed';
  } });
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.deepEqual(f.item.photos, ['old.jpg']);
  assert.equal(f.saves(), 0);
  assert.match(f.notices[0], /Data proyek berubah/);
});

test('duplicate upload is blocked while processing is in progress', async () => {
  let finish;
  const f = fixture({ read: () => new Promise((resolve) => { finish = resolve; }) });
  f.input.files = [{ name: 'new.jpg' }];
  const pending = f.context.appendChecklistDetailPhotos(f.input);
  await f.context.appendChecklistDetailPhotos(f.input);
  assert.equal(f.saves(), 0);
  finish('processed');
  await pending;
  assert.equal(f.saves(), 1);
  assert.deepEqual(Array.from(f.item.photos), ['old.jpg', 'processed']);
});
