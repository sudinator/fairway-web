// Actual old/new update modules; modelled network/worker/storage, never a live deployment.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('typescript'), { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..'), version = '212.100.261113', next = '212.101.261113';
let assertions = 0;
const check = (v, label) => { assertions++; assert.ok(v, label); };
function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', source)(name => name === './app-version' ? { APP_VERSION: version } : { recordPhoneDiagnostic() {}, flushPhoneDiagnostics() {} }, module, module.exports);
  return module.exports;
}
function browser() {
  const dom = new JSDOM('<html></html>', { url: 'https://staging.bnn.test/?tab=games' });
  global.window = dom.window; global.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  global.sessionStorage = dom.window.sessionStorage;
  dom.window.localStorage.setItem('bnn_round_draft_v1', 'PRIVATE_DRAFT');
  return dom;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function scenario(file, kind) {
  const dom = browser(), calls = []; let activations = 0, navigations = [];
  const api = load(file);
  if (kind.startsWith('worker')) {
    const events = new dom.window.EventTarget();
    const worker = { state: kind === 'worker-timeout' ? 'installing' : 'installed', addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), postMessage(msg) { activations++; calls.push(['worker', msg]); if (kind !== 'worker-activation-timeout') { this.state = 'activated'; events.dispatchEvent(new dom.window.Event('statechange')); } } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => ({ update: async () => { calls.push(['worker.update']); if (kind === 'worker-error') throw Error('PRIVATE_ERROR'); }, waiting: worker }) } });
  }
  global.fetch = async (url, init) => {
    calls.push(['fetch', url.split('?')[0], init.cache, init.credentials, init.redirect, init.method, init.body]);
    if (kind === 'offline') throw new TypeError('PRIVATE_NETWORK_ERROR');
    if (kind === 'server') return { ok: false, status: 503 };
    if (kind === 'access') return { ok: false, status: 0, type: 'opaqueredirect' };
    return { ok: true, json: async () => ({ version: kind === 'current' ? version : kind === 'invalid' ? 'bad' : next }) };
  };
  await api.requestAppUpdate(15, url => { const u = new URL(url); navigations.push([u.origin, u.pathname, u.searchParams.get('tab'), u.searchParams.get('bnnUpdate'), /^\d+$/.test(u.searchParams.get('bnnUpdateAt'))]); });
  await pause(25);
  const state = api.automaticUpdateState();
  const result = { calls, activations, navigations, latest: state.latest, updating: state.updating, completed: state.completed, failure: state.checkFailure, attempt: sessionStorage.getItem('bnn-update-attempt'), draft: dom.window.localStorage.getItem('bnn_round_draft_v1') };
  dom.window.close(); return { result, outcome: state.outcome };
}
(async () => {
  for (const kind of ['current', 'new', 'offline', 'server', 'access', 'invalid', 'worker-error', 'worker-activate', 'worker-timeout', 'worker-activation-timeout']) {
    const old = await scenario('ci/fixtures/automatic-updates-212100.ts.txt', kind);
    const current = await scenario('lib/automatic-updates.ts', kind);
    assertions++; assert.deepEqual(current.result, old.result, kind + ': request, activation, navigation, retry, score and public-state contracts preserved');
    if (kind === 'worker-error') check(current.outcome?.phase === 'download', 'worker download failure identified');
    if (kind === 'worker-timeout') check(current.outcome?.phase === 'download', 'install timeout identified');
    if (kind === 'worker-activation-timeout') check(current.outcome?.phase === 'activation', 'waiting-worker activation timeout identified separately');
    if (kind === 'new') check(current.outcome?.phase === 'restart' && current.outcome.status === 'failure', 'navigation alone cannot record success');
  }
  let dom = browser(); global.fetch = async () => ({ ok: true, json: async () => ({ version }) });
  sessionStorage.setItem('bnn-update-attempt', version);
  let api = load('lib/automatic-updates.ts'), stop = api.registerAutomaticUpdates(); await pause(5);
  check(api.automaticUpdateState().outcome?.status === 'success', 'actual running version verifies a requested restart');
  api.clearConfirmedUpdateNotice(); check(!api.automaticUpdateState().notice && api.automaticUpdateState().outcome.status === 'success', 'notice expiry preserves result');
  const saved = sessionStorage.getItem('bnn-update-result-v1'); stop();
  api = load('lib/automatic-updates.ts'); stop = api.registerAutomaticUpdates(); await pause(5);
  check(api.automaticUpdateState().outcome?.status === 'success' && !api.automaticUpdateState().notice, 'fresh runtime restores result without replaying banner'); stop();
  for (const raw of ['{bad', 'x'.repeat(2001), JSON.stringify({ status: 'success', target: '<script>', runningVersion: version, phase: 'restart', at: new Date().toISOString() }), JSON.stringify({ status: 'success', target: version, runningVersion: version, phase: 'restart', at: '2000-01-01T00:00:00Z' })]) {
    sessionStorage.setItem('bnn-update-result-v1', raw); api = load('lib/automatic-updates.ts'); stop = api.registerAutomaticUpdates(); await pause(5);
    check(api.automaticUpdateState().outcome === null, 'corrupt/oversize/invalid/expired outcome ignored'); stop();
  }
  sessionStorage.setItem('bnn-update-result-v1', saved); sessionStorage.setItem('bnn-update-attempt', next);
  global.fetch = async () => ({ ok: true, json: async () => ({ version: next }) });
  api = load('lib/automatic-updates.ts'); stop = api.registerAutomaticUpdates(); await pause(5);
  check(api.automaticUpdateState().outcome.status === 'failure' && api.automaticUpdateState().notice.includes('Update did not complete'), 'stale shell replaces previous success with failure'); stop();
  const originalSet = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  global.fetch = async () => { throw TypeError('offline'); };
  await api.requestAppUpdate(15, () => { throw Error('must not navigate'); });
  check(api.automaticUpdateState().outcome.status === 'failure' && !api.automaticUpdateState().updating, 'storage denial preserves in-memory failure and retry');
  dom.window.Storage.prototype.setItem = originalSet;
  check(dom.window.localStorage.getItem('bnn_round_draft_v1') === 'PRIVATE_DRAFT', 'every result/restore/failure path preserves draft');
  dom.window.close();
  console.log(`update outcome: PASS (${assertions} executed old/new contract, restart verification, retained-result, corruption, storage-failure and retry assertions)`);
})().catch(error => { console.error(error); process.exit(1); });
