const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const summary = () => ({
  tab: 'electric', title: 'Listrik', assumptions: 'Cu/PVC 70 C; estimasi.',
  inputs: [{ label: 'Daya (kW)', value: '10' }],
  results: [{ label: 'Arus (A)', value: '17,875' }]
});
function backend({ key = 'server-test-key', model = null, status = 200, body, transportError = false } = {}) {
  const calls = [];
  const cache = new Map();
  const normal = {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: 'Private thinking', thought: true }, { text: 'Analisis estimasi [1].' }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { title: 'Referensi', uri: 'https://example.com/reference' } },
          { web: { title: 'Unsafe', uri: 'javascript:alert(1)' } }
        ],
        groundingSupports: [{ segment: { text: 'Analisis estimasi' }, groundingChunkIndices: [0, 1, 7] }]
      }
    }]
  };
  const context = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => name === 'GEMINI_API_KEY' ? key : name === 'GEMINI_MODEL' ? model : null }) },
    CacheService: { getScriptCache: () => ({
      get: name => cache.get(name), put: (name, value) => cache.set(name, value)
    }) },
    LockService: { getScriptLock: () => ({
      hasLock: () => false, tryLock: () => { throw new Error('AI must not lock spreadsheet writes'); }
    }) },
    UrlFetchApp: { fetch: (url, options) => {
      calls.push({ url, options });
      if (transportError) throw new Error(url + ' transport failed');
      return { getResponseCode: () => status, getContentText: () => body === undefined ? JSON.stringify(normal) : body };
    } }
  });
  vm.runInContext(source, context);
  context.verifyGoogleIdToken_ = () => ({ email: 'user@example.test' });
  context.getAuthorizedProjects_ = () => [{ projectId: 'project-a' }];
  context.jsonOutput_ = value => value;
  context.bumpDataVersion_ = () => { throw new Error('AI must not invalidate cache'); };
  context.queueSupabaseSync_ = () => { throw new Error('AI must not enqueue mirror'); };
  const request = (overrides = {}) => context.doPost({ postData: { contents: JSON.stringify({
    action: 'askGeminiMEP', projectId: 'project-a', idToken: 'token', summary: summary(), question: '', ...overrides
  }) } });
  return { request, calls, context, cache };
}

test('authenticated Gemini action uses server key, search grounding and returns safe sources/citations', () => {
  const { request, calls } = backend();
  const response = request();
  assert.equal(response.status, 'success');
  assert.equal(response.text, 'Analisis estimasi [1].');
  assert.equal(response.sources.length, 1);
  assert.equal(response.sources[0].index, 1);
  assert.deepEqual(Array.from(response.citations[0].sourceIndexes), [1]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=server-test-key$/);
  assert.equal(calls[0].options.method, 'post');
  assert.equal(calls[0].options.contentType, 'application/json');
  assert.equal(calls[0].options.muteHttpExceptions, true);
  const payload = JSON.parse(calls[0].options.payload);
  assert.deepEqual(payload.tools, [{ google_search: {} }]);
  assert.match(payload.systemInstruction.parts[0].text, /Senior MEP Engineer Indonesia/);
  assert.equal(JSON.parse(payload.contents[0].parts[0].text).summary.tab, 'electric');
  assert.doesNotMatch(JSON.stringify(response), /server-test-key|user@example/);
});

test('404 identifies model/version and preserves safe upstream status without leaking raw details', () => {
  const { request, calls } = backend({ status: 404, body: JSON.stringify({
    error: { code: 404, status: 'NOT_FOUND', message: 'secret server-test-key https://private.example/resource' }
  }) });
  const result = request();
  assert.equal(result.status, 'error');
  assert.match(result.message, /HTTP 404 \(NOT_FOUND\)/);
  assert.match(result.message, /gemini-2\.5-flash/);
  assert.match(result.message, /ListModels/);
  assert.doesNotMatch(result.message, /server-test-key|private\.example|secret/);
  assert.equal(calls.length, 1);
});

test('HTTP errors with malformed or unexpected bodies stay explicit without trusting arbitrary status text', () => {
  for (const body of ['not JSON server-test-key', 'null', JSON.stringify({ error: { status: 'secret-server-test-key' } })]) {
    const { request } = backend({ status: 404, body });
    const result = request();
    assert.equal(result.status, 'error');
    assert.match(result.message, /HTTP 404/);
    assert.doesNotMatch(result.message, /server-test-key/);
  }
  for (const [status, expected] of [[400, /request ditolak/], [401, /autentikasi ditolak/], [403, /izin ditolak/], [429, /kuota\/rate limit/], [503, /gangguan/]]) {
    const { request } = backend({ status, body: JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }) });
    assert.match(request().message, expected);
  }
});

