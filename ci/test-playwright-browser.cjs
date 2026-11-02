// EXECUTED launch-policy regression, MODELLED filesystem/browser availability.
// Every scenario calls the same launcher as the real update browser test.
const assert = require('node:assert/strict');
const { resolveChromium, launchUpdateChromium } = require('./playwright-browser.cjs');
const missing = () => { const error = new Error('directory absent'); error.code = 'ENOENT'; throw error; };
(async () => {
  let calls = 0, received;
  const browser = { testBrowser: true };
  const chromium = { launch: async options => { calls++; received = options; return browser; } };
  const ci = { env: {}, filesystem: { readdirSync: missing } };
  assert.equal(await launchUpdateChromium(chromium, ci), browser);
  assert.equal(calls, 1);
  assert.ok(!Object.hasOwn(received, 'executablePath'), 'missing /opt must use the Playwright default, not skip execution');
  assert.ok(received.args.includes('--no-sandbox'), 'launch arguments are preserved');
  const local = { env: {}, filesystem: { readdirSync: () => ['unrelated', 'chromium_headless_shell-local'], existsSync: file => file.endsWith('/chrome-linux/headless_shell') } };
  await launchUpdateChromium(chromium, local);
  assert.equal(received.executablePath, '/opt/pw-browsers/chromium_headless_shell-local/chrome-linux/headless_shell');
  await launchUpdateChromium(chromium, { env: { PLAYWRIGHT_CHROMIUM: '/custom/chromium' }, filesystem: { readdirSync: () => { throw Error('override must not scan /opt'); } } });
  assert.equal(received.executablePath, '/custom/chromium');
  await launchUpdateChromium(chromium, { env: {}, filesystem: { readdirSync: () => ['chromium_headless_shell-stale'], existsSync: () => false } });
  assert.ok(!Object.hasOwn(received, 'executablePath'), 'stale provisioned directory falls back to installed Playwright');
  await launchUpdateChromium(chromium, { env: {}, filesystem: { readdirSync: () => ['other'], existsSync: () => false } });
  assert.ok(!Object.hasOwn(received, 'executablePath'), 'unrelated /opt contents do not become a browser path');
  const denied = new Error('permission denied'); denied.code = 'EACCES';
  assert.throws(() => resolveChromium({ env: {}, filesystem: { readdirSync: () => { throw denied; } } }), /permission denied/);
  await assert.rejects(launchUpdateChromium({ launch: async () => { throw Error('Playwright browser not installed'); } }, ci), /browser not installed/, 'a genuinely missing browser still fails the test');
  console.log('Playwright browser discovery: PASS (missing /opt, local provisioned, explicit override, stale/unrelated entries, permission error, missing installation; no skipped browser execution)');
})().catch(error => { console.error(error); process.exitCode = 1; });
