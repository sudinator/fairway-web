// Real Chromium, actual worker + actual page policy/responder, two release versions.
const fs = require('fs'), path = require('path'), http = require('http'), ts = require('typescript');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const modules = {};
function bundle(name) {
  if (modules[name]) return;
  const source = ts.transpileModule(fs.readFileSync(path.join(root, name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  modules[name] = source;
  for (const m of source.matchAll(/require\("([^"]+)"\)/g)) {
    assert.ok(m[1].startsWith('.'), 'policy bundle has no substituted dependencies');
    bundle(path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1])));
  }
}
bundle('lib/update-handshake');
let version = '212.79.261101';
const worker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const definitions = Object.entries(modules).map(([id, body]) => `${JSON.stringify(id)}:function(require,module,exports){${body}\n}`).join(',');
const client = `const modules={${definitions}},cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](p=>load(id.slice(0,id.lastIndexOf('/')+1)+p.replace('./','')),m,m.exports);return m.exports;}
window.safety=load('lib/update-safety');load('lib/scoring-device').markScoringDeviceRevoked();
const responder=load('lib/update-handshake').updateHandshake();navigator.serviceWorker.addEventListener('message',responder.receive);
window.changes=0;navigator.serviceWorker.addEventListener('controllerchange',()=>window.changes++);window.safety.reconcileUpdateGames(async()=>null).then(()=>window.ready=true);`;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/sw.js')) { res.setHeader('Content-Type', 'application/javascript'); res.end(worker.replace(/const SW_VERSION = "[^"]+";/, `const SW_VERSION = "${version}";`)); }
  else if (req.url.startsWith('/client.js')) { res.setHeader('Content-Type', 'application/javascript'); res.end(client); }
  else if (req.url.startsWith('/legacy')) { res.setHeader('Content-Type', 'text/html'); res.end('<title>Legacy tab</title>'); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Actual update policy integration</title><script src="/client.js"></script>'); }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const provisioned = fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter(x => x.startsWith('chromium_headless_shell')).map(x => path.join('/opt/pw-browsers', x, 'chrome-linux/headless_shell'))[0] : undefined;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || provisioned, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    const a = await context.newPage(), b = await context.newPage();
    await a.goto(url); await a.waitForFunction(() => window.ready);
    await a.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await a.waitForFunction(() => !!navigator.serviceWorker.controller);
    await b.goto(url); await b.waitForFunction(() => window.ready);
    await a.evaluate(() => { localStorage.setItem('score-proof', '5,4,3'); window.safety.protectUpdateSession('game', 'live', true); });
    const changes = await a.evaluate(() => window.changes);
    version = '212.80.261101';
    await b.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    const askUpdate = () => b.evaluate(async () => {
      for (let n = 0; n < 200; n++) {
        const r = await navigator.serviceWorker.getRegistration();
        if (r?.waiting?.state === 'installed') { r.waiting.postMessage('SKIP_WAITING'); return; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('No installed waiting worker');
    });
    await askUpdate();
    await b.waitForFunction(() => !window.safety.updateInProgress());
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(await b.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), 'active round veto leaves new release waiting');
    assert.equal(await a.evaluate(() => window.changes), changes, 'scoring tab controller unchanged');
    assert.equal(await a.evaluate(() => localStorage.getItem('score-proof')), '5,4,3', 'score backup untouched');
    await a.evaluate(() => window.safety.protectUpdateSession('game', 'live', false));
    // A nonresponding/legacy tab must veto by timeout, never be assumed safe.
    const legacy = await context.newPage(); await legacy.goto(url + '/legacy');
    await askUpdate();
    await new Promise(resolve => setTimeout(resolve, 4400));
    assert.ok(await b.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), 'unresponsive tab prevents activation');
    assert.equal(await b.evaluate(() => window.safety.updateInProgress()), false, 'timeout releases other tabs input');
    await legacy.close();
    await askUpdate();
    await a.waitForFunction(async () => (await caches.keys()).includes('bnn-shell-212.80.261101') && !(await navigator.serviceWorker.getRegistration()).waiting);
    await a.waitForFunction(n => window.changes > n, changes);
    assert.equal(await a.evaluate(() => localStorage.getItem('score-proof')), '5,4,3', 'successful activation preserves scores');
    console.log('safe update browser: PASS (two releases, two tabs, active-round veto, legacy timeout, safe activation, scores preserved)');
    await context.close();
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());
