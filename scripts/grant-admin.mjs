#!/usr/bin/env node
// Authorize a Firebase account as an ingestion admin.
//
// Browser write runs are gated in two places that must agree:
//   .env.local      VITE_ADMIN_UIDS=<uid>      -> the UI shows the admin controls
//   firestore.rules isIngestionAdmin() list    -> Firestore accepts the writes
//
// This command updates both, idempotently:
//
//   npm run admin:grant -- <firebase-uid>
//   npm run admin:grant -- <firebase-uid> --dry-run
//
// It does not deploy: run `firebase deploy --only firestore:rules` afterwards and
// restart `npm run dev`, which reads .env.local only at startup.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RULES_BEGIN = '// BEGIN ingestion admins';
export const RULES_END = '// END ingestion admins';
export const ENV_KEY = 'VITE_ADMIN_UIDS';
export const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function assertValidUid(uid) {
  if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) {
    throw new Error(
      `"${uid ?? ''}" is not a Firebase uid. Copy the 28-character uid shown on /admin/sync after signing in.`,
    );
  }
  return uid;
}

// Adds the uid to VITE_ADMIN_UIDS, keeping every other line (and any existing
// admin uids) untouched. Works whether or not the key already exists.
export function setEnvAdminUid(text, uid) {
  assertValidUid(uid);
  const source = String(text ?? '');
  const uids = new Set();
  let found = false;

  const lines = (source === '' ? [] : source.split('\n')).map((line) => {
    const match = /^\s*VITE_ADMIN_UIDS\s*=\s*(.*)$/.exec(line);
    if (!match) return line;

    found = true;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed) uids.add(trimmed);
    }
    uids.add(uid);
    return `${ENV_KEY}=${[...uids].join(',')}`;
  });

  if (!found) {
    if (source && !source.endsWith('\n')) lines.push('');
    lines.push(`${ENV_KEY}=${uid}`);
  }

  return lines.join('\n');
}

// Inserts the uid between the marker comments inside isIngestionAdmin(). The
// marker region is the source of truth, so repeated runs never duplicate uids.
export function addRulesAdmin(text, uid) {
  assertValidUid(uid);
  const source = String(text ?? '');
  const begin = source.indexOf(RULES_BEGIN);
  const end = source.indexOf(RULES_END);

  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not find "${RULES_BEGIN}" and "${RULES_END}" in firestore.rules. Restore the marker comments inside isIngestionAdmin().`,
    );
  }

  const existing = [...source.slice(begin, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (existing.includes(uid)) return source;

  const lineStart = source.lastIndexOf('\n', begin) + 1;
  const indent = source.slice(lineStart, begin);
  if (!/^[ \t]*$/.test(indent)) {
    throw new Error(`"${RULES_BEGIN}" must sit on its own line in firestore.rules.`);
  }

  const entryIndent = `${indent}  `;
  const body = [...new Set([...existing, uid])]
    .map((value) => `\n${entryIndent}'${value}',`)
    .join('');

  return (
    source.slice(0, begin) +
    `${RULES_BEGIN}${body}\n${indent}${RULES_END}` +
    source.slice(end + RULES_END.length)
  );
}

async function writeAtomic(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, contents, 'utf8');
  await rename(temp, file);
}

export async function grantAdmin({
  uid,
  envPath = path.join(REPO_ROOT, '.env.local'),
  rulesPath = path.join(REPO_ROOT, 'firestore.rules'),
  dryRun = false,
} = {}) {
  assertValidUid(uid);

  if (!existsSync(rulesPath)) throw new Error(`Could not find ${rulesPath}`);
  const rulesText = await readFile(rulesPath, 'utf8');

  const envExists = existsSync(envPath);
  const envText = envExists ? await readFile(envPath, 'utf8') : '';

  const nextEnv = setEnvAdminUid(envText, uid);
  const nextRules = addRulesAdmin(rulesText, uid);
  const envChanged = nextEnv !== envText;
  const rulesChanged = nextRules !== rulesText;

  if (!dryRun) {
    if (envChanged) await writeAtomic(envPath, nextEnv);
    if (rulesChanged) await writeAtomic(rulesPath, nextRules);
  }

  return {
    uid,
    envPath,
    rulesPath,
    envChanged,
    rulesChanged,
    envCreated: !envExists,
    dryRun,
  };
}

export function formatResult(result) {
  const verb = result.dryRun ? 'would update' : result.envChanged ? 'updated' : 'already set';
  const rulesVerb = result.dryRun
    ? 'would update'
    : result.rulesChanged
      ? 'updated'
      : 'already set';

  return [
    `Ingestion admin: ${result.uid}`,
    '',
    `  .env.local        ${verb}`,
    `  firestore.rules   ${rulesVerb}`,
    '',
    'Next:',
    '  1. npx firebase-tools deploy --only firestore:rules',
    '  2. restart `npm run dev` (Vite reads .env.local at startup)',
    '  3. sign in at http://localhost:5173/admin/sync and press "Run sync now"',
  ].join('\n');
}

async function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const uid = args.find((arg) => !arg.startsWith('--'));

  if (!uid) {
    console.error(
      'Usage: npm run admin:grant -- <firebase-uid> [--dry-run]\n\n' +
        'Find your uid on /admin/sync after signing in, or in the Firebase console.',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await grantAdmin({ uid, dryRun });
    console.log(formatResult(result));
  } catch (error) {
    console.error(`\n✖ ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) await main(process.argv);
