const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const [name, command, ...args] = process.argv.slice(2);
if (!/^[a-z-]+$/.test(name || '') || !command) throw Error('Usage: time-command NAME COMMAND [ARGS]');
const start = performance.now();
const run = spawnSync(command, args, { stdio: 'inherit', env: process.env });
const record = { lane: name, seconds: +( (performance.now() - start) / 1000).toFixed(3),
  exitCode: run.status ?? 1, signal: run.signal, commit: process.env.GITHUB_SHA || 'local',
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || 'local', node: process.version };
fs.mkdirSync('ci-timings', { recursive: true });
fs.writeFileSync(path.join('ci-timings', name + '.json'), JSON.stringify(record, null, 2) + '\n');
console.log('CI timing: ' + JSON.stringify(record));
if (run.error) console.error(run.error.message);
process.exitCode = record.exitCode;
