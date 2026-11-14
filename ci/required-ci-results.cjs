// Fail closed: optional staging may be skipped only when this is not a staging -> main PR.
function checkResults(needs, requireStaging) {
  const errors = [];
  for (const name of ['database', 'application', 'charts', 'build']) {
    if (needs?.[name]?.result !== 'success') errors.push(name + ': ' + (needs?.[name]?.result || 'missing'));
  }
  const staging = needs?.['staging-integration']?.result;
  if (requireStaging ? staging !== 'success' : staging !== 'skipped') errors.push('staging-integration: ' + (staging || 'missing'));
  return errors;
}
module.exports = { checkResults };
if (require.main === module) {
  try {
    if (!['true', 'false'].includes(process.env.CI_REQUIRE_STAGING)) throw Error('Missing staging requirement');
    const errors = checkResults(JSON.parse(process.env.CI_JOB_RESULTS || 'null'), process.env.CI_REQUIRE_STAGING === 'true');
    if (errors.length) throw Error(errors.join('; '));
    console.log('verify: PASS — every applicable job succeeded');
  } catch (error) { console.error('verify: FAIL — ' + error.message); process.exitCode = 1; }
}
