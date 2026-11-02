// Browser launch policy for the update test. GitHub installs Playwright's own
// browser; the authoring runtime may instead provision one under /opt.
const fs = require('node:fs');
const path = require('node:path');
function resolveChromium({ env = process.env, filesystem = fs, directory = '/opt/pw-browsers' } = {}) {
  if (env.PLAYWRIGHT_CHROMIUM) return env.PLAYWRIGHT_CHROMIUM;
  let entries;
  try { entries = filesystem.readdirSync(directory); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  return entries.filter(name => name.startsWith('chromium_headless_shell')).sort()
    .map(name => path.join(directory, name, 'chrome-linux', 'headless_shell'))
    .find(file => filesystem.existsSync(file));
}
function launchUpdateChromium(chromium, options) {
  const executablePath = resolveChromium(options);
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
  });
}
module.exports = { resolveChromium, launchUpdateChromium };
