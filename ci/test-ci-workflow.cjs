const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const { checkResults } = require('./required-ci-results.cjs');
const { inspect } = require('./check-ci-lanes.cjs');
let checks = 0; function ok(value, msg) { checks++; assert.ok(value, msg); }
const names = ['database', 'application', 'charts', 'build', 'staging-integration'];
const states = ['success', 'failure', 'cancelled', 'skipped', 'missing'];
// Enumerate every result combination, including absent results and prerequisite failures.
for (let n = 0; n < 3125; n++) for (const required of [true, false]) {
  let k = n, needs = {}, expected = true;
  for (const name of names) { const state = states[k % 5]; k = Math.floor(k / 5);
    if (state !== 'missing') needs[name] = { result: state };
    expected = expected && state === (name === 'staging-integration' && !required ? 'skipped' : 'success');
  }
  ok((checkResults(needs, required).length === 0) === expected, 'gate outcome ' + n + '/' + required);
}
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
const manual = fs.readFileSync(path.join(root, '.github/workflows/staging-integration.yml'), 'utf8');
ok(inspect(workflow, scripts, manual).length === 0, 'actual workflow contract');
ok(inspect(workflow.replace('run: npm ci', 'run: REMOVED'), scripts, manual).length > 0, 'database compiler dependencies retained');
for (const needle of ['if: always()', 'node ci/required-ci-results.cjs', 'ci/test_fresh_db_rebuild.sh', 'ci/check_live_migration_parity.mjs staging', 'npm run ci:app', 'npm run test:charts', 'npm run build', 'run: npm run test:staging']) {
  ok(inspect(workflow.replaceAll(needle, 'REMOVED'), scripts, manual).length > 0, 'reject lost ' + needle);
}
for (const command of ['npm test', 'npx tsc --noEmit', 'node ci/test-ticking-clock.cjs', 'npm run guards']) {
  ok(inspect(workflow, { ...scripts, 'ci:app': scripts['ci:app'].replace(command, 'REMOVED') }, manual).length > 0, 'reject lost app check ' + command);
}
ok(inspect(workflow, scripts, manual.replace('cancel-in-progress: false', 'cancel-in-progress: true')).length > 0, 'manual cancellation rejected');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnn-ci-timing-'));
try {
  for (const exit of [0, 7]) {
    const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'time-command.cjs'), 'probe', process.execPath, '-e', 'process.exit(' + exit + ')'], { cwd: dir });
    ok(run.status === exit, 'timing wrapper preserves exit ' + exit);
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'ci-timings/probe.json'), 'utf8'));
    ok(record.exitCode === exit && record.seconds >= 0, 'timing evidence ' + exit);
  }
  const malformed = cp.spawnSync(process.execPath, [path.join(__dirname, 'required-ci-results.cjs')], { env: { ...process.env, CI_REQUIRE_STAGING: '', CI_JOB_RESULTS: '{}' } });
  ok(malformed.status === 1, 'CLI fails on missing requirement');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('CI workflow: ' + checks + ' checks PASS');
