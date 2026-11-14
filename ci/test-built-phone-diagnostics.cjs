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
    await page.evaluate(v => sessionStorage.setItem('bnn-update-attempt', v), version);
    await page.reload(); await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => { localStorage.setItem('bnn_round_draft_v1', 'PRIVATE_TEST_DRAFT'); await fetch('/api/diagnostic-local-missing'); });
    await page.locator('[data-phone-diagnostics] summary').click();
    await page.getByText('Matches installed app', { exact: true }).waitFor();
    assert.ok((await page.locator('[data-diagnostic-summary]').innerText()).includes(`Updated successfully to version ${version}`), 'verified update result is readable');
    await page.getByRole('button', { name: 'Refresh summary' }).click();
    await page.getByText('Refresh summary', { exact: true }).waitFor();
    assert.ok((await page.locator('[data-diagnostic-summary]').innerText()).includes('Succeeded'), 'manual summary refresh checks latest version');
    await page.getByRole('textbox', { name: 'What went wrong? (optional)' }).fill('The test scorecard stopped responding after reconnecting.');
    fs.mkdirSync(out, { recursive: true });
    const scroller = page.locator('[data-login-scroll]');
    await scroller.evaluate(el => { el.scrollTop = 0; });
    assert.ok(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), 'expanded sign-in diagnostics own a scroll area inside the locked body');
    await page.screenshot({ path: path.join(out, 'login-diagnostics-390-top.png') });
    await scroller.hover(); await page.mouse.wheel(0, 2500);
    await page.waitForFunction(() => document.querySelector('[data-login-scroll]').scrollTop > 100);
    const exportBox = await page.getByRole('button', { name: 'Export diagnostic report' }).boundingBox();
    assert.ok(exportBox.y >= 0 && exportBox.y + exportBox.height <= 844, 'natural scroll reaches export without locator auto-scrolling');
    await page.screenshot({ path: path.join(out, 'login-diagnostics-390-bottom.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone view has no horizontal overflow');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export diagnostic report' }).click()]);
    const destination = path.join(out, 'local-export.json'); await download.saveAs(destination);
    const report = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(report.schema, 'bnn-phone-diagnostics/v1'); assert.equal(report.app.version, version);
    assert.equal(report.worker.workerVersion, version);
    assert.equal(report.userDescription, 'The test scorecard stopped responding after reconnecting.');
    assert.equal(report.updateStatus.lastOutcome.status, 'success');
    assert.ok(!JSON.stringify(report.events).includes('test scorecard stopped responding'), 'user context is separate from automatic records');
    assert.ok(!await page.evaluate(() => Object.values(localStorage).some(value => value.includes('test scorecard stopped responding'))), 'user context is not persisted');
    assert.ok(report.events.some(e => e.event === 'app.launch'), 'RootLayout actually mounts recorder');
    assert.ok(report.events.some(e => e.event === 'network.result' && e.details.status === 404), 'actual app fetch is observed');
    assert.ok(!JSON.stringify(report).includes('PRIVATE_TEST_DRAFT'));
    assert.equal(await page.evaluate(() => localStorage.getItem('bnn_round_draft_v1')), 'PRIVATE_TEST_DRAFT');
    assert.ok((await page.locator('[data-phone-diagnostics]').innerText()).includes('Report download requested'));
    await page.reload();
    await page.locator('[data-phone-diagnostics] summary').click();
    await page.getByText('Matches installed app', { exact: true }).waitFor();
    assert.ok((await page.locator('[data-diagnostic-summary]').innerText()).includes(`Updated successfully to version ${version}`), 'last result survives a full reload');
    assert.equal(await page.getByRole('textbox', { name: 'What went wrong? (optional)' }).inputValue(), '', 'user context does not survive reload');
    assert.equal(await page.getByRole('complementary', { name: 'App update' }).count(), 0, 'retained result does not replay the banner');
    for (const [width, height] of [[320, 844], [390, 844], [440, 844], [390, 460]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(h => document.querySelector('[data-login-scroll]').clientHeight <= h, height);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `summary/description fit ${width}px`);
      await scroller.hover(); await page.mouse.wheel(0, -5000);
      await page.waitForFunction(() => document.querySelector('[data-login-scroll]').scrollTop === 0);
      const signInBox = await page.getByRole('button', { name: 'Continue with Google' }).boundingBox();
      assert.ok(signInBox.y >= 0 && signInBox.y + signInBox.height <= height, `sign-in remains reachable at ${width}×${height}`);
      await scroller.hover(); await page.mouse.wheel(0, 5000);
      await page.waitForFunction(() => document.querySelector('[data-login-scroll]').scrollTop > 100);
      const box = await page.getByRole('button', { name: 'Export diagnostic report' }).boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height, `export remains reachable at ${width}×${height}`);
    }
    await context.close();
    console.log('built phone diagnostic export: PASS (actual compiled app; readable worker/update/check/storage summary, refresh, real download with optional context, context privacy, result survives reload without banner replay, context resets, natural scroll at 320/390/440px and 460px-height shrink, private draft retained/excluded)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
