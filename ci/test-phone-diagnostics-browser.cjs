// Actual browser recorder + worker, local HTTP fixture. No live accounts/data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const ts = require('typescript'), { chromium } = require('playwright');
const { launchUpdateChromium } = require('./playwright-browser.cjs');
const root = path.resolve(__dirname, '..'), modules = {};
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const current = JSON.parse(read('package.json')).version;
let version = current, rejectAssets = false;
function bundle(name) {
  if (modules[name]) return;
  modules[name] = ts.transpileModule(read(name + '.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText.replaceAll('process.env.NEXT_PUBLIC_SUPABASE_URL', '"https://fixture.supabase.co"');
  for (const m of modules[name].matchAll(/require\("([^"]+)"\)/g)) bundle(path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1])));
}
bundle('lib/phone-diagnostics');
const sourceVersion = JSON.parse(read('lib/app-version.ts').match(/APP_VERSION = ("[^"]+")/)[1]);
function client() {
  const defs = Object.entries(modules).map(([name, code]) => `${JSON.stringify(name)}:function(require,module,exports){${code}\n}`).join(',').replaceAll(sourceVersion, version);
  return `const defs={${defs}},cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};defs[id](p=>load(id.slice(0,id.lastIndexOf('/')+1)+p.replace('./','')),m,m.exports);return m.exports;}window.diag=load('lib/phone-diagnostics');window.stopDiagnostics=window.diag.installPhoneDiagnostics();window.ready=true;`;
}
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/sw.js')) { res.setHeader('Content-Type', 'application/javascript'); res.end(read('public/sw.js').replaceAll(current, version)); return; }
  if (req.url === '/client.js' && rejectAssets) { res.statusCode = 503; res.end('unavailable'); return; }
  if (req.url === '/client.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(client()); return; }
  if (req.url.startsWith('/api/test')) { res.statusCode = req.url.includes('fail=1') ? 503 : 200; res.setHeader('x-vercel-id', 'iad1::local-test'); res.setHeader('Content-Type', 'application/json'); res.end('{"private":"PRIVATE_RESPONSE_BODY"}'); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<body data-bnn-app-shell="v1"><title>Diagnostic fixture</title><script src="/client.js"></script>');
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launchUpdateChromium(chromium);
  try {
    const context = await browser.newContext(), page = await context.newPage(); context.setDefaultTimeout(20000);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin); await page.waitForFunction(() => !!window.diag);
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.reload(); await page.waitForFunction(() => !!window.diag && !!navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      localStorage.setItem('bnn_round_draft_v1', 'PRIVATE_PENDING_SCORE');
      const response = await fetch('/api/test?token=PRIVATE_QUERY', { method: 'POST', headers: { Authorization: 'PRIVATE_AUTH' }, body: 'PRIVATE_REQUEST_BODY' });
      if ((await response.json()).private !== 'PRIVATE_RESPONSE_BODY') throw new Error('observer consumed body');
      await fetch('/api/test?fail=1');
      const abort = new AbortController(); abort.abort(); try { await fetch('/api/test', { signal: abort.signal }); } catch { /* caller owns failure */ }
      window.diag.recordPhoneDiagnostic('save.failed', { entityId: '123456' }); window.diag.flushPhoneDiagnostics();
    });
    let report = await page.evaluate(() => window.diag.buildPhoneDiagnosticReport('primary'));
    assert.equal(report.worker.workerVersion, current, 'actual controlling worker answers read-only version query');
    assert.equal(report.device.scoringRole, 'primary'); assert.equal(report.app.origin, origin);
    assert.ok(report.events.some(e => e.event === 'network.result' && e.details.status === 503));
    assert.ok(report.events.some(e => e.event === 'network.failure'));
    assert.ok(report.events.some(e => e.details.requestId === 'iad1::local-test'));
    for (const text of ['PRIVATE_QUERY', 'PRIVATE_AUTH', 'PRIVATE_REQUEST_BODY', 'PRIVATE_RESPONSE_BODY', 'PRIVATE_PENDING_SCORE']) assert.ok(!JSON.stringify(report).includes(text), 'export excludes ' + text);
    version = current.replace(/^(\d+)\.(\d+)\./, (_, major, edit) => `${major}.${Number(edit) + 1}.`);
    await page.reload(); await page.waitForFunction(() => !!window.diag);
    report = await page.evaluate(() => window.diag.buildPhoneDiagnosticReport());
    assert.equal(report.app.version, version, 'new running version reported');
    assert.equal(report.worker.workerVersion, current, 'old controlling worker remains distinguishable from new page');
    assert.ok(report.events.some(e => e.event === 'save.failed' && e.version === current), 'old-version evidence survives fresh document');
    assert.equal(await page.evaluate(() => localStorage.getItem('bnn_round_draft_v1')), 'PRIVATE_PENDING_SCORE');
    rejectAssets = true;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await page.waitForFunction(async () => (await window.diag.buildPhoneDiagnosticReport()).events.some(e => e.event === 'worker.failure' && e.details.status === 503));
    report = await page.evaluate(() => window.diag.buildPhoneDiagnosticReport());
    assert.ok(report.events.some(e => e.event === 'worker.failure' && e.details.phase === 'download'), 'actual worker asset failure reaches support report');
    rejectAssets = false;
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('bnn_phone_diagnostics_v1:')) throw new DOMException('quota', 'QuotaExceededError'); return window.originalSetItem.call(this, key, value); };
      window.diag.recordPhoneDiagnostic('storage.failed'); window.diag.flushPhoneDiagnostics();
    });
    report = await page.evaluate(() => window.diag.buildPhoneDiagnosticReport());
    assert.equal(report.storage.diagnosticsPersistent, false);
    assert.ok(report.events.some(e => e.event === 'storage.failed'), 'memory report works under quota failure');
    assert.equal(await page.evaluate(() => localStorage.getItem('bnn_round_draft_v1')), 'PRIVATE_PENDING_SCORE');
    await context.close();
    console.log('phone diagnostic browser: PASS (actual recorder/worker; HTTP status/correlation, unconsumed bodies, redaction, active-worker/page-version difference, persisted cross-version history, worker asset-failure messages, quota-memory fallback, unchanged drafts)');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
