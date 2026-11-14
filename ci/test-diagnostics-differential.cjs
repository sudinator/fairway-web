// Execute baseline/current save helpers with the same inputs and compare every
// observable dependency call, request payload, acknowledgement and return value.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('typescript'), { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const dom = new JSDOM('', { url: 'https://diagnostic-diff.test' }); global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const diagnostics = require(path.join(root, 'lib/phone-diagnostics.ts'));
function load(name, before) {
  const file = before ? `ci/fixtures/${name}-21299.ts.txt` : `lib/${name}.ts`;
  const module = { exports: {} }, source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => require(path.join(root, 'lib', id + '.ts')), module, module.exports);
  return module.exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
async function latest(factory, seed) {
  const calls = [], states = []; let stored = seed % 3 === 0 ? { value: 1 } : null;
  const saver = factory(async value => { calls.push(['send', clone(value)]); await Promise.resolve(); if (value.fail) throw new Error('PRIVATE_SAVE_PAYLOAD'); stored = clone(value); }, state => states.push(clone(state)), (a, b) => JSON.stringify(a) === JSON.stringify(b), value => JSON.stringify(value) === JSON.stringify(stored));
  const values = [{ value: 1 }, { value: seed % 5, fail: seed % 4 === 0 }, { value: seed % 7 }, { value: seed % 2, fail: seed % 3 === 0 }];
  await Promise.all(values.map(value => saver.request(value)));
  await saver.request(values[3]); // retry/re-entry and stored-value bypass
  await saver.request({ value: 9 });
  return { calls, states, stored };
}
async function sync(factory, seed) {
  const calls = [], watermarks = {}, backups = {};
  const blank = () => ({ scores: [], putts: [], fairways: [], penalties: [], sand: [] });
  for (const id of ['a', 'b']) { watermarks[id] = blank(); backups[id] = { scores: [5, 6], putts: [2, 3], fairways: [true, false], penalties: [0, 0], sand: [false, false] }; }
  let paused = seed % 7 === 0, mutated = false;
  const writer = factory({
    paused() { calls.push(['paused', paused]); return paused; },
    backup(id) { calls.push(['backup', id]); return seed % 11 === 0 ? null : clone(backups[id]); },
    watermark(id) { calls.push(['watermark', id]); return clone(watermarks[id]); },
    locked(id) { calls.push(['locked', id]); return seed % 3 === 0; },
    revision() { calls.push(['revision']); },
    async send(id, body, locked, clock) {
      calls.push(['send', id, clone(body), locked, clock || null]); await Promise.resolve();
      if (seed % 5 === 0) throw new Error('PRIVATE_SYNC_PAYLOAD');
      if (seed % 4 === 0) return false;
      if (seed % 6 === 0 && !mutated) { backups[id].putts[0] = 1; mutated = true; }
      return true;
    },
    confirm(id, bundle) { calls.push(['confirm', id, clone(bundle)]); watermarks[id] = clone(bundle); },
  });
  const tasks = [writer.write('a', { attempt: 1 }), writer.write('a', { attempt: 2 }), writer.write('b')];
  const busy = writer.busy; const results = await Promise.all(tasks); await writer.idle(); paused = false;
  results.push(await writer.write('a', { attempt: 3 }));
  return { calls, results, busy, afterBusy: writer.busy, backups, watermarks };
}
(async () => {
  const oldLatest = load('latest-saver', true).createLatestSaver, newLatest = load('latest-saver', false).createLatestSaver;
  const oldSync = load('game-score-sync', true).createGameScoreWriter, newSync = load('game-score-sync', false).createGameScoreWriter;
  let cases = 0;
  for (let seed = 0; seed < 48; seed++) {
    assert.deepEqual(await latest(newLatest, seed), await latest(oldLatest, seed), `latest-saver contract seed ${seed}`); cases++;
    assert.deepEqual(await sync(newSync, seed), await sync(oldSync, seed), `game writer contract seed ${seed}`); cases++;
  }
  const unsubscribe = diagnostics.subscribePhoneDiagnostics(() => { throw new Error('subscriber failure'); });
  const originalSet = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = function(key, value) { if (key.startsWith(diagnostics.DIAGNOSTIC_PREFIX)) throw new Error('quota'); return originalSet.call(this, key, value); };
  for (let seed = 0; seed < 10; seed++) {
    assert.deepEqual(await latest(newLatest, seed), await latest(oldLatest, seed), 'logging failure cannot alter save contract'); cases++;
    assert.deepEqual(await sync(newSync, seed), await sync(oldSync, seed), 'logging failure cannot alter sync contract'); cases++;
  }
  diagnostics.flushPhoneDiagnostics(); unsubscribe(); dom.window.Storage.prototype.setItem = originalSet;
  const report = await diagnostics.buildPhoneDiagnosticReport();
  assert.ok(report.events.some(e => e.event === 'save.start'));
  assert.ok(report.events.some(e => e.event === 'sync.start'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SAVE_PAYLOAD'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SYNC_PAYLOAD'));
  diagnostics.resetPhoneDiagnostics(); dom.window.close();
  console.log(`diagnostic save differential: PASS (${cases} normal/queued/locked/missing/retry/failure/re-entry scenarios; all inputs, payloads, callbacks, dependency calls and results unchanged)`);
})().catch(error => { console.error(error); diagnostics.resetPhoneDiagnostics(); dom.window.close(); process.exitCode = 1; });
