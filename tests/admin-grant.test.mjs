import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RULES_BEGIN,
  RULES_END,
  addRulesAdmin,
  grantAdmin,
  setEnvAdminUid,
} from '../scripts/grant-admin.mjs';

const RULES_FIXTURE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isIngestionAdmin() {
      return isSignedIn()
        && (request.auth.token.get('admin', false) == true
            || request.auth.uid in [
              ${RULES_BEGIN}
              ${RULES_END}
            ]);
    }
  }
}
`;

function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'gather-admin-'));
}

// ---------------------------------------------------------------------------
// .env.local
// ---------------------------------------------------------------------------

test('setEnvAdminUid appends VITE_ADMIN_UIDS when the key is missing', () => {
  const next = setEnvAdminUid('VITE_TICKETMASTER_KEY=abc\n', 'uid-one');
  assert.match(next, /VITE_TICKETMASTER_KEY=abc/);
  assert.match(next, /VITE_ADMIN_UIDS=uid-one/);
});

test('setEnvAdminUid merges with existing uids without duplicating', () => {
  const once = setEnvAdminUid('VITE_ADMIN_UIDS=uid-one', 'uid-two');
  assert.equal(once, 'VITE_ADMIN_UIDS=uid-one,uid-two');

  const twice = setEnvAdminUid(once, 'uid-two');
  assert.equal(twice, 'VITE_ADMIN_UIDS=uid-one,uid-two');
});

test('setEnvAdminUid keeps comments and unrelated keys', () => {
  const input = ['# local config', 'VITE_RSS_FEEDS=https://example.org/feed', 'VITE_ADMIN_UIDS='].join(
    '\n',
  );
  const next = setEnvAdminUid(input, 'uid-one');
  assert.equal(
    next,
    ['# local config', 'VITE_RSS_FEEDS=https://example.org/feed', 'VITE_ADMIN_UIDS=uid-one'].join(
      '\n',
    ),
  );
});

test('setEnvAdminUid handles quoted values', () => {
  const next = setEnvAdminUid('VITE_ADMIN_UIDS="uid-one"', 'uid-two');
  assert.equal(next, 'VITE_ADMIN_UIDS=uid-one,uid-two');
});

test('setEnvAdminUid rejects values that are not Firebase uids', () => {
  assert.throws(() => setEnvAdminUid('', 'not a uid'), /not a Firebase uid/);
  assert.throws(() => setEnvAdminUid('', ''), /not a Firebase uid/);
});

// ---------------------------------------------------------------------------
// firestore.rules
// ---------------------------------------------------------------------------

test('addRulesAdmin inserts the uid between the marker comments', () => {
  const next = addRulesAdmin(RULES_FIXTURE, 'uid-one');
  assert.match(
    next,
    /\/\/ BEGIN ingestion admins[^\n]*\n\s+'uid-one',\n\s+\/\/ END ingestion admins/,
  );
  // Structure the rules parser relies on is untouched.
  assert.match(next, /request\.auth\.uid in \[/);
  assert.match(next, /\n\s+\]\);/);
});

test('addRulesAdmin is idempotent and keeps earlier admins', () => {
  const first = addRulesAdmin(RULES_FIXTURE, 'uid-one');
  const second = addRulesAdmin(first, 'uid-two');
  assert.equal(addRulesAdmin(second, 'uid-one'), second);

  const block = second.slice(second.indexOf(RULES_BEGIN), second.indexOf(RULES_END));
  assert.equal(block.match(/'uid-one'/g).length, 1);
  assert.equal(block.match(/'uid-two'/g).length, 1);
});

test('addRulesAdmin refuses rules without the managed markers', () => {
  assert.throws(() => addRulesAdmin("rules_version = '2';", 'uid-one'), /Could not find/);
});

test('the real firestore.rules keeps the safe claim lookup and managed markers', async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const code = rules.replace(/\/\/[^\n]*/g, '');

  // A missing claim must fall through to the uid list instead of erroring.
  assert.match(code, /token\.get\('admin', false\) == true/);
  assert.doesNotMatch(code, /token\.admin/);

  assert.equal((rules.match(/BEGIN ingestion admins/g) || []).length, 1);
  assert.equal((rules.match(/END ingestion admins/g) || []).length, 1);
  assert.ok(rules.indexOf(RULES_BEGIN) < rules.indexOf(RULES_END));
});

// ---------------------------------------------------------------------------
// grantAdmin (end-to-end on temp files)
// ---------------------------------------------------------------------------

test('grantAdmin writes both files and reports the changes', async () => {
  const dir = await tempDir();
  const envPath = path.join(dir, '.env.local');
  const rulesPath = path.join(dir, 'firestore.rules');
  await writeFile(envPath, 'VITE_ADMIN_UIDS=\n', 'utf8');
  await writeFile(rulesPath, RULES_FIXTURE, 'utf8');

  const result = await grantAdmin({ uid: 'uid-one', envPath, rulesPath });
  assert.equal(result.envChanged, true);
  assert.equal(result.rulesChanged, true);

  assert.equal(await readFile(envPath, 'utf8'), 'VITE_ADMIN_UIDS=uid-one\n');
  assert.match(await readFile(rulesPath, 'utf8'), /'uid-one',/);

  const again = await grantAdmin({ uid: 'uid-one', envPath, rulesPath });
  assert.equal(again.envChanged, false);
  assert.equal(again.rulesChanged, false);
});

test('grantAdmin creates .env.local when it is absent', async () => {
  const dir = await tempDir();
  const envPath = path.join(dir, '.env.local');
  const rulesPath = path.join(dir, 'firestore.rules');
  await writeFile(rulesPath, RULES_FIXTURE, 'utf8');

  const result = await grantAdmin({ uid: 'uid-one', envPath, rulesPath });
  assert.equal(result.envCreated, true);
  assert.equal(await readFile(envPath, 'utf8'), 'VITE_ADMIN_UIDS=uid-one');
});

test('grantAdmin --dry-run leaves both files untouched', async () => {
  const dir = await tempDir();
  const envPath = path.join(dir, '.env.local');
  const rulesPath = path.join(dir, 'firestore.rules');
  await writeFile(envPath, 'VITE_ADMIN_UIDS=\n', 'utf8');
  await writeFile(rulesPath, RULES_FIXTURE, 'utf8');

  const result = await grantAdmin({ uid: 'uid-one', envPath, rulesPath, dryRun: true });
  assert.equal(result.envChanged, true);
  assert.equal(result.rulesChanged, true);

  assert.equal(await readFile(envPath, 'utf8'), 'VITE_ADMIN_UIDS=\n');
  assert.equal(await readFile(rulesPath, 'utf8'), RULES_FIXTURE);
});

test('grantAdmin fails loudly when firestore.rules is missing', async () => {
  const dir = await tempDir();
  await assert.rejects(
    grantAdmin({
      uid: 'uid-one',
      envPath: path.join(dir, '.env.local'),
      rulesPath: path.join(dir, 'nope.rules'),
    }),
    /Could not find/,
  );
  assert.equal(existsSync(path.join(dir, '.env.local')), false);
});