test('GEMINI_MODEL script property overrides the default model and invalid names are rejected', () => {
  const custom = backend({ model: 'gemini-3.8-flash-lite' });
  assert.equal(custom.request().status, 'success');
  assert.match(custom.calls[0].url, /\/models\/gemini-3\.8-flash-lite:generateContent\?/);

  const limited = backend({ model: 'gemini-3.8-flash-lite', status: 429, body: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }) });
  assert.match(limited.request().message, /gemini-3\.8-flash-lite.*GEMINI_MODEL/);

  for (const bad of ['../secret', 'Gemini Flash', 'model?key=x']) {
    const invalid = backend({ model: bad });
    const result = invalid.request();
    assert.equal(result.status, 'error');
    assert.match(result.message, /GEMINI_MODEL/);
    assert.equal(invalid.calls.length, 0);
  }
});

test('missing API key is explicit and makes no Gemini request', () => {
  const { request, calls } = backend({ key: '' });
  const result = request();
  assert.equal(result.status, 'error');
  assert.match(result.message, /GEMINI_API_KEY/);
  assert.equal(calls.length, 0);
});

test('unauthenticated and unauthorized requests never call Gemini', () => {
  const first = backend();
  first.context.verifyGoogleIdToken_ = () => { throw new Error('Token invalid'); };
  assert.equal(first.request().status, 'error');
  assert.equal(first.calls.length, 0);
  const second = backend();
  assert.match(second.request({ projectId: 'not-allowed' }).message, /akses/);
  assert.equal(second.calls.length, 0);
});

test('invalid and oversized summaries/questions fail before Gemini billing', () => {
  for (const overrides of [
    { summary: null }, { summary: { ...summary(), tab: 'unknown' } },
    { summary: { ...summary(), inputs: [] } },
    { summary: { ...summary(), inputs: [{ label: 'kW', value: 10 }] } },
    { summary: { ...summary(), assumptions: 'a'.repeat(3001) } },
    { summary: { ...summary(), results: [{ label: 'x', value: 'a'.repeat(601) }] } },
    { question: 'x'.repeat(1501) }, { question: {} }
  ]) {
    const { request, calls } = backend();
    assert.equal(request(overrides).status, 'error');
    assert.equal(calls.length, 0);
  }
});

test('quota, key errors, upstream failures, malformed JSON and blocked/empty content are explicit', () => {
  for (const options of [
    { status: 429 }, { status: 403 }, { status: 500 }, { transportError: true },
    { body: 'not json' }, { body: JSON.stringify({ candidates: [] }) },
    { body: JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }) },
    { body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }) }
  ]) {
    const { request } = backend(options);
    const result = request();
    assert.equal(result.status, 'error');
    assert.ok(result.message);
    assert.doesNotMatch(result.message, /server-test-key|generativelanguage/);
  }
});

test('ungrounded and truncated answers are reported honestly and cooldown prevents repeats', () => {
  const { request, calls } = backend({ body: JSON.stringify({ candidates: [{
    finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Partial response' }] }
  }] }) });
  const result = request();
  assert.equal(result.status, 'success');
  assert.equal(result.truncated, true);
  assert.equal(result.sources.length, 0);
  assert.equal(result.citations.length, 0);
  assert.match(request().message, /15 detik/);
  assert.equal(calls.length, 1);
});

test('AI transport does not use Supabase, sync overlay, or retry after uncertain billed requests', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('    async function performAppsScriptRequest(');
  const end = html.indexOf('    function describeAppsScriptError(', start);
  const calls = [];
  const context = vm.createContext({
    currentGoogleCredential: 'test-token', navigator: { onLine: true }, appsScriptPreferBridge: false,
    getAppsScriptTimeout: () => 25000,
    getSupabaseConfig: () => { throw new Error('AI must not use Supabase'); },
    setAppsScriptStatus: () => { throw new Error('AI must not alter sync status'); },
    appsScriptFetch: async (request, timeout, onSlow, method) => {
      calls.push({ request, timeout, onSlow, method });
      throw Object.assign(new Error('Uncertain network result'), { code: 'network' });
    },
    appsScriptBridgeRequest: async () => { throw new Error('Billed AI request must not fallback'); }
  });
  vm.runInContext(html.slice(start, end), context);
  await assert.rejects(context.performAppsScriptRequest('askGeminiMEP', { projectId: 'project-a', summary: summary() }), /Uncertain network/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeout, 90000);
  assert.equal(calls[0].onSlow, null);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].request.idToken, 'test-token');
  assert.equal(calls[0].request.action, 'askGeminiMEP');
  assert.equal(calls[0].request.mutationId, undefined);
});
