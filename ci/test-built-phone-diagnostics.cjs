// Optional post-build smoke against a running LOCAL Next build only.
// No live account, server mutation, or production traffic is permitted.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { launchUpdateChromium } = require('./playwright-browser.cjs');
const origin = process.env.BNN_DIAGNOSTIC_TEST_ORIGIN || 'http://127.0.0.1:41300';
const parsed = new URL(origin);
assert.ok(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname), 'built smoke requires an explicit local server');
const out = path.resolve(process.env.BNN_DIAGNOSTIC_TEST_OUT || '.built-diagnostics-test');
const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
(async () => {
  const browser = await launchUpdateChromium(chromium);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(origin); await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => { localStorage.setItem('bnn_round_draft_v1', 'PRIVATE_TEST_DRAFT'); await fetch('/api/diagnostic-local-missing'); });
    await page.locator('[data-phone-diagnostics] summary').click();
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'login-diagnostics-390.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone view has no horizontal overflow');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export diagnostic report' }).click()]);
    const destination = path.join(out, 'local-export.json'); await download.saveAs(destination);
    const report = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(report.schema, 'bnn-phone-diagnostics/v1'); assert.equal(report.app.version, version);
    assert.equal(report.worker.workerVersion, version);
    assert.ok(report.events.some(e => e.event === 'app.launch'), 'RootLayout actually mounts recorder');
    assert.ok(report.events.some(e => e.event === 'network.result' && e.details.status === 404), 'actual app fetch is observed');
    assert.ok(!JSON.stringify(report).includes('PRIVATE_TEST_DRAFT'));
    assert.equal(await page.evaluate(() => localStorage.getItem('bnn_round_draft_v1')), 'PRIVATE_TEST_DRAFT');
    assert.ok((await page.locator('[data-phone-diagnostics]').innerText()).includes('Report download requested'));
    await context.close();
    console.log('built phone diagnostic export: PASS (actual compiled app, 390px Login support panel, mounted recorder, real download JSON, real worker version, observed 404, private draft retained/excluded)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
