// EXECUTED browser + actual workers/update module; MODELLED deployment gateway.
// Never points at a live database or embeds a deployment bypass credential.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium, webkit } = require('playwright');
const { launchUpdateChromium } = require('./playwright-browser.cjs');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const current = read('public/sw.js');
const workers = {
  legacy: read('ci/fixtures/sw-manual-21283.js'),
  regression21284: read('ci/fixtures/sw-redirect-regression-21284.js'),
  regression21298: read('ci/fixtures/sw-redirect-regression-21298.js'),
  previous21299: read("ci/fixtures/sw-diagnostics-baseline-21299.js"),
  current,
};
const engine = process.env.BNN_UPDATE_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine), 'unsupported browser must fail, never skip');
const oldVersion = '212.98.261110', previousVersion = '212.99.261112';
const candidate = JSON.parse(read('package.json')).version;
const afterCandidate = candidate.replace(/^(\d+)\.(\d+)\./, (_, major, edit) => `${major}.${Number(edit) + 1}.`);
const modules = {};
function bundle(name) {
  if (modules[name]) return;
  modules[name] = ts.transpileModule(read(name + '.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const match of modules[name].matchAll(/require\("([^"]+)"\)/g)) { assert.ok(match[1].startsWith('.')); bundle(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]))); }
}
bundle('lib/automatic-updates');
const legacyModules = { ...modules, 'lib/automatic-updates': ts.transpileModule(read('ci/fixtures/automatic-updates-21299.ts.txt'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText };
const builtVersion = JSON.parse(read('lib/app-version.ts').match(/APP_VERSION = ("[^"]+")/)[1]);
function clientSource(v) {
  const defs = Object.entries(v === oldVersion || v === previousVersion ? legacyModules : modules).map(([name, source]) => `${JSON.stringify(name)}:function(require,module,exports){${source}\n}`).join(',').replaceAll(builtVersion, v);
  return `const definitions={${defs}},cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};definitions[id](p=>load(id.slice(0,id.lastIndexOf('/')+1)+p.replace('./','')),m,m.exports);return m.exports;}window.updates=load('lib/automatic-updates');window.loadedVersion=${JSON.stringify(v)};window.stopUpdates=window.updates.registerAutomaticUpdates();`;
}
const recoverySource = ts.transpileModule(read('app/auth/deployment-access/route.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const recovery = { exports: {} };
new Function('exports', recoverySource)(recovery.exports);
const drafts = {
  bnn_round_draft_v1: '{"round":{"status":"in_progress","holes":[{"strokes":5}]}}',
  bnn_game_scores_fixture: '{"scores":[5,6],"putts":[2,3],"fairways":[true,false]}',
  'bnn:altshot-side-drafts:fixture': '[{"strokes":4}]',
  'bnn_verified_score_recovery:fixture': '{"scores":[7]}',
};
let mode = 'matrix', variant = 'current', status = 302, crossOrigin = false;
let origin, identityOrigin, version = oldVersion, protectedAccess = false, metadataFailure = false;
let loginHits = 0, callbackHits = 0, recoveryHits = 0, appHits = 0;
let disconnect = false, droppedConnections = 0;
const html = (res, body) => { res.setHeader('Content-Type', 'text/html'); res.end(body); };
const identity = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  loginHits++;
  html(res, `<title>Deployment sign-in</title><a id="authorize" href="${origin}/deployment-callback">Sign in</a>`);
});
const app = http.createServer((req, res) => {
  if (disconnect) { droppedConnections++; req.socket.destroy(); return; }
  res.setHeader('Cache-Control', 'no-store');
  const pathname = new URL(req.url, 'http://fixture.test').pathname;
  if (mode === 'matrix') {
    if (pathname === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(workers[variant]); return; }
    if (req.url.startsWith('/?reauth=')) {
      appHits++; res.writeHead(status, { Location: crossOrigin ? `${identityOrigin}/login` : '/deployment-login' }); res.end(); return;
    }
    if (pathname === '/deployment-login') { loginHits++; html(res, '<title>Deployment sign-in</title>Sign in'); return; }
    html(res, '<body data-bnn-app-shell="v1"><title>BNN saved app</title>Saved app<a id="reopen" href="/">Reopen</a>'); return;
  }
  // Model the gateway's callback BEFORE the application access gate. It sets
  // an HTTP-only cookie and redirects on a path NOT excluded by the worker.
  if (pathname === '/deployment-callback') {
    callbackHits++;
    res.writeHead(303, { 'Set-Cookie': 'bnn-test-access=ok; Path=/; HttpOnly; SameSite=Lax', Location: '/auth/deployment-access' });
    res.end(); return;
  }
  if (protectedAccess && !String(req.headers.cookie || '').includes('bnn-test-access=ok')) {
    res.writeHead(302, { Location: `${identityOrigin}/login` }); res.end(); return;
  }
  if (pathname === '/auth/deployment-access') {
    recoveryHits++;
    const response = recovery.exports.GET(); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(); return;
  }
  if (pathname === '/sw.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end((version === oldVersion ? workers.regression21298 : version === previousVersion ? workers.previous21299 : current).replace(/const SW_VERSION = "[^"]+";/, `const SW_VERSION = "${version}";`)); return;
  }
  if (pathname === '/app-version.json') {
    res.setHeader('Content-Type', 'application/json');
    if (metadataFailure) { res.statusCode = 503; res.end('{"error":"temporary"}'); return; }
    res.end(JSON.stringify({ version })); return;
  }
  if (pathname.startsWith('/client-')) {
    const pageVersion = pathname.slice('/client-'.length, -'.js'.length);
    res.setHeader('Content-Type', 'application/javascript');
    res.end(clientSource(pageVersion)); return;
  }
  html(res, `<body data-bnn-app-shell="v1"><title>BNN ${version}</title><input id="score"><a id="reconnect" href="/auth/deployment-access">Reconnect</a><button id="update" onclick="void window.updates.requestAppUpdate()">Update</button><script src="/client-${version}.js"></script>`);
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
async function assertDrafts(page, label) {
  assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(drafts)), drafts, label);
}
async function matrix(browser) {
  let cases = 0;
  for (const external of [false, true]) for (const code of [301, 302, 303, 307, 308]) for (const name of ['none', ...Object.keys(workers)]) {
    crossOrigin = external; status = code; variant = name; appHits = loginHits = 0;
    const context = await browser.newContext(); context.setDefaultTimeout(20000);
    try {
      const page = await context.newPage(); await page.goto(origin);
      if (name !== 'none') {
        await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
        await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await page.waitForFunction(async () => !!await caches.match('/'));
      }
      await page.evaluate(data => { for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value); }, drafts);
      await page.goto(`${origin}/?reauth=${cases}`);
      const shouldFollow = ['none', 'legacy', 'previous21299', 'current'].includes(name);
      assert.equal(await page.title(), shouldFollow ? 'Deployment sign-in' : 'BNN saved app', `${name}/${code}/${external}: observable redirect outcome`);
      assert.equal(loginHits, shouldFollow ? 1 : 0, 'redirect reaches login exactly once, never a loop');
      assert.equal(appHits, 1, 'real network redirect was requested');
      // Use another page in the SAME storage context to inspect cross-origin
      // navigation's app data, then prove an offline reopen still has app HTML.
      const inspect = await context.newPage(); await inspect.goto(`${origin}/inspect`); await assertDrafts(inspect, 'redirect preserves every draft type');
      if (name === 'current') {
        const poisoned = await inspect.evaluate(async () => { for (const key of await caches.keys()) { const cache = await caches.open(key); for (const request of await cache.keys()) { if ((await (await cache.match(request)).text()).includes('Deployment sign-in')) return true; } } return false; });
        assert.equal(poisoned, false, 'no sign-in HTML is cached as an app shell');
        await inspect.waitForFunction(() => !!navigator.serviceWorker.controller);
        await inspect.locator('#reopen').evaluate((node, next) => { node.href = next; }, `${origin}/?offline=${cases}`);
        // Fault the network at the server socket rather than relying on
        // WebKit's offline-navigation emulation (which raises an internal
        // browser error before an observable page result). Both engines use
        // the identical network failure and retain every outcome assertion.
        disconnect = true; droppedConnections = 0;
        await Promise.all([inspect.waitForNavigation({ waitUntil: 'domcontentloaded' }), inspect.locator('#reopen').click()]);
        assert.equal(await inspect.title(), 'BNN saved app', 'offline scoring shell still works after sign-in redirect');
        assert.ok(droppedConnections > 0, 'fallback follows an actual failed network request');
        await assertDrafts(inspect, 'offline reopen preserves drafts');
        disconnect = false;
      }
      cases++;
    } finally { disconnect = false; await context.close(); }
  }
  console.log(`redirect matrix: PASS (${engine}, ${cases} historical/current/control cases, 301/302/303/307/308, same/cross origin, login once, draft preservation, offline/cache safety)`);
}
async function lifecycle(browser, baseline = oldVersion) {
  mode = 'lifecycle'; version = baseline; protectedAccess = false;
  const context = await browser.newContext(); context.setDefaultTimeout(25000);
  try {
    const page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => !!window.updates);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.updates);
    await page.evaluate(data => { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v); document.querySelector('#score').value = '7'; }, drafts);
    version = candidate;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); await window.updates.checkAutomaticVersion(); });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    assert.equal(await page.evaluate(() => window.loadedVersion), baseline, 'baseline document remains until explicit update');
    assert.equal(await page.inputValue('#score'), '7', 'background download preserves active entry');
    await page.click('#update');
    await page.waitForFunction(v => window.loadedVersion === v && window.updates.automaticUpdateState().notice.includes('Updated successfully'), candidate);
    await assertDrafts(page, '212.98 to candidate upgrade keeps same installation data');
    // Renew access in the same context: ordinary Home navigation, cross-origin
    // login, non-/auth/ callback, actual recovery route, successful retry.
    protectedAccess = true;
    await page.evaluate(() => { document.querySelector('#score').value = '8'; return window.updates.checkAutomaticVersion(); });
    assert.equal(await page.evaluate(() => window.updates.automaticUpdateState().checkFailure), 'access', 'denied check is diagnosed');
    assert.equal(await page.inputValue('#score'), '8', 'failed background check never reloads active entry');
    assert.equal(await page.evaluate(() => location.origin), origin, 'failed check never navigates to login');
    loginHits = callbackHits = recoveryHits = 0;
    await page.reload(); await page.waitForURL(`${identityOrigin}/login`);
    assert.equal(loginHits, 1, 'expired access reaches login once instead of old shell');
    await page.click('#authorize'); await page.waitForFunction(v => window.loadedVersion === v && !!window.updates, candidate);
    await page.evaluate(() => window.updates.checkAutomaticVersion());
    assert.equal(await page.evaluate(() => window.updates.automaticUpdateState().checkFailure), '', 'same-installation authentication renewal clears failure');
    assert.equal(callbackHits, 1, 'non-excluded callback runs once'); assert.equal(recoveryHits, 1, 'actual recovery route runs after access grant');
    await assertDrafts(page, 'authentication round trip preserves all drafts');
    // Explicit recovery link also works when access is lost again.
    await context.clearCookies({ name: 'bnn-test-access' });
    await page.evaluate(() => window.updates.checkAutomaticVersion());
    await page.click('#reconnect'); await page.waitForURL(`${identityOrigin}/login`); await page.click('#authorize');
    await page.waitForFunction(v => window.loadedVersion === v && !!window.updates, candidate);
    await assertDrafts(page, 'repeat access recovery/re-entry preserves drafts');
    metadataFailure = true; await page.evaluate(() => window.updates.checkAutomaticVersion());
    assert.equal(await page.evaluate(() => window.updates.automaticUpdateState().checkFailure), 'server', '503 is not reported as access expiry');
    metadataFailure = false; version = afterCandidate;
    await context.setOffline(true); await page.evaluate(() => window.updates.requestAppUpdate(350));
    assert.equal(await page.evaluate(() => window.loadedVersion), candidate, 'offline update never claims a new running version');
    assert.match(await page.evaluate(() => window.updates.automaticUpdateState().notice), /Update could not finish/);
    await assertDrafts(page, 'failed update preserves drafts'); await context.setOffline(false);
    await page.evaluate(() => window.updates.checkAutomaticVersion()); await page.click('#update');
    await page.waitForFunction(v => window.loadedVersion === v && window.updates.automaticUpdateState().notice.includes('Updated successfully'), afterCandidate);
    await assertDrafts(page, 'retry and second version-to-version update preserve same installation');
    console.log(`same-installation lifecycle: PASS (${engine}; actual update module, ${baseline}→candidate→next fixture release, denied access, cross-origin login, normal/reconnect recovery, re-entry, 503/offline retry, verified restart, drafts retained)`);
  } finally { await context.close(); }
}
(async () => {
  await listen(identity); identityOrigin = `http://127.0.0.1:${identity.address().port}`;
  await listen(app); origin = `http://127.0.0.1:${app.address().port}`;
  let browser;
  try {
    browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await launchUpdateChromium(chromium);
    await matrix(browser); await lifecycle(browser, oldVersion); await lifecycle(browser, previousVersion);
  } finally { if (browser) await browser.close(); await close(app); await close(identity); }
})().catch(error => { console.error(error); process.exitCode = 1; });
