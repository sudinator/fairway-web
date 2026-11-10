const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function inspect(workflow, scripts, manual) {
  const errors = [];
  const job = name => workflow.match(new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))', 'm'))?.[1] || '';
  for (const name of ['database', 'application', 'charts', 'build']) {
    if (!job(name) || /needs:|continue-on-error:/.test(job(name))) errors.push(name + ' must run independently and fail closed');
  }
  if (!job('verify').includes('if: always()') ||
      !job('verify').includes('needs: [database, application, charts, build, staging-integration]') ||
      !job('verify').includes('node ci/required-ci-results.cjs') ||
      !job('verify').includes('CI_JOB_RESULTS: ${{ toJSON(needs) }}') ||
      !job('verify').includes("CI_REQUIRE_STAGING: ${{ github.event_name == 'pull_request' && github.base_ref == 'main' && github.head_ref == 'staging' }}")) errors.push('verify must require every applicable job');
  if (!job('database').includes('ci/test_fresh_db_rebuild.sh') || !job('database').includes('ci/check_live_migration_parity.mjs staging')) errors.push('database reconstruction and parity must remain');
  if (!job('database').includes('run: npm ci')) errors.push('database freshness harness needs installed compiler and app dependencies');
  for (const [name, command] of [['application', 'npm run ci:app'], ['charts', 'npm run test:charts'], ['build', 'npm run build']]) {
    if (!job(name).includes(command)) errors.push(name + ' command missing');
  }
  for (const command of ['test:scoring-device', 'test:round-editor', 'test:game-recovery', 'lint:hooks', 'test:ci-workflow', 'guards:lifecycle', 'guards']) {
    if (!scripts['ci:app'].includes('npm run ' + command)) errors.push('application lost ' + command);
  }
  for (const command of ['npx tsc --noEmit', 'npm test', 'node ci/test-ticking-clock.cjs', 'npm run test:setup-nav']) {
    if (!scripts['ci:app'].includes(command)) errors.push('application lost ' + command);
  }
  if (scripts.ci !== 'npm run ci:app && npm run test:charts && npm run build') errors.push('local ci must retain all lanes');
  const integration = job('staging-integration');
  for (const text of ['needs: [database, application, charts, build]', "github.base_ref == 'main'", "github.head_ref == 'staging'", 'BNN_STAGING_ALLOW_MUTATION: YES', 'BNN_PRODUCTION_SUPABASE_PROJECT_REF: epmbsmykyrnoiccwnoxq', 'run: npm run test:staging']) {
    if (!integration.includes(text)) errors.push('integration lost ' + text);
  }
  for (const text of [integration, manual]) {
    if (!text.includes('group: bnn-staging-integration') || !text.includes('cancel-in-progress: false')) errors.push('staging cleanup must not overlap or be cancelled');
  }
  if (/continue-on-error:/.test(workflow)) errors.push('no required job may ignore failures');
  return errors;
}
module.exports = { inspect };
if (require.main === module) {
  const errors = inspect(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts,
    fs.readFileSync(path.join(root, '.github/workflows/staging-integration.yml'), 'utf8'));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('CI lanes: PASS — independent execution, full coverage, fail-closed verify and serialized staging');
}
