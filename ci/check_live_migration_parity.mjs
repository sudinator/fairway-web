#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const target = (process.argv[2] || '').toLowerCase();
if (!['staging', 'production'].includes(target)) {
  console.error('usage: node ci/check_live_migration_parity.mjs <staging|production>');
  process.exit(2);
}

const prefix = target === 'staging' ? 'BNN_STAGING' : 'BNN_PRODUCTION';
const url = process.env[`${prefix}_SUPABASE_URL`];
const serviceKey = process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`];
if (!url || !serviceKey) {
  console.error(`DATABASE MIGRATION PARITY: FAIL (${target})`);
  console.error(`Missing ${prefix}_SUPABASE_URL or ${prefix}_SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}

function committedLedgerIds() {
  const dir = path.join(root, 'migrations');
  const files = fs.readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  return files
    .filter((name) => Number(name.slice(0, 4)) >= 113)
    .map((name) => name.replace(/\.sql$/, ''));
}

const expected = committedLedgerIds();
let rows;
const fixture = process.env.BNN_MIGRATION_LEDGER_FIXTURE;
if (fixture) {
  rows = JSON.parse(fs.readFileSync(fixture, 'utf8'));
} else {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/schema_migrations?select=id&order=id.asc`;
  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error(`DATABASE MIGRATION PARITY: FAIL (${target})`);
    console.error(`Could not reach Supabase: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (!response.ok) {
    const body = await response.text();
    console.error(`DATABASE MIGRATION PARITY: FAIL (${target})`);
    console.error(`Supabase returned HTTP ${response.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  rows = await response.json();
}
const actual = new Set(rows.map((row) => String(row.id)));
const missing = expected.filter((id) => !actual.has(id));

if (missing.length) {
  console.error(`DATABASE MIGRATION PARITY: FAIL (${target})`);
  console.error(`Repository requires ${expected.length} ledger migrations (0113+).`);
  console.error(`Missing in ${target}:`);
  for (const id of missing) console.error(` - ${id}`);
  process.exit(1);
}

const latest = expected.at(-1) || '(none)';
console.log(`DATABASE MIGRATION PARITY: PASS (${target})`);
console.log(` - repository-required ledger migrations present: ${expected.length}`);
console.log(` - latest required migration: ${latest}`);
