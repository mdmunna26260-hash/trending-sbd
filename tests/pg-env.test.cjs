/* pg_dump credential handling.

   Both backup paths used to pass the whole DATABASE_URL as a pg_dump command-line
   argument. argv is world-readable on the host, so the production Postgres password sat
   in `ps aux` and /proc/<pid>/cmdline for the life of every dump. lib/pg-env.ts builds
   the libpq PG* environment instead; scripts/backup.js (plain CommonJS, run standalone
   from cron) carries a mirror of it. These tests cover the shared module and assert the
   mirror cannot drift. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loader } = require('./load-ts.cjs');

const ROOT = path.resolve(__dirname, '..');

// lib/pg-env.ts is deliberately dependency-free, so no mocks are needed.
const { pgEnvFromUrl, isPostgresUrl } = loader()('lib/pg-env.ts');

/* scripts/backup.js runs its backup immediately when required, so the mirrored function
   is lifted out of the source and evaluated on its own. A fresh vm context has the
   ECMAScript built-ins but NOT Node's globals, and URL is a Node global — without it the
   mirror's `new URL()` would throw, land in its own catch, and quietly look like it had
   parsed nothing. */
function mirroredPgEnv() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/backup.js'), 'utf8');
  const start = src.indexOf('function pgEnvFromUrl');
  assert.ok(start > -1, 'scripts/backup.js no longer contains a pgEnvFromUrl mirror');
  const fn = vm.runInNewContext('(' + src.slice(start) + ')', { URL });
  assert.equal(typeof fn, 'function');
  return fn;
}

const URL_FULL = 'postgresql://sinzo:s3cr3t%2Fpw@db.internal:5432/sinzo_live?sslmode=require';

test('the connection is built as PG* env, never as an argv URL', () => {
  const env = pgEnvFromUrl(URL_FULL, { PATH: '/usr/bin' });
  assert.equal(env.PGHOST, 'db.internal');
  assert.equal(env.PGPORT, '5432');
  assert.equal(env.PGUSER, 'sinzo');
  assert.equal(env.PGPASSWORD, 's3cr3t/pw', 'percent-encoding must be decoded');
  assert.equal(env.PGDATABASE, 'sinzo_live');
  assert.equal(env.PGSSLMODE, 'require');
  assert.equal(env.PATH, '/usr/bin', 'unrelated environment must survive');
});

test('an ambient PGPASSWORD cannot survive into the child process', () => {
  const env = pgEnvFromUrl('postgresql://u@h/db', { PGPASSWORD: 'STALE-FROM-PARENT' });
  assert.equal(env.PGPASSWORD, undefined);
  // a URL that does carry one wins over nothing
  assert.equal(pgEnvFromUrl('postgresql://u:real@h/db', { PGPASSWORD: 'STALE' }).PGPASSWORD, 'real');
});

test('a non-postgres or unparseable URL yields no connection settings', () => {
  for (const bad of ['not a url', 'file:./dev.db', '', 'mysql://u:p@h/db']) {
    const env = pgEnvFromUrl(bad, { PATH: '/usr/bin' });
    assert.equal(env.PGHOST, undefined, `${bad} set PGHOST`);
    assert.equal(env.PGDATABASE, undefined, `${bad} set PGDATABASE`);
    assert.equal(env.PGUSER, undefined, `${bad} set PGUSER`);
    assert.equal(env.PATH, '/usr/bin');
  }
  assert.ok(isPostgresUrl('postgresql://u@h/db'));
  assert.ok(isPostgresUrl('postgres://u@h/db'));
  assert.ok(!isPostgresUrl('file:./dev.db'));
  assert.ok(!isPostgresUrl(undefined));
});

test('the postgres: and postgresql: schemes both work', () => {
  assert.equal(pgEnvFromUrl('postgres://u:p@h:5433/db').PGPORT, '5433');
  assert.equal(pgEnvFromUrl('postgresql://u:p@h:5433/db').PGPORT, '5433');
});

test('the CommonJS mirror in scripts/backup.js agrees with lib/pg-env.ts', () => {
  const mirror = mirroredPgEnv();
  const cases = [
    [URL_FULL, { PATH: '/usr/bin', PGPASSWORD: 'STALE' }],
    ['postgres://u@h/db', {}],
    ['postgresql://user%40host:pa%3Ass@10.0.0.5:5432/sinzo', { HOME: '/root' }],
    ['not a url', { PATH: '/usr/bin' }],
    ['file:./dev.db', {}],
    ['', {}],
  ];
  for (const [url, base] of cases) {
    const a = pgEnvFromUrl(url, base);
    const b = mirror(url, base);
    // Compare only the PG* keys plus proof the base survived: the TS copy types its
    // return as a record, the JS copy returns a plain object, and key order is not part
    // of the contract.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k.startsWith('PG') || k in base));
    for (const k of keys) {
      assert.equal(a[k], b[k], `mirror drifted on ${JSON.stringify(url)} → ${k}: ${a[k]} vs ${b[k]}`);
    }
  }
});

test('no pg_dump invocation passes the URL as an argument', () => {
  for (const file of ['lib/backup.ts', 'scripts/backup.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const calls = src.match(/spawnSync\(\s*"pg_dump"[\s\S]{0,240}?\]\s*,/g) || [];
    assert.ok(calls.length > 0, `${file}: expected a pg_dump spawnSync`);
    for (const call of calls) {
      // The argument array must contain only flags and the target path.
      assert.ok(!/DATABASE_URL/.test(call), `${file}: DATABASE_URL still on argv → ${call}`);
      assert.ok(!/,\s*url\s*\]/.test(call), `${file}: url still on argv → ${call}`);
      assert.ok(/pgEnvFromUrl/.test(src.slice(src.indexOf(call))), `${file}: pg_dump call does not use pgEnvFromUrl`);
    }
  }
});
